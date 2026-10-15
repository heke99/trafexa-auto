import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {sql,session,waitForLock,repository,restoreFixture} from './native-helpers.mjs';

// --reuse is a development aid confined to this runner's synthetic database and cache.
// The normal command always recreates the fixed local database and authentic sources.
const reuse=process.argv.includes('--reuse');
const f=reuse?JSON.parse(await readFile('/tmp/trafexa-invoice-email-native-fixtures.json','utf8')):await import('./native-fixtures.mjs');
if(reuse)restoreFixture();
const {admin,owner,companies,originals,credit}=f;
const originalBytes=reuse?f.originalBytes.map(b=>Buffer.from(b,'base64')):f.originalBytes;
const creditBytes=reuse?Buffer.from(f.creditBytes,'base64'):f.creditBytes;
const id=n=>`ee550000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const digest=s=>createHash('sha256').update(s).digest('hex');
const lit=v=>v===null?'null':typeof v==='boolean'||typeof v==='number'?String(v):`'${(typeof v==='string'?v:JSON.stringify(v)).replaceAll("'","''")}'`;
const bind=(q,args)=>q.replace(/\$(\d+)/g,(_,n)=>lit(args[Number(n)-1]));
const as=(actor,body,role='authenticated')=>`begin;set local role ${role};set local request.jwt.claim.sub=${lit(actor??'')};set local request.jwt.claims=${lit({role})};${body};commit;`;
const call=(q,args=[],actor=admin,role='authenticated')=>JSON.parse(sql(as(actor,bind(q,args),role)));
const upgrades=(await readdir(new URL('supabase/migrations/',repository))).filter(n=>n.includes('_advertising_invoice_email_')&&n.endsWith('.sql')).sort();
assert.ok(upgrades.length>=8);
for(const n of upgrades)sql(await readFile(new URL('supabase/migrations/'+n,repository),'utf8'));
const {generateAdvertisingIssuedInvoicePdf}=await import(new URL('src/lib/documents/advertising-issued-invoice-pdf.ts',repository));
const {generateAdvertisingCreditInvoicePdf}=await import(new URL('src/lib/documents/advertising-credit-invoice-pdf.ts',repository));
for(let k=0;k<originals.length;k++){
 const now=call('select public.get_platform_advertising_issued_invoice($1,$2)',[companies[k],originals[k].id]).invoice;
 assert.deepEqual(now,originals[k]);assert.deepEqual(Buffer.from(await generateAdvertisingIssuedInvoicePdf(now)),Buffer.from(originalBytes[k]));
}
assert.deepEqual(call('select public.get_platform_advertising_credit_invoice($1,$2)',[credit.companyId,credit.id]).credit,credit);
assert.deepEqual(Buffer.from(await generateAdvertisingCreditInvoicePdf(credit)),Buffer.from(creditBytes));
console.log('PASS real issued V1/V2/int64 originals and credit canonical objects and actual PDF bytes survive email upgrade');

const page=(k,kind='invoice',actor=admin)=>call(`select public.${actor===admin?'get_platform':'list'}_advertising_invoice_email_page($1,$2,$3)`,[kind==='credit'?credit.companyId:companies[k],kind,kind==='credit'?credit.id:originals[k].id],actor);
const queueQ=(k,p,request,ack=true)=>bind('select public.queue_advertising_invoice_email($1,$2,$3,$4,$5,$6,$7)',[p.companyId,p.documentKind,p.documentId,p.documentSourceHash,p.preview?.reviewToken,ack,request]);
const queue=(k,p,request,ack=true)=>JSON.parse(sql(as(admin,queueQ(k,p,request,ack))));
const claimQ=e=>bind('select public.claim_advertising_invoice_email($1,$2)',[e.companyId,e.id]);
const claim=e=>JSON.parse(sql(as(admin,claimQ(e)))).job;
const checkQ=(e,j,payload,pdf,bindIt=false)=>bind(`select public.${bindIt?'bind':'check'}_advertising_invoice_email($1,$2,$3,$4,$5)`,[e.companyId,e.id,j.leaseId,payload,pdf]);
const {parseAdvertisingInvoiceEmailJob}=await import(new URL('src/lib/advertising/invoice-email-validation.ts',repository));
const {prepareAdvertisingInvoiceEmail}=await import(new URL('src/lib/email/advertising-invoice-content.ts',repository));
const bindJob=async(e,j)=>{
 const parsed=parseAdvertisingInvoiceEmailJob(j,e.companyId,e.id),prepared=await prepareAdvertisingInvoiceEmail(parsed);
 const attachment=JSON.parse(prepared.body).attachments[0];
 const bytes=Buffer.from(attachment.content,'base64');
 assert.deepEqual(bytes,e.documentKind==='credit'?Buffer.from(creditBytes):Buffer.from(originalBytes[companies.indexOf(e.companyId)]));
 assert.equal(prepared.pdfSha256,digest(bytes));
 assert.equal(prepared.payloadHash,digest(prepared.body));
 assert.deepEqual(JSON.parse(sql(as(admin,checkQ(e,j,prepared.payloadHash,prepared.pdfSha256,true)))),{ok:true});
 return{payload:prepared.payloadHash,pdf:prepared.pdfSha256,body:prepared.body};
};
const finishQ=(e,j,h,outcome,provider=null)=>bind('select public.finish_advertising_invoice_email($1,$2,$3,$4,$5,$6,$7,$8)',[e.companyId,e.id,j.leaseId,admin,h.payload,h.pdf,outcome,provider]);
const finish=(e,j,h,outcome,provider=null)=>JSON.parse(sql(as(null,finishQ(e,j,h,outcome,provider),'service_role')));
const eventQ=(eventId,provider,type,at,recipient='buyer@example.invalid',emailId=null)=>bind('select public.apply_advertising_invoice_email_event($1,$2,$3,$4,$5,$6)',[eventId,provider,type,at,digest(recipient.toLowerCase()),emailId]);
const event=(eventId,provider,type,at,recipient,emailId=null)=>JSON.parse(sql(as(null,eventQ(eventId,provider,type,at,recipient,emailId),'service_role')));
const row=e=>JSON.parse(sql(`select private.advertising_invoice_email_json(r) from private.advertising_invoice_emails r where id=${lit(e.id)}`));
const newSession=async name=>{const s=session(name);await s.ready();return s;};
async function race(first,second,name,options={}){
 const a=await newSession(name+'A'),b=await newSession(name+'B');try{
  assert.notEqual(await a.query('select pg_backend_pid()'),await b.query('select pg_backend_pid()'));
  const saved=JSON.parse(await a.query(`begin;set local role ${options.firstRole??'authenticated'};set local request.jwt.claim.sub='${admin}';set local request.jwt.claims='{"role":"${options.firstRole??'authenticated'}"}';${first};`));
  const waiting=b.query(`begin;set local role ${options.secondRole??'authenticated'};set local request.jwt.claim.sub='${admin}';set local request.jwt.claims='{"role":"${options.secondRole??'authenticated'}"}';${second};`);
  const denied=options.denial?assert.rejects(waiting,options.denial):null;
  await waitForLock(name+'B');await a.query('commit;');
  if(denied){await denied;return[saved,null];}
  const other=JSON.parse(await waiting);await b.query('commit;');return[saved,other];
 }finally{a.close();b.close();}
}

assert.equal(page(1).canQueue,false);assert.ok(page(1).blockers.includes('original.creditExists'));
const p0=page(0);assert.equal(p0.recipient,'buyer@example.invalid');assert.equal(p0.canQueue,true);
assert.equal(page(0,'invoice',owner).canQueue,false);
assert.throws(()=>queue(0,p0,id(2000),false),/review/i);
const [q0]=await race(queueQ(0,p0,id(2001)),queueQ(0,p0,id(2002)),'email_queue_distinct',{denial:/changed|exists|unique/i});
const e0=q0.email;assert.equal(sql(`select count(*) from private.advertising_invoice_emails where id='${e0.id}'`),'1');
console.log('PASS real PostgreSQL lock wait: distinct queue nonces create one email per document');
const p2=page(2),[qa,qb]=await race(queueQ(2,p2,id(2003)),queueQ(2,p2,id(2003)),'email_queue_replay');assert.equal(qa.email.id,qb.email.id);const e2=qa.email;
console.log('PASS real PostgreSQL lock wait: same queue nonce replays one frozen email');
assert.throws(()=>queue(0,p0,id(2003)),/reused/i);
const {legalName:_buyerName,organisationNumber:_buyerOrg,...buyerFields}=originals[0].snapshot.assessment.snapshot.draft.snapshot.buyerProfile.fields;
call('select public.save_platform_advertising_buyer_profile($1,$2,1,$3)',[companies[0],{...buyerFields,invoiceEmail:'changed-after-queue@example.invalid'},id(2099)]);
const [ca,cb]=await race(claimQ(e0),claimQ(e0),'email_claim');assert.ok(ca.job);assert.equal(cb.job,null);const j0=ca.job;
assert.equal(j0.snapshot.recipient,'buyer@example.invalid');assert.deepEqual(j0.snapshot.document,originals[0]);
const h0=await bindJob(e0,j0);assert.throws(()=>JSON.parse(sql(as(admin,checkQ(e0,j0,digest('changed'),h0.pdf,true)))),/changed/i);
assert.throws(()=>JSON.parse(sql(as(admin,finishQ(e0,j0,h0,'accepted','native-accepted')))),/permission|service/i);
assert.equal(finish(e0,j0,h0,'accepted','native-accepted').status,'accepted');assert.equal(row(e0).deliveredAt,null);
assert.equal(claim(e0),null);
console.log('PASS real PostgreSQL lock wait: claim exclusivity, immutable full payload/PDF digests, service-only provider facts, accepted differs from delivered');

// Revocation is observed after a real backend row-lock wait, before any send.
let revokeGroups=0;
for(const [table,column,value,restore,name]of[
 ['private.platform_admins','user_id',"status='suspended'","status='active'",'email_admin_revoke'],
 ['auth.users','id',"banned_until='infinity'","banned_until=null",'email_auth_ban'],
 ['public.companies','id',"status='suspended'","status='active'",'email_company_suspend']]){
 const target=table==='public.companies'?e2.companyId:admin,a=await newSession(name+'A'),b=await newSession(name+'B');try{
  await a.query(`begin;update ${table} set ${value} where ${column}='${target}';`);
  const waiting=b.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${admin}';${claimQ(e2)};`);const denied=assert.rejects(waiting,/required|denied|approval|Auth|blocked|active|suspended|Platform/i);
  await waitForLock(name+'B');await a.query('commit;');await denied;assert.equal(row(e2).attempts,0);revokeGroups++;
 }finally{a.close();b.close();sql(`update ${table} set ${restore} where ${column}='${target}'`);}
}
console.log('PASS real PostgreSQL lock waits: registry, Auth ban and company suspension prevent claim after committed revocation');

const e3=queue(3,page(3),id(2004)).email,j3=claim(e3),h3=await bindJob(e3,j3);
assert.equal(finish(e3,j3,h3,'retryable').status,'pending');assert.equal(claim(e3),null);const first=sql(`select first_attempt_at from private.advertising_invoice_emails where id='${e3.id}'`);
for(let attempt=2;attempt<=5;attempt++){
 sql(`update private.advertising_invoice_emails set next_attempt_at=clock_timestamp()-interval '1 second' where id='${e3.id}'`);
 const j=claim(e3);assert.equal(j.attempts,attempt);assert.equal((await prepareAdvertisingInvoiceEmail(parseAdvertisingInvoiceEmailJob(j,e3.companyId,e3.id))).body,h3.body);assert.equal(j.payloadHash,h3.payload);assert.equal(j.pdfSha256,h3.pdf);assert.equal(sql(`select first_attempt_at from private.advertising_invoice_emails where id='${e3.id}'`),first);
 assert.deepEqual(JSON.parse(sql(as(admin,checkQ(e3,j,h3.payload,h3.pdf)))),{ok:true});
 assert.equal(finish(e3,j,h3,'retryable').status,attempt===5?'rejected':'pending');
}
assert.equal(claim(e3),null);
console.log('PASS 429 retry waits for backoff, keeps firstAttempt and exact payload/PDF binding, and stops at five claims');

const e4=queue(4,page(4),id(2005)).email,j4=claim(e4),h4=await bindJob(e4,j4);
finish(e4,j4,h4,'retryable');sql(`update private.advertising_invoice_emails set first_attempt_at=clock_timestamp()-interval '23 hours',next_attempt_at=clock_timestamp()-interval '1 second' where id='${e4.id}'`);assert.equal(claim(e4),null);assert.equal(row(e4).status,'unknown');assert.equal(row(e4).attempts,1);
const e5=queue(5,page(5),id(2006)).email,j5=claim(e5),h5=await bindJob(e5,j5);finish(e5,j5,h5,'unknown');assert.equal(claim(e5),null);assert.equal(page(5).canQueue,false);
console.log('PASS 23-hour first-attempt boundary and unknown outcomes cannot claim or queue a second email');
const crashAt=sql('select clock_timestamp()');
event('native-crash-wrong-tag','native-crash','bounced',crashAt,undefined,e2.id);assert.equal(row(e5).status,'unknown');assert.equal(row(e2).status,'pending');
event('native-crash-wrong-recipient','native-crash','bounced',crashAt,'other@example.invalid',e5.id);assert.equal(row(e5).status,'unknown');
event('native-never-attempted','native-never','delivered',crashAt,undefined,e2.id);assert.equal(row(e2).status,'pending');assert.equal(row(e2).acceptedAt,null);
const [recovered,finished]=await race(eventQ('native-crash-recovery','native-crash','delivered',crashAt,undefined,e5.id),finishQ(e5,j5,h5,'accepted','native-crash'),'email_crash_recovery',{firstRole:'service_role',secondRole:'service_role'});
assert.deepEqual(recovered,{ok:true});assert.deepEqual(finished,{status:'accepted'});assert.equal(row(e5).status,'accepted');assert.ok(row(e5).deliveredAt);assert.equal(row(e5).bouncedAt,null);assert.equal(claim(e5),null);
assert.equal(finish(e5,j5,h5,'accepted','native-crash').status,'accepted');
assert.throws(()=>event('native-crash-recovery','native-crash','delivered',crashAt,undefined,e2.id),/reused/i);
event('native-crash-wrong-tag-after','native-crash','bounced',crashAt,undefined,e2.id);assert.equal(row(e5).bouncedAt,null);
assert.throws(()=>finish(e5,j5,h5,'accepted','different-provider'),/changed/i);
console.log('PASS real PostgreSQL lock wait: signed tag recovers provider fact after worker crash and racing late finish idempotently; wrong tag/recipient and never-attempted jobs are not revived');


const e6=queue(6,page(6),id(2007)).email,j6=claim(e6),h6=await bindJob(e6,j6);
const expireName='email_lease_expiry',ea=await newSession(expireName+'A'),eb=await newSession(expireName+'B');
try{
 assert.notEqual(await ea.query('select pg_backend_pid()'),await eb.query('select pg_backend_pid()'));
 sql(`update private.advertising_invoice_emails set lease_until=clock_timestamp()+interval '1 second' where id='${e6.id}'`);
 await ea.query("begin;select pg_advisory_xact_lock(hashtextextended('advertising-invoice-seller',0));");
 const waiting=eb.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${admin}';${checkQ(e6,j6,h6.payload,h6.pdf)};`);
 await waitForLock(expireName+'B');await new Promise(resolve=>setTimeout(resolve,1250));await ea.query('commit;');
 assert.deepEqual(JSON.parse(await waiting),{ok:false});await eb.query('commit;');
}finally{ea.close();eb.close();}
assert.equal(claim(e6),null);assert.equal(row(e6).status,'unknown');
console.log('PASS real PostgreSQL lock wait crossing lease expiry: final guard reads clock after locks and refuses send');
sql(`update private.platform_admins set status='suspended' where user_id='${admin}'`);
assert.equal(finish(e6,j6,h6,'accepted','native-late-accepted').status,'accepted');
sql(`update private.platform_admins set status='active' where user_id='${admin}'`);assert.equal(row(e6).acceptedAt!==null,true);
console.log('PASS expired lease is never resent; trusted late acceptance persists original provider fact after administrator revocation');

const e7=queue(7,page(7),id(2008)).email,j7=claim(e7),h7=await bindJob(e7,j7),at=sql('select clock_timestamp()');
event('native-before-finish','native-before','delivered',at);
assert.equal(row(e7).deliveredAt,null);assert.equal(finish(e7,j7,h7,'accepted','native-before').status,'accepted');assert.ok(row(e7).deliveredAt);
assert.deepEqual(event('native-before-finish','native-before','delivered',at),{ok:true});
assert.throws(()=>event('native-before-finish','native-before','bounced',at),/reused/i);
assert.throws(()=>call(eventQ('native-untrusted','native-before','delivered',at)),/permission|service/i);
assert.throws(()=>event('native-future','native-before','delivered','2099-01-01'),/Invalid/i);
event('native-wrong-recipient','native-before','bounced',at,'other@example.invalid');assert.equal(row(e7).bouncedAt,null);
console.log('PASS verified event before finish is retained and reconciled; repeated event is idempotent; altered ID payload, untrusted role, future date and other recipient cannot mutate its fact');

const ce=queue(1,page(1,'credit'),id(2009)).email,cj=claim(ce),ch=await bindJob(ce,cj);assert.deepEqual(cj.snapshot.document,credit);
const [beforeEvent]=await race(eventQ('native-race-event','native-race','delivered',at),finishQ(ce,cj,ch,'accepted','native-race'),'email_event_finish',{firstRole:'service_role',secondRole:'service_role'});
assert.deepEqual(beforeEvent,{ok:true});assert.ok(row(ce).deliveredAt);
console.log('PASS real PostgreSQL lock wait: authenticated-source credit with actual PDF hash and webhook/finish race records delivery once');

const e8=queue(8,page(8),id(2010)).email,j8=claim(e8),h8=await bindJob(e8,j8);
const cp=call('select public.get_platform_advertising_credit_page($1,$2)',[companies[8],originals[8].id]);
call('select public.issue_advertising_credit_invoice($1,$2,$3,$4,$5,$6,$7,true,$8)',[companies[8],originals[8].id,originals[8].sourceHash,cp.series.id,cp.series.reviewToken,cp.preview.reviewToken,'Native cancellation before dispatch',id(2011)]);
assert.deepEqual(JSON.parse(sql(as(admin,checkQ(e8,j8,h8.payload,h8.pdf)))),{ok:false});assert.equal(row(e8).status,'cancelled');assert.equal(claim(e8),null);
console.log('PASS original credited after queue is cancelled by final fresh send guard');

// Finish every sendable fixture before adding suppression facts for the shared synthetic recipient.
event('native-bounce','native-before','bounced',at);event('native-complaint','native-before','complained',at);event('native-later-delivered','native-before','delivered',sql('select clock_timestamp()'));
assert.ok(row(e7).deliveredAt&&row(e7).bouncedAt&&row(e7).complainedAt);
const suppressed=page(9);assert.equal(suppressed.canQueue,false);assert.ok(suppressed.blockers.includes('recipient.suppressed'));assert.equal(claim(e2),null);assert.equal(row(e2).status,'cancelled');
assert.equal(row(e0).status,'accepted');
assert.throws(()=>sql(`update private.advertising_invoice_emails set snapshot=snapshot||'{"recipient":"other@example.invalid"}'::jsonb where id='${e0.id}'`),/immutable/i);
assert.throws(()=>sql('delete from private.advertising_invoice_email_requests'),/immutable/i);
assert.throws(()=>call('select public.list_advertising_invoice_email_page($1,$2,$3)',[companies[2],'invoice',originals[0].id],owner),/missing/i);
console.log('PASS out-of-order delivery never removes bounce/complaint facts; suppression blocks new documents and pending sends; frozen snapshots/nonces remain immutable and company-isolated');
console.log(JSON.stringify({status:'PASS',engine:sql('select version()').split(' on ')[0],realSessionGroups:6+revokeGroups,originals:originals.length,upgrades,proofLimits:['synthetic local Auth/Storage/cron catalogs','provider IDs and webhook facts are synthetic','no HTTP provider delivery or real mailbox was exercised','clock boundaries use privileged local timestamp fixtures','actual PDF bytes and production DTO parsing are exercised separately from provider acceptance']}));
