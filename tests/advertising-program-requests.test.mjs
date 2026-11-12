import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, call, fail, A, C, U, id } from './advertising-priced-send-db/fixtures.mjs';
import { createSourceLoader } from './helpers/source-loader.mjs';

const storeInput = { store_name: 'Synthetic store', dealer_code: 'program-fixture' };
const periodInput = (period = id(40), version = 0) => ({ period_id: period, version, agreement_reference: 'Reviewed fixture', desired_start: '2026-12-01', confirmed_start: null, notice_date: null, contract_end: null, confirmed_end: null, blocket_price_ore: '62000', bytbil_price_ore: '0', monthly_fee_ore: '290000', partial_month_rule: 'full', blocket_cost_ore: '50000', bytbil_cost_ore: null, monthly_cost_ore: null });
const save = (db, store, input, request, user = A) => call(db, 'select public.save_advertising_program_request($1,$2,$3,$4) r', [C, store, input, request], user);
const resolve = (db, request, user = A) => call(db, 'select public.resolve_advertising_program_request($1,$2) r', [C, request], user);

test('same request returns the immutable original store and revision receipt, even after a later edit', async () => {
  const db = await fixture();
  try {
    const store = await save(db, null, storeInput, id(41));
    assert.deepEqual(await save(db, null, storeInput, id(41)), store);
    const first = await save(db, store.storeId, periodInput(), id(42));
    assert.equal(first.version, 1); assert.equal(first.periodId, id(40));
    assert.deepEqual(await save(db, store.storeId, periodInput(), id(42)), first);
    const second = await save(db, store.storeId, { ...periodInput(id(40), 1), blocket_price_ore: '72000' }, id(43));
    assert.equal(second.version, 2);
    assert.deepEqual(await save(db, store.storeId, periodInput(), id(42)), first);
    assert.deepEqual((await resolve(db, id(42))).receipt, first);
    assert.equal((await db.query('select count(*)::int n from private.advertising_program_stores')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int n from private.advertising_program_revisions')).rows[0].n, 2);
    await fail(save(db, store.storeId, { ...periodInput(), blocket_price_ore: '99900' }, id(42)), '40001');
    await fail(db.query('delete from private.advertising_program_requests'), '55000');
  } finally { await db.close(); }
});

test('explicitly resolving a missing request fences a delayed original write without creating a store', async () => {
  const db = await fixture();
  try {
    const closed = await resolve(db, id(44));
    assert.equal(closed.state, 'not_saved'); assert.equal(closed.receipt, null);
    assert.deepEqual(await resolve(db, id(44)), closed);
    await fail(save(db, null, storeInput, id(44)), '40001');
    assert.equal((await db.query('select count(*)::int n from private.advertising_program_stores')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int n from private.advertising_program_requests')).rows[0].n, 1);
    const next = await save(db, null, storeInput, id(45)); assert.equal(next.operation, 'store');
  } finally { await db.close(); }
});

test('request IDs do not grant another actor or ordinary account access; private journal has no direct grants', async () => {
  const db = await fixture();
  try {
    await save(db, null, storeInput, id(46));
    await fail(resolve(db, id(46), U), '42501');
    await fail(save(db, null, storeInput, id(47), U), '42501');
    await fail(call(db, 'select * from private.advertising_program_requests r', [], A), '42501');
    await fail(call(db, 'select public.resolve_advertising_program_request($1,$2) r', [C, id(46)], null, 'anon'), '42501');
    await fail(call(db, 'select public.save_advertising_program_request($1,$2,$3,$4) r', [C, null, storeInput, id(48)], null, 'service_role'), '42501');
    await db.query('insert into private.platform_admins(user_id,created_by) values($1,$2)', [U, A]);
    assert.equal((await resolve(db, id(46), U)).state, 'not_saved');
    const own = await resolve(db, id(46), A); assert.equal(own.state, 'saved');
    await db.query("update private.platform_admins set status='suspended' where user_id=$1", [A]);
    await fail(resolve(db, id(46)), '42501');
  } finally { await db.close(); }
});

test('pending-period cancellation has its own stable receipt and unsupported fields never mutate', async () => {
  const db = await fixture();
  try {
    const store = await save(db, null, storeInput, id(50));
    await fail(save(db, store.storeId, { ...periodInput(), created_by: U }, id(51)), '22023');
    await save(db, store.storeId, periodInput(), id(52));
    const input = { period_id: id(40), version: 1, cancelled: true };
    const cancelled = await save(db, store.storeId, input, id(53));
    assert.equal(cancelled.operation, 'cancel'); assert.equal(cancelled.version, 2);
    assert.deepEqual(await save(db, store.storeId, input, id(53)), cancelled);
    assert.equal((await db.query('select count(*)::int n from private.advertising_program_revisions')).rows[0].n, 2);
  } finally { await db.close(); }
});

async function actionsFixture() {
  const db = await fixture();
  const state = { actor: A, lose: false, authThrows: false, revokeAfterSave: false, calls: [] };
  const client = { auth: { async getUser() { if (state.authThrows) throw Error('PRIVATE synthetic Auth failure'); return { data: { user: state.actor ? (await db.query('select id,email,email_confirmed_at::text,is_anonymous from auth.users where id=$1', [state.actor])).rows[0] : null }, error: null }; } }, rpc(name, args) {
    state.calls.push(name);
    const entries = Object.entries(args);
    const response = call(db, `select public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(',')}) r`, entries.map(([, value]) => value), state.actor)
      .then(async data => {
        if (name === 'save_advertising_program_request' && state.revokeAfterSave) await db.query("update private.platform_admins set status='suspended' where user_id=$1", [A]);
        if (name === 'save_advertising_program_request' && state.lose) { state.lose = false; throw Error('PRIVATE response lost after commit'); }
        return { data, error: null };
      }, error => ({ data: null, error: { code: error.code, message: 'PRIVATE database failure' } }));
    response.abortSignal = () => response; return response;
  } };
  const loader = await createSourceLoader({ '@/lib/supabase/server': { async createServerSupabaseClient() { return client; } }, 'next/cache': { revalidatePath() {} } });
  const actions = loader.load('@/lib/platform-admin/advertising-program-actions');
  const input = { actorId: A, companyId: C, requestId: id(60), operation: 'store', storeId: null, periodId: null, expectedVersion: 0, fields: storeInput, acknowledged: true };
  return { db, state, actions, input };
}

test('actual action recovers a lost committed response and a forged actor never reaches the write', async () => {
  const h = await actionsFixture();
  try {
    h.state.lose = true;
    assert.equal((await h.actions.saveAdvertisingProgramRequestAction(h.input)).code, 'unavailable');
    const { actorId, companyId, fields: _fields, acknowledged: _ack, ...identity } = h.input;
    const recovered = await h.actions.resolveAdvertisingProgramRequestAction({ actorId, companyId, identity });
    assert.equal(recovered.ok, true); assert.equal(recovered.state, 'saved');
    assert.deepEqual((await h.actions.saveAdvertisingProgramRequestAction(h.input)).receipt, recovered.receipt);
    assert.equal((await h.db.query('select count(*)::int n from private.advertising_program_stores')).rows[0].n, 1);
    const calls = h.state.calls.length;
    assert.equal((await h.actions.saveAdvertisingProgramRequestAction({ ...h.input, actorId: U, requestId: id(61) })).code, 'access_denied');
    assert.equal(h.state.calls.slice(calls).includes('save_advertising_program_request'), false);
  } finally { await h.db.close(); }
});

test('invalid money preserves a field error without RPC; expired Auth and thrown transport return controlled results', async () => {
  const h = await actionsFixture();
  try {
    const loader = await createSourceLoader();
    const fields = loader.load('@/lib/advertising-program/validation').periodDraft();
    Object.assign(fields, { agreement_reference: 'Retain this reference', desired_start: '2026-12-01', blocket_price_ore: '620 kr' });
    const result = await h.actions.saveAdvertisingProgramRequestAction({ ...h.input, operation: 'period', storeId: id(62), periodId: id(63), fields });
    assert.equal(result.code, 'invalid_input'); assert.match(result.fields.blocket_price_ore, /620,00/); assert.deepEqual(h.state.calls, []);
    const invalidDate = await h.actions.saveAdvertisingProgramRequestAction({ ...h.input, operation: 'period', storeId: id(62), periodId: id(63), fields: { ...fields, blocket_price_ore: '620,00', desired_start: '0000-01-01' } });
    assert.equal(invalidDate.code, 'invalid_input'); assert.match(invalidDate.fields.desired_start, /datum/); assert.deepEqual(h.state.calls, []);
    h.state.actor = null;
    assert.equal((await h.actions.saveAdvertisingProgramRequestAction(h.input)).code, 'unauthenticated');
    h.state.actor = A; h.state.authThrows = true;
    const unavailable = await h.actions.saveAdvertisingProgramRequestAction(h.input);
    assert.equal(unavailable.code, 'unavailable'); assert.equal(JSON.stringify(unavailable).includes('PRIVATE'), false);
  } finally { await h.db.close(); }
});

test('fresh role revocation after a committed request withholds its receipt', async () => {
  const h = await actionsFixture();
  try {
    h.state.revokeAfterSave = true;
    const denied = await h.actions.saveAdvertisingProgramRequestAction(h.input);
    assert.equal(denied.code, 'access_denied'); assert.equal('receipt' in denied, false);
    assert.equal((await h.db.query('select count(*)::int n from private.advertising_program_stores')).rows[0].n, 1);
  } finally { await h.db.close(); }
});
