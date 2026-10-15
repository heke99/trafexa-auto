import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {before,test} from 'node:test';
import {bootstrap,sql,session,id,owner,admin,otherAdmin,foreign,sales,company,otherCompany,ownerMembership,adminMembership,otherAdminMembership,seed,asUser,get,request,requestCall,accept,acceptCall,cancel,cancelCall,waitForLock}from './helpers.mjs';
before(bootstrap);
const begin=user=>`begin;set local role authenticated;set local request.jwt.claim.sub='${user}';`;
const count=table=>Number(sql(`select count(*)from ${table}`));
const members=()=>JSON.parse(sql(`select jsonb_agg(jsonb_build_object('userId',user_id,'role',role,'version',version)order by user_id)from public.memberships where company_id='${company}'`));
const updateMember=(membership,role,nonce=id(951))=>`select public.update_company_team_member('${company}','${membership}',1,'${role}','active','Granskad personaländring','${nonce}')`;

test('hosted-safe rollback proof creates no persistent users, companies, audit or transfers',async()=>{
 sql(await readFile(new URL('../../supabase/tests/company_ownership_transfer.sql',import.meta.url),'utf8'));
 for(const table of ['auth.users','public.companies','private.company_ownership_transfers','private.company_ownership_audit'])assert.equal(count(table),0);
});
test('private tables and helper privileges deny clients; public wrappers are invoker and private entrypoints hardened',()=>{
 seed();
 for(const role of ['anon','authenticated','service_role']){
 assert.throws(()=>sql(`begin;set local role ${role};select * from private.company_ownership_transfers;`),/permission denied/);
 assert.throws(()=>sql(`begin;set local role ${role};select private.company_ownership_lock('${company}','${admin}');`),/permission denied/);
 }
 for(const role of ['anon','service_role'])assert.throws(()=>sql(`begin;set local role ${role};select public.get_company_ownership_transfer('${company}');`),/permission denied/);
 assert.equal(sql(`select count(*)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like '%company_ownership_transfer'and p.prosecdef`),'0');
 assert.equal(sql(`select count(*)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private'and c.relname in('company_ownership_transfers','company_ownership_audit')and c.relrowsecurity`),'2');
});
test('owner-only eligible admin candidates paginate; other tenant and sales cannot read; no automatic acceptance',()=>{
 seed();const page=get();assert.equal(page.canRequest,true);assert.equal(page.owner.membershipId,ownerMembership);assert.equal(page.transfer,null);assert.equal(page.candidates.length,2);
 const first=JSON.parse(asUser(owner,`select public.get_company_ownership_transfer('${company}',null,1)`));assert.equal(first.candidates[0].membershipId,adminMembership);assert.equal(first.nextPageKey,adminMembership);
 const next=JSON.parse(asUser(owner,`select public.get_company_ownership_transfer('${company}','${first.nextPageKey}',1)`));assert.equal(next.candidates[0].membershipId,otherAdminMembership);assert.equal(next.nextPageKey,null);
 assert.deepEqual(get(admin).candidates,[]);assert.equal(get(admin).blockReason,'not_owner');
 for(const user of[foreign,sales])assert.throws(()=>get(user),/denied/);
 sql(`update private.account_approvals set status='suspended'where user_id='${otherAdmin}'`);assert.equal(get().candidates.length,1);
 assert.equal(count('private.company_ownership_audit'),0);
});
test('two-party request and accept preserve historical creator, atomically swap roles and replay exact actor receipts',()=>{
 seed();const before=members(),r=request();assert.equal(r.teamVersion,2);assert.equal(r.transfer.status,'pending');assert.equal(r.transfer.teamVersionAtRequest,2);assert.equal(Date.parse(r.transfer.expiresAt)-Date.parse(r.transfer.createdAt),86400000);assert.deepEqual(members(),before);assert.equal(get(admin).canAccept,true);assert.equal(get(otherAdmin).canAccept,false);
 assert.deepEqual(request(),r);assert.throws(()=>request({reason:'Ändrad historik'}),/payload conflict/);
 const result=accept(r);assert.equal(result.teamVersion,3);assert.equal(result.transfer.version,2);assert.equal(result.transfer.status,'accepted');assert.ok(result.transfer.resolvedAt);
 const roles=members();assert.equal(roles.find(m=>m.userId===owner).role,'admin');assert.equal(roles.find(m=>m.userId===admin).role,'owner');assert.equal(roles.find(m=>m.userId===admin).version,2);
 assert.deepEqual(request(),r);assert.deepEqual(accept(r),result);assert.equal(count('private.company_ownership_audit'),2);assert.equal(sql(`select created_by from public.companies where id='${company}'`),owner);
 assert.equal(get().actorRole,'admin');assert.equal(get(admin).owner.userId,admin);
});
test('request validation, fresh actor roles, target scope and all three CAS values are enforced',()=>{
 seed();
 for(const patch of[{ack:false},{ack:null},{attestation:'old'},{reason:''},{reason:' padded '},{reason:'\nunsafe'},{reason:'a'.repeat(501)},{ownerVersion:0},{targetVersion:null},{teamVersion:null}])assert.throws(()=>request({...patch,nonce:id(910)}),/Invalid/);
 for(const patch of[{ownerVersion:2},{targetVersion:2},{teamVersion:2}])assert.throws(()=>request({...patch,nonce:id(910)}),/version conflict/);
 assert.throws(()=>request({},admin),/Owner required/);assert.throws(()=>request({target:id(204)}),/Target access denied/);assert.throws(()=>request({target:ownerMembership}),/Target access denied/);
 sql(`update public.memberships set role='owner'where id='${otherAdminMembership}'`);assert.equal(get().blockReason,'multiple_owners');assert.throws(()=>request(),/version conflict/);assert.equal(count('private.company_ownership_transfers'),0);
 sql(`update public.memberships set role='admin'where role='owner'and company_id='${company}'`);assert.equal(get().blockReason,'owner_missing');
});
test('verified approved accounts mandatory at request/accept; stale membership versions cannot be restored silently',()=>{
 for(const change of[`update auth.users set email_confirmed_at=null where id='${admin}'`,`update auth.users set banned_until=now()+interval '1 day'where id='${admin}'`,`update private.account_approvals set status='suspended'where user_id='${admin}'`]){
 seed();sql(change);assert.throws(()=>request(),/required/);assert.equal(count('private.company_ownership_transfers'),0);
 }
 seed();const r=request();sql(`update public.memberships set version=version+1 where id='${adminMembership}'`);assert.equal(get(admin).canAccept,false);assert.throws(()=>accept(r),/member conflict/);assert.equal(members().find(m=>m.userId===owner).role,'owner');
 seed();const r2=request();sql(`update private.account_approvals set status='suspended'where user_id='${owner}'`);assert.throws(()=>accept(r2),/required/);
});
test('direct RPC Unicode reasons remain parseable: ECMA edge whitespace and C0/C1 rejected, internal Unicode and 500 codepoints allowed',()=>{
 seed();
 for(const reason of['\u00a0Reason','Reason\u00a0','\ufeffReason','Reason\u2028','Unsafe\u0080reason','Unsafe\u009freason']){
 assert.throws(()=>request({reason}),/Invalid ownership review/);assert.equal(count('private.company_ownership_transfers'),0);assert.equal(count('private.company_ownership_audit'),0);
 }
 const r=request({reason:'🚙'.repeat(500)});assert.equal(Array.from(r.transfer.reason).length,500);
 for(const reason of['\u00a0Reason','Reason\ufeff','Unsafe\u0080reason','Unsafe\u009freason'])assert.throws(()=>cancel(r,{reason}),/Invalid ownership review/);
 assert.equal(get().transfer.status,'pending');assert.equal(count('private.company_ownership_audit'),1);
 const resolved=cancel(r,{reason:'Granskad 🚙 överlåtelse – Åäö'});assert.equal(resolved.transfer.cancelReason,'Granskad 🚙 överlåtelse – Åäö');
});
test('cancel requires original active owner but remains possible when target banned; exact retry and changed payload rules hold',()=>{
 seed();const r=request();assert.throws(()=>cancel(r,{},otherAdmin),/party access denied/);assert.throws(()=>accept(r,{},otherAdmin),/party access denied/);
 sql(`update auth.users set banned_until=now()+interval '1 day'where id='${admin}'`);const result=cancel(r);assert.equal(result.transfer.status,'cancelled');assert.equal(result.transfer.cancelReason,'Överlåtelsen återkallas');assert.deepEqual(cancel(r),result);assert.throws(()=>cancel(r,{reason:'annan'}),/payload conflict/);
 assert.equal(members().find(m=>m.userId===owner).role,'owner');assert.equal(get().canRequest,true);
 sql(`update public.memberships set status='suspended'where id='${ownerMembership}'`);assert.throws(()=>cancel(r),/denied/);
});
test('expiry is derived on read; request persists old expiry and does not double increment team version',()=>{
 seed();const r=request();
 // Privileged fixture time travel only; production clients have no table grants.
 sql(`begin;alter table private.company_ownership_transfers disable trigger guard_company_ownership_transfer;update private.company_ownership_transfers set created_at=now()-interval '25 hours',expires_at=now()-interval '1 hour'where id='${r.transfer.id}';alter table private.company_ownership_transfers enable trigger guard_company_ownership_transfer;commit;`);
 const expired=get().transfer;assert.equal(expired.status,'expired');assert.equal(expired.resolvedAt,expired.expiresAt);assert.equal(expired.version,1);assert.equal(get(admin).canAccept,false);assert.throws(()=>accept(r),/expiry conflict/);
 const next=request({teamVersion:2,nonce:id(911)});assert.equal(next.teamVersion,3);assert.equal(sql(`select status||':'||version from private.company_ownership_transfers where id='${r.transfer.id}'`),'expired:2');assert.equal(count('private.company_ownership_audit'),2);
});
test('immutable terms/audit and injected receipt failure roll back owner swap and team increment',()=>{
 seed();const r=request();assert.throws(()=>sql(`update private.company_ownership_transfers set reason='changed'where id='${r.transfer.id}'`),/immutable/);assert.throws(()=>sql(`delete from private.company_ownership_audit`),/immutable/);
 sql(`create function private.ownership_test_failure()returns trigger language plpgsql as $$begin if new.action='accept'then raise exception 'Injected ownership audit failure';end if;return new;end$$;create trigger ownership_test_failure before insert on private.company_ownership_audit for each row execute function private.ownership_test_failure();`);
 assert.throws(()=>accept(r),/Injected/);assert.equal(get().teamVersion,2);assert.equal(get().transfer.status,'pending');assert.equal(members().find(m=>m.userId===owner).role,'owner');
 sql('drop trigger ownership_test_failure on private.company_ownership_audit;drop function private.ownership_test_failure()');
});
test('same request nonce in real sessions creates exactly one transfer and audit',async()=>{
 seed();const a=session('nonce_a'),b=session('nonce_b');try{await Promise.all([a.ready(),b.ready()]);const first=JSON.parse(await a.query(`${begin(owner)}${requestCall()};`));const pending=b.query(`${begin(owner)}${requestCall()};`);await waitForLock('nonce_b');await a.query('commit;');const second=JSON.parse(await pending);await b.query('commit;');assert.deepEqual(second,first);assert.equal(count('private.company_ownership_transfers'),1);assert.equal(count('private.company_ownership_audit'),1);}finally{a.close();b.close();}
});
test('accept and cancel race in both orders: exactly one resolution wins without double owner',async()=>{
 for(const acceptFirst of[true,false]){seed();const r=request(),a=session('resolve_a'),b=session('resolve_b');try{await Promise.all([a.ready(),b.ready()]);await a.query(`${begin(acceptFirst?admin:owner)}${acceptFirst?acceptCall(r):cancelCall(r)};`);const pending=assert.rejects(b.query(`${begin(acceptFirst?owner:admin)}${acceptFirst?cancelCall(r):acceptCall(r)};`),/denied|conflict/);await waitForLock('resolve_b');await a.query('commit;');await pending;assert.equal(get(acceptFirst?admin:owner).transfer.status,acceptFirst?'accepted':'cancelled');assert.equal(sql(`select count(*)from public.memberships where company_id='${company}'and role='owner'and status='active'`),'1');}finally{a.close();b.close();}}
});
test('old personnel mutation and accept serialize both orders, no stale admin can change new owner',async()=>{
 for(const acceptFirst of[true,false]){seed();const r=request(),a=session('personnel_a'),b=session('personnel_b');try{await Promise.all([a.ready(),b.ready()]);await a.query(`${begin(acceptFirst?admin:owner)}${acceptFirst?acceptCall(r):updateMember(adminMembership,'finance')};`);const pending=assert.rejects(b.query(`${begin(acceptFirst?owner:admin)}${acceptFirst?updateMember(adminMembership,'finance'):acceptCall(r)};`),/denied|conflict/);await waitForLock('personnel_b');await a.query('commit;');await pending;assert.equal(members().find(m=>m.userId===owner).role,acceptFirst?'admin':'owner');}finally{a.close();b.close();}}
});
test('fresh account approval and Auth bans held during wait deny accept when revocation wins',async()=>{
 for(const revoke of[`update private.account_approvals set status='suspended'where user_id='${owner}'`,`update auth.users set banned_until=now()+interval '1 day'where id='${admin}'`]){seed();const r=request(),a=session('revoke_a'),b=session('revoke_b');try{await Promise.all([a.ready(),b.ready()]);await a.query(`begin;${revoke};`);const pending=assert.rejects(b.query(`${begin(admin)}${acceptCall(r)};`),/required/);await waitForLock('revoke_b');await a.query('commit;');await pending;assert.equal(members().find(m=>m.userId===owner).role,'owner');}finally{a.close();b.close();}}
});
test('role reads after company-lock wait reject a demoted owner request and suspended-company acceptance',async()=>{
 for(const setup of['demote','company']){seed();const r=setup==='company'?request():null,a=session('scope_a'),b=session('scope_b');try{await Promise.all([a.ready(),b.ready()]);await a.query(`begin;update public.companies set status=${setup==='company'?"'suspended'":"'active'"}where id='${company}';${setup==='demote'?`update public.memberships set role='admin',version=version+1 where id='${ownerMembership}';`:''}`);const pending=assert.rejects(b.query(`${begin(setup==='company'?admin:owner)}${setup==='company'?acceptCall(r):requestCall()};`),/denied|required/);await waitForLock('scope_b');await a.query('commit;');await pending;}finally{a.close();b.close();}}
});
