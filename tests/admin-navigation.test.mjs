import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';

const APP = 'https://app.example.invalid';
let originalApp;
beforeEach(() => { originalApp = process.env.NEXT_PUBLIC_APP_URL; process.env.NEXT_PUBLIC_APP_URL = APP; });
afterEach(() => { if (originalApp === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = originalApp; });

function redirect(url) { const error = new Error('Framework redirect'); error.url = url; throw error; }
async function redirected(run) {
  try { await run(); assert.fail('Expected framework redirect'); }
  catch (error) { assert.equal(typeof error.url, 'string'); return new URL(error.url, APP); }
}
function elements(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, predicate));
  if (!node || typeof node !== 'object' || !node.props) return [];
  return [...(predicate(node) ? [node] : []), ...elements(node.props.children, predicate)];
}
function hiddenNext(tree) { return elements(tree, node => node.type === 'input' && node.props.name === 'next')[0]?.props.value; }
function hrefTo(tree, path) { return elements(tree, node => typeof node.props.href === 'string' && new URL(node.props.href, APP).pathname === path)[0]?.props.href; }
async function fixture({ signInError = null, signUpError = null, exchangeError = null, throwSignUp = false, throwSignIn = false, throwExchange = false, claims = null, user = null, userError = null } = {}) {
  const calls = [];
  const db = { auth: {
    async getClaims() { calls.push(['getClaims']); return { data: { claims }, error: null }; },
    async getUser() { calls.push(['getUser']); return { data: { user }, error: userError }; },
    async signInWithPassword(value) { calls.push(['signInWithPassword', value]); if (throwSignIn) throw new Error('Private provider diagnostics'); return { error: signInError }; },
    async signUp(value) { calls.push(['signUp', value]); if (throwSignUp) throw new Error('Private provider diagnostics'); return { error: signUpError }; },
    async exchangeCodeForSession(value) { calls.push(['exchangeCodeForSession', value]); if (throwExchange) throw new Error('Private provider diagnostics'); return { error: exchangeError }; },
  }, rpc() { throw new Error('Auth navigation must never claim admin or read tenant/global data'); } };
  // These regression cases model established approved accounts; pending access is tested separately.
  const loader = await createSourceLoader({
    '@/lib/platform-admin/context': { getPlatformAdminContext: async () => null },
    '@/lib/account-access/context': { getAccountAccessContext: async () => ({ status: 'approved', emailVerified: true }) },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => db },
    'next/navigation': { redirect },
    'next/server': { NextResponse: { redirect: url => ({ location: String(url), status: 307 }) } },
    'next/headers': { cookies: () => { throw new Error('No tenant cookie access during admin auth navigation'); } },
    'next/cache': { revalidatePath: () => { throw new Error('No privileged invalidation during navigation'); } },
    './company-context': { getCompanySession: () => { throw new Error('No dealer context during admin auth navigation'); } },
    'next/link': function Link() {}, '@/components/auth-shell': { AuthShell: function AuthShell() {} },
  });
  return { calls, loader, actions: loader.load('./src/lib/data/actions.ts'), callback: loader.load('./src/app/auth/callback/route.ts') };
}
function credentials(patch = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ email: 'hekmat.h@trafexa.com', password: 'Fixture-password-123', acknowledgement: 'yes', next: '/admin', ...patch })) form.set(key, value);
  return form;
}

test('login retains its destination but offers an application instead of open registration', async () => {
  const { loader, calls } = await fixture();
  const login = await loader.load('./src/app/login/page.tsx').default({ searchParams: Promise.resolve({ next: '/admin' }) });
  assert.equal(hiddenNext(login), '/admin');
  assert.equal(hrefTo(login, '/register'), undefined);
  assert.equal(elements(login, node => node.props.href === 'https://trafexa.com/#kontakt').length, 1);
  const register = await redirected(() => loader.load('./src/app/register/page.tsx').default({ searchParams: Promise.resolve({ next: '/admin' }) }));
  assert.equal(register.href, 'https://trafexa.com/#kontakt');
  assert.ok(calls.length > 0); assert.ok(calls.every(call => ['getClaims', 'getUser'].includes(call[0])));
});

test('stale signup submissions lead to the application without creating an Auth user or confirmation email', async () => {
  const { actions, calls } = await fixture();
  const result = await redirected(() => actions.signupAction(credentials()));
  assert.equal(result.href, 'https://trafexa.com/#kontakt');
  assert.deepEqual(calls, []);
});

test('closed signup ignores submitted credentials and never contacts the Auth provider', async () => {
  const cases = [
    [{}, { email: 'invalid' }], [{}, { password: 'short' }], [{}, { acknowledgement: 'no' }],
    [{ signUpError: { message: 'Private provider diagnostics' } }, {}], [{ throwSignUp: true }, {}],
  ];
  for (const [options, patch] of cases) {
    const { actions, calls } = await fixture(options);
    const result = await redirected(() => actions.signupAction(credentials(patch)));
    assert.equal(result.href, 'https://trafexa.com/#kontakt');
    assert.equal(result.toString().includes('Private'), false);
    assert.equal(calls.length, 0);
  }
});

test('login success, rejected credentials and invalid fields all retain the admin return destination', async () => {
  const good = await fixture();
  assert.equal((await redirected(() => good.actions.loginAction(credentials()))).pathname, '/admin');
  for (const [options, patch] of [[{ signInError: { message: 'Private provider diagnostics' } }, {}], [{ throwSignIn: true }, {}], [{}, { email: 'invalid' }], [{}, { password: '' }]]) {
    const { actions, calls } = await fixture(options);
    const result = await redirected(() => actions.loginAction(credentials(patch)));
    assert.equal(result.pathname, '/login'); assert.equal(result.searchParams.get('next'), '/admin');
    assert.ok(result.searchParams.get('error')); assert.equal(result.toString().includes('Private'), false);
    if (Object.keys(patch).length) assert.equal(calls.length, 0);
  }
});

test('a stale JWT without a real Auth user cannot loop from admin login straight back to admin', async () => {
  for (const userError of [null, { message: 'Private revoked identity detail' }]) {
    const { loader, calls } = await fixture({ claims: { sub: '11111111-1111-4111-8111-111111111111' }, user: null, userError });
    const login = await loader.load('./src/app/login/page.tsx').default({ searchParams: Promise.resolve({ next: '/admin' }) });
    assert.equal(hiddenNext(login), '/admin');
    assert.deepEqual(calls, [['getUser']]);
  }
});

test('a freshly verified Auth user returns directly to admin without an implicit access claim', async () => {
  const { loader, calls } = await fixture({ user: { id: '11111111-1111-4111-8111-111111111111', email: 'hekmat.h@trafexa.com', email_confirmed_at: '2026-10-13T18:00:00Z' } });
  const result = await redirected(() => loader.load('./src/app/login/page.tsx').default({ searchParams: Promise.resolve({ next: '/admin' }) }));
  assert.equal(result.pathname, '/admin');
  assert.deepEqual(calls, [['getUser']]);
});

test('failed, missing and rejected callback exchange returns to admin login without an automatic claim', async () => {
  for (const [options, code] of [[{}, null], [{ exchangeError: { message: 'Private provider diagnostics' } }, 'code'], [{ throwExchange: true }, 'code']]) {
    const { callback, calls } = await fixture(options);
    const nextUrl = new URL('/auth/callback?next=/admin', APP);
    if (code) nextUrl.searchParams.set('code', code);
    const response = await callback.GET({ nextUrl });
    const result = new URL(response.location);
    assert.equal(result.origin, APP); assert.equal(result.pathname, '/login');
    assert.equal(result.searchParams.get('next'), '/admin'); assert.ok(result.searchParams.get('error'));
    assert.equal(result.toString().includes('Private'), false);
    assert.deepEqual(calls.map(call => call[0]), code ? ['exchangeCodeForSession'] : []);
  }
});

test('untrusted next cannot become an external redirect in pages, signup, login or callback', async () => {
  for (const next of ['https://outside.invalid/admin', '//outside.invalid/admin', '/\\outside.invalid/admin', '/admin\n', 'javascript:alert(1)']) {
    const { loader, actions, callback, calls } = await fixture();
    const query = { searchParams: Promise.resolve({ next }) };
    const login = await loader.load('./src/app/login/page.tsx').default(query);
    const register = await redirected(() => loader.load('./src/app/register/page.tsx').default(query));
    assert.equal(hiddenNext(login), '/dashboard'); assert.equal(register.href, 'https://trafexa.com/#kontakt');
    const signedIn = await redirected(() => actions.loginAction(credentials({ next })));
    assert.equal(signedIn.origin, APP); assert.equal(signedIn.pathname, '/dashboard');
    const signupDestination = await redirected(() => actions.signupAction(credentials({ next })));
    assert.equal(signupDestination.href, 'https://trafexa.com/#kontakt');
    assert.equal(calls.some(call => call[0] === 'signUp'), false);
    const nextUrl = new URL('/auth/callback', APP); nextUrl.searchParams.set('code', 'code'); nextUrl.searchParams.set('next', next);
    assert.equal((await callback.GET({ nextUrl })).location, `${APP}/dashboard`);
  }
});
