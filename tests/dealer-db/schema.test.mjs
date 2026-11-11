import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, asUser } from './helpers.mjs';

const companyA = '00000000-0000-4000-8000-000000000001';
const companyB = '00000000-0000-4000-8000-000000000002';
const member = '10000000-0000-4000-8000-000000000001';
const manager = '10000000-0000-4000-8000-000000000002';
const viewer = '10000000-0000-4000-8000-000000000003';
const other = '10000000-0000-4000-8000-000000000004';
const outsider = '10000000-0000-4000-8000-000000000005';
const retry = '20000000-0000-4000-8000-000000000001';
let keyCounter = 2;
const key = () => `20000000-0000-4000-8000-${String(keyCounter++).padStart(12, '0')}`;

async function insert(db, user = member, company = companyA, idempotency = key(), extra = {}) {
  const data = {
    company_id: company, created_by: user, idempotency_key: idempotency,
    name: 'Dealer', email: 'dealer@example.com', country: 'Sweden',
    buyer_type: 'Dealer / reseller', brand: 'Volvo', model: 'XC60', destination: 'Sweden', quantity: 2, consent: true,
    ...extra,
  };
  const columns = Object.keys(data);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  return asUser(db, user, async tx => (await tx.query(
    `insert into public.trafexa_requests (${columns.join(',')}) values (${placeholders.join(',')}) returning *`,
    Object.values(data),
  )).rows[0]);
}

async function update(db, user, id, status, version) {
  return asUser(db, user, tx => tx.query(
    'update public.trafexa_requests set status = $1 where id = $2 and version = $3 returning *',
    [status, id, version],
  ));
}

async function rejected(promise, code = '42501') {
  await assert.rejects(promise, error => error.code === code);
}

await test('PostgreSQL migration enforces tenant roles, immutable fields, transitions and atomic audit', async t => {
  const db = await createDatabase();
  t.after(() => db.close());
  await db.query('insert into auth.users(id) select unnest($1::uuid[])', [[member, manager, viewer, other, outsider]]);
  await db.query('insert into public.trafexa_companies(id,name) values ($1, $2), ($3, $4)', [companyA, 'A', companyB, 'B']);
  await db.query(`insert into public.trafexa_memberships(company_id,user_id,role)
    values ($1,$2,'member'), ($1,$3,'manager'), ($1,$4,'viewer'), ($5,$6,'manager')`,
    [companyA, member, manager, viewer, companyB, other]);
  const requestA = await insert(db, member, companyA, retry);
  const requestB = await insert(db, other, companyB);

  await t.test('members, managers and viewers see only their company; memberships remain self-only', async () => {
    for (const user of [member, manager, viewer]) {
      const rows = await asUser(db, user, tx => tx.query('select id from public.trafexa_requests'));
      assert.deepEqual(rows.rows, [{id: requestA.id}]);
      assert.deepEqual((await asUser(db, user, tx => tx.query('select id from public.trafexa_companies'))).rows, [{id: companyA}]);
      assert.deepEqual((await asUser(db, user, tx => tx.query('select user_id from public.trafexa_memberships'))).rows, [{user_id: user}]);
      assert.deepEqual((await asUser(db, user, tx => tx.query('select request_id from public.trafexa_request_events'))).rows, [{request_id: requestA.id}]);
    }
    assert.deepEqual((await asUser(db, other, tx => tx.query('select id from public.trafexa_requests'))).rows, [{id: requestB.id}]);
    assert.equal((await asUser(db, outsider, tx => tx.query('select * from public.trafexa_requests'))).rows.length, 0);
    assert.equal((await asUser(db, null, tx => tx.query('select * from public.trafexa_requests'))).rows.length, 0);
  });

  await t.test('anon has no table access and unprovisioned identities cannot submit', async () => {
    for (const table of ['trafexa_requests', 'trafexa_request_events', 'trafexa_companies', 'trafexa_memberships']) {
      await rejected(asUser(db, null, tx => tx.query(`select * from public.${table}`), 'anon'));
    }
    await rejected(insert(db, outsider));
    await rejected(insert(db, null));
  });

  await t.test('inserts require own creator and member/manager membership', async () => {
    assert.equal(requestA.status, 'submitted');
    assert.equal(requestA.version, 1);
    assert.equal(requestA.condition, 'Either');
    await rejected(insert(db, member, companyB));
    await rejected(insert(db, viewer));
    await rejected(insert(db, member, companyA, key(), {created_by: manager}));
    const managed = await insert(db, manager);
    assert.equal(managed.created_by, manager);
    await rejected(insert(db, member, companyA, key(), {consent: false}), '23514');
    await rejected(insert(db, member, companyA, key(), {quantity: 1001}), '23514');
    await rejected(insert(db, member, companyA, key(), {buyer_type: 'invalid'}), '23514');
    await rejected(insert(db, member, companyA, key(), {name: 'x'.repeat(201)}), '23514');
    for (const field of ['model', 'destination']) {
      await rejected(insert(db, member, companyA, key(), {[field]: null}), '23502');
      await rejected(insert(db, member, companyA, key(), {[field]: '  '}), '23514');
    }
    await rejected(insert(db, member, companyA, key(), {email: 'invalid'}), '23514');
    await rejected(insert(db, member, companyA, key(), {idempotency_key: null}), '23502');
  });

  await t.test('column grants prevent forged state, reassignment, membership and audit writes', async () => {
    for (const [column, value] of [
      ['status', 'closed'], ['version', 9], ['id', companyB], ['created_at', '2000-01-01'], ['updated_at', '2000-01-01'],
    ]) await rejected(insert(db, manager, companyA, key(), {[column]: value}));
    for (const column of ['company_id', 'created_by', 'name', 'version', 'updated_at', 'idempotency_key']) {
      await rejected(asUser(db, manager, tx => tx.query(`update public.trafexa_requests set ${column} = ${column} where id = $1`, [requestA.id])));
    }
    await rejected(asUser(db, manager, tx => tx.query('delete from public.trafexa_requests where id = $1', [requestA.id])));
    await rejected(asUser(db, manager, tx => tx.query("update public.trafexa_memberships set role = 'manager'")));
    await rejected(asUser(db, manager, tx => tx.query("insert into public.trafexa_memberships values ($1,$2,'manager')", [companyB, manager])));
    await rejected(asUser(db, manager, tx => tx.query('insert into public.trafexa_companies(name) values ($1)', ['Injected'])));
    await rejected(asUser(db, manager, tx => tx.query("insert into public.trafexa_request_events values ($1,$2,$3,null,'closed',99,now())", [requestA.id, companyA, manager])));
    await rejected(asUser(db, manager, tx => tx.query('update public.trafexa_request_events set actor_id = $1', [manager])));
    await rejected(asUser(db, manager, tx => tx.query('delete from public.trafexa_request_events')));
    for (const func of ['trafexa_record_request_event', 'trafexa_guard_request_update']) {
      assert.equal((await db.query('select has_function_privilege($1,$2,$3) as allowed', ['authenticated', `private.${func}()`, 'EXECUTE'])).rows[0].allowed, false);
    }
    assert.equal((await db.query(`select count(*)::integer as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef`)).rows[0].count, 0);
  });

  await t.test('only same-company manager can transition and audit is complete', async () => {
    for (const user of [member, viewer, other]) assert.equal((await update(db, user, requestA.id, 'sourcing', 1)).rows.length, 0);
    await rejected(update(db, manager, requestA.id, 'confirmed', 1), '23514');
    for (const [version, status] of [[1, 'sourcing'], [2, 'offered'], [3, 'confirmed'], [4, 'closed']]) {
      const rows = (await update(db, manager, requestA.id, status, version)).rows;
      assert.equal(rows[0].version, version + 1);
      assert.equal(rows[0].status, status);
      assert.ok(new Date(rows[0].updated_at) >= new Date(requestA.updated_at));
    }
    await rejected(update(db, manager, requestA.id, 'submitted', 5), '23514');
    const events = (await asUser(db, manager, tx => tx.query('select from_status,to_status,version,actor_id,company_id from public.trafexa_request_events where request_id=$1 order by version', [requestA.id]))).rows;
    assert.deepEqual(events.map(event => [event.from_status, event.to_status, event.version]), [
      [null,'submitted',1], ['submitted','sourcing',2], ['sourcing','offered',3], ['offered','confirmed',4], ['confirmed','closed',5],
    ]);
    assert.equal(events[0].actor_id, member);
    assert.ok(events.slice(1).every(event => event.actor_id === manager && event.company_id === companyA));
  });

  await t.test('stale version and no-op updates create no audit changes', async () => {
    assert.equal((await update(db, manager, requestA.id, 'closed', 1)).rows.length, 0);
    const before = (await db.query('select updated_at from public.trafexa_requests where id=$1', [requestA.id])).rows[0];
    const result = (await update(db, manager, requestA.id, 'closed', 5)).rows[0];
    assert.deepEqual(result.updated_at, before.updated_at);
    assert.equal(result.version, 5);
    assert.equal((await db.query('select count(*)::integer as count from public.trafexa_request_events where request_id=$1', [requestA.id])).rows[0].count, 5);
  });

  await t.test('every active state can close; regressions roll back state and audit', async () => {
    for (const target of ['submitted', 'sourcing', 'offered', 'confirmed']) {
      const request = await insert(db);
      let version = 1;
      for (const status of ['sourcing', 'offered', 'confirmed']) {
        if (target === 'submitted' || (target === 'sourcing' && version === 2) || (target === 'offered' && version === 3)) break;
        await update(db, manager, request.id, status, version++);
      }
      if (version > 1) {
        await rejected(update(db, manager, request.id, 'submitted', version), '23514');
        assert.equal((await db.query('select count(*)::integer as count from public.trafexa_request_events where request_id=$1', [request.id])).rows[0].count, version);
      }
      assert.equal((await update(db, manager, request.id, 'closed', version)).rows[0].version, version + 1);
    }
  });

  await t.test('company/user idempotency prevents duplicate submissions and audit', async () => {
    await rejected(insert(db, member, companyA, retry), '23505');
    assert.equal((await db.query('select count(*)::integer as count from public.trafexa_requests where idempotency_key=$1 and created_by=$2', [retry, member])).rows[0].count, 1);
    assert.ok(await insert(db, manager, companyA, retry));
    assert.ok(await insert(db, other, companyB, retry));
  });

  await t.test('audit insert failure rolls back request status and version atomically', async () => {
    const request = await insert(db);
    // Trusted test owner creates an event collision; the user still cannot forge it.
    await db.query(`insert into public.trafexa_request_events
      (request_id,company_id,actor_id,from_status,to_status,version)
      values ($1,$2,$3,'submitted','sourcing',2)`, [request.id,companyA,manager]);
    await rejected(update(db, manager, request.id, 'sourcing', 1), '23505');
    const state = (await db.query('select status,version from public.trafexa_requests where id=$1', [request.id])).rows[0];
    assert.deepEqual(state, {status:'submitted',version:1});
  });

  await t.test('security metadata confirms RLS, narrow grants and locked private functions', async () => {
    const tables = (await db.query(`select relname,relrowsecurity from pg_class c
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
      and c.relname in ('trafexa_requests','trafexa_request_events','trafexa_companies','trafexa_memberships')`)).rows;
    assert.equal(tables.length, 4);
    assert.ok(tables.every(table => table.relrowsecurity));
    const functions = (await db.query(`select p.proname,p.prosecdef,p.proconfig from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'trafexa_%'`)).rows;
    assert.equal(functions.length, 2);
    assert.equal(functions.filter(func => func.prosecdef).length, 1);
    assert.ok(functions.every(func => func.proconfig.includes('search_path=""')));
    for (const role of ['anon','authenticated']) {
      for (const func of functions) {
        assert.equal((await db.query('select has_function_privilege($1,$2,$3) as allowed', [role,`private.${func.proname}()`,'EXECUTE'])).rows[0].allowed,false);
      }
    }
    const policy = (await db.query(`select polqual is not null as using_clause,polwithcheck is not null as check_clause
      from pg_policy where polname='trafexa_requests_update_manager'`)).rows[0];
    assert.deepEqual(policy,{using_clause:true,check_clause:true});
    assert.equal((await db.query("select has_table_privilege('authenticated','public.trafexa_requests','UPDATE') as allowed")).rows[0].allowed,false);
    assert.equal((await db.query("select has_column_privilege('authenticated','public.trafexa_requests','status','UPDATE') as allowed")).rows[0].allowed,true);
    for (const column of ['id','version','status','updated_at','created_at']) {
      assert.equal((await db.query('select has_column_privilege($1,$2,$3,$4) as allowed',['authenticated','public.trafexa_requests',column,'INSERT'])).rows[0].allowed,false);
    }
  });

  await t.test('trigger immutability remains effective even if a future migration widens grants', async () => {
    await db.exec('grant update(company_id,created_by,version,name) on public.trafexa_requests to authenticated');
    for (const [column, value] of [['company_id',companyB], ['created_by',manager], ['name','Changed'], ['version',99]]) {
      await rejected(asUser(db, manager, tx => tx.query(`update public.trafexa_requests set ${column}=$1 where id=$2`, [value, requestA.id])));
    }
    await db.exec('revoke update(company_id,created_by,version,name) on public.trafexa_requests from authenticated');
  });
});
