import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { bootstrap, sql, session, ids, rowId, seed, accept, state } from './helpers.mjs';

const held = { stock: 'reserved', deal: 'reserved', reservation: 'active' };
const expired = { stock: 'available', deal: 'draft', reservation: 'expired' };
before(bootstrap);

async function waitForLock(name) {
  const until = Date.now() + 2500;
  while (Date.now() < until) {
    if (sql(`select coalesce((select wait_event_type from pg_stat_activity where application_name='expiry_${name}'),'');`) === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Session ${name} did not enter a PostgreSQL lock wait`);
}
async function buyerAccept(connection) {
  return connection.query(`begin; set local role authenticated;
   select set_config('request.jwt.claim.sub','${ids.buyer}',true);
   select public.respond_offer_review('${rowId('8', 1)}',1,'accepted','Expiry Buyer',null,'2026-10-14',gen_random_uuid());`);
}
function ownerCall(source) {
  return sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${ids.ownerA}',true); ${source}; commit;`);
}

test('accepted deals stay protected in both the worker and direct lazy helper; history is retained', () => {
  seed(); accept();
  assert.equal(sql('select private.expire_reservations();'), '1');
  assert.deepEqual(state(), held); assert.deepEqual(state(2), expired);
  sql(`select private.expire_stock_reservations('${rowId('3', 1)}');`);
  assert.deepEqual(state(), held);
  assert.equal(sql('select count(*) from public.reservations;'), '2');
  assert.throws(() => ownerCall(`select public.create_deal('${ids.companyA}','${rowId('3', 1)}','${ids.customerA}',12000000)`), /Vehicle is not available/);
  assert.deepEqual(state(), held);
});

test('future reservations and sold stock are preserved, and an idle repeat writes no new audit rows', () => {
  seed(2, 1);
  sql(`update public.reservations set expires_at=now()+interval '1 hour' where id='${rowId('6', 1)}'; update public.stock_items set status='sold' where id='${rowId('3', 2)}';`);
  assert.equal(sql('select private.expire_reservations();'), '2');
  assert.deepEqual(state(), held); assert.deepEqual(state(2), { ...expired, stock: 'sold' }); assert.deepEqual(state(3), expired);
  const audited = sql('select count(*) from public.audit_events;');
  assert.equal(sql('select private.expire_reservations();'), '0');
  assert.equal(sql('select count(*) from public.audit_events;'), audited);
});

test('the batch cap is global across tenants and protected rows do not consume it', () => {
  seed(301, 301); accept();
  assert.equal(sql('select private.expire_reservations();'), '500');
  assert.equal(sql("select count(*) from public.reservations where status='active';"), '102');
  assert.deepEqual(state(), held);
  assert.equal(sql('select private.expire_reservations();'), '101');
  assert.equal(sql('select private.expire_reservations();'), '0');
  assert.deepEqual(state(), held);
});

test('legacy public create/reserve preserve their approval gates, lazy expiry and reservation history', () => {
  seed(1, 0);
  ownerCall(`select public.create_deal('${ids.companyA}','${rowId('3', 1)}','${ids.customerA}',12000000)`);
  assert.deepEqual(state(), expired);
  seed(1, 0);
  const draft = rowId('9', 1);
  sql(`insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by) values('${draft}','${ids.companyA}','${rowId('3', 1)}','${ids.customerA}',12000000,'${ids.ownerA}');`);
  ownerCall(`select public.reserve_vehicle('${ids.companyA}','${draft}',48)`);
  assert.deepEqual(state(), { ...expired, stock: 'reserved' });
  assert.equal(sql("select count(*) from public.reservations where status='active';"), '1');
  assert.equal(sql('select count(*) from public.reservations;'), '2');
  sql(`update private.account_approvals set status='suspended' where user_id='${ids.ownerA}';`);
  assert.throws(() => ownerCall(`select public.create_deal('${ids.companyA}','${rowId('3', 1)}','${ids.customerA}',12000000)`), /Superadmin account approval required/);
});

test('ordinary roles cannot call workers or cron, and the registered SQL command has the intended timeout', () => {
  const privileges = JSON.parse(sql(`select jsonb_agg(jsonb_build_object('role',r,'worker',has_function_privilege(r,'private.expire_reservations()','execute'),'helper',has_function_privilege(r,'private.expire_stock_reservations(uuid)','execute'),'cron',has_schema_privilege(r,'cron','usage'))) from unnest(array['anon','authenticated','service_role']) r;`));
  for (const value of privileges) assert.deepEqual(value, { role: value.role, worker: false, helper: false, cron: false });
  const job = JSON.parse(sql("select row_to_json(j) from cron.job j where jobname='trafexa-expire-reservations';"));
  assert.equal(job.schedule, '* * * * *'); assert.equal(job.username, 'postgres'); assert.equal(job.active, true);
  assert.equal(job.command, "set statement_timeout='30s'; select private.expire_reservations();");
  assert.ok(sql(`${job.command} show statement_timeout;`).endsWith('30s'));
});

test('a locked company is skipped before stock, avoiding the advertising company/stock inversion', async () => {
  seed();
  const advertising = session('advertising'), worker = session('company_worker');
  try {
    await advertising.ready(); await worker.ready();
    await advertising.query(`begin; select id from public.companies where id='${ids.companyA}' for update;`);
    assert.equal(await worker.query("begin; set local statement_timeout='2s'; select private.expire_reservations();"), '1');
    await advertising.query(`select id from public.stock_items where id='${rowId('3', 1)}' for update nowait;`);
    await advertising.query('rollback;'); await worker.query('commit;');
    assert.deepEqual(state(), held); assert.deepEqual(state(2), expired);
    assert.equal(sql('select private.expire_reservations();'), '1');
  } finally { advertising.close(); worker.close(); }
});

test('locked stock and locked deals are skipped while another reservation progresses', async () => {
  for (const lock of ['stock', 'deal']) {
    seed(2, 0);
    const busy = session(`busy_${lock}`), worker = session(`skip_${lock}`);
    try {
      await busy.ready(); await worker.ready();
      await busy.query(`begin; select id from public.companies where id='${ids.companyA}' for key share;`);
      await busy.query(lock === 'stock' ? `select id from public.stock_items where id='${rowId('3', 1)}' for update;` : `select id from public.deals where id='${rowId('5', 1)}' for update;`);
      assert.equal(await worker.query("set statement_timeout='2s'; select private.expire_reservations();"), '1');
      assert.deepEqual(state(), held); assert.deepEqual(state(2), expired);
      await busy.query('rollback;');
      assert.equal(sql('select private.expire_reservations();'), '1');
    } finally { busy.close(); worker.close(); }
  }
});

test('an uncommitted customer acceptance is skipped by cron and remains protected after commit', async () => {
  seed();
  const buyer = session('accepting'), worker = session('accept_worker');
  try {
    await buyer.ready(); await worker.ready(); await buyerAccept(buyer);
    assert.equal(await worker.query("set statement_timeout='2s'; select private.expire_reservations();"), '1');
    await buyer.query('commit;');
    assert.deepEqual(state(), held); assert.deepEqual(state(2), expired);
    assert.equal(sql('select private.expire_reservations();'), '0');
  } finally { buyer.close(); worker.close(); }
});

test('lazy expiry waits for the deal lock and then rechecks a newly committed acceptance', async () => {
  seed(1, 0);
  const buyer = session('lazy_accepting'), lazy = session('lazy_expiry');
  try {
    await buyer.ready(); await lazy.ready(); await buyerAccept(buyer);
    const waiting = lazy.query(`select private.expire_stock_reservations('${rowId('3', 1)}');`);
    await waitForLock('lazy_expiry'); await buyer.query('commit;'); await waiting;
    assert.deepEqual(state(), held);
  } finally { buyer.close(); lazy.close(); }
});

test('expiry that wins the deal lock commits first; later acceptance keeps the existing non-reservation semantics', async () => {
  seed(1, 0);
  const buyer = session('later_buyer'), worker = session('earlier_expiry');
  try {
    await buyer.ready(); await worker.ready();
    assert.equal(await worker.query('begin; select private.expire_reservations();'), '1');
    const accepting = buyerAccept(buyer);
    await waitForLock('later_buyer'); await worker.query('commit;'); await accepting; await buyer.query('commit;');
    assert.deepEqual(state(), expired);
    assert.equal(sql(`select status from private.offer_reviews where id='${rowId('8', 1)}';`), 'accepted');
  } finally { buyer.close(); worker.close(); }
});
