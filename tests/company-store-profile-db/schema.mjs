import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,test} from 'node:test';
import {bootstrap,sql,session,id,owner,otherOwner,admin,newOwner,companyA,companyB,legacy,fields,seed,asUser,get,saveCall,save,createCall,create,exportCall,prepare,readExport,counts,waitForLock,value} from './helpers.mjs';
// Native PostgreSQL 17.6 multi-session proof. The local Auth/Storage catalogs
// and cron scheduler are explicit test models. No external API or worker runs.
before(bootstrap);
const begin=user=>`begin;set local role authenticated;set local request.jwt.claim.sub='${user}';`;

test('hosted rollback proof leaves no synthetic users, companies or module records',async()=>{
 sql(await readFile(new URL('../../supabase/tests/company_store_profile.sql',import.meta.url),'utf8'));
 for(const table of ['auth.users','public.companies','private.company_store_profile_versions','private.company_store_profile_heads','private.company_store_exports','private.company_store_requests'])assert.equal(sql(`select count(*)from ${table}`),'0');
});

test('new verified approved dealer atomically creates company, owner, profile and stable receipt without prior membership',()=>{
 seed();const before=counts(),r=create();assert.equal(r.role,'owner');assert.equal(r.profile.version,1);assert.equal(r.source.legalName,'New verified dealer');assert.equal(r.source.organisationNumber,'5568554884');assert.deepEqual(r.source.shop,fields);assert.deepEqual(create(),r);
 const now=counts();assert.equal(now.companies,before.companies+1);assert.equal(now.members,before.members+1);assert.equal(now.versions,1);assert.equal(now.requests,1);assert.equal(now.outbox,before.outbox);assert.equal(now.connections,before.connections);
 const another=create({name:'Additional legal company',request:id(904)},owner);assert.notEqual(another.companyId,companyA);assert.equal(another.role,'owner');assert.equal(another.source.organisationNumber,'5568554884');
 assert.throws(()=>create({name:'Changed retry'}),/payload conflict/);
 for(const patch of[{org:'5568554885'},{org:'0000000000'},{org:null},{ack:false},{ack:null},{name:'x'},{name:'\nName'},{input:{...fields,secret:'forbidden'}}])assert.throws(()=>create({...patch,request:id(905)}),/Invalid|acknowledgement/);
});

test('owner/admin only for every new private read/write; foreign, finance, sales, viewer, pending, unverified, revoked, customer and service denied',()=>{
 seed();const s=save(),e=prepare(s);
 for(const user of [otherOwner,id(4),id(5),id(6),id(8),id(9),id(10),id(11),id(12)]){
  for(const call of[`select public.get_company_store_profile('${companyA}')`,saveCall({version:1,request:id(910)}),exportCall(s,{request:id(911)}),`select public.get_company_store_export('${companyA}','${e.export.id}')`])assert.throws(()=>asUser(user,call),/denied|required/);
 }
 assert.throws(()=>get({company:companyB}),/denied/);assert.throws(()=>readExport(e.export.id,{company:companyB,user:otherOwner}),/denied/);
 assert.equal(get({user:admin}).profile.actorLabel,'Kollega');assert.equal(readExport(e.export.id,{user:admin}).export.actorLabel,'Kollega');
 for(const role of ['anon','service_role'])for(const call of [`select public.get_company_store_profile('${companyA}')`,createCall(),saveCall(),exportCall(s),`select public.get_company_store_export('${companyA}','${e.export.id}')`])assert.throws(()=>sql(`set role ${role};${call}`),/permission denied/);
 for(const role of ['anon','authenticated','service_role'])for(const table of ['company_store_profile_versions','company_store_profile_heads','company_store_exports','company_store_requests'])assert.throws(()=>sql(`set role ${role};select * from private.${table}`),/permission denied/);
 for(const user of [id(8),id(9),id(12)])assert.throws(()=>create({request:id(912)},user),/required/);
});

test('closed canonical JSON fields, complete contact, bounds, Unicode code points and multiline trim/control parity',()=>{
 seed();const before=counts();const invalid=[null,[],{},'bad',{...fields,extra:'secret'},{...fields,displayName:2},{...fields,displayName:'x'},{...fields,addressLine1:''},{...fields,addressLine2:''},{...fields,countryCode:'NO'},{...fields,postalCode:'111 22'},{...fields,publicEmail:'UPPER@trafexa.se'},{...fields,publicEmail:'not-email'},{...fields,publicEmail:'a\u00a0b@trafexa.se'},{...fields,publicEmail:'a\ufeffb@trafexa.se'},{...fields,publicPhone:'abc1234567'},{...fields,publicPhone:'+1234567890123456'},{...fields,description:'x'.repeat(5001)},{...fields,description:'\nButik'},{...fields,description:'Butik\t'},{...fields,displayName:'\u00a0Butik'},{...fields,description:'Butik\u0085öppet'},{...fields,city:'S\nT'}];
 for(const input of invalid)assert.throws(()=>save({input}),/Invalid store profile/);
 assert.deepEqual(counts(),before);
 const unicode=save({input:{...fields,description:'😀'.repeat(5000),displayName:'Åäö 🚘 butik'}});assert.equal([...unicode.profile.fields.description].length,5000);assert.equal(unicode.profile.fields.displayName,'Åäö 🚘 butik');
});

test('canonical HTTPS public DNS names and paths only, with URL parser edge cases rejected on raw SQL entry',()=>{
 seed();const bad=['http://trafexa.se/','https://trafexa.se','https://TRAFEXA.se/','https://user@trafexa.se/','https://trafexa.se:443/','https://trafexa.se:8443/','https://trafexa.se/?','https://trafexa.se/#','https://127.0.0.1/','https://127.0.0x1/','https://dealer.0xff/','https://[::1]/','https://xn--a.se/','https://xn--bilar-qra.se/','https://localhost/','https://dealer.local/','https://dealer.internal/','https://dealer.home.arpa/','https://example.com/','https://dealer.invalid/','https://trafexa.se./','https://dealer/','https://-bad.se/','https://bad-.se/','https://bad..se/','https://trafexa.se/a b','https://trafexa.se/a\\b','https://trafexa.se/å','https://trafexa.se/%zz','https://trafexa.se/%0d','https://trafexa.se/%7F','https://trafexa.se/%5c','https://trafexa.se/a/../b','https://trafexa.se/%2E%2e/b','https://trafexa.se/a`b'];
 for(const websiteUrl of bad)assert.throws(()=>save({input:{...fields,websiteUrl}}),/Invalid store profile/,websiteUrl);
 assert.equal(counts().versions,0);
 const valid=save({input:{...fields,websiteUrl:'https://bilar.trafexa.se/bilar/%C3%A5',logoUrl:'https://cdn.trafexa.se/logo.png'}});assert.equal(valid.profile.fields.logoUrl,'https://cdn.trafexa.se/logo.png');
});

test('profile CAS, exact same-payload retries and immutable historical source survive later profile and legal identity changes',()=>{
 seed();const first=save(),next=save({version:1,input:{...fields,displayName:'Second version'},request:id(904)},admin);assert.equal(next.profile.version,2);assert.equal(get().profile.actorLabel,'Kollega');
 assert.throws(()=>save({request:id(905)}),/version conflict/);assert.throws(()=>save({input:{...fields,displayName:'Changed retry'}}),/payload conflict/);assert.deepEqual(save(),first);
 sql(`update public.companies set name='Changed legal name' where id='${companyA}'`);const current=get();assert.equal(current.profile.version,2);assert.notEqual(current.sourceSha256,next.sourceSha256);assert.equal(current.source.legalName,'Changed legal name');assert.deepEqual(save(),first);
 for(const statement of [`update private.company_store_profile_versions set fields='{}'`,`delete from private.company_store_requests`])assert.throws(()=>sql(statement),/immutable/);
});

test('reviewed exports freeze exact UTF-8 canonical bytes/hash and source, use both version and legal identity CAS, and never assert delivery',()=>{
 seed();const s=save(),e=prepare(s);assert.equal(e.export.exportSha256,createHash('sha256').update(e.export.canonicalContent,'utf8').digest('hex'));assert.deepEqual(JSON.parse(e.export.canonicalContent),{schemaVersion:1,kind:'trafexa_store_profile',channel:'blocket',purpose:'new_store',profile:s.source});assert.equal(e.export.status,'prepared');assert.deepEqual(e.export.snapshot,s.source);assert.deepEqual(prepare(s),e);
 assert.throws(()=>prepare(s,{hash:'0'.repeat(64),request:id(920)}),/source identity conflict/);
 for(const patch of[{channel:'custom'},{purpose:'send'},{ack:false},{attestation:'old'},{hash:'invalid'}])assert.throws(()=>prepare(s,{...patch,request:id(920)}),/Invalid reviewed export/);
 sql(`update public.companies set name='Changed legal entity name' where id='${companyA}'`);assert.throws(()=>prepare(s,{request:id(921)}),/source identity conflict/);assert.deepEqual(prepare(s),e);
 sql(`update public.companies set organisation_number='0000000000' where id='${companyA}'`);const invalid=get();assert.equal(invalid.canExport,false);assert.equal(invalid.reason,'invalid_organisation_number');assert.throws(()=>prepare(invalid,{request:id(922)}),/Invalid organisation/);assert.deepEqual(prepare(s),e);assert.deepEqual(readExport(e.export.id).export,e.export);
 assert.throws(()=>sql('delete from private.company_store_exports'),/immutable/);
});

test('legacy invalid org stays readable and can save a full profile but cannot prepare export; latest history is bounded to 20',()=>{
 seed();const missing=get({company:legacy});assert.equal(missing.identityValid,false);assert.equal(missing.reason,'profile_missing');assert.equal(missing.source,null);
 const legacyReceipt=save({company:legacy,request:id(905)});const page=get({company:legacy});assert.equal(page.identityValid,false);assert.equal(page.reason,'invalid_organisation_number');assert.ok(page.sourceSha256);assert.throws(()=>prepare(legacyReceipt),/Invalid organisation/);
 const s=save();const exports=[];for(let n=0;n<22;n++)exports.push(prepare(s,{request:id(1000+n),channel:n%2?'wayke':'blocket',purpose:n%2?'existing_store':'new_store'}).export);
 const latest=get().exports;assert.equal(latest.length,20);assert.deepEqual(latest.map(x=>x.id),exports.slice(-20).reverse().map(x=>x.id));assert.equal(readExport(exports[0].id).export.id,exports[0].id);
});

test('fresh approval/company/membership gates apply even to exact historic create/save/export retries and current role is returned',()=>{
 seed();const c=create();sql(`update public.memberships set role='admin' where company_id='${c.companyId}' and user_id='${newOwner}'`);assert.equal(create().role,'admin');
 const s=save(),e=prepare(s);
 for(const [suspend,restore]of [[`update private.account_approvals set status='suspended' where user_id='${owner}'`,`update private.account_approvals set status='approved' where user_id='${owner}'`],[`update public.memberships set status='suspended' where company_id='${companyA}' and user_id='${owner}'`,`update public.memberships set status='active' where company_id='${companyA}' and user_id='${owner}'`],[`update public.companies set status='suspended' where id='${companyA}'`,`update public.companies set status='active' where id='${companyA}'`]]){sql(suspend);for(const action of [()=>get(),()=>save(),()=>prepare(s),()=>readExport(e.export.id)])assert.throws(action,/denied|required/);sql(restore);}
 sql(`update public.memberships set status='suspended' where company_id='${c.companyId}' and user_id='${newOwner}'`);assert.throws(()=>create(),/denied/);
});

test('a failing immutable request insert rolls back new company, owner, profile, head and export as one transaction',()=>{
 seed();sql(`create function private.store_profile_test_failure()returns trigger language plpgsql as $$begin raise exception 'Injected receipt failure';end$$;create trigger store_profile_test_failure before insert on private.company_store_requests for each row execute function private.store_profile_test_failure();`);
 try{const before=counts();assert.throws(()=>create(),/Injected/);assert.deepEqual(counts(),before);assert.throws(()=>save(),/Injected/);assert.deepEqual(counts(),before);}finally{sql('drop trigger store_profile_test_failure on private.company_store_requests;drop function private.store_profile_test_failure();');}
 const s=save(),before=counts();sql(`create function private.store_profile_test_failure()returns trigger language plpgsql as $$begin raise exception 'Injected receipt failure';end$$;create trigger store_profile_test_failure before insert on private.company_store_requests for each row execute function private.store_profile_test_failure();`);
 try{assert.throws(()=>prepare(s),/Injected/);assert.deepEqual(counts(),before);}finally{sql('drop trigger store_profile_test_failure on private.company_store_requests;drop function private.store_profile_test_failure();');}
});

test('two real PostgreSQL sessions with the same create nonce converge on exactly one company/owner/profile',async()=>{
 seed();const a=session('create_a'),b=session('create_b');await a.ready();await b.ready();try{
  const first=JSON.parse(await a.query(`${begin(newOwner)}${createCall()};`));const pending=b.query(`${begin(newOwner)}${createCall()};`);await waitForLock('create_b');await a.query('commit;');const second=JSON.parse(await pending);await b.query('commit;');assert.deepEqual(second,first);assert.equal(counts().companies,4);assert.equal(counts().versions,1);assert.equal(counts().requests,1);
 }finally{a.close();b.close();}
});

test('first-profile save races serialize the absent head and reject the stale loser without duplicate versions',async()=>{
 seed();const a=session('first_a'),b=session('first_b');await a.ready();await b.ready();try{
  await a.query(`${begin(owner)}${saveCall()};`);const pending=assert.rejects(b.query(`${begin(admin)}${saveCall({request:id(950)})};`),/version conflict/);await waitForLock('first_b');await a.query('commit;');await pending;assert.equal(counts().versions,1);assert.equal(counts().heads,1);assert.equal(counts().requests,1);
 }finally{a.close();b.close();}
});

test('export and profile-save locks serialize both orders; export first freezes old bytes and save first rejects stale export',async()=>{
 for(const exportFirst of [true,false]){seed();const s=save(),a=session('head_a'),b=session('head_b');await a.ready();await b.ready();try{
  if(exportFirst){const e=JSON.parse(await a.query(`${begin(owner)}${exportCall(s)};`));const pending=b.query(`${begin(admin)}${saveCall({version:1,input:{...fields,displayName:'Updated'},request:id(951)})};`);await waitForLock('head_b');await a.query('commit;');await pending;await b.query('commit;');assert.deepEqual(readExport(e.export.id).export.snapshot,s.source);assert.equal(get().profile.version,2);}
  else{await a.query(`${begin(admin)}${saveCall({version:1,input:{...fields,displayName:'Updated'},request:id(951)})};`);const pending=assert.rejects(b.query(`${begin(owner)}${exportCall(s)};`),/version conflict/);await waitForLock('head_b');await a.query('commit;');await pending;assert.equal(counts().exports,0);}
 }finally{a.close();b.close();}}
});

test('company/team revocation serializes with module work in both lock orders, denying the operation when revocation wins first',async()=>{
 for(const revokeFirst of [true,false]){seed();const a=session('revoke_a'),b=session('revoke_b');await a.ready();await b.ready();const revoke=`select 1 from public.companies where id='${companyA}' for update;update public.memberships set status='suspended' where company_id='${companyA}' and user_id='${owner}';`;try{
  if(revokeFirst){await a.query(`begin;${revoke}`);const pending=assert.rejects(b.query(`${begin(owner)}${saveCall()};`),/denied/);await waitForLock('revoke_b');await a.query('commit;');await pending;assert.equal(counts().versions,0);}
  else{await a.query(`${begin(owner)}${saveCall()};`);const pending=b.query(`begin;${revoke}`);await waitForLock('revoke_b');await a.query('commit;');await pending;await b.query('commit;');assert.equal(counts().versions,1);assert.throws(()=>get(),/denied/);}
 }finally{a.close();b.close();}}
});

test('privileged legal-identity updates and reviewed export serialize in both orders without changing frozen history',async()=>{
 for(const identityFirst of [true,false]){seed();const s=save(),a=session('identity_a'),b=session('identity_b');await a.ready();await b.ready();const update=`update public.companies set name='New legal name' where id='${companyA}';`;try{
  if(identityFirst){await a.query(`begin;${update}`);const pending=assert.rejects(b.query(`${begin(owner)}${exportCall(s)};`),/source identity conflict/);await waitForLock('identity_b');await a.query('commit;');await pending;assert.equal(counts().exports,0);}
  else{const e=JSON.parse(await a.query(`${begin(owner)}${exportCall(s)};`));const pending=b.query(`begin;${update}`);await waitForLock('identity_b');await a.query('commit;');await pending;await b.query('commit;');assert.deepEqual(readExport(e.export.id).export.snapshot,s.source);assert.notEqual(get().sourceSha256,s.sourceSha256);}
 }finally{a.close();b.close();}}
});
