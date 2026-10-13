import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { registerHooks } from 'node:module';
import { NextRequest } from 'next/server.js';

// Next's bundler resolves this subpath; Node's direct TypeScript loader needs .js.
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === 'next/server' ? 'next/server.js' : specifier, context);
  }
});
const { POST } = await import('../src/app/api/demo-requests/route.ts');
hook.deregister();

const ENV_KEYS = ['NODE_ENV', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SITE_URL', 'VERCEL_URL', 'VERCEL_BRANCH_URL'];
const valid = { name: ' Test Buyer ', company: 'Test Dealer', email: 'buyer@example.com', phone: '+46 123456', message: 'Help with inventory', website: '' };
let savedEnv, calls, provider;
beforeEach(t => {
  savedEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]));
  process.env.NODE_ENV = 'production';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_mock_for_tests_only';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://trafexa.com';
  process.env.VERCEL_URL = 'trafexa-preview.test.invalid';
  process.env.VERCEL_BRANCH_URL = 'trafexa-git-preview-team.vercel.app';
  calls = [];
  provider = async () => new Response(null, { status: 204 });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://test.supabase.invalid/rest/v1/rpc/submit_demo_request');
    calls.push({ url, options, payload: JSON.parse(options.body) });
    return provider(url, options);
  });
});
afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function request(body = valid, overrides = {}) {
  const { raw = false, headers = {} } = overrides;
  return POST(new NextRequest('https://trafexa.com/api/demo-requests', {
    method: 'POST', headers: { origin: 'https://trafexa.com', 'content-type': 'application/json', ...headers },
    body: raw ? body : JSON.stringify(body), duplex: 'half'
  }));
}
async function assertError(response, status) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(typeof body.error, 'string');
  assert.ok(body.error.length > 0);
  return body;
}

test('a valid inquiry uses the actual typed RPC and returns an explicit success acknowledgement', async () => {
  const response = await request();
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'POST');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(calls[0].payload, { contact_name: 'Test Buyer', contact_email: valid.email, company_name: valid.company, contact_phone: valid.phone, contact_message: valid.message });
});

test('void RPC confirmations accept an empty HTTP 200 body and omit blank optional arguments', async () => {
  provider = async () => new Response('', { status: 200 });
  const response = await request({ ...valid, phone: '', message: '' });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal('contact_phone' in calls[0].payload, false);
  assert.equal('contact_message' in calls[0].payload, false);
});

test('untrusted origins and unsupported content types never call the database', async () => {
  await assertError(await request(valid, { headers: { origin: 'https://evil.test.invalid' } }), 403);
  await assertError(await request(valid, { headers: { origin: '' } }), 403);
  await assertError(await request(valid, { headers: { 'content-type': 'application/x-www-form-urlencoded' } }), 415);
  assert.equal(calls.length, 0);
  process.env.NODE_ENV = 'development';
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://trafexa-preview.test.invalid']) {
    assert.equal((await request(valid, { headers: { origin } })).status, 201);
  }
});

test('production accepts only the configured unique and branch preview origins', async () => {
  process.env.VERCEL_URL = 'trafexa-preview-123-team.vercel.app';
  for (const origin of ['https://another-project.vercel.app', 'https://trafexa-git-preview-team.vercel.app.evil.invalid', 'http://trafexa-git-preview-team.vercel.app']) {
    await assertError(await request(valid, { headers: { origin } }), 403);
  }
  assert.equal(calls.length, 0);
  for (const origin of [`https://${process.env.VERCEL_URL}`, `https://${process.env.VERCEL_BRANCH_URL}`]) {
    const response = await request(valid, { headers: { origin } });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { success: true });
  }
  assert.equal(calls.length, 2);
  delete process.env.VERCEL_BRANCH_URL;
  await assertError(await request(valid, { headers: { origin: 'https://trafexa-git-preview-team.vercel.app' } }), 403);
  assert.equal(calls.length, 2);
});

test('malformed JSON, invalid UTF-8 and non-object bodies return safe validation errors', async () => {
  for (const body of ['{broken', 'null', '[]', '42', 'true', new Uint8Array([0xff])]) {
    await assertError(await request(body, { raw: true }), 400);
  }
  assert.equal(calls.length, 0);
});

test('declared and streamed body limits count bytes before parsing or database access', async () => {
  await assertError(await request(valid, { headers: { 'content-length': '8193' } }), 413);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(5000)));
      controller.enqueue(new TextEncoder().encode('x'.repeat(3193)));
      controller.close();
    }
  });
  await assertError(await request(stream, { raw: true }), 413);
  await assertError(await request({ ...valid, message: '車'.repeat(3000) }), 413);
  assert.equal(calls.length, 0);
});

test('wrong field types, missing required text and field overflow are rejected rather than discarded', async () => {
  for (const patch of [
    { name: null }, { company: {} }, { email: ['buyer@example.com'] }, { phone: 123 },
    { message: null }, { website: false }, { name: ' ' }, { company: 'x' },
    { email: 'invalid' }, { name: 'x'.repeat(161) }, { phone: 'x'.repeat(61) }, { message: 'x'.repeat(2001) }
  ]) await assertError(await request({ ...valid, ...patch }), 400);
  assert.equal(calls.length, 0);
});

test('honeypot submissions do not write, while missing database configuration returns a service error', async () => {
  const response = await request({ ...valid, website: 'spam.test.invalid' });
  assert.deepEqual(await response.json(), { success: true });
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  await assertError(await request(), 503);
  assert.equal(calls.length, 0);
});

test('provider rejection, malformed confirmation, network and configuration errors do not leak provider details', async () => {
  const sensitive = 'private-provider-detail';
  const variants = [
    [async () => new Response(JSON.stringify({ message: sensitive, code: '42501' }), { status: 403 }), 503],
    [async () => new Response(JSON.stringify({ message: `Too many requests ${sensitive}`, code: 'P0001' }), { status: 400 }), 429],
    [async () => new Response('<html>unexpected</html>', { status: 200 }), 503],
    [async () => { throw new TypeError(sensitive); }, 503]
  ];
  for (const [implementation, status] of variants) {
    provider = implementation;
    const body = await assertError(await request(), status);
    assert.ok(!JSON.stringify(body).includes(sensitive));
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'not-a-url';
  await assertError(await request(), 503);
  assert.equal(calls.length, 4);
});

test('the actual RPC fetch aborts after ten seconds and returns a safe timeout acknowledgement', async t => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let fireTimeout, enteredFetch, cleared = false;
  const entered = new Promise(resolve => { enteredFetch = resolve; });
  const timer = {};
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay !== 10000) return originalSetTimeout(callback, delay, ...args);
    fireTimeout = callback;
    return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', handle => {
    if (handle === timer) cleared = true;
    else originalClearTimeout(handle);
  });
  provider = async (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('mock timeout', 'AbortError')), { once: true });
    enteredFetch();
  });
  const pending = request();
  await entered;
  fireTimeout();
  const body = await assertError(await pending, 504);
  assert.match(body.error, /för lång tid/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(cleared, true);
});
