import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, call, fail, A, C, U, SALES } from './fixtures.mjs';

test('superadmin configures multiple stores and versioned prices, fees and program periods', async () => {
  const db = await fixture();
  try {
    const read = user => call(db, 'select public.list_advertising_program($1) r', [C], user);
    const save = (store, payload, user = A) => call(db, 'select public.save_advertising_program($1,$2,$3) r', [C, store, payload], user);
    assert.deepEqual((await read(A)).stores, []);
    await fail(read(U), '42501');
    await fail(read(SALES), '42501');
    await fail(save(null, { store_name: 'Blocked', dealer_code: 'blocked' }, U), '42501');
    const first = await save(null, { store_name: 'First', dealer_code: 'first' });
    const second = await save(null, { store_name: 'Second', dealer_code: 'second' });
    await fail(save(null, { store_name: 'Duplicate', dealer_code: 'first' }), '23505');
    const input = { version: 0, agreement_reference: 'Agreement 1', desired_start: '2026-11-01',
      confirmed_start: '2026-11-01', blocket_price_ore: '62000', bytbil_price_ore: '0',
      blocket_cost_ore: '50000', monthly_fee_ore: '290000', partial_month_rule: 'full' };
    await save(first, input);
    await save(second, { ...input, blocket_price_ore: '78000' });
    await fail(save(first, { ...input, desired_start: '2026-12-01' }), '23P01');
    const { period_id } = (await read(A)).stores[0].periods[0];
    const exit = { ...input, period_id, version: 1, notice_date: '2026-11-20',
      contract_end: '2027-01-20', confirmed_end: '2027-01-21' };
    await save(first, exit);
    await fail(save(first, exit), '40001');
    await fail(save(first, { ...input, desired_start: '2027-01-20', confirmed_start: null }), '23P01');
    await save(first, { ...input, desired_start: '2027-01-21', confirmed_start: null, blocket_price_ore: '72000' });
    const [a, b] = (await read(A)).stores;
    assert.equal(a.periods[0].blocket_price_ore, '72000');
    assert.equal(a.periods[1].blocket_cost_ore, '50000');
    assert.equal(a.periods[1].monthly_fee_ore, '290000');
    assert.equal(a.periods[1].bytbil_price_ore, '0');
    assert.equal(b.periods[0].blocket_price_ore, '78000');
    await fail(save(first, { period_id, version: 2, cancelled: true }), '23514');
    await save(first, { period_id: a.periods[0].period_id, version: 1, cancelled: true });
    await fail(save(first, { period_id: a.periods[0].period_id, version: 2, cancelled: true }), '40001');
    await save(first, { ...input, desired_start: '2027-01-21', confirmed_start: null });
    assert.equal((await read(A)).stores[0].periods.filter(period => period.cancelled).length, 1);
    assert.equal((await db.query('select count(*)::int as n from private.advertising_program_revisions')).rows[0].n, 6);
    await fail(db.query('delete from private.advertising_program_revisions'), '55000');
  } finally { await db.close(); }
});
