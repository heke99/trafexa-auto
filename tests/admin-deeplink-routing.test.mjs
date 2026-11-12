import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server.js';
import { createSourceLoader } from './helpers/source-loader.mjs';

const origin = 'https://app.trafexa.com';
const actor = '10000000-0000-4000-8000-000000000001';
const company = '10000000-0000-4000-8000-000000000002';
const program = `/admin/annonsprogram/${company}`;

function redirect(url) { throw Object.assign(new Error('Framework redirect'), { url }); }
async function destination(run) {
  try { await run(); } catch (error) {
    assert.equal(typeof error.url, 'string');
    return new URL(error.url, origin);
  }
  assert.fail('Expected framework redirect');
}

async function fixture({ claims = false, freshAuth = false, admin = true } = {}) {
  const previous = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'synthetic-public';
  const state = { claims, freshAuth, admin, calls: [] };
  const user = { id: actor, email: 'admin@fixture.invalid', email_confirmed_at: '2026-11-12T12:00:00Z' };
  const db = {
    auth: {
      async getUser() { state.calls.push('getUser'); return { data: { user: state.freshAuth ? user : null }, error: null }; },
      async signInWithPassword() { state.calls.push('signIn'); state.freshAuth = true; return { error: null }; },
    },
    async rpc(name) {
      state.calls.push(name);
      if (name === 'get_platform_admin_session') return state.admin
        ? { data: { is_platform_admin: true, user_id: actor }, error: null }
        : { data: null, error: { code: '42501' } };
      assert.fail(`Unexpected business read: ${name}`);
    },
  };
  const loader = await createSourceLoader({
    'next/navigation': { redirect, notFound() { throw Object.assign(new Error('Not found'), { status: 404 }); } },
    'next/cache': { revalidatePath() { assert.fail('Login must not mutate business data'); } },
    'next/headers': { cookies() { assert.fail('Login must not select a company'); } },
    '@supabase/ssr': { createServerClient(_url, _key, { cookies }) {
      return { auth: { async getClaims() {
        cookies.setAll([{ name: 'synthetic-session', value: 'refreshed', options: { httpOnly: true } }]);
        return { data: { claims: state.claims ? { sub: actor } : null }, error: null };
      } } };
    } },
    '@/lib/supabase/server': { async createServerSupabaseClient() { return db; } },
    './company-context': { getCompanySession() { assert.fail('Login must not require a company'); } },
    './create-record-actions': {},
  });
  return {
    state,
    proxy: request => loader.load('src/proxy.ts').proxy(request),
    login: next => { const form = new FormData(); form.set('next', next); form.set('email', user.email); form.set('password', 'synthetic-password'); return loader.load('@/lib/data/actions').loginAction(form); },
    page: result => loader.load('src/app/admin/annonsprogram/[companyId]/page.tsx').default({ params: Promise.resolve({ companyId: company }), searchParams: Promise.resolve(result === undefined ? {} : { result }) }),
    close() {
      for (const [index, key] of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'].entries()) {
        if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
      }
    },
  };
}

test('anonymous admin links keep the complete local destination, refreshed cookies and return after login', async () => {
  const h = await fixture();
  try {
    for (const target of ['/admin', program, `${program}?result=saved&filter=a%26b&filter=c`]) {
      const response = await h.proxy(new NextRequest(origin + target));
      const login = new URL(response.headers.get('location'));
      assert.equal(response.status, 307);
      assert.equal(login.origin, origin);
      assert.equal(login.pathname, '/login');
      assert.equal(login.searchParams.get('next'), target);
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
      assert.equal(response.cookies.get('synthetic-session').value, 'refreshed');
      assert.equal((await destination(() => h.login(login.searchParams.get('next')))).href, origin + target);
    }
  } finally { h.close(); }
});

test('expired fresh Auth after a surviving proxy claim returns to the selected program and status after login', async () => {
  const h = await fixture({ claims: true });
  try {
    const response = await h.proxy(new NextRequest(`${origin}${program}?result=saved`));
    assert.equal(response.headers.get('location'), null);
    const login = await destination(() => h.page('saved'));
    assert.equal(login.pathname, '/login');
    assert.equal(login.searchParams.get('next'), `${program}?result=saved`);
    assert.equal((await destination(() => h.login(login.searchParams.get('next')))).href, `${origin}${program}?result=saved`);
    assert.equal(h.state.calls.includes('list_advertising_program'), false);
  } finally { h.close(); }
});

test('preserved admin query text cannot turn a login destination into an external redirect', async () => {
  const h = await fixture();
  try {
    const target = `${program}?next=${encodeURIComponent('https://outside.invalid')}`;
    const response = await h.proxy(new NextRequest(origin + target));
    const next = new URL(response.headers.get('location')).searchParams.get('next');
    assert.equal(next, target);
    assert.equal((await destination(() => h.login(next))).origin, origin);
    for (const unsafe of ['https://outside.invalid', '//outside.invalid', '/\\outside.invalid', '/admin\n']) {
      assert.equal((await destination(() => h.login(unsafe))).href, origin + '/admin');
    }
  } finally { h.close(); }
});

test('a surviving claim and a preserved admin destination never replace fresh administrator authorization', async () => {
  const h = await fixture({ claims: true, freshAuth: true, admin: false });
  try {
    const response = await h.proxy(new NextRequest(origin + program));
    assert.equal(response.headers.get('location'), null);
    await assert.rejects(() => h.page(), error => error.status === 404);
    assert.equal(h.state.calls.includes('list_advertising_program'), false);
  } finally { h.close(); }
});
