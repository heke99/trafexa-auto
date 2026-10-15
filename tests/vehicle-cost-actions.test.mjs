import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';

const COMPANY = '10000000-0000-4000-8000-000000000001';
const STOCK = '20000000-0000-4000-8000-000000000001';
const USER = '30000000-0000-4000-8000-000000000001';
const OTHER = '40000000-0000-4000-8000-000000000001';
const id = (number) => `50000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const input = { stockItemId: STOCK, expectedCompanyId: COMPANY };
function cost(number, overrides = {}) {
  return { id: id(number), company_id: COMPANY, stock_item_id: STOCK, category: 'repair', description: `Service ${number}`, amount_ore: 109 + number, incurred_on: '2026-10-15', created_at: '2026-10-15T10:00:00+00:00', ...overrides };
}

/** Actual CRM and approval context code, with a deliberately cached dealer
 * context. Post-I/O checks must therefore read Auth/membership/approval again. */
async function fixture(overrides = {}) {
  const state = {
    user: { id: USER, email: 'costs@example.invalid', email_confirmed_at: '2026-10-15T09:00:00Z', user_metadata: { company_id: OTHER, role: 'owner' } },
    membership: { company_id: COMPANY, user_id: USER, role: 'sales', status: 'active', companies: { id: COMPANY, status: 'active' } },
    approval: 'approved', stock: { id: STOCK, company_id: COMPANY }, costs: [cost(1)],
    cap: 1000, queries: [], authCalls: 0, approvalCalls: 0, costPages: 0, stockReads: 0, ...overrides,
  };
  const db = {
    auth: { async getUser() { state.authCalls++; return { data: { user: state.user }, error: state.authError ?? null }; } },
    async rpc(name) {
      assert.equal(name, 'get_account_access'); state.approvalCalls++;
      return { data: { userId: state.user.id, email: state.user.email, emailVerified: Boolean(state.user.email_confirmed_at), status: state.approval, version: 1, isPlatformAdmin: false }, error: state.approvalError ?? null };
    },
    from(table) {
      const entry = { table, filters: {}, greater: {}, limit: Infinity, order: null }; state.queries.push(entry);
      function response() {
        if (table === 'stock_items') state.stockReads++;
        if (table === 'vehicle_costs') state.costPages++;
        const pageError = table === 'vehicle_costs' && state.costPages === state.failCostPage;
        if (pageError) return { data: null, count: null, error: { message: 'private service_role diagnostics', code: 'XX000' } };
        let rows = table === 'memberships' ? [state.membership].filter(Boolean) : table === 'stock_items' ? [state.stock].filter(Boolean) : state.costs;
        rows = rows.filter((row) => Object.entries(entry.filters).every(([key, value]) => key === 'companies.status' ? row.companies.status === value : row[key] === value));
        rows = rows.filter((row) => Object.entries(entry.greater).every(([key, value]) => row[key] > value));
        if (entry.order) rows = rows.slice().sort((a, b) => a[entry.order] < b[entry.order] ? -1 : a[entry.order] > b[entry.order] ? 1 : 0);
        const count = rows.length;
        const data = structuredClone(rows.slice(0, Math.min(entry.limit, state.cap)));
        if (table === 'vehicle_costs') state.afterCostPage?.(state, state.costPages);
        return { data, count: table === 'vehicle_costs' && state.missingCount ? null : count, error: null };
      }
      const query = {
        select(columns, options) { entry.columns = columns; entry.count = options?.count; return query; },
        eq(key, value) { entry.filters[key] = value; return query; },
        gt(key, value) { entry.greater[key] = value; return query; },
        order(key) { entry.order = key; return query; },
        limit(value) { entry.limit = value; return query; },
        async maybeSingle() { const result = response(); return { ...result, data: result.data?.[0] ?? null }; },
        then(resolve, reject) { return Promise.resolve(response()).then(resolve, reject); },
      };
      return query;
    },
  };
  const loader = await createSourceLoader({
    '@/lib/supabase/server': { createServerSupabaseClient: async () => db },
    '@/lib/data/company-context': { getActiveCompanyContext: async () => ({ db, company: COMPANY, user: USER, role: 'sales' }) },
  });
  return { state, load: loader.load('src/lib/data/vehicle-cost-actions.ts').loadVehicleCosts };
}

test('targeted cost read uses real fresh CRM/account checks and scopes both stock readbacks and every cost page', async () => {
  const { state, load } = await fixture();
  const result = await load(input);
  assert.equal(result.ok, true); assert.equal(result.stockItemId, STOCK);
  assert.equal(result.companyId, COMPANY); assert.equal(result.actorId, USER); assert.equal(result.role, 'sales');
  assert.deepEqual(result.costs.map((row) => row.amount_ore), [110]);
  assert.equal(state.authCalls, 4); assert.equal(state.approvalCalls, 2); assert.equal(state.stockReads, 2);
  const costs = state.queries.filter((query) => query.table === 'vehicle_costs');
  assert.equal(costs.length, 1); assert.equal(costs[0].count, 'exact');
  assert.deepEqual(costs[0].filters, { company_id: COMPANY, stock_item_id: STOCK });
  assert.equal('company_id' in result.costs[0], false);
});

test('all 1203 costs are loaded beyond 500, including a Data API cap of only 127 records', async () => {
  for (const cap of [1000, 127]) {
    const { state, load } = await fixture({ cap, costs: Array.from({ length: 1203 }, (_, index) => cost(index + 1)) });
    const result = await load(input);
    assert.equal(result.ok, true); assert.equal(result.costs.length, 1203);
    assert.equal(new Set(result.costs.map((row) => row.id)).size, 1203);
    assert.equal(state.costPages, Math.ceil(1203 / Math.min(cap, 500)));
    const pages = state.queries.filter((query) => query.table === 'vehicle_costs');
    assert.ok(pages.every((query) => query.filters.company_id === COMPANY && query.filters.stock_item_id === STOCK && query.order === 'id' && query.limit === 500));
    assert.ok(pages.slice(1).every((query) => typeof query.greater.id === 'string'));
  }
});

test('a verified empty list differs from missing counts and failures after buffered pages', async () => {
  const empty = await fixture({ costs: [] }); const verified = await empty.load(input);
  assert.equal(verified.ok, true); assert.deepEqual(verified.costs, []);
  for (const overrides of [{ missingCount: true }, { failCostPage: 2, costs: Array.from({ length: 701 }, (_, index) => cost(index + 1)) }]) {
    const { load } = await fixture(overrides); const result = await load(input);
    assert.equal(result.ok, false); assert.equal('costs' in result, false);
    assert.equal(JSON.stringify(result).includes('service_role'), false);
  }
});

test('revoked membership, approval, actor, company or stock ownership after pagination discards the entire buffer', async () => {
  for (const revoke of [
    (state) => { state.membership.status = 'suspended'; },
    (state) => { state.membership.role = 'viewer'; },
    (state) => { state.membership.companies.status = 'suspended'; },
    (state) => { state.approval = 'suspended'; },
    (state) => { state.user = { ...state.user, id: OTHER }; },
    (state) => { state.stock.company_id = OTHER; },
  ]) {
    const { state, load } = await fixture({ costs: Array.from({ length: 601 }, (_, index) => cost(index + 1)), afterCostPage: (state, page) => { if (page === 2) revoke(state); } });
    const result = await load(input);
    assert.equal(state.costPages, 2); assert.equal(result.ok, false); assert.equal('costs' in result, false);
  }
});

test('foreign tenant, missing stock, invalid input and unsafe monetary rows fail closed without diagnostic leakage', async () => {
  for (const overrides of [{ stock: { id: STOCK, company_id: OTHER } }, { stock: null }, { approval: 'pending' }, { user: null }, { membership: null }]) {
    const { state, load } = await fixture(overrides); const result = await load(input);
    assert.equal(result.ok, false); assert.equal(state.costPages, 0);
  }
  const foreign = await fixture(); assert.equal((await foreign.load({ ...input, expectedCompanyId: OTHER })).ok, false); assert.equal(foreign.state.costPages, 0);
  for (const value of [null, {}, { ...input, stockItemId: 'bad' }, { ...input, expectedCompanyId: '' }, { ...input, actorId: USER }]) {
    const { state, load } = await fixture(); assert.equal((await load(value)).ok, false); assert.equal(state.authCalls, 0);
  }
  for (const patch of [{ amount_ore: Number.MAX_SAFE_INTEGER + 1 }, { amount_ore: -1 }, { category: 'invalid' }, { id: 'bad' }]) {
    // Malformed amounts and records must never enter financial totals.
    const { load } = await fixture({ costs: [cost(1, patch)] });
    assert.equal((await load(input)).ok, false);
  }
});
