import assert from 'node:assert/strict';
import {before,test} from 'node:test';
import{readFile}from'node:fs/promises';
import{bootstrap,sql,session,id,companyA,companyB,owner,otherOwner,admin,finance,buyer,deal,seed,asUser,get,call,record,counts,stock,waitForLock,competingCall}from'./helpers.mjs';
// Real PostgreSQL sessions and real full migration chain. Auth/Storage catalogs
// and cron are explicit local models. No Storage bytes, mail or bank APIs run.
before(bootstrap);

test('hosted-safe accepted trade/signing fixture and zero/positive acquisition proof rolls back every synthetic row',async()=>{
 assert.match(sql(await readFile(new URL('../../supabase/tests/trade_in_acquisition.sql',import.meta.url),'utf8')),/PASS: exact accepted\/signed source/);
 for(const table of ['auth.users','public.companies','private.trade_in_acquisitions','private.trade_in_acquisition_audit'])assert.equal(sql(`select count(*) from ${table}`),'0');
});

test('ready source freezes exact whitelist and hash, while pending/unattached/unavailable sources are honest and finance is read-only',()=>{
 const b=seed();assert.equal(b.canAcquire,true);assert.equal(b.reason,null);assert.equal(b.source.signingRevision,3);
 assert.equal(b.source.offerSnapshot.trade_in.debt_ore,'0');assert.equal(b.source.offerSnapshot.trade_in.value_ore,'30000029');
 assert.equal(b.source.offerSnapshot.trade_in.amount_to_pay_ore,'-18000029');assert.ok(!JSON.stringify(b).includes('PRIVATE'));
 assert.equal(Object.keys(b.source).length,12);assert.equal(Object.keys(b.source.offerSnapshot.trade_in).length,12);
 const read=get({user:finance});assert.equal(read.canAcquire,false);assert.equal(read.reason,null);assert.deepEqual(read.source,b.source);
 for(const[dealId,reason]of[[id(503),'contract_incomplete'],[id(504),'no_accepted_trade_in'],[id(505),'no_accepted_trade_in']]){const r=get({dealId});assert.equal(r.source,null);assert.equal(r.canAcquire,false);assert.equal(r.reason,reason);}
 sql(`update public.deals set status='cancelled' where id='${deal}'`);const unavailable=get();assert.equal(unavailable.reason,'deal_unavailable');assert.equal(unavailable.source,null);
});

test('role, account, company and tenant boundaries deny all private read/write entrypoints and service authority',()=>{
 const b=seed();
 for(const user of[id(5),id(6),buyer,id(8),otherOwner,id(9),id(10),id(11),id(12)]){assert.throws(()=>get({user}),/denied|required/);assert.throws(()=>record(b,{},user),/denied|required/);}
 assert.throws(()=>record(b,{},finance),/denied/);
 assert.throws(()=>get({company:companyB}),/denied/);assert.throws(()=>get({dealId:id(502)}),/denied/);
 for(const role of['anon','service_role'])for(const entry of[`select public.get_trade_in_acquisition('${companyA}','${deal}')`,call(b)])assert.throws(()=>sql(`set role ${role};${entry}`),/permission denied/);
 for(const table of['trade_in_acquisitions','trade_in_acquisition_audit'])for(const role of['anon','authenticated','service_role'])assert.throws(()=>sql(`set role ${role};select * from private.${table}`),/permission denied/);
 const saved=record(b,{},admin).acquisition;assert.equal(saved.actorLabel,'Du');assert.equal(get({user:finance}).acquisition.actorLabel,'Kollega');
});

test('zero and positive manual debt remain exact and full gross creates one new available unknown-VAT stock without changing sale/signing/outbox',()=>{
 const b=seed(),originals=sql("select jsonb_build_object('deals',(select jsonb_agg(to_jsonb(d)order by id)from public.deals d),'offers',(select jsonb_agg(to_jsonb(o)order by id)from public.offers o),'stock',(select jsonb_agg(to_jsonb(s)order by id)from public.stock_items s),'signing',(select jsonb_agg(to_jsonb(s)order by id)from private.contract_signings s),'signatures',(select jsonb_agg(to_jsonb(s)order by signing_id,party)from private.contract_signatures s))");
 const before=counts(),a=record(b).acquisition;
 assert.equal(a.purchasePriceOre,'30000029');assert.equal(a.debtConfirmedOre,'0');assert.equal(a.source.sourceSha256,b.source.sourceSha256);assert.equal(a.attestationVersion,'2026-10-15');
 const s=stock(a.stockItemId);assert.equal(s.purchase_price_ore,30000029);assert.equal(s.vat_scheme,'unknown');assert.equal(s.purchase_vat_ore,null);assert.equal(s.vat_basis_confirmed,false);assert.equal(s.status,'available');assert.equal(s.acquired_on,'2000-01-01');
 assert.equal(s.vehicle.registration_number,'TI001');assert.equal(s.vehicle.fuel,'hybrid');assert.equal(s.vehicle.gearbox,'manual');assert.equal(s.vehicle.vin,null);
 const after=counts();assert.equal(after.vehicles,before.vehicles+1);assert.equal(after.stock,before.stock+1);assert.equal(after.acquisitions,1);assert.equal(after.receipts,1);assert.equal(after.mail,before.mail);
 const now=sql(`select jsonb_build_object('deals',(select jsonb_agg(to_jsonb(d)order by id)from public.deals d),'offers',(select jsonb_agg(to_jsonb(o)order by id)from public.offers o),'stock',(select jsonb_agg(to_jsonb(s)order by id)from public.stock_items s where s.id<>'${a.stockItemId}'),'signing',(select jsonb_agg(to_jsonb(s)order by id)from private.contract_signings s),'signatures',(select jsonb_agg(to_jsonb(s)order by signing_id,party)from private.contract_signatures s))`);assert.equal(now,originals);
 const positive=get({user:otherOwner,company:companyB,dealId:id(502)}),p=record(positive,{request:id(902)},otherOwner).acquisition;
 assert.equal(p.purchasePriceOre,'30000029');assert.equal(p.debtConfirmedOre,'35000001');assert.equal(p.source.offerSnapshot.trade_in.net_trade_in_ore,'-4999972');assert.equal(stock(p.stockItemId).vehicle.registration_number,'TI-002');
 assert.ok(!JSON.stringify(p).includes(otherOwner));
});

test('all acknowledgements, exact source/debt CAS, bounded explicit inputs and independent valid past dates are enforced',()=>{
 const b=seed(),before=counts();
 for(const patch of[{purchase:false},{received:false},{debtConfirmed:false},{ack:false},{version:'old'},{agreement:''},{agreement:' x '},{agreement:'a\nb'},{evidence:''},{evidence:'x'},{fuel:null},{fuel:'unknown'},{gearbox:null},{gearbox:'other'},{asking:'0'},{asking:'1000000000000'},{acquiredOn:'1899-12-31'},{acquiredOn:'2999-01-01'},{debtOn:'1899-12-31'},{debtOn:'2999-01-01'}])assert.throws(()=>record(b,patch),/Invalid manual purchase/);
 for(const patch of[{hash:'0'.repeat(64)},{debt:'1'},{dealId:id(503)},{dealId:id(504)}])assert.throws(()=>record(b,patch),/conflict/);
 assert.deepEqual(counts(),before);
 const old=get({company:companyB,dealId:id(502),user:otherOwner});assert.throws(()=>record(b,{hash:old.source.sourceSha256}),/source conflict/);
 // Dates are independently valid; no invented ordering against signing or each other.
 assert.equal(record(b,{acquiredOn:'1900-01-01',debtOn:'2000-01-01'}).acquisition.acquiredOn,'1900-01-01');
});

test('same exact nonce replays before lifecycle/source/duplicate checks, changed payload and a fresh purchase nonce conflict',()=>{
 const b=seed(),saved=record(b),a=saved.acquisition;
 sql(`update public.deals set status='cancelled' where id='${deal}';update public.stock_items set status='sold' where id='${a.stockItemId}';update public.customers set name='Later customer name' where id='${id(201)}'`);
 assert.deepEqual(record(b),saved);assert.deepEqual(get().acquisition,a);assert.equal(get().reason,'already_acquired');
 for(const patch of[{agreement:'Changed agreement'},{asking:'40000001'},{debt:'1'},{hash:'0'.repeat(64)},{dealId:id(503)},{received:false}])assert.throws(()=>record(b,patch),/request conflict/);
 assert.throws(()=>record(b,{request:id(902)}),/deal conflict/);
 sql(`update private.account_approvals set status='suspended' where user_id='${owner}'`);assert.throws(()=>record(b),/approval required/);
});

test('all existing canonical registrations including sold/archived are rejected without overwriting vehicle history; hyphens remain significant',()=>{
 for(const status of['available','reserved','sold','archived']){
  const b=seed();asUser(owner,competingCall('manual'));
  sql(`update public.stock_items set status='${status}' where vehicle_id in(select id from public.vehicles where registration_number=' TI 001 ')`);
  const before=counts(),history=sql("select jsonb_agg(to_jsonb(v)) from public.vehicles v");assert.equal(get().reason,'vehicle_exists');assert.throws(()=>record(b),/identity already exists/);assert.deepEqual(counts(),before);assert.equal(sql('select jsonb_agg(to_jsonb(v)) from public.vehicles v'),history);
 }
 const b=seed();asUser(owner,`select public.create_stock('${companyA}','TI-001','Other','Vehicle',2020,1,'petrol','automatic',1,2,'unknown')`);
 assert.equal(get().canAcquire,true);assert.equal(record(b).acquisition.source.offerSnapshot.trade_in.registration,'TI 001');
});

test('a forced final audit failure rolls back new vehicle/stock/acquisition atomically and both ledgers are immutable',()=>{
 const b=seed(),before=counts();
 sql("create function private.test_acquisition_failure()returns trigger language plpgsql as $$begin raise exception 'Controlled final audit failure';end$$;create trigger test_acquisition_failure before insert on private.trade_in_acquisition_audit for each row execute function private.test_acquisition_failure()");
 try{assert.throws(()=>record(b),/Controlled final audit failure/);assert.deepEqual(counts(),before);}finally{sql('drop trigger test_acquisition_failure on private.trade_in_acquisition_audit;drop function private.test_acquisition_failure()');}
 record(b);
 for(const table of['trade_in_acquisitions','trade_in_acquisition_audit']){assert.throws(()=>sql(`delete from private.${table}`),/Immutable trade-in/);assert.throws(()=>sql(`update private.${table} set created_at=now()`),/Immutable trade-in/);}
});

for(const kind of['manual','import','direct'])for(const intakeFirst of[false,true])test(`real canonical identity race vs ${kind}, ${intakeFirst?'intake':'legacy'} commits first`,async()=>{
 const b=seed(),intake=session(`intake_${kind}`),legacy=session(`legacy_${kind}`);
 try{
  await intake.ready();await legacy.ready();
  if(intakeFirst){
   const saved=JSON.parse(await intake.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${owner}';${call(b)};`));
   const waiting=legacy.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${owner}';${competingCall(kind)};`);
   await waitForLock(`legacy_${kind}`);await intake.query('commit;');await assert.rejects(waiting,error=>{assert.match(error.message,/ERROR:\s+23505:/);assert.match(error.message,kind==='import'?/Registration already exists/:/duplicate key/);return true;});assert.equal(get().acquisition.id,saved.acquisition.id);
  }else{
   await legacy.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${owner}';${competingCall(kind)};`);
   const waiting=intake.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${owner}';${call(b)};`);
   await waitForLock(`intake_${kind}`);await legacy.query('commit;');await assert.rejects(waiting,error=>{assert.match(error.message,/ERROR:\s+23505:/);assert.match(error.message,/Vehicle identity already exists/);return true;});assert.equal(get().acquisition,null);assert.equal(get().reason,'vehicle_exists');
  }
  assert.equal(sql(`select count(*) from public.vehicles where company_id='${companyA}' and upper(regexp_replace(registration_number,'[[:space:]]','','g'))='TI001'`),'1');
 }finally{intake.close();legacy.close();}
});

test('two actual intakes serialize, and a reader waiting for commit reports the stored acquisition',async()=>{
 const b=seed(),first=session('first_intake'),second=session('second_intake'),reader=session('waiting_reader');
 try{
  await first.ready();await second.ready();await reader.ready();
  const a=JSON.parse(await first.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${owner}';${call(b)};`));
  const waiting=second.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${admin}';${call(b,{request:id(902)})};`);
  const reading=reader.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${finance}';select public.get_trade_in_acquisition('${companyA}','${deal}');`);
  await waitForLock('second_intake');await waitForLock('waiting_reader');await first.query('commit;');
  const denied=assert.rejects(waiting,/deal conflict/);
  const observed=JSON.parse(await reading);await reader.query('commit;');await denied;assert.equal(observed.reason,'already_acquired');assert.equal(observed.acquisition.id,a.acquisition.id);assert.equal(counts().acquisitions,1);
 }finally{first.close();second.close();reader.close();}
});

test('in-flight account/company/membership revocation is checked after each real lock wait',async()=>{
 for(const change of[`update private.account_approvals set status='suspended' where user_id='${owner}'`,`update public.companies set status='suspended' where id='${companyA}'`,`update public.memberships set status='suspended' where company_id='${companyA}' and user_id='${owner}'`]){
  const b=seed(),revoke=session('revocation'),intake=session('revoked_intake');
  try{
   await revoke.ready();await intake.ready();await revoke.query(`begin;${change};`);
   const waiting=intake.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${owner}';${call(b)};`);
   await waitForLock('revoked_intake');await revoke.query('commit;');await assert.rejects(waiting,/denied|approval required/);assert.equal(counts().acquisitions,0);
  }finally{revoke.close();intake.close();}
 }
});
