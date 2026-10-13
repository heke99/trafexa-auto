import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleRequest, handleRequests } from '../../lib/dealer/handlers.mjs';
import { createPayload } from '../../lib/dealer/validation.mjs';

const USER = '10000000-0000-4000-8000-000000000001';
const COMPANY = '20000000-0000-4000-8000-000000000002';
const KEY = '30000000-0000-4000-8000-000000000003';
const ID = '40000000-0000-4000-8000-000000000004';
const TOKEN = 'Bearer user.access.token';
const ENV = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testkey' };
const BODY = { companyId: COMPANY, idempotencyKey: KEY, name: 'Buyer', email: 'Buyer@example.com', country: 'Sweden', buyerType: 'Dealer / reseller', brand: 'Volvo', model: 'XC90', destination: 'Sweden', year: '2026 / 2027', quantity: '2', consent: true };
const row = (overrides = {}) => ({ ...createPayload(BODY, USER), id: ID, version: 1, status: 'submitted', created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z', ...overrides });
const auth = { status: 200, data: { id: USER, user_metadata: { role: 'manager' } } };
const member = { status: 200, data: [{ role: 'member' }] };
const manager = { status: 200, data: [{ role: 'manager' }] };

async function run(handler, { method = 'GET', url = '/', body, headers = {}, sequence = [], timeoutMs = 100 } = {}) {
  const calls = [];
  let index = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url: new URL(url), ...options });
    const value = sequence[index++];
    assert.ok(value, `Unexpected fetch ${url}`);
    if (value.throw) throw value.throw;
    if (value.timeout) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('sensitive timeout'), { name: 'AbortError' })), { once: true }));
    return { status: value.status, ok: value.status >= 200 && value.status < 300, json: async () => {
      if (value.invalidJSON) throw new SyntaxError('sensitive provider content');
      return value.data;
    } };
  };
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(status) { this.statusCode = status; return this; }, json(body) { this.body = body; return this; } };
  const request = { method, url, body, headers: { authorization: TOKEN, 'content-type': 'application/json', ...headers } };
  await handler(request, response, { fetchImpl, env: ENV, timeoutMs });
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.match(response.headers['Content-Type'], /^application\/json/);
  return { response, calls };
}

test('authentication precedes all database operations and forwards the verified session to RLS', async () => {
  const { response, calls } = await run(handleRequests, { method: 'POST', body: BODY, sequence: [auth, member, { status: 201, data: [row()] }] });
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.ok, true);
  assert.equal(calls[0].url.pathname, '/auth/v1/user');
  assert.equal(calls[1].url.searchParams.get('user_id'), `eq.${USER}`);
  for (const call of calls) {
    assert.equal(call.headers.Authorization, TOKEN);
    assert.equal(call.headers.apikey, ENV.SUPABASE_PUBLISHABLE_KEY);
  }
  const saved = JSON.parse(calls[2].body);
  assert.equal(saved.created_by, USER);
  assert.equal(saved.company_id, COMPANY);
  assert.equal(saved.email, 'buyer@example.com');
  assert.equal(saved.year, '2026 / 2027');
  assert.equal(saved.quantity, 2);
  assert.equal(calls[2].headers.Prefer, 'return=representation');
});

test('server-owned identity is rejected from request bodies', async () => {
  for (const field of ['created_by', 'createdBy', 'status', 'version', 'userId']) {
    const { response, calls } = await run(handleRequests, { method: 'POST', body: { ...BODY, [field]: USER }, sequence: [auth] });
    assert.equal(response.statusCode, 400);
    assert.equal(calls.length, 1);
  }
});

test('missing/invalid/anonymous sessions cannot reach database, metadata is never authorization', async () => {
  for (const authorization of ['', 'Basic abc', 'Bearer a\nb']) {
    const { response, calls } = await run(handleRequests, { headers: { authorization } });
    assert.equal(response.statusCode, 401);
    assert.equal(calls.length, 0);
  }
  for (const result of [{ status: 401, data: { error: 'sensitive token' } }, { status: 200, data: { id: USER, is_anonymous: true } }, { status: 200, data: { user_metadata: { id: USER, role: 'manager' } } }]) {
    const { response, calls } = await run(handleRequests, { sequence: [result] });
    assert.equal(response.statusCode, 401);
    assert.equal(calls.length, 1);
  }
});

test('list uses validated company filter and a bounded, stable ordering', async () => {
  const { response, calls } = await run(handleRequests, { url: `/?companyId=${COMPANY}&limit=2`, sequence: [auth, { status: 200, data: [row()] }] });
  assert.equal(response.statusCode, 200);
  assert.equal(calls[1].url.searchParams.get('company_id'), `eq.${COMPANY}`);
  assert.equal(calls[1].url.searchParams.get('limit'), '2');
  assert.equal(calls[1].url.searchParams.get('order'), 'created_at.desc,id.desc');
  for (const url of [`/?companyId=${COMPANY}&limit=51`, `/?companyId=${COMPANY}&limit=0`, `/?companyId=${COMPANY}&limit=1.5`, `/?companyId=${COMPANY}&limit=1&limit=2`, '/?companyId=eq.bad', `/?companyId=${COMPANY}&userId=${USER}`]) {
    const bad = await run(handleRequests, { url, sequence: [auth] });
    assert.equal(bad.response.statusCode, 400);
    assert.equal(bad.calls.length, 1);
  }
  const mismatch = await run(handleRequests, { url: `/?companyId=${COMPANY}`, sequence: [auth, { status: 200, data: [row({ company_id: USER })] }] });
  assert.equal(mismatch.response.statusCode, 502);
});

test('only company member or manager may create; RLS remains the final gate', async () => {
  for (const membership of [[], [{ role: 'viewer' }], [{ role: 'unknown' }]]) {
    const { response, calls } = await run(handleRequests, { method: 'POST', body: BODY, sequence: [auth, { status: 200, data: membership }] });
    assert.equal(response.statusCode, 403);
    assert.equal(calls.length, 2);
  }
  const denied = await run(handleRequests, { method: 'POST', body: BODY, sequence: [auth, member, { status: 403, data: { code: '42501', message: 'sensitive details' } }] });
  assert.equal(denied.response.statusCode, 403);
  assert.equal(denied.response.body.ok, false);
  assert.doesNotMatch(JSON.stringify(denied.response.body), /sensitive/);
});

test('same idempotency key and normalized details returns saved request', async () => {
  const { response, calls } = await run(handleRequests, { method: 'POST', body: BODY, sequence: [auth, member, { status: 409, data: { code: '23505' } }, { status: 200, data: [row({ status: 'sourcing', version: 2 })] }] });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.request.version, 2);
  assert.equal(calls[3].url.searchParams.get('company_id'), `eq.${COMPANY}`);
  assert.equal(calls[3].url.searchParams.get('created_by'), `eq.${USER}`);
  assert.equal(calls[3].url.searchParams.get('idempotency_key'), `eq.${KEY}`);
});

test('same key with different details or hidden collision never reports success', async () => {
  for (const data of [[row({ model: 'Other' })], [], [row({ created_by: COMPANY })]]) {
    const { response } = await run(handleRequests, { method: 'POST', body: BODY, sequence: [auth, member, { status: 409, data: { code: '23505' } }, { status: 200, data }] });
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.ok, false);
  }
});

test('create requires confirmed saved representation', async () => {
  for (const data of [[], [row({ version: 0 })], [row({ model: 'Other' })], { id: ID }]) {
    const { response } = await run(handleRequests, { method: 'POST', body: BODY, sequence: [auth, member, { status: 201, data }] });
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.ok, false);
  }
});

test('detail reads visible request before version-sorted status history', async () => {
  const event = { request_id: ID, company_id: COMPANY, actor_id: USER, from_status: null, to_status: 'submitted', created_at: '2026-10-13T00:00:00Z' };
  const events = [{ ...event, version: 1 }, { ...event, from_status: 'submitted', to_status: 'sourcing', version: 2 }];
  const { response, calls } = await run(handleRequest, { url: `/?id=${ID}`, sequence: [auth, { status: 200, data: [row()] }, { status: 200, data: events }] });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.events, events);
  assert.equal(calls[2].url.searchParams.get('order'), 'version.asc');
  assert.equal(calls[2].url.searchParams.get('request_id'), `eq.${ID}`);
  const hidden = await run(handleRequest, { url: `/?id=${ID}`, sequence: [auth, { status: 200, data: [] }] });
  assert.equal(hidden.response.statusCode, 404);
  assert.equal(hidden.calls.length, 2);
});

test('successful responses expose selected schema fields and reject malformed rows or history', async () => {
  const result = await run(handleRequests, { url: `/?companyId=${COMPANY}`, sequence: [auth, { status: 200, data: [row({ upstream_private: TOKEN })] }] });
  assert.equal(result.response.statusCode, 200);
  assert.equal(result.response.body.requests[0].upstream_private, undefined);
  for (const override of [{ notes: {} }, { quantity: true }, { buyer_type: 'bad' }, { consent: false }, { updated_at: 'bad' }]) {
    const invalid = await run(handleRequests, { url: `/?companyId=${COMPANY}`, sequence: [auth, { status: 200, data: [row(override)] }] });
    assert.equal(invalid.response.statusCode, 502);
  }
  const otherId = await run(handleRequest, { url: `/?id=${ID}`, sequence: [auth, { status: 200, data: [row({ id: COMPANY })] }] });
  assert.equal(otherId.response.statusCode, 502);
  const event = { request_id: ID, company_id: COMPANY, actor_id: USER, from_status: null, to_status: 'submitted', created_at: '2026-10-13T00:00:00Z', version: 1 };
  for (const events of [[{ ...event, company_id: USER }], [{ ...event, to_status: 'bad' }], [event, event]]) {
    const invalid = await run(handleRequest, { url: `/?id=${ID}`, sequence: [auth, { status: 200, data: [row()] }, { status: 200, data: events }] });
    assert.equal(invalid.response.statusCode, 502);
  }
});

test('patch status update is guarded by database version and manager membership', async () => {
  const { response, calls } = await run(handleRequest, { method: 'PATCH', body: { id: ID, version: 1, status: 'sourcing' }, sequence: [auth, { status: 200, data: [row()] }, manager, { status: 200, data: [row({ version: 2, status: 'sourcing' })] }] });
  assert.equal(response.statusCode, 200);
  assert.equal(calls[3].url.searchParams.get('id'), `eq.${ID}`);
  assert.equal(calls[3].url.searchParams.get('version'), 'eq.1');
  assert.deepEqual(JSON.parse(calls[3].body), { status: 'sourcing' });
  const denied = await run(handleRequest, { method: 'PATCH', body: { id: ID, version: 1, status: 'sourcing' }, sequence: [auth, { status: 200, data: [row()] }, member] });
  assert.equal(denied.response.statusCode, 403);
  assert.equal(denied.calls.length, 3);
});

test('patch handles stale version, concurrent change, invisibility, and revoked update permission', async () => {
  const body = { id: ID, version: 1, status: 'sourcing' };
  const stale = await run(handleRequest, { method: 'PATCH', body, sequence: [auth, { status: 200, data: [row({ version: 2 })] }, manager] });
  assert.equal(stale.response.statusCode, 409);
  for (const [lookup, expected] of [[[row({ version: 2 })], 409], [[], 404], [[row()], 403]]) {
    const { response } = await run(handleRequest, { method: 'PATCH', body, sequence: [auth, { status: 200, data: [row()] }, manager, { status: 200, data: [] }, { status: 200, data: lookup }] });
    assert.equal(response.statusCode, expected);
    assert.equal(response.body.ok, false);
  }
  const hidden = await run(handleRequest, { method: 'PATCH', body, sequence: [auth, { status: 200, data: [] }] });
  assert.equal(hidden.response.statusCode, 404);
});

test('no-op patch accepts unchanged version; contradictory saved response is rejected', async () => {
  const same = await run(handleRequest, { method: 'PATCH', body: { id: ID, version: 1, status: 'submitted' }, sequence: [auth, { status: 200, data: [row()] }, manager, { status: 200, data: [row()] }] });
  assert.equal(same.response.statusCode, 200);
  const contradictory = await run(handleRequest, { method: 'PATCH', body: { id: ID, version: 1, status: 'sourcing' }, sequence: [auth, { status: 200, data: [row()] }, manager, { status: 200, data: [row()] }] });
  assert.equal(contradictory.response.statusCode, 502);
});

test('provider failures, invalid responses, network errors and timeouts are sanitized', async () => {
  for (const [upstream, expected] of [[{ status: 500, data: { message: TOKEN } }, 502], [{ status: 200, invalidJSON: true }, 502], [{ throw: new Error(TOKEN) }, 502], [{ timeout: true }, 504]]) {
    const { response } = await run(handleRequests, { sequence: [upstream], timeoutMs: 5 });
    assert.equal(response.statusCode, expected);
    assert.equal(response.body.ok, false);
    assert.doesNotMatch(JSON.stringify(response.body), /user\.access\.token|sensitive/);
  }
  for (const data of [null, {}, [null], ['invalid']]) {
    const { response } = await run(handleRequests, { url: `/?companyId=${COMPANY}`, sequence: [auth, { status: 200, data }] });
    assert.equal(response.statusCode, 502);
  }
});

test('method, JSON content type, malformed JSON and body size are enforced', async () => {
  for (const [handler, allow] of [[handleRequests, 'GET, POST'], [handleRequest, 'GET, PATCH']]) {
    const { response, calls } = await run(handler, { method: 'DELETE' });
    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.Allow, allow);
    assert.equal(calls.length, 0);
  }
  for (const [body, headers, expected] of [['{broken', {}, 400], [[], {}, 400], [null, {}, 400], [BODY, { 'content-type': 'text/plain' }, 415], [BODY, { 'content-length': '16385' }, 413], [' '.repeat(16385), {}, 413]]) {
    const { response, calls } = await run(handleRequests, { method: 'POST', body, headers, sequence: [auth] });
    assert.equal(response.statusCode, expected);
    assert.equal(calls.length, 1);
  }
});

test('bounds, enum, email, consent, UUID and field types are checked before database calls', async () => {
  const invalid = [
    { name: 'a'.repeat(201) }, { phone: 'a'.repeat(81) }, { country: 'a'.repeat(101) }, { budget: 'a'.repeat(101) }, { destination: 'a'.repeat(101) }, { notes: 'a'.repeat(5001) },
    { year: 2026 }, { quantity: 1001 }, { quantity: true }, { quantity: '2.5' }, { name: {} }, { brand: [] }, { notes: '\u0000' },
    { buyerType: 'owner' }, { condition: 'Used' }, { email: 'invalid' }, { consent: 'true' }, { companyId: `${COMPANY},or=(true)` }, { idempotencyKey: 'bad' },
  ];
  for (const overrides of invalid) {
    const { response, calls } = await run(handleRequests, { method: 'POST', body: { ...BODY, ...overrides }, sequence: [auth] });
    assert.equal(response.statusCode, 400, JSON.stringify(overrides));
    assert.equal(calls.length, 1);
  }
  for (const overrides of [{ status: 'bad' }, { version: 0 }, { version: '1' }, { version: 1.5 }, { id: 'bad' }, { companyId: COMPANY }]) {
    const { response, calls } = await run(handleRequest, { method: 'PATCH', body: { id: ID, version: 1, status: 'sourcing', ...overrides }, sequence: [auth] });
    assert.equal(response.statusCode, 400);
    assert.equal(calls.length, 1);
  }
});

test('streamed bodies enforce byte limits and parse valid JSON', async () => {
  const { readBody } = await import('../../lib/dealer/transport.mjs');
  const request = Readable.from([JSON.stringify(BODY).slice(0, 10), JSON.stringify(BODY).slice(10)]);
  request.headers = { 'content-type': 'application/json' };
  assert.deepEqual(await readBody(request), BODY);
  const large = Readable.from(['x'.repeat(9000), 'x'.repeat(9000)]);
  large.headers = { 'content-type': 'application/json' };
  await assert.rejects(readBody(large), error => error.status === 413);
  const invalidGetter = { headers: { 'content-type': 'application/json' }, get body() { throw new SyntaxError('malformed input'); } };
  await assert.rejects(readBody(invalidGetter), error => error.status === 400);
});

test('database rejects status regression with a sanitized conflict', async () => {
  const { response } = await run(handleRequest, { method: 'PATCH', body: { id: ID, version: 1, status: 'submitted' }, sequence: [auth, { status: 200, data: [row({ status: 'sourcing' })] }, manager, { status: 400, data: { code: '23514', message: 'sensitive sql constraint' } }] });
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.ok, false);
  assert.doesNotMatch(JSON.stringify(response.body), /sensitive|constraint/);
});

test('configuration accepts public aliases and rejects elevated keys', async () => {
  const { session } = await import('../../lib/dealer/transport.mjs');
  const request = { headers: { authorization: TOKEN } };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ id: USER }) });
  const aliases = await session(request, { fetchImpl, env: { NEXT_PUBLIC_SUPABASE_URL: ENV.SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ENV.SUPABASE_PUBLISHABLE_KEY } });
  assert.equal(aliases.userId, USER);
  for (const env of [{}, { ...ENV, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_private' }, { ...ENV, SUPABASE_URL: 'http://localhost' }, { ...ENV, SUPABASE_URL: 'https://user:pass@project.supabase.co' }]) {
    await assert.rejects(session(request, { fetchImpl, env }), error => error.status === 503);
  }
});
