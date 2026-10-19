import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { createDatabase, asUser } from '../dealer-db/helpers.mjs';
import { handleRequests, handleRequest } from '../../lib/dealer/handlers.mjs';

// Test-only PostgREST adapter. Application handlers still use their real transport,
// while PostgreSQL executes the actual migration, policies, grants and triggers.
const COMPANY_A = '10000000-0000-0000-0000-000000000001';
const COMPANY_B = '10000000-0000-0000-0000-000000000002';
const USERS = {
  manager: '20000000-0000-0000-0000-000000000001',
  member: '20000000-0000-0000-0000-000000000002',
  viewer: '20000000-0000-0000-0000-000000000003',
  outsider: '20000000-0000-0000-0000-000000000004',
};
const ALLOWED_TABLES = new Set(['trafexa_memberships', 'trafexa_requests', 'trafexa_request_events']);
const identifier = value => {
  assert.match(value, /^[a-z_]+$/);
  return `"${value}"`;
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

function dataAdapter(db) {
  return async (address, options) => {
    const url = new URL(address);
    assert.equal(url.origin, 'https://supabase.test');
    assert.equal(options.headers.apikey, 'sb_publishable_test');
    const token = options.headers.Authorization.replace(/^Bearer /, '');
    const user = USERS[token];
    if (!user) return json({ error: 'Invalid test session' }, 401);
    if (url.pathname === '/auth/v1/user') return json({ id: user, is_anonymous: false });
    const table = url.pathname.replace('/rest/v1/', '');
    assert.ok(ALLOWED_TABLES.has(table));
    const select = url.searchParams.get('select') || '*';
    const columns = select === '*' ? '*' : select.split(',').map(identifier).join(',');
    try {
      const rows = await asUser(db, user, async transaction => {
        let statement;
        const values = [];
        if (options.method === 'POST') {
          const payload = JSON.parse(options.body);
          const keys = Object.keys(payload);
          values.push(...Object.values(payload));
          statement = `INSERT INTO public.${identifier(table)} (${keys.map(identifier)}) VALUES (${keys.map((_, i) => `$${i + 1}`)}) RETURNING ${columns}`;
        } else {
          if (options.method === 'PATCH') {
            const payload = JSON.parse(options.body);
            assert.deepEqual(Object.keys(payload), ['status']);
            values.push(payload.status);
            statement = `UPDATE public.${identifier(table)} SET status=$1`;
          } else {
            assert.equal(options.method, 'GET');
            statement = `SELECT ${columns} FROM public.${identifier(table)}`;
          }
          const predicates = [];
          for (const [key, value] of url.searchParams) {
            if (['select', 'limit', 'order'].includes(key)) continue;
            assert.ok(value.startsWith('eq.'));
            values.push(value.slice(3));
            predicates.push(`${identifier(key)}=$${values.length}`);
          }
          if (predicates.length) statement += ` WHERE ${predicates.join(' AND ')}`;
          if (options.method === 'PATCH') {
            statement += ` RETURNING ${columns}`;
          } else {
            const order = url.searchParams.get('order');
            if (order) statement += ` ORDER BY ${order.split(',').map(part => {
              const [column, direction] = part.split('.');
              assert.ok(['asc', 'desc'].includes(direction));
              return `${identifier(column)} ${direction.toUpperCase()}`;
            }).join(',')}`;
            const limit = url.searchParams.get('limit');
            if (limit) {
              assert.match(limit, /^\d+$/);
              statement += ` LIMIT ${Number(limit)}`;
            }
          }
        }
        return (await transaction.query(statement, values)).rows;
      });
      return json(rows, options.method === 'POST' ? 201 : 200);
    } catch (error) {
      return json({ code: error.code, message: 'Test database rejected the operation' }, error.code === '42501' ? 403 : 400);
    }
  };
}

async function fixture() {
  const db = await createDatabase();
  for (const user of Object.values(USERS)) await db.query('INSERT INTO auth.users(id) VALUES ($1)', [user]);
  await db.query('INSERT INTO public.trafexa_companies(id,name) VALUES ($1,$2),($3,$4)', [COMPANY_A, 'Dealer A', COMPANY_B, 'Dealer B']);
  for (const [role, company, user] of [
    ['manager', COMPANY_A, USERS.manager], ['member', COMPANY_A, USERS.member],
    ['viewer', COMPANY_A, USERS.viewer], ['manager', COMPANY_B, USERS.outsider],
  ]) await db.query('INSERT INTO public.trafexa_memberships(company_id,user_id,role) VALUES ($1,$2,$3)', [company, user, role]);
  const options = { fetchImpl: dataAdapter(db), env: { SUPABASE_URL: 'https://supabase.test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' } };
  const server = createServer((req, res) => {
    res.status = code => { res.statusCode = code; return res; };
    res.json = value => { res.end(JSON.stringify(value)); return res; };
    const handler = req.url.startsWith('/api/dealer-requests') ? handleRequests : handleRequest;
    void handler(req, res, options);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    async call(path, { user = 'manager', method = 'GET', body } = {}) {
      const headers = { 'Content-Type': 'application/json' };
      if (user) headers.Authorization = `Bearer ${user}`;
      const response = await fetch(`${origin}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return { status: response.status, body: await response.json() };
    },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await db.close();
    },
  };
}

const submission = {
  companyId: COMPANY_A, name: 'Buyer', email: 'buyer@example.com', country: 'Sweden',
  buyerType: 'Dealer / reseller', brand: 'BMW', model: 'X5', year: '2026 / 2027',
  quantity: 2, destination: 'Sweden', consent: true,
  idempotencyKey: '30000000-0000-0000-0000-000000000001',
};

test('HTTP request flow persists data with PostgreSQL RLS and atomic history', async t => {
  const app = await fixture();
  t.after(() => app.close());
  let id;
  await t.test('member saves a request and its initial event', async () => {
    const result = await app.call('/api/dealer-requests', { user: 'member', method: 'POST', body: submission });
    assert.equal(result.status, 201);
    id = result.body.request.id;
    assert.equal(result.body.request.created_by, USERS.member);
    assert.equal(result.body.request.year, '2026 / 2027');
    assert.equal(result.body.request.version, 1);
    const detail = await app.call(`/api/dealer-request?id=${id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.events.length, 1);
    assert.equal(detail.body.events[0].actor_id, USERS.member);
    assert.equal(detail.body.events[0].to_status, 'submitted');
  });
  await t.test('same key replays once, changed payload conflicts', async () => {
    const replay = await app.call('/api/dealer-requests', { user: 'member', method: 'POST', body: submission });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.request.id, id);
    const conflict = await app.call('/api/dealer-requests', { user: 'member', method: 'POST', body: { ...submission, model: 'X3' } });
    assert.equal(conflict.status, 409);
    assert.equal((await app.db.query('SELECT count(*)::int AS count FROM public.trafexa_requests')).rows[0].count, 1);
  });
  await t.test('other company sees no rows and cannot read or patch the request', async () => {
    const list = await app.call(`/api/dealer-requests?companyId=${COMPANY_A}`, { user: 'outsider' });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.requests, []);
    assert.equal((await app.call(`/api/dealer-request?id=${id}`, { user: 'outsider' })).status, 404);
    assert.equal((await app.call('/api/dealer-request', { user: 'outsider', method: 'PATCH', body: { id, version: 1, status: 'sourcing' } })).status, 404);
    assert.equal((await app.call('/api/dealer-requests', { user: 'outsider', method: 'POST', body: submission })).status, 403);
  });
  await t.test('viewer reads while viewer create and member status update are denied', async () => {
    assert.equal((await app.call(`/api/dealer-request?id=${id}`, { user: 'viewer' })).status, 200);
    assert.equal((await app.call('/api/dealer-requests', { user: 'viewer', method: 'POST', body: submission })).status, 403);
    assert.equal((await app.call('/api/dealer-request', { user: 'member', method: 'PATCH', body: { id, version: 1, status: 'sourcing' } })).status, 403);
  });
  await t.test('manager update creates one atomic event; stale update conflicts', async () => {
    const changed = await app.call('/api/dealer-request', { method: 'PATCH', body: { id, version: 1, status: 'sourcing' } });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.request.version, 2);
    assert.equal((await app.call('/api/dealer-request', { method: 'PATCH', body: { id, version: 1, status: 'offered' } })).status, 409);
    const detail = await app.call(`/api/dealer-request?id=${id}`);
    assert.equal(detail.body.events.length, 2);
    assert.equal(detail.body.events[1].actor_id, USERS.manager);
    assert.equal(detail.body.events[1].from_status, 'submitted');
    assert.equal(detail.body.events[1].to_status, 'sourcing');
  });
  await t.test('repeated status is a no-op; invalid regression never succeeds', async () => {
    const repeated = await app.call('/api/dealer-request', { method: 'PATCH', body: { id, version: 2, status: 'sourcing' } });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.request.version, 2);
    const regression = await app.call('/api/dealer-request', { method: 'PATCH', body: { id, version: 2, status: 'submitted' } });
    assert.equal(regression.status, 409);
    const detail = await app.call(`/api/dealer-request?id=${id}`);
    assert.equal(detail.body.request.status, 'sourcing');
    assert.equal(detail.body.events.length, 2);
  });
  await t.test('missing session and injected server-owned fields fail', async () => {
    assert.equal((await app.call(`/api/dealer-requests?companyId=${COMPANY_A}`, { user: null })).status, 401);
    assert.equal((await app.call('/api/dealer-requests', { method: 'POST', body: { ...submission, created_by: USERS.outsider } })).status, 400);
  });
});
