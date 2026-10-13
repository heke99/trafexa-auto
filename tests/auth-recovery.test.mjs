import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';

let originalAppUrl;
beforeEach(() => { originalAppUrl = process.env.NEXT_PUBLIC_APP_URL; process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.invalid'; });
afterEach(() => { if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl; });

function redirect(url) {
  const error = new Error('Framework redirect');
  error.url = url; error.digest = `NEXT_REDIRECT;${url}`;
  throw error;
}
async function harness({ sdkError = null, networkError = false, clientError = false } = {}) {
  const calls = [];
  let clients = 0;
  const loader = await createSourceLoader({
    'next/navigation': { redirect },
    'next/headers': { cookies: () => { throw new Error('Recovery must not mutate cookies.'); } },
    'next/cache': { revalidatePath: () => { throw new Error('Recovery must not invalidate business data.'); } },
    './company-context': { getCompanySession: () => { throw new Error('Recovery must not access a company.'); } },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => {
      clients++;
      if (clientError) throw new Error('private client initialization detail');
      return { auth: { resetPasswordForEmail: async (email, options) => {
        calls.push({ email, options });
        if (networkError) throw new Error('private network/provider detail');
        return { data: {}, error: sdkError };
      } } };
    } },
  });
  const { forgotPasswordAction } = loader.load('src/lib/data/actions.ts');
  return {
    calls, clients: () => clients,
    async submit(email = 'buyer@example.invalid') {
      const form = new FormData(); form.set('email', email);
      try { await forgotPasswordAction(form); assert.fail('Recovery should redirect.'); }
      catch (error) { assert.match(error.digest ?? '', /^NEXT_REDIRECT;/); return new URL(error.url, 'https://app.example.invalid'); }
    },
  };
}

test('confirmed recovery request keeps the conditional account-safe success message', async () => {
  const h = await harness();
  const result = await h.submit('  buyer@example.invalid  ');
  assert.equal(result.pathname, '/forgot-password');
  assert.equal(result.searchParams.has('error'), false);
  assert.equal(result.searchParams.get('success'), 'Om adressen har ett konto får du ett mejl med instruktioner för återställning.');
  assert.deepEqual(h.calls, [{ email: 'buyer@example.invalid', options: { redirectTo: 'https://app.example.invalid/auth/callback?next=/reset-password' } }]);
});

test('SDK failures produce the same generic error for missing accounts and rate limits', async () => {
  const messages = [];
  for (const sdkError of [{ code: 'user_not_found', message: 'Account does not exist: private provider detail' }, { code: 'over_email_send_rate_limit', message: 'SMTP provider-private-diagnostics' }]) {
    const h = await harness({ sdkError });
    const result = await h.submit();
    assert.equal(result.pathname, '/forgot-password');
    assert.equal(result.searchParams.has('success'), false);
    assert.equal(h.calls.length, 1);
    messages.push(result.searchParams.get('error'));
  }
  assert.deepEqual(messages, Array(2).fill('Återställningsförfrågan kunde inte behandlas just nu. Försök igen senare.'));
});

test('a rejected network request returns safe failure instead of success or raw diagnostics', async () => {
  const h = await harness({ networkError: true });
  const result = await h.submit();
  assert.equal(result.searchParams.has('success'), false);
  assert.equal(result.searchParams.get('error'), 'Återställningsförfrågan kunde inte behandlas just nu. Försök igen senare.');
  assert.equal(h.calls.length, 1);
});

test('client initialization failures use the same account-safe recovery error', async () => {
  const h = await harness({ clientError: true });
  const result = await h.submit();
  assert.equal(result.searchParams.has('success'), false);
  assert.equal(result.searchParams.get('error'), 'Återställningsförfrågan kunde inte behandlas just nu. Försök igen senare.');
  assert.equal(h.clients(), 1); assert.equal(h.calls.length, 0);
});

test('invalid email is rejected before creating a client or calling the provider', async () => {
  const h = await harness();
  for (const email of ['', 'invalid', 'a@b@c.example', 'buyer@example.invalid\nBcc: hidden@example.invalid']) {
    const result = await h.submit(email);
    assert.equal(result.searchParams.has('success'), false);
    assert.equal(result.searchParams.get('error'), 'Ange en giltig e-postadress.');
  }
  assert.equal(h.clients(), 0); assert.deepEqual(h.calls, []);
});
