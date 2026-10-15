import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { test } from 'node:test';
import { createRequestReact, createSourceLoader } from './helpers/source-loader.mjs';

const COMPANY = '72150000-0000-4000-8000-000000000001';
const ACTOR = '72150000-0000-4000-8000-000000000002';
const STOCK = '72150000-0000-4000-8000-000000000003';
const VEHICLE = '72150000-0000-4000-8000-000000000004';
const FOREIGN = '72150000-0000-4000-8000-000000000005';
const REQUEST = '72150000-0000-4000-8000-000000000006';
const PURCHASE = 123456789;
const PURCHASE_TOTAL = '987654321';
const row = { id: STOCK, company_id: COMPANY, status: 'available', created_at: '2026-10-15T10:00:00Z', acquired_on: '2026-10-15', purchase_price_ore: PURCHASE, asking_price_ore: 222222222, vat_scheme: 'standard',
  vehicles: { id: VEHICLE, company_id: COMPANY, registration_number: 'RBAC12', make: 'Volvo', model: 'V60', model_year: 2024, mileage_km: 20000, fuel: 'hybrid', gearbox: 'automatic' } };
function form(values) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }
function redirect(url) { const error = new Error('Framework redirect'); error.url = url; error.digest = `NEXT_REDIRECT;${url}`; throw error; }
async function destination(work) { try { await work(); assert.fail('Expected redirect'); } catch (error) { assert.match(error.digest ?? '', /^NEXT_REDIRECT;/); return new URL(error.url, 'https://app.example.invalid'); } }

/** Real session/cache, approval parser, fresh CRM context and action code.
 * Supabase wire responses are modeled; the separate SQL suite proves policies. */
async function fixture(overrides = {}) {
  const requests = new AsyncLocalStorage();
  const state = { role: 'owner', approval: 'approved', cookie: COMPANY, user: { id: ACTOR, email: 'dealer@example.invalid', email_confirmed_at: '2026-10-15T09:00:00Z', user_metadata: { role: 'owner', company_id: COMPANY } },
    memberStatus: 'active', companyStatus: 'active', calls: [], writes: [], authCalls: 0, ...overrides };
  function member() { return { company_id: COMPANY, user_id: ACTOR, role: state.role, status: state.memberStatus, companies: { id: COMPANY, name: 'RBAC Dealer', organisation_number: '5566778899', status: state.companyStatus } }; }
  const db = {
    auth: { async getUser() { state.authCalls++; return { data: { user: state.user }, error: null }; } },
    async rpc(name, args) {
      state.calls.push({ name, args });
      if (name === 'get_account_access') return { data: { userId: state.user.id, email: state.user.email, emailVerified: true, status: state.approval, version: 1, isPlatformAdmin: false }, error: null };
      if (name === 'get_workspace_inventory') {
        const financial = ['owner', 'admin', 'finance'].includes(state.role);
        let data = { companyId: COMPANY, actorId: ACTOR, role: state.role, rows: [{ ...structuredClone(row), purchase_price_ore: financial ? PURCHASE : null }] };
        if (state.inventoryPatch) data = state.inventoryPatch(data);
        state.afterInventory?.(state);
        return { data, error: null };
      }
      if (name === 'inventory_dashboard_totals') return { data: { companyId: COMPANY, activeStockCount: '7', availableStockCount: '6', purchaseValueOre: ['owner', 'admin', 'finance'].includes(state.role) ? PURCHASE_TOTAL : null, activeDealCount: '4', reservedDealCount: '2', customerCount: '12' }, error: null };
      if (name === 'stock_import_duplicate_registrations') return { data: [], error: null };
      if (name === 'import_stock_batch' || name === 'create_stock') { state.writes.push({ name, args }); return { data: name === 'import_stock_batch' ? 1 : STOCK, error: null }; }
      assert.fail(`Unexpected RPC ${name}`);
    },
    from(table) {
      assert.notEqual(table, 'stock_items', 'Snapshot must not select financial columns through the Data API');
      const filters = {};
      const query = {
        select() { return query; }, eq(key, value) { filters[key] = value; return query; }, order() { return query; }, limit() { return query; },
        async maybeSingle() { const result = response(); return { ...result, data: result.data[0] ?? null }; },
        then(resolve, reject) { return Promise.resolve(response()).then(resolve, reject); },
      };
      function response() {
        const rows = table === 'memberships' ? [member()].filter(value => Object.entries(filters).every(([key, expected]) => (key === 'companies.status' ? value.companies.status : value[key]) === expected)) : [];
        return { data: structuredClone(rows), error: null };
      }
      return query;
    },
  };
  const loader = await createSourceLoader({
    react: createRequestReact(requests),
    '@/lib/supabase/server': { createServerSupabaseClient: async () => db },
    'next/headers': { cookies: async () => ({ get: key => key === 'trafexa-company' ? { value: state.cookie } : undefined }) },
    'next/navigation': { redirect }, 'next/cache': { revalidatePath() {} },
  });
  return { state, workspace: loader.load('src/lib/data/workspace.ts'), actions: loader.load('src/lib/data/actions.ts'), imports: loader.load('src/lib/data/import-actions.ts'),
    run: work => requests.run({ reactCache: new Map() }, work) };
}

test('SSR financial projection uses exact null for sales/viewer and full values only for owner/admin/finance', async () => {
  for (const role of ['owner', 'admin', 'finance', 'sales', 'viewer']) {
    const h = await fixture({ role });
    const snapshot = await h.run(() => h.workspace.getWorkspaceSnapshot());
    const visible = ['owner', 'admin', 'finance'].includes(role);
    assert.equal(snapshot.inventory[0].purchase_price_ore, visible ? PURCHASE : null);
    assert.equal(snapshot.dashboardTotals.purchaseValueOre, visible ? PURCHASE_TOTAL : null);
    assert.equal(snapshot.inventory[0].asking_price_ore, row.asking_price_ore);
    assert.equal(snapshot.dashboardTotals.activeStockCount, '7');
    assert.equal(snapshot.dashboardTotals.customerCount, '12');
    assert.deepEqual(snapshot.vehicle_costs, []);
    if (!visible) { assert.equal(JSON.stringify(snapshot).includes(String(PURCHASE)), false); assert.equal(JSON.stringify(snapshot).includes(PURCHASE_TOTAL), false); }
    assert.equal(h.state.calls.filter(call => call.name === 'get_workspace_inventory').length, 1);
  }
});

test('SSR strips hidden financial aliases and internal fields at both stock and vehicle boundaries', async () => {
  const h = await fixture({ role: 'sales', inventoryPatch: page => ({ ...page, purchaseValueOre: PURCHASE_TOTAL, rows: page.rows.map(value => ({ ...value, internalPurchasePrice: PURCHASE, purchase_vat_ore: 100, vat_basis_confirmed: true, calculation_version: 7, vehicles: { ...value.vehicles, internalProfitOre: 888888888 } })) }) });
  const snapshot = await h.run(() => h.workspace.getWorkspaceSnapshot());
  const json = JSON.stringify(snapshot);
  for (const forbidden of ['internalPurchasePrice', 'purchase_vat_ore', 'vat_basis_confirmed', 'calculation_version', 'internalProfitOre', String(PURCHASE), PURCHASE_TOTAL]) assert.equal(json.includes(forbidden), false, forbidden);
});

test('SSR denies non-null restricted prices, wrong tenant/actor/role, unsafe amounts and duplicate stock', async () => {
  for (const inventoryPatch of [
    page => ({ ...page, rows: [{ ...page.rows[0], purchase_price_ore: PURCHASE }] }),
    page => ({ ...page, companyId: FOREIGN }), page => ({ ...page, actorId: FOREIGN }), page => ({ ...page, role: 'owner' }),
    page => ({ ...page, rows: [{ ...page.rows[0], company_id: FOREIGN }] }),
    page => ({ ...page, rows: [{ ...page.rows[0], vehicles: { ...page.rows[0].vehicles, company_id: FOREIGN } }] }),
    page => ({ ...page, rows: [{ ...page.rows[0], asking_price_ore: Number.MAX_SAFE_INTEGER + 1 }] }),
    page => ({ ...page, rows: [page.rows[0], page.rows[0]] }),
  ]) {
    const h = await fixture({ role: 'sales', inventoryPatch });
    await assert.rejects(h.run(() => h.workspace.getWorkspaceSnapshot()));
  }
});

test('buffered SSR finance data is discarded after fresh role, approval, membership, company or identity revocation', async () => {
  for (const revoke of [
    state => { state.role = 'sales'; }, state => { state.role = 'viewer'; }, state => { state.approval = 'suspended'; },
    state => { state.memberStatus = 'suspended'; }, state => { state.companyStatus = 'suspended'; }, state => { state.user = { ...state.user, id: FOREIGN }; },
  ]) {
    const h = await fixture({ afterInventory: revoke });
    await assert.rejects(h.run(() => h.workspace.getWorkspaceSnapshot()));
    assert.ok(h.state.authCalls > 1, 'Recheck must not reuse the request-cached Auth proof');
  }
});

test('stock creation rejects sales/viewer/finance before validating financial inputs or calling create_stock', async () => {
  for (const role of ['sales', 'viewer', 'finance']) {
    const h = await fixture({ role });
    const result = await h.run(() => destination(() => h.actions.createVehicleAction(form({ expected_company_id: COMPANY, purchase_price: 'not a financial amount' }))));
    assert.match(result.searchParams.get('error'), /Endast företagets ägare och administratörer/);
    assert.deepEqual(h.state.writes, []);
  }
});

const csvKeys = ['registration_number', 'make', 'model', 'model_year', 'mileage_km', 'fuel', 'gearbox', 'purchase_price', 'asking_price', 'vat_scheme'];
const csv = `${csvKeys.join(';')}\nABC123;Volvo;V60;2024;20000;hybrid;automatic;125000,29;159000,09;unknown`;
const mapping = JSON.stringify(Object.fromEntries(csvKeys.map((key, index) => [key, index])));
test('import review and commit both reject sales/viewer/finance without duplicate lookup or writes', async () => {
  for (const role of ['sales', 'viewer', 'finance']) {
    const h = await fixture({ role });
    for (const action of ['reviewStockImportAction', 'importStockAction']) {
      const result = await h.run(() => h.imports[action](form({ csv, mapping, company_id: COMPANY, submission_id: REQUEST })));
      assert.equal(result.ok, false); assert.match(result.message, /Endast företagets ägare och administratörer/);
    }
    assert.equal(h.state.calls.some(call => call.name === 'stock_import_duplicate_registrations'), false);
    assert.deepEqual(h.state.writes, []);
  }
});
test('owner/admin imports keep exact supplied purchase amounts and existing batch idempotency inputs', async () => {
  for (const role of ['owner', 'admin']) {
    const h = await fixture({ role });
    const result = await h.run(() => h.imports.importStockAction(form({ csv, mapping, company_id: COMPANY, submission_id: REQUEST })));
    assert.equal(result.ok, true); assert.equal(result.count, 1);
    assert.equal(h.state.writes[0].args.payload[0].purchase_price_ore, 12500029);
    assert.equal(h.state.writes[0].args.submission, REQUEST);
  }
});
