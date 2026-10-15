import assert from 'node:assert/strict';
import {readFile}from 'node:fs/promises';
import {before,test}from 'node:test';
import {bootstrap,sql,session,id,owner,admin,foreign,sales,finance,viewer,pending,company,otherCompany,branch,fields,seed,asUser,list,save,saveCall,setStatus,statusCall,waitForLock}from './helpers.mjs';
before(bootstrap);
const begin=user=>`begin;set local role authenticated;set local request.jwt.claim.sub='${user}';`;
const count=table=>Number(sql(`select count(*)from ${table}`));

test('hosted-safe rollback proof and read-only nine-count cleanup leave no synthetic records',async()=>{
 sql(await readFile(new URL('../../supabase/tests/company_branches.sql',import.meta.url),'utf8'));
 const result=JSON.parse(sql(await readFile(new URL('../../supabase/tests/company_branches_cleanup.sql',import.meta.url),'utf8')));assert.equal(Object.keys(result).length,9);assert.ok(Object.values(result).every(n=>n===0));
});
test('owner/admin private APIs only; foreign, sales, finance, viewer, pending, anon, service denied',()=>{
 seed();save();assert.equal(list({user:admin}).branches.length,1);
 for(const user of[foreign,sales,finance,viewer,pending]){
 assert.throws(()=>list({user}),/denied|required/);assert.throws(()=>save({nonce:id(910)},user),/denied|required/);assert.throws(()=>setStatus({},user),/denied|required/);
 }
 assert.throws(()=>list({companyId:otherCompany}),/denied/);
 for(const role of['anon','authenticated','service_role'])for(const table of['private.company_branches','private.company_branch_audit'])assert.throws(()=>sql(`begin;set local role ${role};select *from ${table};`),/permission denied/);
 for(const role of['anon','service_role'])for(const call of[`select public.list_company_branches('${company}','active')`,saveCall(),statusCall()])assert.throws(()=>sql(`begin;set local role ${role};${call}`),/permission denied/);
 assert.throws(()=>asUser(owner,`select private.mutate_company_branch('save','${company}','${branch}',0,'{}',null,null,true,'${id(920)}')`),/permission denied/);
 assert.equal(sql(`select count(*)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('list_company_branches','save_company_branch','set_company_branch_status')and p.prosecdef`),'0');
});
test('create edit archive reactivate preserve company identity, exact versions, timestamps and historical receipts',()=>{
 seed();const outboxBefore=count('private.transactional_email_outbox');const created=save();assert.equal(created.action,'save');assert.equal(created.branch.version,1);assert.deepEqual(created.branch.fields,fields);assert.equal(created.branch.createdAt,created.branch.updatedAt);assert.deepEqual(save(),created);
 const edited=save({version:1,input:{...fields,name:'Ny Åäö butik'},nonce:id(911)},admin);assert.equal(edited.branch.version,2);assert.equal(edited.branch.createdAt,created.branch.createdAt);
 const archived=setStatus({version:2});assert.equal(archived.branch.status,'archived');assert.equal(list().branches.length,0);assert.equal(list({status:'archived'}).branches.length,1);
 assert.deepEqual(save(),created);assert.deepEqual(save({version:1,input:{...fields,name:'Ny Åäö butik'},nonce:id(911)},admin),edited);assert.deepEqual(setStatus({version:2}),archived);
 const active=setStatus({version:3,status:'active',nonce:id(912)},admin);assert.equal(active.branch.version,4);assert.equal(active.branch.fields.name,'Ny Åäö butik');assert.equal(count('private.company_branch_audit'),4);
 const page=list();assert.equal(page.legalName,'Branches fixture A');assert.equal(page.organisationNumber,'5568554884');assert.equal(count('public.stock_items'),0);assert.equal(count('private.advertising_connections'),0);assert.equal(count('private.transactional_email_outbox'),outboxBefore);
});
test('strict seven-field direct RPC validation preserves Unicode codepoint and nullable contact parity',()=>{
 seed();
 const invalid=[{secret:'x'},{name:'x'},{name:'🚙'.repeat(121)},{name:'\u00a0Edge'},{city:'city\u0080'},{code:'Stockholm'},{code:'-start'},{code:'a'.repeat(25)},{postalCode:'１２３４５'},{postalCode:'123 45'},{publicEmail:'UPPER@fixture.invalid'},{publicEmail:'bad address@fixture.invalid'},{publicEmail:'one\u00a0two@fixture.invalid'},{publicEmail:'wrong'},{publicPhone:'abcdefghi'},{publicPhone:'+123456'},{publicPhone:'+1234567890123456'},{publicPhone:'123.456.789'},{publicPhone:''}];
 for(const patch of invalid)assert.throws(()=>save({input:{...fields,...patch}}),/Invalid branch fields/);
 const missing={...fields};delete missing.publicEmail;assert.throws(()=>save({input:missing}),/Invalid branch fields/);assert.throws(()=>save({input:[]}),/Invalid branch fields/);assert.throws(()=>save({input:null}),/Invalid branch fields/);
 assert.equal(count('private.company_branches'),0);const created=save({input:{...fields,name:'🚙'.repeat(120),publicEmail:null,publicPhone:null}});assert.equal(Array.from(created.branch.fields.name).length,120);assert.equal(created.branch.fields.publicPhone,null);
});
test('acknowledgement versions status and reason reject direct mutation without audit changes',()=>{
 seed();for(const patch of[{ack:false},{ack:null},{version:-1},{version:null}])assert.throws(()=>save(patch),/Invalid branch review/);save();
 for(const patch of[{ack:false},{version:0},{version:null},{status:'pending'},{status:null},{reason:null},{reason:''},{reason:' padded '},{reason:'a'.repeat(501)},{reason:'\ufeffReason'},{reason:'Unsafe\u009f'}])assert.throws(()=>setStatus(patch),/Invalid branch/);
 const archived=setStatus({reason:'🚙'.repeat(500)});assert.equal(Array.from(archived.branch.status==='archived'?sql(`select payload->>'reason'from private.company_branch_audit where action='status'`):'').length,500);
 assert.equal(count('private.company_branch_audit'),2);
});
test('CAS and active-only edits block stale review and double status change; no hard delete',()=>{
 seed();save();assert.throws(()=>save({version:0,nonce:id(911)}),/version conflict/);assert.throws(()=>save({version:2,nonce:id(911)}),/version conflict/);assert.throws(()=>setStatus({status:'active'}),/status conflict/);setStatus();
 assert.throws(()=>save({version:2,nonce:id(911)}),/Archived branch conflict/);assert.throws(()=>setStatus({version:2,nonce:id(911)}),/status conflict/);assert.throws(()=>setStatus({version:1,status:'active',nonce:id(911)}),/version conflict/);
 assert.throws(()=>sql(`delete from private.company_branches`),/forbidden/);assert.throws(()=>sql(`update private.company_branch_audit set payload='{}'`),/immutable/);assert.throws(()=>sql(`delete from private.company_branch_audit`),/immutable/);assert.equal(count('private.company_branches'),1);
});
test('code unique across active and archived branches, released on active rename, scoped per company',()=>{
 seed();save();setStatus();assert.throws(()=>save({branchId:id(302),nonce:id(911)}),/code or request conflict/);
 setStatus({version:2,status:'active',nonce:id(912)});save({version:3,input:{...fields,code:'renamed'},nonce:id(913)});
 assert.equal(save({branchId:id(302),nonce:id(911)}).branch.fields.code,'stockholm');assert.equal(save({branchId:id(303),companyId:otherCompany,nonce:id(914)},foreign).branch.fields.code,'stockholm');
 assert.throws(()=>save({branchId:id(303),version:1,nonce:id(915)}),/version conflict/);assert.throws(()=>setStatus({branchId:id(303),nonce:id(915)}),/version conflict/);
});
test('UUID keyset pagination binds current company and status and scans beyond 500 branches',()=>{
 seed();
 sql(`insert into private.company_branches(id,company_id,version,status,fields,created_at,updated_at)select('fd180000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,'${company}',1,'active',jsonb_build_object('code','branch-'||n,'name','Butik '||n,'addressLine1','Bilvägen 1','postalCode','11122','city','Stockholm','publicEmail',null,'publicPhone',null),now(),now()from generate_series(1,503)n`);
 let key=null,total=0,last='';do{const page=list({pageKey:key});for(const b of page.branches){assert.ok(b.id>last);last=b.id;}total+=page.branches.length;key=page.nextPageKey;}while(key);assert.equal(total,503);
 assert.throws(()=>list({pageKey:id(1)}),/page conflict/);assert.throws(()=>list({pageKey:id(1001),status:'archived'}),/page conflict/);assert.throws(()=>list({limit:51}),/Invalid branch page/);
});
test('fresh account verification approval company and membership required even for historical nonce',()=>{
 for(const change of[`update auth.users set email_confirmed_at=null where id='${owner}'`,`update auth.users set banned_until=now()+interval '1 day'where id='${owner}'`,`update private.account_approvals set status='suspended'where user_id='${owner}'`,`update public.companies set status='suspended'where id='${company}'`,`update public.memberships set status='suspended'where company_id='${company}'and user_id='${owner}'`,`update public.memberships set role='sales'where company_id='${company}'and user_id='${owner}'`]){
 seed();save();sql(change);assert.throws(()=>save(),/denied|required/);assert.throws(()=>list(),/denied|required/);assert.equal(count('private.company_branch_audit'),1);
 }
});
test('actor nonce payload mismatch conflicts; audit failure rolls back new row and existing status/version',()=>{
 seed();const created=save();assert.throws(()=>save({input:{...fields,name:'Different'}}),/payload conflict/);assert.throws(()=>save({branchId:id(302)}),/payload conflict/);
 sql(`create function private.branch_test_failure()returns trigger language plpgsql as $$begin raise exception 'Injected branch audit failure';end$$;create trigger branch_test_failure before insert on private.company_branch_audit for each row execute function private.branch_test_failure();`);
 assert.throws(()=>setStatus(),/Injected/);assert.equal(list().branches[0].version,1);assert.throws(()=>save({branchId:id(302),input:{...fields,code:'other'},nonce:id(911)}),/Injected/);assert.equal(count('private.company_branches'),1);assert.deepEqual(save(),created);
 sql('drop trigger branch_test_failure on private.company_branch_audit;drop function private.branch_test_failure()');
});
test('same actor nonce concurrent create converges exactly; distinct nonce same code has one winner',async()=>{
 for(const sameNonce of[true,false]){seed();const a=session('create_a'),b=session('create_b');try{await Promise.all([a.ready(),b.ready()]);const first=JSON.parse(await a.query(`${begin(owner)}${saveCall()};`));const secondPromise=b.query(`${begin(owner)}${saveCall(sameNonce?{}:{branchId:id(302),nonce:id(911)})};`);const outcome=sameNonce?secondPromise:assert.rejects(secondPromise,/code or request conflict/);await waitForLock('create_b');await a.query('commit;');if(sameNonce){assert.deepEqual(JSON.parse(await outcome),first);await b.query('commit;');}else await outcome;assert.equal(count('private.company_branches'),1);assert.equal(count('private.company_branch_audit'),1);}finally{a.close();b.close();}}
});
test('edit/archive races serialize both orders and reject stale loser',async()=>{
 for(const archiveFirst of[true,false]){seed();save();const a=session('edit_a'),b=session('edit_b');try{await Promise.all([a.ready(),b.ready()]);const edit=saveCall({version:1,input:{...fields,name:'New store'},nonce:id(911)}),archive=statusCall();await a.query(`${begin(owner)}${archiveFirst?archive:edit};`);const outcome=assert.rejects(b.query(`${begin(admin)}${archiveFirst?edit:archive};`),/version conflict/);await waitForLock('edit_b');await a.query('commit;');await outcome;assert.equal(list({status:archiveFirst?'archived':'active'}).branches[0].version,2);assert.equal(count('private.company_branch_audit'),2);}finally{a.close();b.close();}}
});
test('archive/reactivate status race with identical nonce replays instead of reverting current status',async()=>{
 seed();save();const a=session('status_a'),b=session('status_b');try{await Promise.all([a.ready(),b.ready()]);const first=JSON.parse(await a.query(`${begin(owner)}${statusCall()};`));const outcome=b.query(`${begin(owner)}${statusCall()};`);await waitForLock('status_b');await a.query('commit;');assert.deepEqual(JSON.parse(await outcome),first);await b.query('commit;');setStatus({version:2,status:'active',nonce:id(913)});assert.deepEqual(setStatus(),first);assert.equal(list().branches[0].version,3);}finally{a.close();b.close();}
});
test('Auth approval and company/member revocation during actual lock wait deny write',async()=>{
 for(const revoke of[`update auth.users set banned_until=now()+interval '1 day'where id='${owner}'`,`update private.account_approvals set status='suspended'where user_id='${owner}'`,`update public.companies set status='suspended'where id='${company}'`,`update public.companies set status='active'where id='${company}';update public.memberships set role='sales'where company_id='${company}'and user_id='${owner}'`]){seed();const a=session('revoke_a'),b=session('revoke_b');try{await Promise.all([a.ready(),b.ready()]);await a.query(`begin;${revoke};`);const outcome=assert.rejects(b.query(`${begin(owner)}${saveCall()};`),/denied|required/);await waitForLock('revoke_b');await a.query('commit;');await outcome;assert.equal(count('private.company_branches'),0);assert.equal(count('private.company_branch_audit'),0);}finally{a.close();b.close();}}
});
