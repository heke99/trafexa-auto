import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';

const id = n => `ac510000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const companyId = id(1), dealId = id(2), userId = id(3), requestId = id(4);
const now = new Date('2026-10-15T10:00:00Z'), day = '2026-10-15';
const scope = { companyId, dealId, userId, role: 'owner' };
function source() {
  return {
    companyId, dealId, offerId: id(5), offerVersion: 2, tradeInId: id(6), tradeInVersion: 3,
    sellerCustomerId: id(7), signingId: id(8), signingDocumentSha256: 'a'.repeat(64), signingRevision: 3, sourceSha256: 'b'.repeat(64),
    offerSnapshot: {
      schema_version: 1, document_type: 'offer', version: 2, deal_id: dealId, issued_at: '2026-10-14T10:00:00Z', valid_until: '2026-11-12',
      terms: 'Frysta accepterade villkor.', currency: 'SEK', price_basis: 'gross', sale_price_ore: '20000000',
      company: { id: companyId, name: 'Fiktiv bil AB', organisation_number: '5560000001' },
      customer: { id: id(7), name: 'Fryst säljare Åäö', kind: 'person', email: 'seller@example.invalid', phone: null, address: null },
      stock: { id: id(9), vat_scheme: 'unknown' },
      vehicle: { id: id(10), registration_number: 'UT123', vin: null, make: 'Volvo', model: 'V60', model_year: 2020, mileage_km: 50000, fuel: 'hybrid', gearbox: 'automatic' },
      vat: { rate_percent: null, amount_ore: null, net_price_ore: null },
      trade_in: { id: id(6), version: 3, registration: 'IN123', make: 'Saab', model: '9-3', model_year: 2010, mileage_km: 150000, value_ore: '10000029', debt_known: true, debt_ore: '2500001', net_trade_in_ore: '7500028', amount_to_pay_ore: '12499972' },
    },
  };
}
function input() {
  return { companyId, dealId, expectedSourceSha256: 'b'.repeat(64), acquiredOn: '2026-10-14', purchaseAgreementReference: 'INK-2026-001', debtConfirmedOre: '2500001', debtConfirmedOn: '2026-10-15', debtEvidenceReference: 'SKULD-001', fuel: 'petrol', gearbox: 'manual', askingPriceOre: '12000009', purchaseConfirmed: true, receivedConfirmed: true, debtConfirmed: true, reviewAcknowledged: true, attestationVersion: '2026-10-15', requestId };
}
function acquisition() {
  const { acquiredOn, purchaseAgreementReference, debtConfirmedOre, debtConfirmedOn, debtEvidenceReference, fuel, gearbox, askingPriceOre, attestationVersion } = input();
  return { id: id(11), companyId, dealId, source: source(), vehicleId: id(12), stockItemId: id(13), acquiredOn, purchaseAgreementReference, debtConfirmedOre, debtConfirmedOn, debtEvidenceReference, fuel, gearbox, askingPriceOre, purchasePriceOre: '10000029', vatScheme: 'unknown', attestationVersion, createdAt: '2026-10-15T09:00:00Z', actorLabel: 'Du' };
}
function page(patch = {}) { return { actorId: userId, role: 'owner', companyId, dealId, businessDate: day, canAcquire: true, reason: null, source: source(), acquisition: null, ...patch }; }
function receipt(patch = {}) { return { actorId: userId, role: 'owner', companyId, dealId, requestId, acquisition: acquisition(), ...patch }; }
const loader = await createSourceLoader();
const validation = loader.load('src/lib/trade-in-acquisition/validation.ts');

test('frozen source binds exact accepted offer, customer, trade-in version and full value rather than debt or net', () => {
  const parsed = validation.parseTradeInAcquisitionSource(source(), scope);
  assert.equal(parsed.offerSnapshot.customer.name, 'Fryst säljare Åäö');
  const saved = validation.parseTradeInAcquisition(acquisition(), scope, day);
  assert.equal(saved.purchasePriceOre, '10000029'); assert.notEqual(saved.purchasePriceOre, saved.debtConfirmedOre);
  for (const purchasePriceOre of ['7500028', '2500001', '0', 10000029]) assert.throws(() => validation.parseTradeInAcquisition({ ...acquisition(), purchasePriceOre }, scope, day));
});

test('input exact canonical öre, explicit manual choices, all four attestations and strict private-field rejection', () => {
  assert.deepEqual(validation.parseRecordTradeInAcquisitionInput(input()), input());
  const trimmed = validation.parseRecordTradeInAcquisitionInput({ ...input(), purchaseAgreementReference: '  INK-2026-001  ' });
  assert.equal(trimmed.purchaseAgreementReference, 'INK-2026-001');
  for (const patch of [
    { debtConfirmedOre: 2500001 }, { debtConfirmedOre: '01' }, { debtConfirmedOre: '-1' }, { askingPriceOre: '0' }, { askingPriceOre: '1.01' }, { askingPriceOre: '1e3' }, { askingPriceOre: '1000000000000' },
    { purchaseConfirmed: false }, { receivedConfirmed: false }, { debtConfirmed: false }, { reviewAcknowledged: false },
    { fuel: '' }, { gearbox: 'other' }, { attestationVersion: 'future' }, { purchasePriceOre: '1' }, { sellerName: 'Live customer' }, { source: source() }, { actorId: userId }, { cursor: 'foreign' },
    { purchaseAgreementReference: 'a' }, { purchaseAgreementReference: 'x'.repeat(161) }, { purchaseAgreementReference: '\nHidden control' }, { debtEvidenceReference: 'bad\tref' },
  ]) assert.throws(() => validation.parseRecordTradeInAcquisitionInput({ ...input(), ...patch }), JSON.stringify(patch));
});

test('Gregorian dates reject rollover, use Stockholm business dates and impose no invented relative receipt order', () => {
  for (const value of ['1900-01-01', '2000-02-29', '2024-02-29']) assert.equal(validation.acquisitionDate(value), value);
  for (const value of ['1899-12-31', '1900-02-29', '2026-02-29', '2026-04-31', '2026-13-01', '2026-10-1', '2026-01-01T00:00:00Z']) assert.throws(() => validation.acquisitionDate(value));
  assert.equal(validation.stockholmAcquisitionBusinessDate(new Date('2026-10-14T22:30:00Z')), '2026-10-15');
  // Syntax is validated before auth; mutable future-date checks belong to SQL
  // after an authorized historical replay, not to this input parser.
  assert.equal(validation.parseRecordTradeInAcquisitionInput({ ...input(), acquiredOn: '2099-01-01' }).acquiredOn, '2099-01-01');
  assert.equal(validation.parseTradeInAcquisition(acquisition(), scope, day).debtConfirmedOn, '2026-10-15');
  assert.throws(() => validation.parseTradeInAcquisition({ ...acquisition(), acquiredOn: '2026-10-16' }, scope, day));
  assert.throws(() => validation.parseTradeInAcquisition({ ...acquisition(), debtConfirmedOn: '2026-10-16' }, scope, day));
});

test('read reason/role/source algebra distinguishes ready, duplicate, already acquired and verified absence', () => {
  assert.equal(validation.parseTradeInAcquisitionPage(page(), scope, now).canAcquire, true);
  assert.equal(validation.parseTradeInAcquisitionPage(page({ role: 'finance', canAcquire: false }), { ...scope, role: 'finance' }, now).canAcquire, false);
  for (const reason of ['no_accepted_trade_in', 'contract_incomplete', 'deal_unavailable']) assert.equal(validation.parseTradeInAcquisitionPage(page({ reason, canAcquire: false, source: null }), scope, now).reason, reason);
  assert.equal(validation.parseTradeInAcquisitionPage(page({ reason: 'vehicle_exists', canAcquire: false }), scope, now).reason, 'vehicle_exists');
  assert.equal(validation.parseTradeInAcquisitionPage(page({ reason: 'already_acquired', canAcquire: false, acquisition: acquisition() }), scope, now).acquisition.id, id(11));
  for (const patch of [{ canAcquire: false }, { reason: 'already_acquired', canAcquire: false }, { source: null }, { businessDate: '2026-10-16' }, { reason: 'vehicle_exists', canAcquire: true }, { reason: 'no_accepted_trade_in', canAcquire: false }, { acquisition: acquisition() }, { role: 'sales' }, { actorId: id(99) }, { companyId: id(99) }, { dealId: id(99) }, { cursor: null }]) assert.throws(() => validation.parseTradeInAcquisitionPage(page(patch), scope, now));
});

test('foreign or mutated source, leaked snapshot fields, debt mismatch and mutable-VAT attribution are rejected', () => {
  for (const mutate of [
    value => { value.companyId = id(99); }, value => { value.dealId = id(99); }, value => { value.offerVersion++; }, value => { value.tradeInVersion++; }, value => { value.tradeInId = id(99); }, value => { value.sellerCustomerId = id(99); }, value => { value.signingRevision = 2; }, value => { value.sourceSha256 = 'BAD'; }, value => { value.offerSnapshot.customer.id = id(99); }, value => { value.offerSnapshot.trade_in.net_trade_in_ore = '1'; }, value => { value.offerSnapshot.trade_in.value_ore = 10000029; }, value => { value.offerSnapshot.privateActorId = id(99); },
  ]) { const value = source(); mutate(value); assert.throws(() => validation.parseTradeInAcquisitionSource(value, scope)); }
  for (const patch of [{ debtConfirmedOre: '0' }, { vatScheme: 'standard' }, { vehicleId: id(10) }, { stockItemId: id(9) }, { createdAt: '2026-02-30T00:00:00Z' }, { createdAt: '2026-10-15T24:00:00Z' }, { actorLabel: 'External' }]) assert.throws(() => validation.parseTradeInAcquisition({ ...acquisition(), ...patch }, scope, day));
});

test('known zero debt still needs complete proof and exact maximum integer öre remain strings', () => {
  const value = acquisition(), trade = value.source.offerSnapshot.trade_in;
  trade.debt_ore = '0'; trade.net_trade_in_ore = trade.value_ore; trade.amount_to_pay_ore = (20000000n - BigInt(trade.value_ore)).toString(); value.debtConfirmedOre = '0';
  assert.equal(validation.parseTradeInAcquisition(value, scope, day).debtConfirmedOre, '0');
  value.debtEvidenceReference = ''; assert.throws(() => validation.parseTradeInAcquisition(value, scope, day));
  const parsed = validation.parseRecordTradeInAcquisitionInput({ ...input(), askingPriceOre: '999999999999', debtConfirmedOre: '999999999999' });
  assert.equal(parsed.askingPriceOre, '999999999999'); assert.equal(typeof parsed.debtConfirmedOre, 'string');
});

async function actionsFixture(options = {}) {
  const state = { contexts: [], calls: [], invalidated: [] };
  const db = { rpc(name, args) {
    state.calls.push({ name, args });
    const query = { abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return query; }, then(resolve, reject) { return Promise.resolve({ data: options.data ?? (name === 'get_trade_in_acquisition' ? page({ businessDate: validation.stockholmAcquisitionBusinessDate() }) : receipt()), error: options.error ?? null }).then(resolve, reject); } };
    return query;
  } };
  const graph = await createSourceLoader({
    '../trade-in-acquisition/context': { async requireTradeInAcquisitionContext(selected, mode = 'read') { state.contexts.push({ selected, mode }); if (options.deny || options.revoke && state.contexts.length > 1) throw Object.assign(Error('private diagnostics'), { code: options.noAuth ? 'unauthenticated' : 'access_denied' }); return { db, companyId, userId: options.switchActor && state.contexts.length > 1 ? id(99) : userId, role: 'owner' }; } },
    'next/cache': { revalidatePath(path) { state.invalidated.push(path); } },
  });
  return { state, actions: graph.load('src/lib/data/trade-in-acquisition-actions.ts') };
}

test('write action dispatches only scoped manual fields and exact source CAS then reauthorizes before success', async () => {
  const { state, actions } = await actionsFixture(); const result = await actions.recordTradeInAcquisitionAction(input());
  assert.equal(result.ok, true); assert.equal(result.acquisition.purchasePriceOre, '10000029'); assert.equal(result.actorId, userId);
  assert.equal(state.calls.length, 1); assert.equal(state.calls[0].name, 'record_trade_in_acquisition');
  assert.equal(state.calls[0].args.p_asking_price_ore, '12000009'); assert.equal(state.calls[0].args.p_debt_confirmed_ore, '2500001');
  assert.equal(state.calls[0].args.p_request_id, requestId); assert.equal(state.calls[0].args.p_expected_source_sha256, input().expectedSourceSha256);
  for (const forbidden of ['p_purchase_price_ore', 'p_actor_id', 'p_seller_name', 'p_source', 'p_vehicle_id']) assert.equal(forbidden in state.calls[0].args, false);
  assert.deepEqual(state.contexts.map(value => value.mode), ['write', 'write']); assert.deepEqual(state.invalidated, ['/inventory', '/deals', '/dashboard']);
});

test('historical replay does no mutable source/status preflight and preserves the exact nonce/input transport', async () => {
  const { state, actions } = await actionsFixture();
  assert.equal((await actions.recordTradeInAcquisitionAction(input())).ok, true);
  assert.equal((await actions.recordTradeInAcquisitionAction(input())).ok, true);
  assert.deepEqual(state.calls[0], state.calls[1]); assert.ok(state.calls.every(call => call.name === 'record_trade_in_acquisition'));
});

test('unconfirmed, malformed or forged writes stop before Auth/RPC, including numeric money and bad Gregorian input', async () => {
  const { state, actions } = await actionsFixture();
  for (const patch of [{ receivedConfirmed: false }, { askingPriceOre: 12000009 }, { acquiredOn: '2026-02-30' }, { companyId: 'bad' }, { purchasePriceOre: '1' }, { actorId: userId }, { cursor: 'foreign' }]) assert.equal((await actions.recordTradeInAcquisitionAction({ ...input(), ...patch })).code, 'invalid_input');
  assert.equal(state.contexts.length, 0); assert.equal(state.calls.length, 0);
});

test('each mismatching source/actor/role/request/manual receipt field withholds success and invalidation', async () => {
  const mutations = [value => { value.actorId = id(99); }, value => { value.role = 'admin'; }, value => { value.requestId = id(99); }, value => { value.companyId = id(99); }, value => { value.dealId = id(99); }, value => { value.acquisition.source.sourceSha256 = 'c'.repeat(64); }, value => { value.acquisition.actorLabel = 'Kollega'; }];
  for (const key of ['acquiredOn', 'purchaseAgreementReference', 'debtConfirmedOn', 'debtEvidenceReference', 'fuel', 'gearbox', 'askingPriceOre']) mutations.push(value => { value.acquisition[key] = ({ acquiredOn: '2026-10-13', purchaseAgreementReference: 'Different', debtConfirmedOn: '2026-10-13', debtEvidenceReference: 'Different', fuel: 'diesel', gearbox: 'automatic', askingPriceOre: '12000010' })[key]; });
  for (const mutate of mutations) { const data = receipt(); mutate(data); const { state, actions } = await actionsFixture({ data }); assert.equal((await actions.recordTradeInAcquisitionAction(input())).ok, false); assert.deepEqual(state.invalidated, []); }
});

test('fresh post-I/O denial/actor change and database conflict/unknown outcomes never expose raw diagnostics', async () => {
  for (const options of [{ deny: true }, { deny: true, noAuth: true }, { revoke: true }, { switchActor: true }]) {
    const { state, actions } = await actionsFixture(options); const result = await actions.recordTradeInAcquisitionAction(input());
    assert.equal(result.ok, false); assert.equal(result.code, options.noAuth ? 'unauthenticated' : 'access_denied'); assert.deepEqual(state.invalidated, []);
  }
  for (const [code, expected] of [['40001', 'conflict'], ['23505', 'conflict'], ['42501', 'access_denied'], ['22023', 'invalid_input'], ['XX000', 'unavailable']]) {
    const { state, actions } = await actionsFixture({ error: { code, message: 'private service_key detail' } }); const result = await actions.recordTradeInAcquisitionAction(input());
    assert.equal(result.code, expected); assert.equal(result.error.includes('service_key'), false); assert.deepEqual(state.invalidated, []); assert.equal(state.calls[0].args.p_request_id, requestId);
  }
});

test('read action returns the full verified scope envelope and refuses stale role/source/cursor data', async () => {
  const good = await actionsFixture(); const result = await good.actions.getTradeInAcquisitionAction({ companyId, dealId });
  assert.equal(result.ok, true); assert.equal(result.actorId, userId); assert.equal(result.source.offerSnapshot.customer.name, 'Fryst säljare Åäö');
  assert.deepEqual(good.state.contexts.map(value => value.mode), ['read', 'read']);
  for (const patch of [{ actorId: id(99) }, { role: 'sales' }, { source: null }, { cursor: null }]) {
    const { actions } = await actionsFixture({ data: page({ businessDate: validation.stockholmAcquisitionBusinessDate(), ...patch }) });
    assert.equal((await actions.getTradeInAcquisitionAction({ companyId, dealId })).ok, false);
  }
});
