import assert from 'node:assert/strict';
import {after, before, beforeEach, test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createDatabase, asRole} from '../crm-db/helpers.mjs';
import {createSourceLoader} from '../helpers/source-loader.mjs';

const id = number => `fc130000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const COMPANY = id(101), OWNER = id(1), FINANCE = id(4), DEAL = id(501);
let database, seed;
before(async () => {
  database = await createDatabase({approveEstablishedFixtures: false});
  const proof = await readFile(new URL('../../supabase/tests/trade_in_acquisition.sql', import.meta.url), 'utf8');
  seed = proof.split('-- BEGIN TRADE IN ACQUISITION FIXTURES')[1]?.split('-- END TRADE IN ACQUISITION FIXTURES')[0];
  assert.ok(seed, 'Use the same real accepted-offer/native-signing fixture as the SQL proof');
});
beforeEach(async () => { await database.exec(`begin; truncate auth.users cascade; ${seed} commit;`); });
after(async () => { await database?.close(); });

/**
 * Real actions, current authorization contexts, account approval, parsers and
 * migrated PostgreSQL RPCs. Only Supabase SDK I/O and selected-company routing
 * are adapted to local PGlite. This is not a hosted Auth/PostgREST/browser proof
 * and does not replace the separate native PostgreSQL concurrency suite.
 */
async function integration({actor = OWNER, company = COMPANY} = {}) {
  const state = {actor, company, authenticated: true, calls: [], databaseErrors: [], invalidations: [], afterRpc: null, loseReceipt: false};
  const db = {
    auth: {async getUser() {
      state.calls.push(['auth']);
      if (!state.authenticated) return {data: {user: null}, error: null};
      const {rows} = await database.query('select id,email,email_confirmed_at::text,is_anonymous from auth.users where id=$1', [state.actor]);
      return {data: {user: rows[0] ?? null}, error: null};
    }},
    from(table) {
      assert.equal(table, 'memberships');
      const filters = {}, query = {
        select() { return query; }, eq(key, value) { filters[key] = value; return query; },
        async maybeSingle() {
          assert.deepEqual(Object.keys(filters).sort(), ['companies.status', 'company_id', 'status', 'user_id']);
          const data = await asRole(database, 'authenticated', state.actor, async tx => {
            const {rows} = await tx.query(`select m.company_id,m.user_id,m.role,m.status,
              jsonb_build_object('id',c.id,'status',c.status) companies
              from public.memberships m join public.companies c on c.id=m.company_id
              where m.company_id=$1 and m.user_id=$2 and m.status=$3 and c.status=$4`,
            [filters.company_id, filters.user_id, filters.status, filters['companies.status']]);
            return rows[0] ?? null;
          });
          state.calls.push(['membership']); return {data, error: null};
        },
      };
      return query;
    },
    rpc(name, args) {
      assert.ok(['get_account_access', 'get_trade_in_acquisition', 'record_trade_in_acquisition'].includes(name));
      state.calls.push(['rpc', name, structuredClone(args)]);
      const request = Promise.resolve().then(async () => {
        try {
          const entries = Object.entries(args);
          assert.ok(entries.every(([key]) => /^p_[a-z_][a-z_0-9]*$/.test(key)));
          const parameters = entries.map(([key], index) => `${key} => $${index + 1}`).join(',');
          const data = await asRole(database, 'authenticated', state.actor, async tx =>
            (await tx.query(`select public.${name}(${parameters}) result`, entries.map(([, value]) => value))).rows[0].result);
          if (state.afterRpc) await state.afterRpc(name, data);
          if (name === 'record_trade_in_acquisition' && state.loseReceipt) {
            state.loseReceipt = false; return {data: null, error: {code: 'FIXTURE_NETWORK', message: 'PRIVATE lost response after commit'}};
          }
          return {data, error: null};
        } catch (error) { state.databaseErrors.push({code: error.code, message: error.message}); return {data: null, error: {code: error.code, message: 'PRIVATE database detail withheld'}}; }
      });
      request.abortSignal = signal => { assert.ok(signal instanceof AbortSignal); return request; };
      return request;
    },
  };
  const loader = await createSourceLoader({
    'next/cache': {revalidatePath: path => state.invalidations.push(path)},
    '@/lib/supabase/server': {async createServerSupabaseClient() { return db; }},
    '@/lib/data/company-context': {async getActiveCompanyContext() { return {db, company: state.company, user: state.actor, role: 'owner'}; }},
  });
  const actions = loader.load('@/lib/data/trade-in-acquisition-actions');
  return {
    state, actions,
    get: (dealId = DEAL) => actions.getTradeInAcquisitionAction({companyId: state.company, dealId}),
    record: value => actions.recordTradeInAcquisitionAction(value),
  };
}
function input(page, request = id(901)) {
  return {
    companyId: page.companyId, dealId: page.dealId, expectedSourceSha256: page.source.sourceSha256,
    acquiredOn: page.businessDate, purchaseAgreementReference: 'Externt inköpsavtal 42',
    debtConfirmedOre: page.source.offerSnapshot.trade_in.debt_ore, debtConfirmedOn: page.businessDate,
    debtEvidenceReference: 'Manuellt granskat skuldunderlag 42', fuel: 'electric', gearbox: 'manual', askingPriceOre: '999999999999',
    purchaseConfirmed: true, receivedConfirmed: true, debtConfirmed: true, reviewAcknowledged: true,
    attestationVersion: '2026-10-15', requestId: request,
  };
}
async function ready(harness, deal = DEAL) {
  const page = await harness.get(deal);
  assert.equal(page.ok, true, JSON.stringify(page)); assert.equal(page.canAcquire, true); assert.ok(page.source);
  return page;
}
async function counts() {
  return (await database.query(`select (select count(*)::integer from private.trade_in_acquisitions) acquisitions,
    (select count(*)::integer from private.trade_in_acquisition_audit) audits,
    (select count(*)::integer from public.vehicles) vehicles,
    (select count(*)::integer from public.stock_items) stocks`)).rows[0];
}

test('trade-in cross-layer: actual signed SQL sources create gross-price stock with explicit vehicle facts and frozen seller for zero and positive debt', async () => {
  for (const options of [{}, {actor: id(2), company: id(102)}]) {
    const h = await integration(options), deal = options.company ? id(502) : DEAL, page = await ready(h, deal);
    const frozenName = page.source.offerSnapshot.customer.name;
    await database.query('update public.customers set name=$1 where id=$2', ['Later edited customer', page.source.sellerCustomerId]);
    const result = await h.record(input(page, options.company ? id(902) : id(901)));
    assert.equal(result.ok, true, JSON.stringify({result, databaseErrors: h.state.databaseErrors}));
    assert.equal(result.acquisition.source.offerSnapshot.customer.name, frozenName);
    assert.equal(result.acquisition.purchasePriceOre, '30000029');
    assert.equal(result.acquisition.debtConfirmedOre, options.company ? '35000001' : '0');
    assert.equal(result.acquisition.actorLabel, 'Du');
    const {rows} = await database.query(`select v.registration_number,v.fuel,v.gearbox,s.purchase_price_ore::text,
      s.asking_price_ore::text,s.vat_scheme,s.purchase_vat_ore,s.vat_basis_confirmed,s.status
      from public.stock_items s join public.vehicles v on v.id=s.vehicle_id where s.id=$1`, [result.acquisition.stockItemId]);
    assert.deepEqual(rows[0], {registration_number: options.company ? 'TI-002' : 'TI001', fuel: 'electric', gearbox: 'manual', purchase_price_ore: '30000029', asking_price_ore: '999999999999', vat_scheme: 'unknown', purchase_vat_ore: null, vat_basis_confirmed: false, status: 'available'});
    const saved = await h.get(deal); assert.equal(saved.ok, true); assert.equal(saved.canAcquire, false);
    assert.equal(saved.reason, 'already_acquired'); assert.deepEqual(saved.acquisition, result.acquisition);
    assert.ok(h.state.invalidations.includes('/inventory')); assert.ok(h.state.invalidations.includes('/deals'));
    assert.doesNotMatch(JSON.stringify(saved), /PRIVATE CONDITION|PRIVATE EQUIPMENT|PRIVATE LENDER/);
  }
  assert.deepEqual(await counts(), {acquisitions: 2, audits: 2, vehicles: 7, stocks: 7});
});

test('trade-in cross-layer: lost committed response recovers the same immutable receipt after deal cancellation and acquired-stock archive', async () => {
  const h = await integration(), page = await ready(h), value = input(page);
  h.state.loseReceipt = true;
  const lost = await h.record(value); assert.equal(lost.ok, false); assert.equal(lost.code, 'unavailable');
  const row = (await database.query('select id,stock_item_id from private.trade_in_acquisitions')).rows[0]; assert.ok(row);
  await database.query("update public.stock_items set status='archived' where id=$1", [row.stock_item_id]);
  await database.query("update public.deals set status='cancelled' where id=$1", [DEAL]);
  const replay = await h.record(value); assert.equal(replay.ok, true, JSON.stringify(replay)); assert.equal(replay.acquisition.id, row.id);
  const changedRequest = await h.record({...value, requestId: id(903)}); assert.equal(changedRequest.ok, false); assert.equal(changedRequest.code, 'conflict');
  const changedPayload = await h.record({...value, askingPriceOre: '10000'}); assert.equal(changedPayload.ok, false); assert.equal(changedPayload.code, 'conflict');
  assert.deepEqual(await counts(), {acquisitions: 1, audits: 1, vehicles: 6, stocks: 6});
});

test('trade-in cross-layer: finance reads private historical receipt but cannot mutate; current approval revocation withholds a successful RPC response', async () => {
  const owner = await integration(), page = await ready(owner), value = input(page);
  assert.equal((await owner.record(value)).ok, true);
  const finance = await integration({actor: FINANCE}), read = await finance.get();
  assert.equal(read.ok, true, JSON.stringify(read)); assert.equal(read.role, 'finance'); assert.equal(read.canAcquire, false); assert.equal(read.acquisition.actorLabel, 'Kollega');
  const denied = await finance.record({...value, requestId: id(904)}); assert.equal(denied.ok, false); assert.equal(denied.code, 'access_denied');
  assert.ok(!finance.state.calls.some(call => call[1] === 'record_trade_in_acquisition'));
  owner.state.afterRpc = async name => {
    if (name === 'get_trade_in_acquisition') { owner.state.afterRpc = null; await database.query("update private.account_approvals set status='suspended',version=version+1 where user_id=$1", [OWNER]); }
  };
  const revoked = await owner.get(); assert.equal(revoked.ok, false); assert.equal(revoked.code, 'access_denied');
  assert.doesNotMatch(JSON.stringify(revoked), /purchaseAgreementReference|sourceSha256|PRIVATE/);
  const replay = await owner.record(value); assert.equal(replay.ok, false); assert.equal(replay.code, 'access_denied');
  assert.deepEqual(await counts(), {acquisitions: 1, audits: 1, vehicles: 6, stocks: 6});
});
