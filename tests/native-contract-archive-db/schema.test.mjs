import assert from 'node:assert/strict';
import {before,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {bootstrap,sql,session,id,companyA,companyB,owner,admin,finance,buyer,seed,asUser,get,paths,objectInsert,upload,registerCall,register,objectCount,waitForLock} from './helpers.mjs';

// PostgreSQL 17.6 exercises real grants/RLS/locks. Auth/Storage catalogs and cron
// are local fixtures only: these tests do not claim actual Storage API byte IO.
before(bootstrap);

test('the hosted-safe real native signing rollback proof passes without Storage object writes or leftover accounts',async()=>{
 const source=await readFile(new URL('../../supabase/tests/native_contract_archive.sql',import.meta.url),'utf8');
 assert.match(sql(source),/PASS: native completed source/);
 assert.equal(sql('select count(*) from auth.users;'),'0');assert.equal(sql('select count(*) from public.companies;'),'0');
 assert.equal(sql('select count(*) from storage.objects;'),'0');
});

test('only owner/admin upload exact completed tenant paths; orphan reads remain limited to their authorized uploader',()=>{
 const [s,foreign,pending]=seed(),p=paths(s);
 for(const user of [finance,id(5),id(6),buyer,id(2),id(9),id(10),id(11),id(12)]){
  assert.throws(()=>asUser(user,objectInsert(p.pdf,user)),/row-level security/);
 }
 for(const path of [paths(foreign).pdf,paths(pending).pdf,p.pdf.replace(companyA,companyB),`${p.pdf}/extra`,p.pdf.toUpperCase(),p.pdf.replace('/v1/','/v2/'),p.pdf.replace('signed-','original-')]){
  assert.throws(()=>asUser(owner,objectInsert(path)),/row-level security/);
 }
 upload(s);assert.equal(objectCount(owner,p),2);
 for(const user of [admin,finance,buyer,id(2),id(5),id(6),id(9),id(11)])assert.equal(objectCount(user,p),0);
 const other=paths(s,'d'.repeat(64),'e'.repeat(64));asUser(admin,objectInsert(other.pdf,admin));assert.equal(objectCount(admin,other),1);assert.equal(objectCount(owner,other),0);
 assert.equal(get(s).archive,null);assert.equal(get(s,buyer,null).archive,null);
});

test('service-only registration derives exact DTO and grants registered paths to finance/customer while later uploads are denied',()=>{
 const [s]=seed(),p=upload(s),saved=register(s);
 assert.deepEqual(Object.keys(saved).sort(),['actorId','archive','companyId','signingId']);
 assert.equal(saved.actorId,owner);assert.equal(saved.companyId,companyA);assert.equal(saved.signingId,s.id);
 const a=saved.archive;assert.deepEqual(Object.keys(a).sort(),['archivedAt','companyId','dealId','documentContentSha256','draftId','draftVersion','evidence','evidenceSchemaVersion','id','pdf','rendererVersion','signingId','signingRevision']);
 assert.equal(a.documentContentSha256,s.hash);assert.equal(a.signingRevision,3);assert.equal(a.rendererVersion,'trafexa-native-v1');assert.equal(a.evidenceSchemaVersion,1);
 assert.deepEqual(a.pdf,{objectPath:p.pdf,sha256:'b'.repeat(64),bytes:20,mimeType:'application/pdf'});
 assert.deepEqual(a.evidence,{objectPath:p.evidence,sha256:'c'.repeat(64),bytes:40,mimeType:'application/json'});
 assert.ok(!JSON.stringify(a).includes(owner));
 for(const user of [owner,admin,finance,buyer])assert.equal(objectCount(user,p),2);
 assert.deepEqual(get(s,finance).archive,a);assert.deepEqual(get(s,buyer,null).archive,a);
 for(const user of [id(2),id(5),id(6),id(8),id(9),id(10),id(11),id(12)])assert.equal(objectCount(user,p),0);
 assert.throws(()=>asUser(owner,objectInsert(paths(s,'a'.repeat(64)).pdf)),/row-level security/);
 assert.throws(()=>asUser(owner,registerCall(s)),/permission denied/);
 assert.throws(()=>sql(`set role anon; ${registerCall(s)}`),/permission denied/);
});

test('wrong source/revision/renderer, incomplete/foreign/revoked actors and missing or malformed object metadata cannot register',()=>{
 const [s,foreign,pending]=seed(),p=paths(s);
 for(const actor of [finance,id(5),id(6),buyer,id(2),id(9),id(10),id(11),id(12)])assert.throws(()=>register(s,{actor}),/denied|required/);
 assert.throws(()=>register(foreign),/denied/);assert.throws(()=>register(pending),/Completed/);
 for(const options of [{hash:'0'.repeat(64)},{revision:2},{renderer:'trafexa-native-v2'},{pdfBytes:52428801},{evidenceBytes:1048577},{pdf:'not-a-hash'},{pdfBytes:4},{evidenceBytes:1}])assert.throws(()=>register(s,options),/Invalid native archive/);
 assert.throws(()=>register(s),/object unavailable/);
 asUser(owner,objectInsert(p.pdf));assert.throws(()=>register(s),/object unavailable/);
 asUser(owner,objectInsert(p.evidence,owner,40,'application/json'));
 for(const metadata of ["'{}'::jsonb","jsonb_build_object('size',21,'mimetype','application/pdf')","jsonb_build_object('size','20','mimetype','application/pdf')","jsonb_build_object('size',20,'mimetype','image/png')","jsonb_build_object('size',20,'mimetype','application/pdf','contentType','text/html')"]){
  sql(`update storage.objects set metadata=${metadata} where name='${p.pdf}'`);assert.throws(()=>register(s),/metadata mismatch/);
 }
 assert.equal(sql('select count(*) from private.contract_signing_archives;'),'0');
 sql(`update storage.objects set metadata=jsonb_build_object('size',20,'mimetype','application/pdf') where name='${p.pdf}'`);
 assert.equal(register(s).archive.signingId,s.id);
});

test('private bucket is checked on every null, saved read and registration retry; fresh approval and membership still gate saved receipts',()=>{
 const [s]=seed();
 sql("update storage.buckets set public=true where id='native-contract-originals'");assert.throws(()=>get(s),/archive unavailable/);
 sql("update storage.buckets set public=false where id='native-contract-originals'");upload(s);register(s);
 sql("update storage.buckets set public=true where id='native-contract-originals'");assert.throws(()=>get(s),/archive unavailable/);assert.throws(()=>register(s),/archive unavailable/);
 assert.equal(objectCount(buyer,paths(s)),0);
 sql("update storage.buckets set public=false where id='native-contract-originals'");
 sql(`update private.account_approvals set status='suspended' where user_id='${owner}'`);
 assert.throws(()=>get(s),/approval required/);assert.throws(()=>register(s),/approval required/);
 sql(`update private.account_approvals set status='approved' where user_id='${owner}';update public.memberships set status='suspended' where user_id='${owner}' and company_id='${companyA}'`);
 assert.throws(()=>register(s),/denied/);assert.throws(()=>get(s),/denied/);
 assert.equal(get(s,buyer,null).archive.signingId,s.id);
});

test('metadata, request audit and original objects remain immutable even with an unrelated permissive ordinary-file policy',()=>{
 const [s]=seed(),p=upload(s);register(s);
 for(const table of ['contract_signing_archives','contract_archive_requests']){
  assert.throws(()=>sql(`delete from private.${table}`),/Immutable contract source/);
  assert.throws(()=>sql(`update private.${table} set ${table==='contract_signing_archives'?'pdf_bytes=21':'created_at=now()'}`),/Immutable contract source/);
  for(const role of ['anon','authenticated','service_role'])assert.throws(()=>sql(`set role ${role};select * from private.${table}`),/permission denied/);
 }
 sql('create policy native_test_broad_update on storage.objects for update to authenticated using(true) with check(true);create policy native_test_broad_delete on storage.objects for delete to authenticated using(true)');
 try{
  assert.equal(asUser(owner,`with changed as(update storage.objects set metadata='{}' where bucket_id='native-contract-originals' returning id)select count(*) from changed`),'0');
  assert.equal(asUser(owner,`with removed as(delete from storage.objects where bucket_id='native-contract-originals' returning id)select count(*) from removed`),'0');
  assert.equal(objectCount(owner,p),2);
  asUser(owner,`insert into storage.objects(bucket_id,name,owner_id)values('dealer-documents','${companyA}/ordinary.pdf','${owner}')`);
  assert.throws(()=>asUser(owner,`update storage.objects set bucket_id='native-contract-originals',name='${p.pdf}' where bucket_id='dealer-documents'`),/row-level security/);
 }finally{sql('drop policy native_test_broad_update on storage.objects;drop policy native_test_broad_delete on storage.objects');}
});

test('a competing bundle and lost-response retry retain the first original, while cross-signing request reuse conflicts',()=>{
 const [s,,pending]=seed();upload(s);const first=register(s);
 const again=register(s,{actor:admin,request:id(902),pdf:'d'.repeat(64),evidence:'e'.repeat(64)});
 assert.deepEqual(again.archive,first.archive);assert.deepEqual(register(s),first);
 assert.equal(sql('select count(*) from private.contract_signing_archives;'),'1');assert.equal(sql('select count(*) from private.contract_archive_requests;'),'2');
 // Completing the other own-company signing uses the actual two party RPCs.
 const strokes=JSON.stringify([{points:[{x:0,y:0},{x:5,y:20},{x:10,y:0}]}]);
 asUser(buyer,`select public.sign_contract('${pending.id}',null,1,'${pending.hash}','Native Buyer','${strokes}'::jsonb,true,'2026-10-14','${id(910)}')`);
 asUser(owner,`select public.sign_contract('${pending.id}','${companyA}',2,'${pending.hash}','Native Owner','${strokes}'::jsonb,true,'2026-10-14','${id(911)}')`);
 assert.throws(()=>register(pending),/request conflict/);

});

test('two real service sessions serialize on signing and return one first-wins artifact to different actors',async()=>{
 const [s]=seed();upload(s);upload(s,admin,'d'.repeat(64),'e'.repeat(64));
 const first=session('first_register'),second=session('second_register');
 try{
  await first.ready();await second.ready();
  const a=JSON.parse(await first.query(`begin;set local role service_role;${registerCall(s)};`));
  const waiting=second.query(`begin;set local role service_role;${registerCall(s,{actor:admin,request:id(902),pdf:'d'.repeat(64),evidence:'e'.repeat(64)})};`);
  await waitForLock('second_register');await first.query('commit;');const b=JSON.parse(await waiting);await second.query('commit;');
  assert.deepEqual(a.archive,b.archive);assert.equal(sql('select count(*) from private.contract_signing_archives;'),'1');
 }finally{first.close();second.close();}
});

test('upload and register serialize in both orders, with queued post-archive uploads refused',async()=>{
 for(const uploadFirst of [true,false]){
  const [s]=seed(),p=paths(s);if(!uploadFirst)upload(s);
  const uploader=session('racing_upload'),registrar=session('racing_register');
  try{
   await uploader.ready();await registrar.ready();
   if(uploadFirst){
    await uploader.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${owner}';${objectInsert(p.pdf)};${objectInsert(p.evidence,owner,40,'application/json')};`);
    const waiting=registrar.query(`begin;set local role service_role;${registerCall(s)};`);await waitForLock('racing_register');await uploader.query('commit;');
    assert.equal(JSON.parse(await waiting).archive.signingId,s.id);await registrar.query('commit;');
   }else{
    await registrar.query(`begin;set local role service_role;${registerCall(s)};`);
    const waiting=uploader.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${owner}';${objectInsert(paths(s,'d'.repeat(64)).pdf)};`);
    await waitForLock('racing_upload');await registrar.query('commit;');await assert.rejects(waiting,/row-level security/);
   }
   assert.equal(sql('select count(*) from private.contract_signing_archives;'),'1');
  }finally{uploader.close();registrar.close();}
 }
});

test('an in-flight company, membership or account revocation is rechecked after real row-lock waits',async()=>{
 for(const change of [`update public.companies set status='suspended' where id='${companyA}'`,`update public.memberships set status='suspended' where company_id='${companyA}' and user_id='${owner}'`,`update private.account_approvals set status='suspended' where user_id='${owner}'`]){
  const [s]=seed();upload(s);const revoke=session('revocation'),registrar=session('revoked_register');
  try{
   await revoke.ready();await registrar.ready();await revoke.query(`begin;${change};`);
   const waiting=registrar.query(`begin;set local role service_role;${registerCall(s)};`);await waitForLock('revoked_register');await revoke.query('commit;');
   await assert.rejects(waiting,/denied|approval required/);assert.equal(sql('select count(*) from private.contract_signing_archives;'),'0');
  }finally{revoke.close();registrar.close();}
 }
});

test('actual native signature replay holds deal before signing and cannot deadlock archive registration',async()=>{
 const [s]=seed();upload(s);
 const old=JSON.parse(sql(`select jsonb_build_object('request',request_id,'payload',payload) from private.contract_signing_audit where actor_user_id='${owner}' and payload->>'signingId'='${s.id}' and payload->>'operation'='signContract' and payload->>'expectedRevision'='2'`));
 const signing=session('native_signature'),registrar=session('native_register');
 try{
  await signing.ready();await registrar.ready();
  await signing.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${owner}';select public.sign_contract('${s.id}','${companyA}',2,'${s.hash}','Native Owner','${JSON.stringify(old.payload.strokes)}'::jsonb,true,'2026-10-14','${old.request}');`);
  const waiting=registrar.query(`begin;set local role service_role;${registerCall(s)};`);await waitForLock('native_register');await signing.query('commit;');
  assert.equal(JSON.parse(await waiting).archive.signingId,s.id);await registrar.query('commit;');
 }finally{signing.close();registrar.close();}
});
