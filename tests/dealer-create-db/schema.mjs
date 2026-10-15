import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import { bootstrap, sql, session, seed, id, owner, admin, sales, finance, viewer, foreign, pending, unverified, unassigned, company, otherCompany, foreignDeal, asUser, customer, intake, customerCall, financeCall, waitForLock } from './helpers.mjs';
before(bootstrap);
const count=table=>Number(sql(`select count(*)from ${table}`));
const begin=user=>`begin;set local role authenticated;set local request.jwt.claim.sub='${user}';`;

test('hosted rollback proof passes and all six synthetic namespace counters remain zero',async()=>{
 sql(await readFile(new URL('../../supabase/tests/dealer_create_idempotency.sql',import.meta.url),'utf8'));
 const result=JSON.parse(sql(await readFile(new URL('../../supabase/tests/dealer_create_idempotency_cleanup.sql',import.meta.url),'utf8')));
 assert.equal(Object.keys(result).length,6);assert.ok(Object.values(result).every(value=>value===0));
});
test('narrow public invoker RPCs deny anon/service/private helper/table access and forged metadata',()=>{
 seed();for(const role of['anon','service_role'])for(const call of[customerCall(),financeCall()])assert.throws(()=>sql(`begin;set local role ${role};${call};`),/permission denied/);
 for(const role of['anon','authenticated','service_role'])assert.throws(()=>sql(`begin;set local role ${role};select *from private.dealer_create_receipts`),/permission denied/);
 assert.throws(()=>asUser(sales,`select private.dealer_create_record('${company}','${id(901)}','customer','{}')`),/permission denied/);
 sql(`update auth.users set raw_user_meta_data='{"role":"owner","company_id":"${company}"}'where id='${viewer}'`);
 assert.throws(()=>customer({},viewer),/access denied/);
 assert.equal(sql("select count(*)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('create_customer_request','create_finance_intake_request')and p.prosecdef"),'0');
});
test('direct REST-equivalent inserts cannot bypass receipts while existing atomic customer-lead creation still works',()=>{
 seed();
 assert.throws(()=>asUser(sales,`insert into public.customers(company_id,name)values('${company}','Bypass customer')`),/permission denied/);
 assert.throws(()=>asUser(finance,`insert into public.finance_applications(company_id,created_by,product,requested_amount_ore)values('${company}','${finance}','stock',100)`),/permission denied/);
 assert.equal(count('public.customers'),2);assert.equal(count('public.finance_applications'),0);assert.equal(count('private.dealer_create_receipts'),0);
 const lead=asUser(sales,`select public.create_customer_lead('${company}','${id(930)}','Existing lead workflow','lead@fixture.invalid','','Lead conversion remains atomic')`);
 assert.match(lead,/^[0-9a-f-]{36}$/);assert.equal(count('public.customers'),3);assert.equal(count('public.leads'),1);assert.equal(count('private.dealer_create_receipts'),0);
});
test('each operation preserves its existing role matrix and rejects foreign, pending, unverified and absent members',()=>{
 for(const user of[owner,admin,sales,finance,viewer,foreign,pending,unverified,unassigned]){
  seed();if([owner,admin,sales].includes(user))assert.equal(customer({},user).kind,'customer');else assert.throws(()=>customer({},user),/denied|required/);
  if([owner,admin,sales,finance].includes(user))assert.equal(intake({},user).kind,'finance_intake');else assert.throws(()=>intake({},user),/denied|required/);
 }
});
test('exact customer retries are durable and historical while distinct requests do not deduplicate names or email',()=>{
 seed();const first=customer();assert.deepEqual(customer(),first);assert.equal(count('private.dealer_create_receipts'),1);assert.equal(count('public.customers'),3);
 sql(`update public.customers set name='Edited later'where id='${first.recordId}'`);
 assert.deepEqual(customer(),first);assert.equal(sql(`select name from public.customers where id='${first.recordId}'`),'Edited later');
 const next=customer({requestId:id(905)});assert.notEqual(first.recordId,next.recordId);assert.equal(count('public.customers'),4);
 assert.deepEqual(Object.keys(first).sort(),['companyId','actorId','requestId','kind','recordId','createdAt'].sort());
 assert.equal(sql('select length(payload_sha256)from private.dealer_create_receipts limit 1'),'64');
});
test('finance retries retain exact gross ore and original receipt after withdrawal or deal cancellation without claiming current status',()=>{
 seed();const first=intake();assert.deepEqual(intake(),first);
 sql(`update public.finance_applications set status='withdrawn'where id='${first.recordId}';update public.deals set status='cancelled'where id='${id(601)}'`);
 assert.deepEqual(intake(),first);assert.equal(sql(`select status from public.finance_applications where id='${first.recordId}'`),'withdrawn');
 assert.equal(sql(`select requested_amount_ore||','||deposit_ore||','||term_months from public.finance_applications where id='${first.recordId}'`),'12500029,100009,36');
 assert.equal('status'in first,false);assert.equal(count('private.dealer_create_receipts'),1);
});
test('same nonce with changed payload or another operation is rejected; actor and tenant are independent scopes',()=>{
 seed();const a=customer();assert.throws(()=>customer({notes:'Changed payload'}),/payload conflict/);assert.throws(()=>intake({requestId:id(901)}),/payload conflict/);
 const actorB=customer({},admin);assert.notEqual(actorB.recordId,a.recordId);assert.equal(actorB.actorId,admin);
 sql(`update public.memberships set role='sales'where company_id='${otherCompany}'and user_id='${sales}'`);
 const tenantB=customer({companyId:otherCompany});assert.notEqual(tenantB.recordId,a.recordId);assert.equal(tenantB.companyId,otherCompany);
 assert.equal(count('private.dealer_create_receipts'),3);
});
test('customer validation rejects noncanonical whitespace, C1 and UTF16 overlength instead of storing unreadable data',()=>{
 seed();for(const patch of[{name:' padded '},{name:'a'},{name:'a'.repeat(161)},{name:'🚙'.repeat(81)},{name:'Unsafe\u0080'},{email:'wrong'},{email:'a\u00a0b@example.invalid'},{phone:'x'.repeat(61)},{address:'\nAddress'},{notes:'Note\ufeff'}])assert.throws(()=>customer(patch),/Invalid customer/);
 assert.equal(count('private.dealer_create_receipts'),0);assert.equal(customer({name:'🚙'.repeat(80),notes:'Line1\nLine2'}).kind,'customer');
});
test('finance validation and tenant FK failures roll back every record and receipt',()=>{
 seed();for(const patch of[{amount:0},{amount:-1},{amount:1000000000000},{deposit:-1},{term:0},{term:121},{note:'Bad\u0080'},{dealId:foreignDeal}])assert.throws(()=>intake(patch),/Invalid finance|unavailable/);
 assert.equal(count('private.dealer_create_receipts'),0);assert.equal(count('public.finance_applications'),0);
 assert.equal(intake({dealId:null,deposit:0,term:null}).kind,'finance_intake');
});
test('historical customer receipt requires fresh allowed membership, company, approval and actual Auth every time',()=>{
 for(const change of[
  `update public.memberships set role='viewer'where company_id='${company}'and user_id='${sales}'`,
  `update public.memberships set status='suspended'where company_id='${company}'and user_id='${sales}'`,
  `update public.companies set status='suspended'where id='${company}'`,
  `update private.account_approvals set status='suspended'where user_id='${sales}'`,
  `update auth.users set email_confirmed_at=null where id='${sales}'`,
  `update auth.users set banned_until=now()+interval '1 day'where id='${sales}'`,
 ]){seed();customer();sql(change);assert.throws(()=>customer(),/denied|required/);assert.equal(count('private.dealer_create_receipts'),1);}
 seed();const first=customer();sql(`update public.memberships set role='admin'where company_id='${company}'and user_id='${sales}'`);assert.deepEqual(customer(),first);
});
test('immutable receipts and a failed receipt insert cannot leave a business row or audit orphan',()=>{
 seed();customer();assert.throws(()=>sql("update private.dealer_create_receipts set payload_sha256=repeat('0',64)"),/immutable/);assert.throws(()=>sql('delete from private.dealer_create_receipts'),/immutable/);
 sql("create function private.dealer_create_test_failure()returns trigger language plpgsql as $$begin raise exception 'Injected receipt failure';end$$;create trigger dealer_create_test_failure before insert on private.dealer_create_receipts for each row execute function private.dealer_create_test_failure();");
 const before={customers:count('public.customers'),finance:count('public.finance_applications'),audit:count('public.audit_events')};
 assert.throws(()=>customer({requestId:id(910)}),/Injected receipt/);assert.throws(()=>intake(),/Injected receipt/);
 assert.equal(count('public.customers'),before.customers);assert.equal(count('public.finance_applications'),before.finance);assert.equal(count('public.audit_events'),before.audit);assert.equal(count('private.dealer_create_receipts'),1);
 sql('drop trigger dealer_create_test_failure on private.dealer_create_receipts;drop function private.dealer_create_test_failure()');
});
test('real concurrent exact retries for customer and finance converge to one insert and one immutable receipt',async()=>{
 for(const call of[customerCall,financeCall]){
  seed();const a=session('retry_a'),b=session('retry_b');try{
   await Promise.all([a.ready(),b.ready()]);const first=JSON.parse(await a.query(`${begin(sales)}${call()};`));
   const second=b.query(`${begin(sales)}${call()};`);await waitForLock('retry_b');await a.query('commit;');
   assert.deepEqual(JSON.parse(await second),first);await b.query('commit;');assert.equal(count('private.dealer_create_receipts'),1);
   assert.equal(count(first.kind==='customer'?'public.customers':'public.finance_applications'),first.kind==='customer'?3:1);
  }finally{a.close();b.close();}
 }
});
test('real concurrent changed-payload retries have one winner and never create a second business record',async()=>{
 for(const [call,patch]of[[customerCall,{notes:'Changed'}],[financeCall,{amount:12500030}]]){
  seed();const a=session('changed_a'),b=session('changed_b');try{
   await Promise.all([a.ready(),b.ready()]);await a.query(`${begin(sales)}${call()};`);
   const second=assert.rejects(b.query(`${begin(sales)}${call(patch)};`),/payload conflict/);await waitForLock('changed_b');await a.query('commit;');await second;assert.equal(count('private.dealer_create_receipts'),1);
  }finally{a.close();b.close();}
 }
});
test('revocation already holding a row lock defeats a waiting historical retry rather than returning cached authorization',async()=>{
 for(const change of[
  `update auth.users set banned_until=now()+interval '1 day'where id='${sales}'`,
  `update private.account_approvals set status='suspended'where user_id='${sales}'`,
  `update public.companies set status='suspended'where id='${company}'`,
  `update public.memberships set role='viewer'where company_id='${company}'and user_id='${sales}'`,
 ]){
  seed();customer();const a=session('revoke_a'),b=session('revoke_b');try{
   await Promise.all([a.ready(),b.ready()]);await a.query(`begin;${change};`);
   const denied=assert.rejects(b.query(`${begin(sales)}${customerCall()};`),/required|denied/);await waitForLock('revoke_b');await a.query('commit;');await denied;assert.equal(count('private.dealer_create_receipts'),1);
  }finally{a.close();b.close();}
 }
});
