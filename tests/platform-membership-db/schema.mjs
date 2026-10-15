import assert from 'node:assert/strict';
import {readFile}from 'node:fs/promises';
import {before,test}from 'node:test';
import {bootstrap,sql,session,id,platform,owner,admin,sales,finance,viewer,foreign,noMembership,unverified,pending,suspendedPlatform,otherPlatform,phoneOnly,company,otherCompany,adminMembership,salesMembership,ownerMembership,seed,asUser,listCompany,listAccount,update,updateCall,waitForLock}from './helpers.mjs';
before(bootstrap);
const count=t=>Number(sql(`select count(*)from ${t}`));
const begin=u=>`begin;set local role authenticated;set local request.jwt.claim.sub='${u}';`;
const ownershipRequest=()=>JSON.parse(asUser(owner,`select public.request_company_ownership_transfer('${company}','${adminMembership}',1,1,1,'Granskad ägarroll',true,'2026-10-15','${id(950)}')`));
const ownershipAccept=t=>`select public.accept_company_ownership_transfer('${company}','${t.transfer.id}',1,${t.teamVersion},true,'2026-10-15','${id(951)}')`;
const ownerEdit=()=>`select public.update_company_team_member('${company}','${adminMembership}',1,'viewer','active','Granskad personalroll','${id(952)}')`;

test('hosted rollback proof leaves all eight synthetic namespace counters zero',async()=>{
 sql(await readFile(new URL('../../supabase/tests/platform_membership_admin.sql',import.meta.url),'utf8'));
 const result=JSON.parse(sql(await readFile(new URL('../../supabase/tests/platform_membership_admin_cleanup.sql',import.meta.url),'utf8')));assert.equal(Object.keys(result).length,8);assert.ok(Object.values(result).every(n=>n===0));
});
test('platform-only private RPCs deny company owner/admin/all dealer roles, anon, service and forged metadata',()=>{
 seed();
 sql(`update auth.users set raw_user_meta_data='{"role":"superadmin","is_platform_admin":true}'where id='${owner}'`);
 for(const user of[owner,admin,sales,finance,viewer,foreign,suspendedPlatform]){
 for(const call of[`select public.list_platform_company_members('${company}')`,`select public.list_platform_account_memberships('${admin}')`,updateCall()])assert.throws(()=>asUser(user,call),/required/);
 }
 for(const role of['anon','service_role'])for(const call of[`select public.list_platform_company_members('${company}')`,`select public.list_platform_account_memberships('${admin}')`,updateCall()])assert.throws(()=>sql(`begin;set local role ${role};${call}`),/permission denied/);
 for(const role of['anon','authenticated','service_role'])assert.throws(()=>sql(`begin;set local role ${role};select *from private.platform_membership_audit`),/permission denied/);
 assert.throws(()=>asUser(platform,'select private.platform_members_admin_identity()'),/permission denied/);
 assert.equal(sql(`select count(*)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('list_platform_company_members','list_platform_account_memberships','update_platform_company_member')and p.prosecdef`),'0');
});
test('both bounded membership directions preserve nullable identity and empty accounts; no unrelated personal metadata',()=>{
 seed();const a=listCompany();assert.equal(a.companyName,'Platform member A');assert.equal(a.members.length,11);assert.equal(a.members.find(m=>m.userId===phoneOnly).email,null);assert.equal(a.members.find(m=>m.userId===pending).accountStatus,'pending');assert.equal(a.members.find(m=>m.userId===unverified).emailVerified,false);
 const b=listAccount();assert.equal(b.userId,admin);assert.deepEqual(b.memberships.map(m=>m.companyId),[company,otherCompany]);assert.equal(b.email,'platform-member-3@fixture.invalid');assert.equal(listAccount({userId:noMembership}).memberships.length,0);assert.equal(listAccount({userId:phoneOnly}).email,null);
 const expected=['membershipId','userId','email','role','status','version','companyId','companyName','companyStatus','accountStatus','emailVerified','isPlatformAdmin'].sort();assert.deepEqual(Object.keys(a.members[0]).sort(),expected);
 assert.throws(()=>listCompany({pageKey:id(207)}),/cursor conflict/);assert.throws(()=>listAccount({pageKey:ownerMembership}),/cursor conflict/);assert.throws(()=>listCompany({limit:51}),/Invalid/);
});
test('new mutation bumps exact member/team versions once; historical receipt survives later edits without changing current state',()=>{
 seed();const outbox=count('private.transactional_email_outbox'),r=update();assert.equal(r.member.version,2);assert.equal(r.teamVersion,2);assert.equal(r.member.role,'finance');assert.deepEqual(update(),r);
 const next=update({version:2,role:'viewer',nonce:id(902)});assert.equal(next.member.version,3);assert.equal(next.teamVersion,3);assert.deepEqual(update(),r);assert.equal(listCompany().members.find(m=>m.userId===admin).role,'viewer');
 assert.equal(count('private.platform_membership_audit'),2);assert.equal(count('private.transactional_email_outbox'),outbox);assert.equal(sql(`select role from public.memberships where id='${ownerMembership}'`),'owner');assert.equal(sql(`select created_by from public.companies where id='${company}'`),owner);
 assert.throws(()=>update({reason:'Ändrad historik'}),/payload conflict/);
});
test('owner, owner promotion, self, every platform registry target and foreign membership IDs are protected',()=>{
 seed();assert.throws(()=>update({membershipId:ownerMembership,role:'viewer'}),/Owner membership is protected/);assert.throws(()=>update({role:'owner'}),/Invalid/);
 for(const membershipId of[id(201),id(211),id(212)])assert.throws(()=>update({membershipId}),/Protected platform/);
 assert.throws(()=>update({membershipId:id(207)}),/unavailable/);assert.equal(count('private.platform_membership_audit'),0);
});
test('existing account list correctly protects active and suspended platform registry entries',()=>{
 seed();const page=JSON.parse(asUser(platform,"select public.list_platform_accounts('all',null,50)"));
 for(const user of[platform,suspendedPlatform,otherPlatform])assert.equal(page.accounts.find(a=>a.userId===user).isPlatformAdmin,true);
 for(const user of[suspendedPlatform,otherPlatform])assert.throws(()=>asUser(platform,`select public.set_platform_account_access('${user}',1,'suspended','Skyddad admin','${id(920)}')`),/independently administered/);
});
test('strict mutation validation rejects no-op, stale CAS, unknown roles/statuses and noncanonical Unicode reason',()=>{
 seed();for(const patch of[{role:'admin'},{version:0},{version:null},{role:'root'},{status:'inactive'},{status:null},{reason:null},{reason:''},{reason:' padded '},{reason:'Reason\ufeff'},{reason:'Unsafe\u0080'},{reason:'a'.repeat(501)}])assert.throws(()=>update(patch),/Invalid|change required/);
 assert.throws(()=>update({version:2}),/version conflict/);assert.equal(count('private.platform_membership_audit'),0);
 const r=update({reason:'🚙'.repeat(500)});assert.equal(r.member.version,2);assert.equal(Array.from(sql('select reason from private.platform_membership_audit')).length,500);
});
test('activation requires currently verified approved unbanned account and active company; suspension remains possible',()=>{
 for(const change of[`update auth.users set email_confirmed_at=null where id='${admin}'`,`update auth.users set banned_until=now()+interval '1 day'where id='${admin}'`,`update auth.users set is_anonymous=true where id='${admin}'`,`update auth.users set is_sso_user=true where id='${admin}'`,`update private.account_approvals set status='pending'where user_id='${admin}'`,`update private.account_approvals set status='rejected'where user_id='${admin}'`,`update private.account_approvals set status='suspended'where user_id='${admin}'`,`update public.companies set status='suspended'where id='${company}'`]){
 seed();sql(change);assert.throws(()=>update(),/required/);assert.equal(count('private.platform_membership_audit'),0);const r=update({status:'suspended'});assert.equal(r.member.status,'suspended');assert.equal(r.member.version,2);
 }
 seed();assert.throws(()=>update({membershipId:id(213),role:'viewer'}),/required/);const phone=update({membershipId:id(213),role:'sales',status:'suspended'});assert.equal(phone.member.email,null);
});
test('suspension and role changes apply to existing-session RLS while another company membership remains isolated',()=>{
 seed();assert.equal(asUser(admin,`select count(*)from public.stock_items where company_id='${company}'`),'1');
 update({status:'suspended'});assert.equal(asUser(admin,`select count(*)from public.stock_items where company_id='${company}'`),'0');assert.equal(asUser(admin,`select private.has_company_role('${otherCompany}',array['viewer'])`),'t');
 const current=listAccount();assert.equal(current.memberships.find(m=>m.companyId===company).status,'suspended');assert.equal(current.memberships.find(m=>m.companyId===otherCompany).status,'active');
});
test('private audit immutable and injected audit failure rolls back membership and company versions',()=>{
 seed();update();assert.throws(()=>sql("update private.platform_membership_audit set payload='{}'"),/immutable/);assert.throws(()=>sql('delete from private.platform_membership_audit'),/immutable/);
 sql(`create function private.platform_member_test_failure()returns trigger language plpgsql as $$begin raise exception 'Injected membership audit failure';end$$;create trigger platform_member_test_failure before insert on private.platform_membership_audit for each row execute function private.platform_member_test_failure();`);
 assert.throws(()=>update({version:2,role:'viewer',nonce:id(902)}),/Injected/);assert.equal(listCompany().teamVersion,2);assert.equal(listCompany().members.find(m=>m.userId===admin).role,'finance');assert.equal(count('private.platform_membership_audit'),1);
 sql('drop trigger platform_member_test_failure on private.platform_membership_audit;drop function private.platform_member_test_failure()');
});
test('membership UUID keysets cover more than500 records in both directions and bind target scope',()=>{
 seed();sql(`insert into auth.users(id,email,email_confirmed_at)select('fd200000-0000-4000-8000-'||lpad((10000+n)::text,12,'0'))::uuid,'membership-extra-'||n||'@fixture.invalid',now()from generate_series(1,501)n;
 insert into public.memberships(id,company_id,user_id,role)select('fd200000-0000-4000-8000-'||lpad((20000+n)::text,12,'0'))::uuid,'${company}',('fd200000-0000-4000-8000-'||lpad((10000+n)::text,12,'0'))::uuid,'viewer'from generate_series(1,501)n;
 insert into public.companies(id,name,organisation_number,created_by)select('fd200000-0000-4000-8000-'||lpad((30000+n)::text,12,'0'))::uuid,'Company '||n,'5568554884','${owner}'from generate_series(1,501)n;
 insert into public.memberships(id,company_id,user_id,role)select('fd200000-0000-4000-8000-'||lpad((40000+n)::text,12,'0'))::uuid,('fd200000-0000-4000-8000-'||lpad((30000+n)::text,12,'0'))::uuid,'${admin}','viewer'from generate_series(1,501)n;`);
 for(const kind of['company','account']){let cursor=null,total=0,last='';do{const p=kind==='company'?listCompany({pageKey:cursor}):listAccount({pageKey:cursor});for(const m of p[kind==='company'?'members':'memberships']){assert.ok(m.membershipId>last);last=m.membershipId;total++;}cursor=p.nextPageKey;}while(cursor);assert.equal(total,kind==='company'?512:503);}
});
test('pending owner transfer cannot accept stale member version even if the former role is restored',()=>{
 seed();const transfer=ownershipRequest();update({role:'sales'});update({version:2,role:'admin',nonce:id(902)});
 assert.throws(()=>asUser(admin,ownershipAccept({...transfer,teamVersion:4})),/member conflict/);assert.equal(sql(`select role from public.memberships where id='${ownerMembership}'`),'owner');
});
test('same actor nonce concurrent updates converge exactly; different requests with stale version have one winner',async()=>{
 for(const sameNonce of[true,false]){seed();const a=session('nonce_a'),b=session('nonce_b');try{await Promise.all([a.ready(),b.ready()]);const first=JSON.parse(await a.query(`${begin(platform)}${updateCall()};`));const raw=b.query(`${begin(platform)}${updateCall(sameNonce?{}:{role:'viewer',nonce:id(902)})};`),outcome=sameNonce?raw:assert.rejects(raw,/version conflict/);await waitForLock('nonce_b');await a.query('commit;');if(sameNonce){assert.deepEqual(JSON.parse(await outcome),first);await b.query('commit;');}else await outcome;assert.equal(count('private.platform_membership_audit'),1);}finally{a.close();b.close();}}
});
test('platform edit and ordinary owner personnel edit serialize both orders and reject stale loser',async()=>{
 for(const platformFirst of[true,false]){seed();const a=session('team_a'),b=session('team_b');try{await Promise.all([a.ready(),b.ready()]);await a.query(`${begin(platformFirst?platform:owner)}${platformFirst?updateCall():ownerEdit()};`);const outcome=assert.rejects(b.query(`${begin(platformFirst?owner:platform)}${platformFirst?ownerEdit():updateCall()};`),/version conflict/);await waitForLock('team_b');await a.query('commit;');await outcome;assert.equal(sql(`select version from public.memberships where id='${adminMembership}'`),'2');}finally{a.close();b.close();}}
});
test('platform edit and owner-role acceptance race in both orders without owner bypass or deadlock',async()=>{
 for(const acceptFirst of[true,false]){seed();const transfer=ownershipRequest(),a=session('ownership_a'),b=session('ownership_b');try{await Promise.all([a.ready(),b.ready()]);await a.query(`${begin(acceptFirst?admin:platform)}${acceptFirst?ownershipAccept(transfer):updateCall()};`);const outcome=assert.rejects(b.query(`${begin(acceptFirst?platform:admin)}${acceptFirst?updateCall():ownershipAccept(transfer)};`),/protected|denied|conflict/);await waitForLock('ownership_b');await a.query('commit;');await outcome;assert.equal(sql(`select role from public.memberships where id='${adminMembership}'`),acceptFirst?'owner':'finance');assert.equal(sql(`select count(*)from public.memberships where company_id='${company}'and role='owner'and status='active'`),'1');}finally{a.close();b.close();}}
});
test('target approval and company revocation during lock wait deny activation while no mutation is committed',async()=>{
 for(const mutation of[`select public.set_platform_account_access('${admin}',1,'suspended','Granskad kontospärr','${id(953)}')`,`select public.set_platform_company_status('${company}','active','suspended','Granskad företagsspärr','${id(954)}')`]){seed();const a=session('scope_a'),b=session('scope_b');try{await Promise.all([a.ready(),b.ready()]);await a.query(`${begin(platform)}${mutation};`);const outcome=assert.rejects(b.query(`${begin(platform)}${updateCall()};`),/required/);await waitForLock('scope_b');await a.query('commit;');await outcome;assert.equal(count('private.platform_membership_audit'),0);}finally{a.close();b.close();}}
});
test('actor platform/Auth revocation during wait defeats historical receipt replay',async()=>{
 for(const change of[`update private.platform_admins set status='suspended'where user_id='${platform}'`,`update auth.users set banned_until=now()+interval '1 day'where id='${platform}'`]){seed();update();const a=session('actor_a'),b=session('actor_b');try{await Promise.all([a.ready(),b.ready()]);await a.query(`begin;${change};`);const outcome=assert.rejects(b.query(`${begin(platform)}${updateCall()};`),/required/);await waitForLock('actor_b');await a.query('commit;');await outcome;assert.equal(count('private.platform_membership_audit'),1);}finally{a.close();b.close();}}
});
test('concurrent new platform registry entry cannot slip past target protection absent-row check',async()=>{
 seed();const a=session('registry_a'),b=session('registry_b');try{await Promise.all([a.ready(),b.ready()]);await a.query(`begin;insert into private.platform_admins(user_id,created_by)values('${admin}','${platform}');`);const outcome=assert.rejects(b.query(`${begin(platform)}${updateCall()};`),/Protected platform/);await waitForLock('registry_b');await a.query('commit;');await outcome;assert.equal(count('private.platform_membership_audit'),0);assert.equal(sql(`select role from public.memberships where id='${adminMembership}'`),'admin');}finally{a.close();b.close();}
});
