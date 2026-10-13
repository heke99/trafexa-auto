import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createDatabase, asRole, rpc } from '../signing-ledger/helpers.mjs';
import { createSigningStore, parseStoredSigningJob } from '../../src/lib/signing/signing-store.ts';
import { createSigningWorker, hashSigningTemplate } from '../../src/lib/signing/signing-worker.ts';
import { createDocuSealClient } from '../../src/lib/signing/docuseal.ts';
import { createPrivateSigningStorage } from '../../src/lib/signing/signing-storage.ts';
import { createSigningUserBoundary } from '../../src/lib/signing/signing-user.ts';
import { applyVerifiedEvent } from '../../src/lib/signing/signing-state.ts';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const COMPANY=uuid(1), OWNER=uuid(11), VIEWER=uuid(12), DEAL=uuid(21), DOCUMENT=uuid(31);
const SERVICE_KEY='sb_secret_local_signing_fixture';
const PUBLISHABLE_KEY='sb_publishable_local_signing_fixture';
const OWNER_TOKEN='verified-owner-fixture-token', VIEWER_TOKEN='verified-viewer-fixture-token';
const SECRET=`whsec_${'A'.repeat(32)}`;
const SOURCE_PATH=`${COMPANY}/${DOCUMENT}.pdf`;
const SOURCE=Buffer.from('%PDF-1.7\nApproved purchase price: 23000\n%%EOF');
const TEMPLATE=Buffer.from('%PDF-1.7\nProvider contract with approved Price field\n%%EOF');
const SIGNED=Buffer.from('%PDF-1.7\nProvider signed purchase price: 23000\n%%EOF');
const AUDIT=Buffer.from('%PDF-1.7\nVerified signing audit evidence\n%%EOF');
const FIELD_SCHEMA=[{name:'Price',type:'text',role:'Buyer'}];
const TEMPLATE_HASH=hashSigningTemplate(TEMPLATE,FIELD_SCHEMA);
const SIGNERS=[{role:'Buyer',email:'buyer@example.com',externalId:'approved:buyer',values:{Price:23000}},
  {role:'Dealer',email:'dealer@example.com',externalId:'approved:dealer'}];
const SHA=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const CONTEXT_KEYS=['id','companyId','documentId','dealId','documentVersion','sourceSha256','templateId','templateVersion','templateSha256'];
const context=snapshot=>Object.fromEntries(CONTEXT_KEYS.map(key=>[key,snapshot[key]]));
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

// A test-only PostgREST adapter. Authentication is a fixed verified-token fixture;
// every authorization decision and mutation thereafter runs on actual PostgreSQL.
function restAdapter(db) {
  const calls=[];
  const publicRpcs=new Set(['register_signing_document_version','register_signing_template','prepare_signing_job',
    'claim_signing_job','save_signing_job','mark_expired_signing_dispatch','enqueue_signing_webhook','apply_signing_webhook']);
  const tables=new Set(['signing_jobs','signing_webhook_inbox','signing_document_versions','signing_templates','companies','memberships','documents','deals']);
  const fetchImpl=async(address,options={})=>{
    const url=new URL(address); assert.equal(url.origin,'https://supabase.test');
    const headers=new Headers(options.headers);
    let role,user=null;
    if (headers.get('apikey')===SERVICE_KEY && !headers.has('authorization')) role='service_role';
    else if (headers.get('apikey')===PUBLISHABLE_KEY) {
      const verifiedUsers=new Map([[`Bearer ${OWNER_TOKEN}`,OWNER],[`Bearer ${VIEWER_TOKEN}`,VIEWER]]);
      user=verifiedUsers.get(headers.get('authorization'));
      if (user) role='authenticated';
    }
    if (!role) return json({code:'42501'},401);
    if(url.pathname==='/auth/v1/user') {
      calls.push({role,method:options.method??'GET',route:'auth/v1/user'});
      return role==='authenticated'?json({id:user,is_anonymous:false}):json({code:'42501'},401);
    }
    const route=url.pathname.replace(/^\/rest\/v1\//,'');
    calls.push({role,method:options.method??'GET',route});
    try {
      const result=await asRole(db,role,user,async tx=>{
        if (route.startsWith('rpc/')) {
          const name=route.slice(4);
          assert.ok(publicRpcs.has(name));assert.equal(options.method,'POST');
          const args=JSON.parse(options.body);assert.ok(args&&typeof args==='object'&&!Array.isArray(args));
          const metadata=(await tx.query(`select proargnames from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname=$1`,[name])).rows[0];
          assert.ok(metadata);
          assert.ok(Object.keys(args).every(key=>metadata.proargnames.includes(key)));
          const keys=Object.keys(args);
          const placeholders=keys.map((key,index)=>`${key} => $${index+1}`).join(',');
          return (await tx.query(`select public.${name}(${placeholders}) as value`,Object.values(args))).rows[0].value;
        }
        assert.ok(tables.has(route));assert.equal(options.method??'GET','GET');
        const columnInfo=(await tx.query(`select column_name,data_type from information_schema.columns
          where table_schema='public' and table_name=$1`,[route])).rows;
        const metadata=columnInfo.map(row=>row.column_name);
        const select=(url.searchParams.get('select')??'').split(',');
        assert.ok(select.length&&select.every(column=>/^[a-z_][a-z0-9_]*$/.test(column)&&metadata.includes(column)));
        const parameters=[], predicates=[];
        for(const [column,filter] of url.searchParams) {
          if(['select','limit'].includes(column))continue;
          assert.ok(/^[a-z_][a-z0-9_]*$/.test(column)&&metadata.includes(column));assert.ok(filter.startsWith('eq.'));
          let value=filter.slice(3);
          if(columnInfo.find(info=>info.column_name===column).data_type==='boolean') {
            assert.ok(value==='true'||value==='false');value=value==='true';
          }
          parameters.push(value);predicates.push(`t.${column}=$${parameters.length}`);
        }
        assert.ok(predicates.length);
        const limit=Number(url.searchParams.get('limit')??'2');assert.ok(Number.isSafeInteger(limit)&&limit>=1&&limit<=2);
        const projection=select.map(column=>`'${column}',t.${column}`).join(',');
        const rows=await tx.query(`select jsonb_build_object(${projection}) as value from public.${route} t where ${predicates.join(' and ')} limit ${limit}`,parameters);
        return rows.rows.map(row=>row.value);
      });
      return json(result);
    } catch (error) {
      const status=error.code==='42501'?403:['40001','23505'].includes(error.code)?409:400;
      return json({code:error.code??'test_adapter_error'},status);
    }
  };
  return {fetchImpl,calls};
}

async function fixture(t,{postOutcome='ok',corruptArchive=false}={}) {
  const db=await createDatabase();t.after(()=>db.close());
  await db.query('insert into auth.users values($1),($2)',[OWNER,VIEWER]);
  await db.query('insert into public.companies(id) values($1)',[COMPANY]);
  await db.query("insert into public.memberships(company_id,user_id,role) values($1,$2,'owner'),($1,$3,'viewer')",[COMPANY,OWNER,VIEWER]);
  await db.query('insert into public.deals values($1,$2)',[COMPANY,DEAL]);
  await db.query("insert into public.documents values($1,$2,$3,'Approved contract',$4,'contract')",[DOCUMENT,COMPANY,DEAL,SOURCE_PATH]);
  await rpc(db,'service_role',null,'register_signing_template',[COMPANY,44,1,TEMPLATE_HASH,'contract',OWNER]);
  const rest=restAdapter(db);
  const store=createSigningStore({supabaseUrl:'https://supabase.test',serviceKey:SERVICE_KEY,fetchImpl:rest.fetchImpl});
  const approval=await store.registerDocumentVersion({companyId:COMPANY,documentId:DOCUMENT,documentVersion:1,
    sourceSha256:SHA(SOURCE),sourceObjectPath:SOURCE_PATH,actorUserId:OWNER,approvedSigners:clone(SIGNERS),
    templateId:44,templateVersion:1,templateSha256:TEMPLATE_HASH});
  const prepareArgs={p_company_id:COMPANY,p_document_id:DOCUMENT,p_deal_id:DEAL,p_document_version:1,
    p_source_sha256:SHA(SOURCE),p_template_id:44,p_signers:clone(SIGNERS),p_idempotency_key:randomUUID(),
    p_expected_template_version:1,p_expected_template_sha256:TEMPLATE_HASH};
  const authRpc=async(args=prepareArgs,token=OWNER_TOKEN)=>{
    const response=await rest.fetchImpl('https://supabase.test/rest/v1/rpc/prepare_signing_job',{
      method:'POST',headers:{apikey:PUBLISHABLE_KEY,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args),
    });
    return {status:response.status,body:await response.json()};
  };
  const prepared=await authRpc();assert.equal(prepared.status,200);
  const stored=await store.getJob(prepared.body.id);assert.ok(stored);
  const objects=new Map([[SOURCE_PATH,Buffer.from(SOURCE)]]);
  const uploads=[],reads=[],downloads=[],posts=[];
  let providerCompleted=false;
  const storageClient={storage:{
    async getBucket(name){assert.equal(name,'dealer-documents');return {data:{id:name,public:false},error:null};},
    from(name){assert.equal(name,'dealer-documents');return {
      async download(path){reads.push(path);return objects.has(path)?{data:new Blob([objects.get(path)]),error:null}:{data:null,error:'missing'};},
      async upload(path,bytes,options){
        assert.equal(options.upsert,false);assert.equal(options.contentType,'application/pdf');uploads.push(path);
        if(objects.has(path))return {data:null,error:'already_exists'};
        objects.set(path,corruptArchive?Buffer.from('%PDF-1.7\nCorrupted stored bytes\n%%EOF'):Buffer.from(bytes));
        return {data:{path},error:null};
      },
    };},
  }};
  const storage=createPrivateSigningStorage({client:storageClient,allowedDownloadOrigins:['https://docuseal.test'],
    fetchImpl:async(address,options)=>{
      assert.equal(options.redirect,'error');assert.equal(options.headers,undefined);downloads.push(address);
      if(address==='https://docuseal.test/artifacts/signed.pdf')return new Response(SIGNED);
      if(address==='https://docuseal.test/artifacts/audit.pdf')return new Response(AUDIT);
      throw new Error('Unexpected provider artifact');
    }});
  const providerSigner=(signer,index,status='awaiting')=>({id:101+index,submission_id:9001,status,role:signer.role,email:signer.email,
    external_id:signer.externalId,completed_at:status==='completed'?'2026-10-13T10:00:00Z':null,declined_at:null,embed_src:null});
  const provider=createDocuSealClient({baseUrl:'https://docuseal.test',apiKey:'local-docuseal-fixture-token',enabled:true,
    fetchImpl:async(address,options)=>{
      if(options.method==='POST'){
        assert.equal(address,'https://docuseal.test/submissions');
        const body=JSON.parse(options.body);posts.push(body);
        assert.equal(body.send_email,false);assert.equal(body.send_sms,false);assert.equal(body.template_id,44);
        if(postOutcome==='unknown')throw new Error('Local simulated response loss after POST');
        return json(SIGNERS.map((signer,index)=>providerSigner(signer,index)));
      }
      assert.equal(address,'https://docuseal.test/submissions/9001');
      return json({id:9001,status:providerCompleted?'completed':'pending',completed_at:providerCompleted?'2026-10-13T10:00:00Z':null,
        archived_at:null,submitters:SIGNERS.map((signer,index)=>providerSigner(signer,index,providerCompleted?'completed':'awaiting')),
        documents:[{name:'Signed contract',url:'https://docuseal.test/artifacts/signed.pdf'}],audit_log_url:'https://docuseal.test/artifacts/audit.pdf',combined_document_url:null});
    }});
  const sourceReader={async load(job){
    const source=await asRole(db,'service_role',null,async tx=>{
      const d=(await tx.query('select * from public.documents where id=$1',[job.snapshot.documentId])).rows[0];
      const c=(await tx.query('select * from public.companies where id=$1',[job.snapshot.companyId])).rows[0];
      const m=(await tx.query('select * from public.memberships where company_id=$1 and user_id=$2',[job.snapshot.companyId,job.createdBy])).rows[0];
      const version=(await tx.query('select * from public.signing_document_versions where company_id=$1 and document_id=$2 and document_version=$3',[job.snapshot.companyId,job.snapshot.documentId,job.snapshot.documentVersion])).rows[0];
      const deal=d.deal_id===null?null:(await tx.query('select * from public.deals where company_id=$1 and id=$2',[d.company_id,d.deal_id])).rows[0];
      return {d,c,m,version,deal};
    });
    const file=await storage.readPrivateObject({context:context(job.snapshot),objectPath:source.d.object_path});
    return {context:file.context,document:{id:source.d.id,companyId:source.d.company_id,dealId:source.d.deal_id,
      documentVersion:source.version.document_version,documentKind:source.d.kind,sourceObjectPath:source.d.object_path},
      company:{id:source.c.id,active:source.c.status==='active'},deal:source.deal?{id:source.deal.id,companyId:source.deal.company_id,active:true}:null,
      initiator:{id:source.m.user_id,companyId:source.m.company_id,active:source.m.status==='active',mayDispatch:['owner','admin','finance'].includes(source.m.role)},
      storageVisibility:file.storageVisibility,objectPath:file.objectPath,bytes:file.bytes,approvedSigners:source.version.approved_signers,
      templateId:Number(source.version.approved_template_id),templateVersion:source.version.approved_template_version,templateSha256:source.version.approved_template_sha256};
  }};
  const templateReader={async load(job){
    const template=await asRole(db,'service_role',null,async tx=>(await tx.query(`select * from public.signing_templates
      where company_id=$1 and template_id=$2 and template_version=$3`,[job.snapshot.companyId,job.snapshot.templateId,job.snapshot.templateVersion])).rows[0]);
    return {companyId:template.company_id,providerInstance:template.provider_instance,templateId:Number(template.template_id),templateVersion:template.template_version,
      documentKind:template.document_kind,active:template.active,bytes:TEMPLATE,fieldSchema:clone(FIELD_SCHEMA)};
  }};
  const now=Date.now();
  const worker=createSigningWorker({enabled:true,store,provider,privateSource:sourceReader,templateSource:templateReader,
    archive:storage.archive,webhookSecret:SECRET,now:()=>now});
  const callback=(type='submission.completed',sid=9001,submitter=101,metadata={companyId:'untrusted-other-company'})=>{
    const raw=Buffer.from(JSON.stringify({event_type:type,timestamp:'2026-10-13T10:00:00Z',data:type.startsWith('form.')?
      {id:submitter,submission_id:sid,metadata}:{id:sid,metadata}}));
    const stamp=Math.floor(now/1000);return {raw,signature:`${stamp}.${createHmac('sha256',SECRET).update(`${stamp}.`).update(raw).digest('hex')}`};
  };
  const receive=async(type,sid,submitter)=>{const event=callback(type,sid,submitter);return worker.receiveWebhook(event.raw,event.signature);};
  return {db,store,worker,storage,approval,job:stored,prepareArgs,authRpc,rest,objects,uploads,reads,downloads,posts,callback,receive,
    completeProvider:()=>{providerCompleted=true;}};
}

const workerError=code=>error=>error.code===code;

test('service store parser and authenticated prepare operate on real approved SQL rows',async t=>{
  const f=await fixture(t);
  assert.equal(f.approval.sourceSha256,SHA(SOURCE));assert.deepEqual(f.approval.approvedSigners,SIGNERS);
  const raw=(await f.db.query('select to_jsonb(j) as row from public.signing_jobs j where id=$1',[f.job.snapshot.id])).rows[0].row;
  assert.deepEqual(parseStoredSigningJob(raw),f.job);
  assert.equal((await f.authRpc()).body.id,f.job.snapshot.id);
  assert.equal((await f.authRpc({...f.prepareArgs,p_idempotency_key:randomUUID()})).status,409);
  const changed=clone(SIGNERS);changed[0].values.Price=1;
  assert.equal((await f.authRpc({...f.prepareArgs,p_signers:changed,p_idempotency_key:randomUUID()})).status,403);
  assert.equal((await f.authRpc(f.prepareArgs,VIEWER_TOKEN)).status,403);
  assert.ok(f.rest.calls.some(call=>call.role==='authenticated'&&call.route==='rpc/prepare_signing_job'));
  assert.equal(f.posts.length,0);
});

test('two workers race through durable PostgreSQL CAS and exactly one provider POST occurs',async t=>{
  const f=await fixture(t);
  const attempts=await Promise.allSettled([f.worker.dispatch(f.job.snapshot.id,1),f.worker.dispatch(f.job.snapshot.id,1)]);
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(attempts.filter(result=>result.status==='rejected'&&result.reason.code==='conflict').length,1);
  assert.equal(f.posts.length,1);
  const current=await f.store.getJob(f.job.snapshot.id);
  assert.equal(current.snapshot.state,'awaiting_signatures');assert.equal(current.snapshot.submissionId,9001);assert.equal(current.snapshot.version,3);
  assert.equal(current.claimToken,null);assert.equal(current.claimExpiresAt,null);
  assert.equal(f.posts[0].submitters[0].values.Price,23000);
  await assert.rejects(f.worker.dispatch(current.snapshot.id,current.snapshot.version),workerError('conflict'));
  assert.equal(f.posts.length,1);
});

test('uncertain provider outcome is persisted and neither another worker nor later retry resends',async t=>{
  const f=await fixture(t,{postOutcome:'unknown'});
  await assert.rejects(f.worker.dispatch(f.job.snapshot.id,1),workerError('outcome_unknown'));
  const unknown=await f.store.getJob(f.job.snapshot.id);
  assert.equal(unknown.snapshot.state,'outcome_unknown');assert.equal(unknown.snapshot.version,3);
  assert.equal(unknown.errorCode,'outcome_unknown');assert.ok(unknown.claimToken);assert.equal(unknown.claimExpiresAt,null);
  assert.equal((await f.authRpc()).body.id,unknown.snapshot.id);
  await assert.rejects(f.worker.dispatch(unknown.snapshot.id,unknown.snapshot.version),workerError('conflict'));
  assert.equal(f.posts.length,1);
});

test('actual source bytes and current actor authorization are checked before claim or provider calls',async t=>{
  const f=await fixture(t);
  f.objects.set(SOURCE_PATH,Buffer.from('%PDF-1.7\nTampered price\n%%EOF'));
  await assert.rejects(f.worker.dispatch(f.job.snapshot.id,1),workerError('source_mismatch'));
  assert.equal((await f.store.getJob(f.job.snapshot.id)).snapshot.state,'prepared');assert.equal(f.posts.length,0);
  f.objects.set(SOURCE_PATH,Buffer.from(SOURCE));
  await f.db.query("update public.memberships set status='suspended' where user_id=$1",[OWNER]);
  await assert.rejects(f.worker.dispatch(f.job.snapshot.id,1),workerError('source_mismatch'));
  assert.equal(f.posts.length,0);
});

test('raw HMAC reception, normalized durable inbox and actual CAS handle partial whole duplicate and unknown events',async t=>{
  const f=await fixture(t);let job=await f.worker.dispatch(f.job.snapshot.id,1);
  const invalid=f.callback('form.completed');
  await assert.rejects(f.worker.receiveWebhook(invalid.raw,invalid.signature.slice(0,-1)+(invalid.signature.endsWith('0')?'1':'0')),workerError('invalid_input'));
  assert.equal((await f.db.query('select count(*)::integer as n from public.signing_webhook_inbox')).rows[0].n,0);
  const received=await f.receive('form.completed');assert.equal(received.status,'pending');
  const inbox=await f.store.getInbox(received.inboxId);assert.equal(inbox.jobId,job.snapshot.id);
  assert.deepEqual(Object.keys(inbox.event).sort(),['entity','eventType','occurredAt','submissionId','submitterId'].sort());
  const next=applyVerifiedEvent(job.snapshot,inbox.event);
  await assert.rejects(f.store.applyWebhook({inboxId:inbox.id,expectedJobVersion:job.snapshot.version-1,snapshot:next}),error=>error.code==='conflict');
  assert.equal((await f.store.getInbox(inbox.id)).status,'pending');
  await f.worker.processWebhook(inbox.id);job=await f.store.getJob(job.snapshot.id);
  assert.equal(job.snapshot.state,'awaiting_signatures');assert.deepEqual(job.snapshot.completedSubmitterIds,[101]);
  assert.equal((await f.receive('form.completed')).inboxId,inbox.id);
  await f.worker.processWebhook(inbox.id);assert.equal((await f.store.getJob(job.snapshot.id)).snapshot.version,job.snapshot.version);
  const dealer=await f.receive('form.completed',9001,102);await f.worker.processWebhook(dealer.inboxId);
  job=await f.store.getJob(job.snapshot.id);assert.equal(job.snapshot.state,'awaiting_signatures');assert.deepEqual(job.snapshot.completedSubmitterIds,[101,102]);
  const whole=await f.receive('submission.completed');await f.worker.processWebhook(whole.inboxId);
  job=await f.store.getJob(job.snapshot.id);assert.equal(job.snapshot.state,'awaiting_archive');assert.equal(job.snapshot.archive,null);
  const unknown=await f.receive('submission.completed',9999);assert.equal(unknown.status,'quarantined');
  assert.equal((await f.store.getInbox(unknown.inboxId)).jobId,null);
  assert.equal((await f.worker.processWebhook(unknown.inboxId)).status,'quarantined');
  assert.equal(f.uploads.length,0);
});

test('whole signing completion reaches completed only after provider confirmation and private byte readback archival',async t=>{
  const f=await fixture(t);let job=await f.worker.dispatch(f.job.snapshot.id,1);
  const received=await f.receive('submission.completed');await f.worker.processWebhook(received.inboxId);job=await f.store.getJob(job.snapshot.id);
  await assert.rejects(f.worker.archiveCompleted(job.snapshot.id,job.snapshot.version),workerError('archive_invalid'));
  assert.equal((await f.store.getJob(job.snapshot.id)).snapshot.state,'awaiting_archive');assert.equal(f.uploads.length,0);
  f.completeProvider();const result=await f.worker.archiveCompleted(job.snapshot.id,job.snapshot.version);
  assert.equal(result.snapshot.state,'completed');assert.equal(result.snapshot.version,job.snapshot.version+1);
  assert.equal(f.uploads.length,2);assert.equal(f.downloads.length,2);
  const proof=result.snapshot.archive;assert.equal(proof.storageVisibility,'private');assert.equal(proof.signedPdf.sha256,SHA(SIGNED));assert.equal(proof.audit.sha256,SHA(AUDIT));
  assert.deepEqual(f.objects.get(proof.signedPdf.path),SIGNED);assert.deepEqual(f.objects.get(proof.audit.path),AUDIT);
  assert.ok(f.reads.filter(path=>path===proof.signedPdf.path).length>=2);
  const late=await f.receive('submission.expired');await f.worker.processWebhook(late.inboxId);
  assert.equal((await f.store.getJob(result.snapshot.id)).snapshot.version,result.snapshot.version);
  assert.equal((await f.worker.archiveCompleted(result.snapshot.id,result.snapshot.version)).snapshot.state,'completed');assert.equal(f.uploads.length,2);
});

test('corrupted private object readback never marks the SQL job completed',async t=>{
  const f=await fixture(t,{corruptArchive:true});let job=await f.worker.dispatch(f.job.snapshot.id,1);
  const received=await f.receive('submission.completed');await f.worker.processWebhook(received.inboxId);job=await f.store.getJob(job.snapshot.id);f.completeProvider();
  await assert.rejects(f.worker.archiveCompleted(job.snapshot.id,job.snapshot.version));
  const unchanged=await f.store.getJob(job.snapshot.id);
  assert.equal(unchanged.snapshot.state,'awaiting_archive');assert.equal(unchanged.snapshot.version,job.snapshot.version);assert.equal(unchanged.snapshot.archive,null);
});


test('authenticated user boundary uses actual RLS reads, private source bytes and approved registration, with historical template replay',async t=>{
  const f=await fixture(t);
  // Additional foundation policies exist only in this local integration fixture.
  // The real application owns them; no migration or source module is changed here.
  await f.db.exec(`
    alter table public.companies enable row level security;
    alter table public.memberships enable row level security;
    alter table public.deals enable row level security;
    create policy company_read on public.companies for select to authenticated
      using(private.has_company_role(id,array['owner','admin','finance']));
    create policy membership_read on public.memberships for select to authenticated
      using(user_id=(select auth.uid()) and status='active'
        and private.has_company_role(company_id,array['owner','admin','sales','finance','viewer']));
    create policy deal_read on public.deals for select to authenticated
      using(private.has_company_role(company_id,array['owner','admin','finance']));
    grant select on public.companies,public.memberships,public.deals to authenticated;
  `);
  const renderReads=[];
  const immutableApproval={approvalId:uuid(80),document:{id:DOCUMENT,companyId:COMPANY,dealId:DEAL,documentKind:'contract',
    documentVersion:2,sourceObjectPath:SOURCE_PATH},sourceSha256:SHA(SOURCE),approvedSigners:clone(SIGNERS),
    templateId:44,templateVersion:1,templateSha256:TEMPLATE_HASH};
  const reader={async load(expected){
    renderReads.push(expected);
    assert.equal(expected.userId,OWNER);assert.equal(expected.documentVersion,2);assert.equal(expected.templateVersion,1);
    const file=await f.storage.readPrivateObject({context:{id:immutableApproval.approvalId,companyId:COMPANY,documentId:DOCUMENT,
      dealId:DEAL,documentVersion:2,sourceSha256:immutableApproval.sourceSha256,templateId:44,templateVersion:1,templateSha256:TEMPLATE_HASH},
      objectPath:SOURCE_PATH});
    return {...clone(immutableApproval),storageVisibility:file.storageVisibility,objectPath:file.objectPath,bytes:file.bytes};
  }};
  const boundary=createSigningUserBoundary({supabaseUrl:'https://supabase.test',publishableKey:PUBLISHABLE_KEY,
    serviceStore:f.store,approvedRenderReader:reader,fetchImpl:f.rest.fetchImpl});
  const input={companyId:COMPANY,documentId:DOCUMENT,documentVersion:2,templateId:44,idempotencyKey:randomUUID()};
  const before=f.rest.calls.length;
  const result=await boundary.prepare(`Bearer ${OWNER_TOKEN}`,input);
  assert.equal(result.snapshot.state,'prepared');assert.equal(result.snapshot.documentVersion,2);
  assert.equal(result.snapshot.sourceSha256,SHA(SOURCE));assert.equal(result.snapshot.templateSha256,TEMPLATE_HASH);
  assert.equal(renderReads.length,1);
  const stored=await f.store.getJob(result.snapshot.id);assert.deepEqual(stored.signers,SIGNERS);
  const approval=(await f.db.query('select to_jsonb(v) as row from public.signing_document_versions v where document_id=$1 and document_version=2',[DOCUMENT])).rows[0].row;
  assert.deepEqual(approval.approved_signers,SIGNERS);assert.equal(approval.source_sha256,SHA(SOURCE));
  const calls=f.rest.calls.slice(before);
  assert.ok(calls.some(call=>call.route==='auth/v1/user'&&call.role==='authenticated'));
  for(const table of ['memberships','companies','documents','deals','signing_templates'])
    assert.ok(calls.some(call=>call.route===table&&call.role==='authenticated'));
  assert.ok(calls.some(call=>call.route==='rpc/register_signing_document_version'&&call.role==='service_role'));
  assert.ok(calls.some(call=>call.route==='rpc/prepare_signing_job'&&call.role==='authenticated'));
  assert.ok(f.reads.includes(SOURCE_PATH));assert.equal(f.posts.length,0);
  await assert.rejects(boundary.prepare(`Bearer ${VIEWER_TOKEN}`,input),error=>error.code==='forbidden');
  // Finance role may prepare contracts, but finance-purpose documents remain excluded.
  const financeDocument=uuid(90);
  await f.db.query("update public.memberships set role='finance' where user_id=$1",[OWNER]);
  await f.db.query("insert into public.documents values($1,$2,$3,'Finance document',$4,'finance')",
    [financeDocument,COMPANY,DEAL,`${COMPANY}/${financeDocument}.pdf`]);
  await assert.rejects(boundary.prepare(`Bearer ${OWNER_TOKEN}`,{...input,documentId:financeDocument,idempotencyKey:randomUUID()}),error=>error.code==='forbidden');
  assert.equal(renderReads.length,1);
  await f.db.query("update public.memberships set role='owner' where user_id=$1",[OWNER]);
  await rpc(f.db,'service_role',null,'register_signing_template',[COMPANY,44,2,hashSigningTemplate(TEMPLATE,[...FIELD_SCHEMA,{name:'NewField',type:'text',role:'Buyer'}]),'contract',OWNER]);
  const callCount=f.rest.calls.length;
  const replay=await boundary.prepare(`Bearer ${OWNER_TOKEN}`,input);
  assert.deepEqual(replay.snapshot,result.snapshot);assert.equal(renderReads.length,1);
  const replayCalls=f.rest.calls.slice(callCount);
  assert.ok(replayCalls.some(call=>call.route==='signing_jobs'));
  assert.ok(!replayCalls.some(call=>call.route==='rpc/register_signing_document_version'||call.route==='rpc/prepare_signing_job'));
  assert.equal((await f.db.query('select count(*)::integer as n from public.signing_jobs where document_id=$1 and document_version=2',[DOCUMENT])).rows[0].n,1);
});
