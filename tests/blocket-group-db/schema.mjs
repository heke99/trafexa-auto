import assert from 'node:assert/strict';
import {readFile}from 'node:fs/promises';
import {before,test}from 'node:test';
import {bootstrap,sql,session,id,platform,owner,sales,foreign,company,otherCompany,group,listing,seed,asUser,service,page,configure,groupCall,bind,bindCall,disable,disableCall,validUntil,ready,job,beginDelivery,beginCall,record,recordCall,waitForLock}from './helpers.mjs';
before(bootstrap);
const count=t=>Number(sql(`select count(*)from ${t}`));
const adminBegin=`begin;set local role authenticated;set local request.jwt.claim.sub='${platform}';`;
const workerBegin='begin;set local role service_role;';
function prepared(){seed();configure();bind();ready();job();return beginDelivery();}
function acknowledge(d){return record(d);}
function verified(d){const a=acknowledge(d);return record(a,{token:null,status:'published',requestId:id(811),adId:'123456',evidence:'b'.repeat(64)});}
function advanceListing(){sql(`update private.advertising_listings set version=4 where id='${listing}';insert into private.advertising_versions(company_id,listing_id,version,snapshot,created_by)select company_id,listing_id,4,snapshot,created_by from private.advertising_versions where listing_id='${listing}'and version=2;`);}
function savePublished(jobId=id(601),version=2,token=id(801)){return service(`select public.save_advertising_job('${jobId}',${version},'${token}','published','123456',null,null)`);}

test('hosted-safe rollback proof and 12 cleanup counters leave no synthetic records',async()=>{
 sql(await readFile(new URL('../../supabase/tests/blocket_group_delivery.sql',import.meta.url),'utf8'));
 const result=JSON.parse(sql(await readFile(new URL('../../supabase/tests/blocket_group_delivery_cleanup.sql',import.meta.url),'utf8')));assert.equal(Object.keys(result).length,12);assert.ok(Object.values(result).every(n=>n===0));
});
test('private tables and helpers deny every client; platform provision and service delivery boundaries are separate',()=>{
 seed();
 for(const user of[owner,sales,foreign])for(const call of[`select public.get_platform_blocket_provisioning('${company}')`,groupCall(),bindCall(),disableCall()])assert.throws(()=>asUser(user,call),/required/);
 for(const role of['anon','authenticated','service_role'])for(const t of['blocket_groups','blocket_company_bindings','blocket_provision_audit','blocket_delivery_identities','blocket_delivery_revisions','blocket_delivery_events'])assert.throws(()=>sql(`begin;set local role ${role};select *from private.${t}`),/permission denied/);
 for(const user of[platform,owner])assert.throws(()=>asUser(user,beginCall()),/permission denied/);
 assert.throws(()=>service(groupCall()),/permission denied/);assert.throws(()=>asUser(platform,`select private.blocket_service_identity()`),/permission denied/);
 assert.equal(sql(`select count(*)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('get_platform_blocket_provisioning','configure_blocket_group','bind_blocket_company','disable_blocket_company','begin_blocket_delivery','get_blocket_delivery','record_blocket_delivery')and p.prosecdef`),'0');
});
test('platform group and binding use reviewed CAS idempotent receipts without enabling runtime; requested connection version visible',()=>{
 seed();const g=configure();assert.equal(g.group.version,1);assert.equal(g.group.scope,'dealer_group');assert.deepEqual(configure(),g);assert.throws(()=>configure({credential:'other'}),/payload conflict/);
 asUser(owner,`select public.request_advertising_connection('${company}','blocket','requested-dealer','${id(920)}')`);assert.equal(page().connectionVersion,1);assert.equal(page().binding,null);
 const b=bind({connectionVersion:1});assert.equal(b.binding.connectionVersion,2);assert.equal(b.binding.status,'verified');assert.equal(page().binding.dealerCode,'dealer-a');assert.deepEqual(bind({connectionVersion:1}),b);
 assert.equal(sql(`select available_until>clock_timestamp()from private.advertising_dispatchers where id='blocket_${group.replaceAll('-','')}'`),'f');
 assert.throws(()=>bind({connectionVersion:1,nonce:id(921)}),/version conflict/);
 const stopped=disable({version:2});assert.equal(stopped.binding.status,'disabled');assert.equal(stopped.binding.connectionVersion,3);assert.deepEqual(disable({version:2}),stopped);assert.deepEqual(bind({connectionVersion:1}),b);
});
test('strict nonsecret reference and Unicode review validators reject malformed direct RPC, date checks only new requests',()=>{
 seed();
 for(const patch of[{credential:'JWT.secret.value'},{credential:'UPPER'},{credential:'x'.repeat(101)},{reference:'\u00a0Group'},{reference:'Unsafe\u0080'},{scope:'all'},{status:null},{reason:null},{reason:'Reason\ufeff'},{ack:false}])assert.throws(()=>configure(patch),/Invalid/);
 configure();
 for(const patch of[{dealerCode:''},{dealerCode:'x'.repeat(161)},{evidence:' bad '},{reason:'Unsafe\u009f'},{until:'2000-01-01T00:00:00Z'},{until:new Date(Date.now()+91*86400000).toISOString()},{ack:false}])assert.throws(()=>bind(patch),/Invalid/);
 const b=bind();sql(`update private.blocket_company_bindings set valid_until=now()-interval '1 day'where company_id='${company}'`);assert.equal(page().binding.status,'disabled');assert.deepEqual(bind(),b);
});
test('dealer re-request after administrator disable leaves old binding disabled and exposes authoritative current connection version',()=>{
 seed();configure();const original=bind();disable();
 asUser(owner,`select public.request_advertising_connection('${company}','blocket','new-requested-dealer','${id(921)}')`);
 const current=page();assert.equal(current.connectionVersion,3);assert.equal(current.binding.connectionVersion,2);assert.equal(current.binding.status,'disabled');assert.deepEqual(bind(),original);
 const reviewed=bind({connectionVersion:3,nonce:id(922)});assert.equal(reviewed.binding.connectionVersion,4);assert.equal(page().binding.status,'verified');
});
test('dealer codes cannot cross companies; single dealer scope cannot cover another dealer; groups invalidate old bindings/readiness',()=>{
 seed();configure();bind();assert.throws(()=>bind({companyId:otherCompany,nonce:id(921)}),/identity conflict/);
 configure({groupId:id(202),scope:'dealer_code',nonce:id(922)});bind({companyId:otherCompany,groupId:id(202),dealerCode:'dealer-b',nonce:id(923)});
 assert.throws(()=>bind({groupId:id(202),connectionVersion:1,dealerCode:'dealer-c',nonce:id(924)}),/Single dealer scope conflict/);
 ready();configure({version:1,reference:'Revised group',nonce:id(925)});assert.equal(page().binding.status,'disabled');assert.equal(sql(`select available_until>clock_timestamp()from private.advertising_dispatchers where id='blocket_${group.replaceAll('-','')}'`),'f');
});
test('first ready internal version2 creates source identity and a durable single-use intent; repeat only reconciles',()=>{
 const begun=prepared();assert.equal(begun.delivery.listingVersion,2);assert.equal(begun.delivery.operation,'create');assert.equal(begun.delivery.revision,1);assert.equal(begun.delivery.sourceId,listing);assert.equal(begun.replayed,false);
 const replay=beginDelivery();assert.equal(replay.replayed,true);assert.deepEqual(replay.delivery,begun.delivery);assert.equal(count('private.blocket_delivery_revisions'),1);assert.equal(count('private.blocket_delivery_events'),1);
 assert.throws(()=>beginDelivery({hash:'c'.repeat(64)}),/intent conflict/);assert.throws(()=>beginDelivery({token:id(802)}),/intent conflict/);
});
test('published worker bypass denied until current revision correlation and evidence persisted',()=>{
 const begun=prepared();assert.throws(()=>savePublished(),/current revision evidence required/);assert.equal(count('private.advertising_publications'),0);
 assert.throws(()=>record(begun.delivery,{status:'published',requestId:id(811),adId:'123456',evidence:'b'.repeat(64)}),/correlated publication required/);
 const ack=acknowledge(begun.delivery);assert.equal(ack.version,2);assert.equal(ack.status,'submitted');assert.deepEqual(acknowledge(begun.delivery),ack);
 assert.throws(()=>record(ack,{token:null,status:'published',requestId:id(812),adId:'123456',evidence:'b'.repeat(64)}),/receipt conflict/);assert.throws(()=>record(ack,{token:null,status:'published',adId:'123456',evidence:null}),/correlated publication required/);
 const published=record(ack,{token:null,status:'published',adId:'123456',evidence:'b'.repeat(64)});assert.equal(published.status,'published');savePublished();assert.equal(count('private.advertising_publications'),1);
 assert.deepEqual(record(ack,{token:null,status:'published',adId:'123456',evidence:'b'.repeat(64)}),published);
});
test('unknown or merely submitted prior revision blocks a newer write atomically',()=>{
 for(const state of['outcome_unknown','submitted']){const begun=prepared();record(begun.delivery,{status:state,requestId:state==='submitted'?id(811):null});advanceListing();job({jobId:id(602),version:4});assert.throws(()=>beginDelivery({jobId:id(602),token:id(802)}),/unresolved revision conflict/);assert.equal(sql(`select status from private.advertising_jobs where id='${id(602)}'`),'queued');assert.equal(count('private.blocket_delivery_revisions'),1);}
});
test('next published revision uses PUT semantics and stable identity; updates never create extra billing publication',()=>{
 const first=prepared();verified(first.delivery);savePublished();advanceListing();job({jobId:id(602),version:4});const second=beginDelivery({jobId:id(602),token:id(802),hash:'c'.repeat(64)});assert.equal(second.delivery.operation,'update');assert.equal(second.delivery.revision,2);assert.equal(second.delivery.sourceId,listing);assert.equal(second.delivery.providerAdId,'123456');
 const d={...second.delivery,jobId:id(602)};assert.throws(()=>record(d,{token:id(802),requestId:id(812),adId:'999999'}),/receipt conflict/);
 const ack=record(d,{token:id(802),requestId:id(812),adId:'123456'});record({...ack,jobId:id(602)},{token:null,status:'published',requestId:id(812),adId:'123456',evidence:'d'.repeat(64)});savePublished(id(602),2,id(802));assert.equal(count('private.advertising_publications'),1);assert.equal(count('private.blocket_delivery_revisions'),2);assert.equal(count('private.blocket_delivery_events'),6);
 assert.throws(()=>bind({connectionVersion:1,dealerCode:'new-dealer',nonce:id(921)}),/identity conflict/);disable();assert.throws(()=>bind({companyId:otherCompany,dealerCode:'dealer-a',nonce:id(922)}),/identity conflict/);
});
test('definitive rejected create permits only a newly reviewed version, which still creates; same job never resubmits',()=>{
 const begun=prepared();const rejected=record(begun.delivery,{status:'rejected',requestId:null,adId:null});assert.equal(rejected.status,'rejected');
 service(`select public.save_advertising_job('${id(601)}',2,'${id(801)}','rejected',null,null,'blocket_http_400')`);
 assert.equal(beginDelivery().replayed,true);assert.throws(()=>beginDelivery({token:id(802)}),/intent conflict/);assert.throws(()=>record(rejected,{status:'submitted'}),/receipt conflict/);
 advanceListing();job({jobId:id(602),version:4});const revised=beginDelivery({jobId:id(602),token:id(802)});assert.equal(revised.delivery.operation,'create');assert.equal(revised.delivery.revision,2);assert.equal(revised.delivery.sourceId,listing);assert.equal(revised.delivery.providerAdId,null);assert.equal(count('private.advertising_publications'),0);
});
test('definitive rejected update preserves published identity and next reviewed version uses update',()=>{
 const first=prepared();verified(first.delivery);savePublished();advanceListing();job({jobId:id(602),version:4});const update=beginDelivery({jobId:id(602),token:id(802)}),d={...update.delivery,jobId:id(602)};
 record(d,{token:id(802),status:'rejected',requestId:null,adId:'123456'});service(`select public.save_advertising_job('${id(602)}',2,'${id(802)}','rejected','123456',null,'blocket_http_400')`);
 sql(`update private.advertising_listings set version=6 where id='${listing}';insert into private.advertising_versions(company_id,listing_id,version,snapshot,created_by)select company_id,listing_id,6,snapshot,created_by from private.advertising_versions where listing_id='${listing}'and version=2`);job({jobId:id(603),version:6});const revised=beginDelivery({jobId:id(603),token:id(803)});assert.equal(revised.delivery.operation,'update');assert.equal(revised.delivery.providerAdId,'123456');assert.equal(revised.delivery.revision,3);assert.equal(count('private.advertising_publications'),1);
});
test('group disable expiry and binding rotation deny managed job claim even if a heartbeat is forged fresh',()=>{
 for(const change of[`update private.blocket_company_bindings set valid_until=now()-interval '1 day'where company_id='${company}'`,`update private.blocket_groups set version=version+1 where id='${group}'`,`update private.blocket_groups set status='disabled'where id='${group}'`]){seed();configure();bind();ready();job();sql(change);assert.throws(()=>beginDelivery(),/verified binding changed/);assert.equal(count('private.blocket_delivery_revisions'),0);assert.equal(sql(`select status from private.advertising_jobs where id='${id(601)}'`),'queued');}
});
test('service runtime resolvers expose only nonsecret current group and exact job binding without needing heartbeat',()=>{
 seed();configure();bind();job();
 const g=JSON.parse(service(`select public.get_blocket_worker_group('${group}')`));assert.equal(g.credentialReference,'blocket_group_main');assert.equal(g.scope,'dealer_group');assert.equal(g.dispatcherId,`blocket_${group.replaceAll('-','')}`);
 const b=JSON.parse(service(`select public.get_blocket_worker_binding('${id(601)}')`));assert.equal(b.companyId,company);assert.equal(b.accountReference,'dealer-a');assert.deepEqual(b.group,g);
 assert.equal(sql(`select available_until>clock_timestamp()from private.advertising_dispatchers where id='${g.dispatcherId}'`),'f');
 for(const user of[platform,owner])for(const call of[`select public.get_blocket_worker_group('${group}')`,`select public.get_blocket_worker_binding('${id(601)}')`])assert.throws(()=>asUser(user,call),/permission denied/);
 sql(`update private.blocket_company_bindings set valid_until=now()-interval '1 day'where company_id='${company}'`);assert.throws(()=>service(`select public.get_blocket_worker_binding('${id(601)}')`),/unavailable/);
 sql(`update private.blocket_groups set status='disabled'where id='${group}'`);assert.throws(()=>service(`select public.get_blocket_worker_group('${group}')`),/unavailable/);
});
test('actual priced send through delivery ledger bills frozen accepted price once across create and update',()=>{
 seed();configure();bind();ready();
 asUser(platform,`select public.save_advertising_channel_rate('${company}','blocket','12500',0,'${id(930)}')`);
 function send(version,nonce){return JSON.parse(asUser(sales,`select public.send_vehicle_advertisement_priced('${company}','${listing}',${version},array['blocket'],'${nonce}',public.get_advertising_send_quote('${company}','${listing}',${version},array['blocket'])->>'reviewToken')`)).jobs[0];}
 function deliver(j,token,requestId){const begun=beginDelivery({jobId:j.id,token}),d={...begun.delivery,jobId:j.id};const ack=record(d,{token,requestId});record({...ack,jobId:j.id},{token:null,status:'published',requestId,adId:'123456',evidence:'e'.repeat(64)});savePublished(j.id,2,token);}
 deliver(send(2,id(931)),id(831),id(841));
 asUser(platform,`select public.save_advertising_channel_rate('${company}','blocket','99999',1,'${id(932)}')`);
 advanceListing();deliver(send(4,id(933)),id(832),id(842));
 assert.equal(count('private.advertising_publications'),1);assert.equal(count('private.advertising_publication_prices'),1);assert.equal(sql(`select unit_price_ore from private.advertising_publication_prices`),'12500');
 assert.equal(count('private.advertising_job_price_commitments'),2);assert.equal(sql(`select bool_and(unit_price_ore=12500)from private.advertising_job_price_commitments`),'t');
});
test('immutable ledger identity terms events and injected event failure roll back entire job claim',()=>{
 const begun=prepared();assert.throws(()=>sql(`update private.blocket_delivery_revisions set payload_sha256=repeat('c',64)where id='${begun.delivery.id}'`),/immutable/);assert.throws(()=>sql(`delete from private.blocket_delivery_events`),/immutable/);assert.throws(()=>sql(`delete from private.blocket_delivery_identities`),/immutable/);
 seed();configure();bind();ready();job();sql(`create function private.blocket_test_failure()returns trigger language plpgsql as $$begin raise exception 'Injected Blocket event failure';end$$;create trigger blocket_test_failure before insert on private.blocket_delivery_events for each row execute function private.blocket_test_failure();`);
 assert.throws(()=>beginDelivery(),/Injected/);assert.equal(count('private.blocket_delivery_identities'),0);assert.equal(sql(`select status from private.advertising_jobs where id='${id(601)}'`),'queued');sql('drop trigger blocket_test_failure on private.blocket_delivery_events;drop function private.blocket_test_failure()');
});
test('platform revocation defeats historical provisioning receipt; account ban defeats new delivery',()=>{
 seed();configure();sql(`update private.platform_admins set status='suspended'where user_id='${platform}'`);assert.throws(()=>configure(),/required/);assert.throws(()=>page(),/required/);
 seed();configure();bind();ready();job();sql(`update auth.users set banned_until=now()+interval '1 day'where id='${sales}'`);assert.throws(()=>beginDelivery(),/required/);assert.equal(count('private.blocket_delivery_revisions'),0);
});
test('same admin nonce concurrent group creates converge with one immutable audit',async()=>{
 seed();const a=session('admin_a'),b=session('admin_b');try{await Promise.all([a.ready(),b.ready()]);const first=JSON.parse(await a.query(`${adminBegin}${groupCall()};`));const pending=b.query(`${adminBegin}${groupCall()};`);await waitForLock('admin_b');await a.query('commit;');assert.deepEqual(JSON.parse(await pending),first);await b.query('commit;');assert.equal(count('private.blocket_provision_audit'),1);}finally{a.close();b.close();}
});
test('concurrent dealer-code assignment across companies permits one winner only',async()=>{
 seed();configure();const a=session('binding_a'),b=session('binding_b');try{await Promise.all([a.ready(),b.ready()]);await a.query(`${adminBegin}${bindCall()};`);const pending=assert.rejects(b.query(`${adminBegin}${bindCall({companyId:otherCompany,nonce:id(921)})};`),/identity conflict/);await waitForLock('binding_b');await a.query('commit;');await pending;assert.equal(count('private.blocket_company_bindings'),1);}finally{a.close();b.close();}
});
test('concurrent begin has one network intent and stale loser conflicts, later same-intent retry returns replay flag',async()=>{
 seed();configure();bind();ready();job();const a=session('intent_a'),b=session('intent_b');try{await Promise.all([a.ready(),b.ready()]);await a.query(`${workerBegin}${beginCall()};`);const pending=assert.rejects(b.query(`${workerBegin}${beginCall({token:id(802)})};`),/CAS conflict|intent conflict/);await waitForLock('intent_b');await a.query('commit;');await pending;assert.equal(beginDelivery().replayed,true);assert.equal(count('private.blocket_delivery_revisions'),1);}finally{a.close();b.close();}
});
test('group configuration and managed claim serialize in both orders without lock inversion',async()=>{
 for(const groupFirst of[true,false]){seed();configure();bind();ready();job();const a=session('group_a'),b=session('group_b');try{await Promise.all([a.ready(),b.ready()]);await a.query(`${groupFirst?adminBegin:workerBegin}${groupFirst?groupCall({version:1,reference:'Rotated group',nonce:id(921)}):beginCall()};`);const raw=b.query(`${groupFirst?workerBegin:adminBegin}${groupFirst?beginCall():groupCall({version:1,reference:'Rotated group',nonce:id(921)})};`);const pending=groupFirst?assert.rejects(raw,/connection changed|binding changed/):raw;await waitForLock('group_b');await a.query('commit;');await pending;if(!groupFirst)await b.query('commit;');assert.equal(count('private.blocket_delivery_revisions'),groupFirst?0:1);}finally{a.close();b.close();}}
});
test('approval revocation held during wait denies delivery without partial intent',async()=>{
 seed();configure();bind();ready();job();const a=session('revoke_a'),b=session('revoke_b');try{await Promise.all([a.ready(),b.ready()]);await a.query(`begin;update private.account_approvals set status='suspended'where user_id='${sales}';`);const pending=assert.rejects(b.query(`${workerBegin}${beginCall()};`),/required/);await waitForLock('revoke_b');await a.query('commit;');await pending;assert.equal(count('private.blocket_delivery_revisions'),0);}finally{a.close();b.close();}
});
test('platform registry and Auth revocation during real lock waits defeat even historical group receipt replay',async()=>{
 for(const change of[`update private.platform_admins set status='suspended'where user_id='${platform}'`,`update auth.users set banned_until=now()+interval '1 day'where id='${platform}'`]){seed();configure();const a=session('platform_revoke_a'),b=session('platform_revoke_b');try{await Promise.all([a.ready(),b.ready()]);await a.query(`begin;${change};`);const outcome=assert.rejects(b.query(`${adminBegin}${groupCall()};`),/required/);await waitForLock('platform_revoke_b');await a.query('commit;');await outcome;assert.equal(count('private.blocket_provision_audit'),1);}finally{a.close();b.close();}}
});
