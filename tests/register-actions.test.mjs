import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';

const uuid = (n) => `45150000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const COMPANY = uuid(1), ACTOR = uuid(2), FOREIGN = uuid(3);
const DATE = '2026-10-15T08:30:00.123456+00:00';
const vehicle = (n = 10) => ({ id: uuid(n + 1000), company_id: COMPANY, registration_number: `REG${n}`, make: 'Volvo', model: 'V60', model_year: 2022, mileage_km: 50123, fuel: 'hybrid', gearbox: 'automatic' });
const stock = (n = 10) => ({ id: uuid(n), company_id: COMPANY, status: 'available', created_at: DATE, acquired_on: '2026-10-15', purchase_price_ore: null, asking_price_ore: '15900009', vat_scheme: 'unknown', vehicles: vehicle(n) });
const customer = (n = 20) => ({ id: uuid(n), company_id: COMPANY, name: 'Buyer', kind: 'person', email: null, phone: '0701234567', address: null, notes: null, created_at: DATE });
const deal = () => ({ id: uuid(30), company_id: COMPANY, status: 'draft', sale_price_ore: '15900009', customer_id: uuid(2000), stock_item_id: uuid(3000), created_at: DATE, customer: customer(2000), stockItem: stock(3000) });
const counts = (kind, n) => kind === 'inventory' ? { all: String(n), available: String(n), reserved: '0', sold: '0', archived: '0' } : kind === 'customers' ? { all: String(n), person: String(n), business: '0' } : { all: String(n), draft: String(n), reserved: '0', cancelled: '0', completed: '0' };
function page(args, role = 'sales') {
  const rows = args.p_kind === 'inventory' ? [stock()] : args.p_kind === 'customers' ? [customer()] : [deal()];
  if (['owner', 'admin', 'finance'].includes(role)) for (const row of rows) { if ('stockItem' in row) row.stockItem.purchase_price_ore = '12500029'; else if ('purchase_price_ore' in row) row.purchase_price_ore = '12500029'; }
  return { kind: args.p_kind, companyId: COMPANY, actorId: ACTOR, role, options: args.p_options, rows, totalCount: '600', filteredCount: '1', counts: counts(args.p_kind, 600), selected: args.p_selected_id ? args.p_kind === 'inventory' ? stock(Number(args.p_selected_id.slice(-12))) : customer(Number(args.p_selected_id.slice(-12))) : null, nextCursor: null };
}
function cursor(args, last = stock(59), role = 'sales') {
  return { version: 1, companyId: COMPANY, actorId: ACTOR, role, kind: args.p_kind, query: args.p_query, status: args.p_status, sort: args.p_sort, options: args.p_options, id: last.id, createdAt: DATE, priceOre: last.asking_price_ore };
}
async function actions({ role = 'sales', response = (args) => page(args, role), error = null, failContextAt = 0, changedActor = false, changedRole = false, activeCompany = COMPANY } = {}) {
  const calls = [], contexts = []; let contextCalls = 0;
  const db = { async rpc(name, args) { calls.push([name, args]); return { data: response(args), error }; } };
  const loader = await createSourceLoader({ '@/lib/crm/context': { async requireCrmContext(companyId) {
    contextCalls++; contexts.push(companyId);
    if (companyId !== activeCompany || failContextAt === contextCalls) throw new Error('private session detail');
    return { db, companyId, userId: changedActor && contextCalls > 1 ? FOREIGN : ACTOR, role: changedRole && contextCalls > 1 ? 'owner' : role };
  } } });
  return { module: loader.load('src/lib/data/register-actions.ts'), calls, contexts };
}
const input = (patch = {}) => ({ kind: 'inventory', expectedCompanyId: COMPANY, ...patch });

test('register action sends normalized literal search and returns exact full-company totals and öre', async () => {
  const { module, calls, contexts } = await actions({ role: 'owner' });
  const result = await module.loadDealerRegisterPage(input({ query: '  Volvo   V60  ', status: 'available', sort: 'price_asc' }));
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['dealer_register_page', { p_company_id: COMPANY, p_kind: 'inventory', p_query: 'Volvo V60', p_status: 'available', p_sort: 'price_asc', p_cursor: null, p_options: false, p_selected_id: null }]]);
  assert.deepEqual(contexts, [COMPANY, COMPANY]);
  assert.equal(result.page.totalCount, 600); assert.equal(result.page.filteredCount, 1); assert.equal(result.page.counts.available, 600);
  assert.equal(result.page.rows[0].purchase_price_ore, 12500029); assert.equal(result.page.rows[0].asking_price_ore, 15900009);
  assert.equal('company_id' in result.page.rows[0], false); assert.equal('company_id' in result.page.rows[0].vehicles, false);
});

test('deal relations are returned from real related rows beyond an old 500-record snapshot', async () => {
  const { module } = await actions();
  const result = await module.loadDealerRegisterPage(input({ kind: 'deals' }));
  assert.equal(result.ok, true); assert.equal(result.page.rows[0].customer.id, uuid(2000)); assert.equal(result.page.rows[0].stockItem.id, uuid(3000));
  assert.equal(result.page.rows[0].stockItem.vehicles.registration_number, 'REG3000');
});

test('all established reading roles including finance and viewer retain register and option access', async () => {
  for (const role of ['owner', 'admin', 'sales', 'finance', 'viewer']) {
    const { module } = await actions({ role });
    assert.equal((await module.loadDealerRegisterPage(input({ kind: 'customers' }))).page.role, role);
    assert.equal((await module.searchDealOptions(input())).page.role, role);
  }
});

test('sales/viewer stock, nested deal and selected-option DTOs retain selling fields with exact null purchase prices', async () => {
  for (const role of ['sales', 'viewer']) {
    const { module } = await actions({ role });
    const stockPage = await module.loadDealerRegisterPage(input());
    const dealPage = await module.loadDealerRegisterPage(input({kind:'deals'}));
    const options = await module.searchDealOptions(input({selectedId:uuid(5000)}));
    assert.equal(stockPage.page.rows[0].purchase_price_ore,null);
    assert.equal(dealPage.page.rows[0].stockItem.purchase_price_ore,null);
    assert.equal(options.page.rows[0].purchase_price_ore,null);assert.equal(options.page.selected.purchase_price_ore,null);
    assert.equal(stockPage.page.rows[0].asking_price_ore,15900009);
    const bad = await actions({role,response:args=>({...page(args,role),rows:[{...stock(),purchase_price_ore:'12500029'}]})});
    assert.equal((await bad.module.loadDealerRegisterPage(input())).ok,false);
  }
});

test('untrusted keys, invalid enum/search/cursor/company inputs fail before context or RPC', async () => {
  const { module, calls, contexts } = await actions();
  for (const patch of [{ kind: 'memberships' }, { expectedCompanyId: 'not-uuid' }, { query: 'x'.repeat(121) }, { query: 'abc\0def' }, { query: 'abc\ndef' }, { query: {} }, { status: 'submitted' }, { kind: 'customers', sort: 'price_desc' }, { sort: 'created_at;delete' }, { cursor: '' }, { cursor: 'bad)' }, { cursor: {} }, { limit: 1000 }, { actorId: FOREIGN }]) assert.equal((await module.loadDealerRegisterPage(input(patch))).ok, false, JSON.stringify(patch));
  assert.equal((await module.searchDealOptions(input({ kind: 'deals' }))).ok, false);
  assert.equal((await module.searchDealOptions(input({ selectedId: 'wrong' }))).ok, false);
  assert.deepEqual(calls, []); assert.deepEqual(contexts, []);
});

test('literal wildcard and PostgREST-looking search stays a bounded RPC string', async () => {
  const { module, calls } = await actions();
  await module.loadDealerRegisterPage(input({ query: '%_\'),company_id.eq.foreign' }));
  assert.equal(calls[0][1].p_query, '%_\'),company_id.eq.foreign');
});

test('foreign active company, missing approval/session or a changed scope after loading never releases data', async () => {
  for (const options of [{ activeCompany: FOREIGN }, { failContextAt: 1 }, { failContextAt: 2 }, { changedActor: true }, { changedRole: true }]) {
    const { module } = await actions(options); const result = await module.loadDealerRegisterPage(input());
    assert.equal(result.ok, false); assert.equal('page' in result, false); assert.ok(!result.error.includes('private'));
  }
});

test('cross-company relation, wrong actor/role, invalid total and unsafe money responses are denied', async () => {
  const patches = [
    (p) => ({ ...p, companyId: FOREIGN }), (p) => ({ ...p, actorId: FOREIGN }), (p) => ({ ...p, role: 'admin' }),
    (p) => ({ ...p, filteredCount: '601' }), (p) => ({ ...p, counts: { ...p.counts, all: '599' } }),
    (p) => ({ ...p, counts: { ...p.counts, available: '599' } }), (p) => ({ ...p, totalCount: '9007199254740993' }),
    (p) => ({ ...p, rows: [{ ...p.rows[0], company_id: FOREIGN }] }),
    (p) => ({ ...p, rows: [{ ...p.rows[0], asking_price_ore: '9007199254740993' }] }),
    (p) => ({ ...p, rows: [{ ...p.rows[0], vehicles: { ...p.rows[0].vehicles, company_id: FOREIGN } }] }),
  ];
  for (const patch of patches) { const { module } = await actions({ response: (args) => patch(page(args)) }); assert.equal((await module.loadDealerRegisterPage(input())).ok, false); }
  const { module } = await actions({ response: (args) => ({ ...page(args), rows: [{ ...deal(), customer: customer(999) }] }) });
  assert.equal((await module.loadDealerRegisterPage(input({ kind: 'deals' }))).ok, false);
});

test('50-row next cursor preserves microseconds and is bound to actor/company/query/status/sort/mode', async () => {
  const { module, calls } = await actions({ response: (args) => {
    const rows = Array.from({ length: 50 }, (_, index) => stock(index + 10));
    return { ...page(args), rows, filteredCount: '600', nextCursor: cursor(args, rows.at(-1)) };
  } });
  const first = await module.loadDealerRegisterPage(input());
  assert.equal(first.ok, true); assert.equal(first.page.rows.length, 50);
  const decoded = JSON.parse(Buffer.from(first.page.nextCursor, 'base64url').toString('utf8'));
  assert.equal(decoded.createdAt, DATE); assert.equal(decoded.id, uuid(59));
  assert.equal((await module.loadDealerRegisterPage(input({ cursor: first.page.nextCursor }))).ok, true);
  assert.equal(calls[1][1].p_cursor.createdAt, DATE);
  for (const patch of [{ query: 'changed' }, { status: 'reserved' }, { sort: 'price_asc' }, { expectedCompanyId: FOREIGN }]) assert.equal((await module.loadDealerRegisterPage(input({ cursor: first.page.nextCursor, ...patch }))).ok, false);
  assert.equal((await module.searchDealOptions(input({ cursor: first.page.nextCursor }))).ok, false);
  assert.equal(calls.length, 2);
});

test('invalid dates, cursor actor and appended cursor fields never reach the RPC', async () => {
  const { module, calls } = await actions();
  const base = cursor({ p_kind: 'inventory', p_query: '', p_status: 'all', p_sort: 'recent', p_options: false });
  for (const patch of [{ actorId: FOREIGN }, { createdAt: '2026-02-30T00:00:00Z' }, { createdAt: '2026-10-15T24:00:00Z' }, { createdAt: '2026-10-15T00:00:00.1234567Z' }, { companyId: FOREIGN }, { extra: 'injection' }, { priceOre: '9223372036854775808' }, { priceOre: '-1' }]) {
    const encoded = Buffer.from(JSON.stringify({ ...base, ...patch })).toString('base64url');
    assert.equal((await module.loadDealerRegisterPage(input({ cursor: encoded }))).ok, false);
  }
  assert.deepEqual(calls, []);
});

test('options restrict stock to available and preserve a separately selected own-company row outside search', async () => {
  const { module, calls } = await actions();
  const result = await module.searchDealOptions(input({ query: 'Other car', selectedId: uuid(5000) }));
  assert.equal(result.ok, true); assert.equal(result.page.selected.id, uuid(5000)); assert.equal(result.page.rows[0].id, uuid(10));
  assert.equal(calls[0][1].p_status, 'available'); assert.equal(calls[0][1].p_options, true);
  const invalid = await actions({ response: (args) => ({ ...page(args), selected: { ...stock(5000), status: 'reserved' } }) });
  assert.equal((await invalid.module.searchDealOptions(input({ selectedId: uuid(5000) }))).ok, false);
});

test('database details and malformed responses produce a safe error rather than an empty or successful page', async () => {
  for (const options of [{ error: { message: 'private SQL detail' } }, { response: () => null }, { response: () => ({}) }, { response: (args) => ({ ...page(args), nextCursor: {} }) }]) {
    const { module } = await actions(options); const result = await module.loadDealerRegisterPage(input());
    assert.equal(result.ok, false); assert.ok(!result.error.includes('private SQL')); assert.equal('page' in result, false);
  }
});
