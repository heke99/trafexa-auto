import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSourceLoader } from './helpers/source-loader.mjs';

function redirect(url) { const error = new Error('Framework redirect'); error.url = url; throw error; }
const source = await createSourceLoader();
const { savedPasswordSignOutWarning, passwordChangeUnconfirmedWarning } = source.load('@/lib/auth/sign-out');

test('actual login page displays password/session warnings despite a remaining authenticated session, with gated destinations', async () => {
  const loader = await createSourceLoader({
    'next/navigation': { redirect },
    'next/link': ({ children, ...props }) => createElement('a', props, children),
    '@/components/auth-shell': { AuthShell: ({ children }) => createElement('main', {}, children) },
    '@/lib/data/actions': { loginAction: () => assert.fail('No password write during rendering') },
    '@/lib/auth/landing': { getAuthenticatedLandingPath: async () => '/account-pending?next=%2Fmy-offers' },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'synthetic' } }, error: null }) } }) },
  });
  const page = loader.load('src/app/login/page.tsx').default;
  for (const warning of [savedPasswordSignOutWarning, passwordChangeUnconfirmedWarning]) {
    const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve({ error: warning, next: '/my-offers' }) }));
    assert.ok(html.includes(warning));
    assert.match(html, /Försök logga ut igen/);
    assert.match(html, /href="\/account-pending\?next=%2Fmy-offers"/);
    assert.match(html, /Begär en ny återställningslänk/);
    assert.doesNotMatch(html, /name="password"/);
  }
  await assert.rejects(() => page({ searchParams: Promise.resolve({ error: 'arbitrary untrusted message' }) }), error => error.url === '/account-pending?next=%2Fmy-offers');
});

test('logout retry preserves warning on provider rejection or exception, clears company context and never reapplies password', async () => {
  for (const mode of ['success', 'rejected', 'throw', 'client']) {
    const calls = [];
    const loader = await createSourceLoader({
      'next/navigation': { redirect },
      'next/headers': { cookies: async () => ({ delete: name => calls.push(['delete', name]) }) },
      '@/lib/supabase/server': { createServerSupabaseClient: async () => {
        if (mode === 'client') throw Error('private initialization diagnostic');
        return { auth: {
          signOut: async input => { calls.push(['logout', input.scope]); if (mode === 'throw') throw Error('private provider diagnostic'); return { error: mode === 'rejected' ? { message: 'private provider diagnostic' } : null }; },
          updateUser: () => assert.fail('A logout retry must not reset a password'),
          verifyOtp: () => assert.fail('A logout retry must not replay an invitation'),
        } };
      } },
    });
    const form = new FormData(); form.set('next', '/my-offers');
    await assert.rejects(() => loader.load('@/lib/auth/session-recovery-actions').retryPasswordSignOutAction(form), error => {
      const url = new URL(error.url, 'https://app.trafexa.com');
      assert.equal(url.pathname, '/login'); assert.equal(url.searchParams.get('next'), '/my-offers');
      assert.equal(url.searchParams.get('error'), mode === 'success' ? null : savedPasswordSignOutWarning);
      assert.ok(!url.href.includes('private')); return true;
    });
    assert.deepEqual(calls.at(-1), ['delete', 'trafexa-company']);
  }
});
