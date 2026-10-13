import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, asRole, rpc } from './helpers.mjs';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const company=uuid(1), companyB=uuid(2), owner=uuid(11), admin=uuid(12), finance=uuid(13), sales=uuid(14), viewer=uuid(15), ownerB=uuid(16);
const deal=uuid(21), deal2=uuid(22), dealB=uuid(23), document=uuid(31), purchase=uuid(32), financeDoc=uuid(33), nullContract=uuid(34), documentB=uuid(35);
const hash='a'.repeat(64), templateHash='d'.repeat(64);
const signers=()=>[{role:'Buyer',email:'buyer@example.com',externalId:'trusted:buyer'},{role:'Dealer',email:'dealer@example.com',externalId:'trusted:dealer'}];
let counter=100;
let approvedVersion=1, approvedHash=templateHash, approvedDocumentVersion=1;
const nextId=()=>uuid(counter++);
const service=(db,name,args)=>rpc(db,'service_role',null,name,args);
let sourceVersion=1000;
const keyVersions=new Map();
const prepare=async(db,args={})=>{
  const co=args.company??company, doc=args.document??document, user=args.user??owner, key=args.key??nextId();
  const cacheKey=`${co}/${user}/${key}`;
  let version=args.documentVersion??keyVersions.get(cacheKey);
  if (version===undefined) {
    version=++sourceVersion;
    await register(db,doc,co,co===companyB?ownerB:owner,version);
    keyVersions.set(cacheKey,version);
  }
  return rpc(db,'authenticated',user,'prepare_signing_job',[
    co,doc,Object.hasOwn(args,'deal')?args.deal:deal,version,args.hash??hash,args.template??44,
    args.signers??signers(),key,args.templateVersion??approvedVersion,args.templateHash??approvedHash,
  ]);
};
const register=(db,doc=document,co=company,actor=owner,version=approvedDocumentVersion,source=hash)=>service(db,'register_signing_document_version',[
  co,doc,version,source,`${co}/${doc}.pdf`,actor,signers(),doc===purchase?45:44,(doc===purchase||co===companyB)?1:approvedVersion,(doc===purchase||co===companyB)?templateHash:approvedHash,
]);
const claim=(db,job,token=nextId())=>service(db,'claim_signing_job',[job.id,job.version,token]);
const save=(db,job,snapshot,code=null,token=job.claim_token)=>service(db,'save_signing_job',[job.id,job.version,token,snapshot,code]);
const transition=(job,state,extra={})=>({...job.snapshot,...extra,state,version:job.version+1});
const bind=(db,job,sid=9001)=>save(db,job,transition(job,'awaiting_signatures',{
  submissionId:sid,submitters:[{id:sid+101,externalId:'trusted:buyer'},{id:sid+102,externalId:'trusted:dealer'}],
}));
const event=(type='submission.completed',sid=9001,submitter=null)=>({eventType:type,entity:type.startsWith('form.')?'submitter':'submission',submissionId:sid,submitterId:submitter,occurredAt:'2026-10-13T00:00:00Z'});
const enqueue=(db,payload)=>service(db,'enqueue_signing_webhook',[(counter++).toString(16).padStart(64,'0'),payload]);
const reject=async(promise,code)=>assert.rejects(promise,error=>!code||error.code===code);

await test('signing ledger on local PostgreSQL with the existing foundation model',async t=>{
  const db=await createDatabase(); t.after(()=>db.close());
  await db.query('insert into auth.users select unnest($1::uuid[])',[[owner,admin,finance,sales,viewer,ownerB]]);
  await db.query('insert into public.companies(id) values($1),($2)',[company,companyB]);
  for (const [user,role,co] of [[owner,'owner',company],[admin,'admin',company],[finance,'finance',company],[sales,'sales',company],[viewer,'viewer',company],[ownerB,'owner',companyB]])
    await db.query('insert into public.memberships(company_id,user_id,role) values($1,$2,$3)',[co,user,role]);
  for (const [id,co] of [[deal,company],[deal2,company],[dealB,companyB]]) await db.query('insert into public.deals values($1,$2)',[co,id]);
  for (const [id,co,di,kind] of [[document,company,deal,'contract'],[purchase,company,null,'purchase'],[financeDoc,company,deal,'finance'],[nullContract,company,null,'contract'],[documentB,companyB,dealB,'contract']])
    await db.query('insert into public.documents values($1,$2,$3,$4,$5,$6)',[id,co,di,'Document',`${co}/${id}.pdf`,kind]);
  for (const [co,actor,tid,kind] of [[company,owner,44,'contract'],[company,owner,45,'purchase'],[companyB,ownerB,44,'contract']])
    await service(db,'register_signing_template',[co,tid,1,templateHash,kind,actor]);
  await register(db); await register(db,purchase); await register(db,documentB,companyB,ownerB);

  await t.test('document version registration is trusted service-only and immutable',async()=>{
    await reject(rpc(db,'authenticated',owner,'register_signing_document_version',[company,document,2,hash,`${company}/${document}.pdf`,owner,signers(),44,1,templateHash]),'42501');
    await reject(asRole(db,'authenticated',owner,tx=>tx.query('insert into public.signing_document_versions(company_id,document_id,document_version,source_sha256,source_object_path,registered_by) values($1,$2,99,$3,$4,$5)',[company,document,hash,`${company}/${document}.pdf`,owner])),'42501');
    await reject(register(db,document,company,owner,1,'b'.repeat(64)),'40001');
    await reject(service(db,'register_signing_document_version',[company,document,1,hash,'other/path',owner,signers(),44,1,templateHash]),'42501');
    await reject(register(db,document,company,viewer,2),'42501');
    await reject(register(db,financeDoc),'42501');
    assert.equal((await register(db)).source_sha256,hash);
    await reject(service(db,'register_signing_document_version',[company,document,1,hash,`${company}/${document}.pdf`,owner,[{...signers()[0],values:{Price:999}},signers()[1]],44,1,templateHash]),'40001');
    for (const payload of [[{...signers()[0],values:{Price:999}},signers()[1]],[{...signers()[0],email:'attacker@example.com'},signers()[1]]])
      await reject(prepare(db,{signers:payload}),'42501');
    await reject(prepare(db,{documentVersion:2}),'40001');
    await reject(prepare(db,{hash:'b'.repeat(64)}),'40001');
  });

  await t.test('template governance and source/kind/company/deal boundaries are enforced',async()=>{
    await reject(service(db,'register_signing_template',[company,44,2,templateHash,'contract',finance]),'42501');
    await reject(service(db,'register_signing_template',[company,44,1,'b'.repeat(64),'contract',owner]),'40001');
    await reject(prepare(db,{template:999}),'42501');
    await reject(prepare(db,{template:45}),'42501');
    await reject(prepare(db,{deal:deal2}),'42501');
    await reject(prepare(db,{deal:null}),'42501');
    await reject(prepare(db,{document:documentB,deal:dealB}),'42501');
    await reject(prepare(db,{company:companyB,document:documentB,deal:dealB}),'42501');
    await reject(prepare(db,{document:financeDoc}),'42501');
    await reject(prepare(db,{document:nullContract,deal:null}),'42501');
    assert.equal((await prepare(db,{document:purchase,deal:null,template:45})).deal_id,null);
  });

  await t.test('prepare derives snapshot, preserves retries and rejects changed payloads',async()=>{
    const key=nextId(); const job=await prepare(db,{key});
    assert.equal(job.state,'prepared');assert.equal(job.version,1);assert.equal(job.created_by,owner);
    assert.equal(job.source_object_path,`${company}/${document}.pdf`);
    assert.equal(job.snapshot.templateVersion,1);assert.equal(job.snapshot.templateSha256,templateHash);
    assert.deepEqual(job.snapshot.expectedSignerExternalIds,['trusted:buyer','trusted:dealer']);
    assert.equal((await prepare(db,{key})).id,job.id);
    await reject(prepare(db,{documentVersion:job.document_version}),'23505');
    await reject(prepare(db,{user:admin,documentVersion:job.document_version}),'23505');
    await reject(prepare(db,{key,signers:[{...signers()[0],email:'changed@example.com'},signers()[1]]}),'40001');
    await reject(prepare(db,{signers:[signers()[0],signers()[0]]}),'23514');
    await reject(prepare(db,{signers:[{...signers()[0],externalId:null}]}),'23514');
    await reject(prepare(db,{signers:[{...signers()[0],email:'bad'}]}),'23514');
    await reject(prepare(db,{signers:[{...signers()[0],sendEmail:true}]}),'23514');
    await reject(prepare(db,{signers:[{...signers()[0],values:{large:'x'.repeat(65536)}}]}),'23514');
  });

  await t.test('owner admin finance can prepare; sales/viewer/anonymous cannot',async()=>{
    for (const user of [owner,admin,finance]) assert.equal((await prepare(db,{user})).created_by,user);
    for (const user of [sales,viewer,ownerB]) await reject(prepare(db,{user}),'42501');
    await reject(rpc(db,'anon',null,'prepare_signing_job',[company,document,deal,1,hash,44,signers(),nextId(),1,templateHash]),'42501');
    await db.query("update public.memberships set status='suspended' where user_id=$1",[finance]);
    await reject(prepare(db,{user:finance}),'42501');
    await db.query("update public.memberships set status='active' where user_id=$1",[finance]);
    await db.query("update public.companies set status='suspended' where id=$1",[company]);
    await reject(prepare(db),'42501');await reject(register(db),'42501');
    await db.query("update public.companies set status='active' where id=$1",[company]);
  });

  await t.test('RLS reads isolate two companies and no user can mutate jobs or access inbox',async()=>{
    const a=await prepare(db);const b=await prepare(db,{user:ownerB,company:companyB,document:documentB,deal:dealB});
    for (const [user,co] of [[owner,company],[admin,company],[finance,company],[ownerB,companyB]]) {
      const rows=(await asRole(db,'authenticated',user,tx=>tx.query('select company_id from public.signing_jobs'))).rows;
      assert.ok(rows.length>0 && rows.every(row=>row.company_id===co));
    }
    for (const user of [viewer,sales]) assert.equal((await asRole(db,'authenticated',user,tx=>tx.query('select * from public.signing_jobs'))).rows.length,0);
    await reject(asRole(db,'authenticated',owner,tx=>tx.query("update public.signing_jobs set state='completed' where id=$1",[a.id])),'42501');
    await reject(asRole(db,'authenticated',owner,tx=>tx.query('delete from public.signing_jobs where id=$1',[a.id])),'42501');
    for (const role of ['authenticated','anon']) await reject(asRole(db,role,owner,tx=>tx.query('select * from public.signing_webhook_inbox')),'42501');
    await reject(asRole(db,'anon',null,tx=>tx.query('select * from public.signing_jobs')),'42501');
    assert.notEqual(a.id,b.id);
  });

  await t.test('direct Data API prepared INSERT cannot forge status/provider/source/signers/snapshot',async()=>{
    const job=await prepare(db);
    const columns=['id','company_id','document_id','deal_id','document_version','source_sha256','source_object_path','template_id','template_version','template_sha256','document_kind','created_by','idempotency_key','snapshot','signers'];
    const base=Object.fromEntries(columns.map(column=>[column,job[column]]));
    const direct=async changes=>{
      const data={...base,id:nextId(),idempotency_key:nextId(),...changes};data.snapshot={...data.snapshot,id:data.id};
      const keys=Object.keys(data);
      return asRole(db,'authenticated',owner,tx=>tx.query(`insert into public.signing_jobs(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(data)));
    };
    await reject(direct({state:'completed'}),'42501');
    await reject(direct({provider_submission_id:9001}),'42501');
    await reject(direct({created_by:ownerB}),'42501');
    await reject(direct({source_sha256:'b'.repeat(64)}),'40001');
    await reject(direct({source_object_path:`${company}/another.pdf`}),'42501');
    await reject(direct({deal_id:deal2}),'42501');
    await reject(direct({template_sha256:'b'.repeat(64)}),'42501');
    await reject(direct({snapshot:{...job.snapshot,state:'completed'}}),'23514');
    await reject(direct({signers:[{...signers()[0],externalId:'forged'}]}),'42501');
  });

  await t.test('claims recheck active initiator and current document/template before any dispatch',async()=>{
    const retryKey=nextId();
    const job=await prepare(db,{key:retryKey});
    await db.query("update public.memberships set status='suspended' where user_id=$1",[owner]);await reject(claim(db,job),'42501');
    await db.query("update public.memberships set status='active' where user_id=$1",[owner]);
    await db.query("update public.companies set status='suspended' where id=$1",[company]);await reject(claim(db,job),'42501');
    await db.query("update public.companies set status='active' where id=$1",[company]);
    await db.query('update public.documents set deal_id=$1 where id=$2',[deal2,document]);await reject(claim(db,job),'42501');
    await db.query('update public.documents set deal_id=$1 where id=$2',[deal,document]);
    await db.query('update public.documents set object_path=$1 where id=$2',[`${company}/changed.pdf`,document]);await reject(claim(db,job),'42501');
    await db.query('update public.documents set object_path=$1 where id=$2',[`${company}/${document}.pdf`,document]);
    await service(db,'register_signing_template',[company,44,2,'e'.repeat(64),'contract',owner]);
    approvedVersion=2;approvedHash='e'.repeat(64);approvedDocumentVersion=2;
    await register(db,document,company,owner,2);
    assert.equal((await prepare(db,{key:retryKey,templateVersion:1,templateHash})).id,job.id);
    await reject(prepare(db,{templateVersion:1,templateHash}), '40001');
    await reject(claim(db,job),'42501');
    await reject(service(db,'register_signing_template',[company,44,1,templateHash,'contract',owner]),'40001');
  });

  await t.test('two workers cannot claim one version; dispatch saves require exact claim token',async()=>{
    const original=await prepare(db);const token=nextId();const claimed=await claim(db,original,token);
    assert.equal(claimed.version,2);assert.equal(claimed.state,'dispatching');
    assert.deepEqual(claimed.snapshot,{...original.snapshot,state:'dispatching',version:2});
    assert.ok(Date.parse(claimed.claim_expires_at)-Date.now()>290000);
    await reject(claim(db,original),'40001');await reject(claim(db,claimed),'23514');
    await reject(bind(db,{...claimed,claim_token:nextId()},9100),'42501');
    const bound=await bind(db,claimed,9100);assert.equal(bound.claim_token,null);assert.equal(bound.claim_expires_at,null);
    await reject(save(db,claimed,transition(claimed,'outcome_unknown'),'outcome_unknown'),'40001');
  });

  await t.test('expired lease becomes outcome_unknown and never permits a new dispatch',async()=>{
    const job=await claim(db,await prepare(db));
    await reject(service(db,'mark_expired_signing_dispatch',[job.id,job.version]),'23514');
    // Advance this one local fixture lease; production has no such client privilege.
    await db.exec('alter table public.signing_jobs disable trigger signing_validate_job');
    await db.query("update public.signing_jobs set claim_expires_at=now()-interval '1 second' where id=$1",[job.id]);
    await db.exec('alter table public.signing_jobs enable trigger signing_validate_job');
    const unknown=await service(db,'mark_expired_signing_dispatch',[job.id,job.version]);
    assert.equal(unknown.state,'outcome_unknown');assert.equal(unknown.error_code,'outcome_unknown');assert.equal(unknown.claim_token,job.claim_token);
    await reject(claim(db,unknown),'23514');await reject(service(db,'mark_expired_signing_dispatch',[unknown.id,unknown.version]),'23514');
    const reconciled=await bind(db,unknown,9200);assert.equal(reconciled.state,'awaiting_signatures');assert.equal(reconciled.claim_token,null);
  });

  await t.test('known rejection is terminal and invalid context or signer mutations are rejected',async()=>{
    const claimed=await claim(db,await prepare(db));
    const failed=await save(db,claimed,transition(claimed,'dispatch_failed'),'provider_rejected');
    assert.equal(failed.state,'dispatch_failed');assert.equal(failed.claim_token,null);
    await reject(claim(db,failed),'23514');await reject(bind(db,failed,9250),'23514');
    const bound=await bind(db,await claim(db,await prepare(db)),9300);
    for (const changes of [{companyId:companyB},{dealId:deal2},{documentVersion:99},{templateVersion:99},{sourceSha256:'b'.repeat(64)},
      {submitters:[{id:1,externalId:'trusted:buyer'},{id:2,externalId:'trusted:dealer'}]},
    ]) await reject(save(db,bound,transition(bound,'awaiting_archive',changes)),'23514');
    await reject(save(db,bound,transition(bound,'completed')),'23514');
    await reject(bind(db,await claim(db,await prepare(db)),9300),'23505');
  });

  await t.test('inbox quarantines unknown submissions and stores only normalized events',async()=>{
    const quarantined=await enqueue(db,event('submission.completed',999999));
    assert.equal(quarantined.status,'quarantined');assert.equal(quarantined.job_id,null);
    await reject(enqueue(db,{...event(),metadata:{companyId:company},email:'private@example.com'}),'23514');
    await reject(enqueue(db,event('form.completed',9001,null)),'23514');
    await reject(enqueue(db,event('submission.completed',9001,101)),'23514');
    await reject(enqueue(db,event('unknown',9001)),'23514');
    assert.equal((await service(db,'apply_signing_webhook',[quarantined.id,1,{}])).status,'quarantined');
  });

  await t.test('webhook partial/whole completion and processed marking are atomic with CAS',async()=>{
    let job=await bind(db,await claim(db,await prepare(db)),9400);
    const payload=event('form.completed',9400,9501);const body='f'.repeat(64);
    const inbox=await service(db,'enqueue_signing_webhook',[body,payload]);
    assert.equal(inbox.status,'pending');assert.equal(inbox.job_id,job.id);
    assert.equal((await service(db,'enqueue_signing_webhook',[body,payload])).id,inbox.id);
    await reject(service(db,'enqueue_signing_webhook',[body,event('form.completed',9400,9502)]),'40001');
    const signed=transition(job,'awaiting_signatures',{completedSubmitterIds:[9501]});
    await reject(service(db,'apply_signing_webhook',[inbox.id,job.version-1,signed]),'40001');
    await reject(service(db,'apply_signing_webhook',[inbox.id,job.version,transition(job,'completed')]),'23514');
    assert.equal((await db.query('select status from public.signing_webhook_inbox where id=$1',[inbox.id])).rows[0].status,'pending');
    const processed=await service(db,'apply_signing_webhook',[inbox.id,job.version,signed]);assert.equal(processed.status,'processed');
    assert.equal((await service(db,'apply_signing_webhook',[inbox.id,0,{}])).id,inbox.id);
    job=(await db.query('select to_jsonb(j) as j from public.signing_jobs j where id=$1',[job.id])).rows[0].j;
    assert.equal(job.state,'awaiting_signatures');assert.deepEqual(job.snapshot.completedSubmitterIds,[9501]);
    const duplicate=await enqueue(db,payload);await service(db,'apply_signing_webhook',[duplicate.id,job.version,job.snapshot]);
    assert.equal((await db.query('select version from public.signing_jobs where id=$1',[job.id])).rows[0].version,job.version);
    const whole=await enqueue(db,event('submission.completed',9400));
    await service(db,'apply_signing_webhook',[whole.id,job.version,transition(job,'awaiting_archive')]);
    job=(await db.query('select to_jsonb(j) as j from public.signing_jobs j where id=$1',[job.id])).rows[0].j;
    assert.equal(job.state,'awaiting_archive');assert.equal(job.snapshot.archive,null);
    const late=await enqueue(db,event('submission.expired',9400));await service(db,'apply_signing_webhook',[late.id,job.version,job.snapshot]);
    const context=Object.fromEntries(['id','companyId','documentId','dealId','documentVersion','sourceSha256','templateId','templateVersion','templateSha256'].map(key=>[key,job.snapshot[key]]));
    const archive={context,submissionId:9400,storageVisibility:'private',signedPdf:{path:`${company}/signed.pdf`,sha256:'b'.repeat(64)},audit:{path:`${company}/audit.json`,sha256:'c'.repeat(64)}};
    await reject(save(db,job,transition(job,'completed',{archive:{...archive,storageVisibility:'public'}})),'23514');
    await reject(save(db,job,transition(job,'completed',{archive:{...archive,signedPdf:{...archive.signedPdf,path:`${company}/../signed.pdf`}}})),'23514');
    const completed=await save(db,job,transition(job,'completed',{archive}));assert.equal(completed.state,'completed');
    const expiry=await enqueue(db,event('submission.expired',9400));await service(db,'apply_signing_webhook',[expiry.id,completed.version,completed.snapshot]);
    await reject(save(db,completed,transition(completed,'awaiting_signatures')),'23514');
  });

  await t.test('catalog confirms private invokers, narrow grants, RLS and no old helper escalation',async()=>{
    const tables=(await db.query("select relname,relrowsecurity from pg_class where relname in ('signing_jobs','signing_document_versions','signing_templates','signing_webhook_inbox')")).rows;
    assert.equal(tables.length,4);assert.ok(tables.every(row=>row.relrowsecurity));
    const functions=(await db.query("select proname,prosecdef,proconfig from pg_proc where proname like '%signing%'")).rows;
    assert.equal(functions.length,9);assert.ok(functions.every(row=>!row.prosecdef&&row.proconfig.includes('search_path=""')));
    assert.equal((await db.query("select has_function_privilege('service_role','private.has_company_role(uuid,text[])','EXECUTE') as allowed")).rows[0].allowed,false);
    for (const fn of ['claim_signing_job(uuid,integer,uuid)','save_signing_job(uuid,integer,uuid,jsonb,text)','enqueue_signing_webhook(text,jsonb)','apply_signing_webhook(uuid,integer,jsonb)','register_signing_template(uuid,bigint,integer,text,text,uuid)'])
      for (const role of ['authenticated','anon']) assert.equal((await db.query('select has_function_privilege($1,$2,$3) as allowed',[role,`public.${fn}`,'EXECUTE'])).rows[0].allowed,false);
    for (const table of ['signing_jobs','signing_document_versions','signing_templates','signing_webhook_inbox'])
      assert.equal((await db.query('select has_table_privilege($1,$2,$3) as allowed',['authenticated',`public.${table}`,'UPDATE'])).rows[0].allowed,false);
  });
});
