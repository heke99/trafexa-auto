import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Webhook} from 'svix';
import {prepareAdvertisingInvoiceEmail,emailDigest} from '../src/lib/email/advertising-invoice-content.ts';
import {sendPreparedAdvertisingInvoiceEmail} from '../src/lib/email/advertising-invoice-transport.ts';
import {verifyAdvertisingInvoiceEmailWebhook} from '../src/lib/email/advertising-invoice-webhook.ts';
import {generateAdvertisingIssuedInvoicePdf} from '../src/lib/documents/advertising-issued-invoice-pdf.ts';
import {generateAdvertisingCreditInvoicePdf} from '../src/lib/documents/advertising-credit-invoice-pdf.ts';
import {job,id} from './helpers/advertising-invoice-email-fixture.mjs';

test('invoice and credit payloads attach exact immutable PDF bytes, frozen recipient and stable complete payload digest',async()=>{
 for(const kind of ['invoice','credit']){
  const j=job(kind),prepared=await prepareAdvertisingInvoiceEmail(j),payload=JSON.parse(prepared.body),pdf=kind==='invoice'?await generateAdvertisingIssuedInvoicePdf(j.snapshot.document):await generateAdvertisingCreditInvoicePdf(j.snapshot.document);
  assert.deepEqual(Buffer.from(payload.attachments[0].content,'base64'),Buffer.from(pdf));
  assert.equal(prepared.pdfSha256,emailDigest(pdf));assert.equal(prepared.payloadHash,emailDigest(prepared.body));
  assert.deepEqual(payload.to,[j.recipient]);assert.equal(payload.from,'Trafexa <kundtjanst@trafexa.com>');assert.equal(payload.reply_to,'info@trafexa.com');
  assert.deepEqual(payload.tags,[{name:'trafexa_invoice_email_id',value:j.id}]);
  assert.match(payload.html,/<html lang="sv">/);assert.match(payload.html,/role="presentation"/);
  assert.equal(payload.attachments.length,1);assert.ok(!prepared.body.includes('localhost'));assert.ok(!prepared.body.includes('SUPABASE_SECRET'));
  assert.deepEqual(await prepareAdvertisingInvoiceEmail(j),prepared);
  if(kind==='credit'){assert.match(payload.text,/-0,10 SEK/);assert.ok(!payload.text.includes('Att betala:'));assert.ok(!payload.text.includes('Förfallodatum:'));}
  else{assert.match(payload.text,/Att betala: 0,10 SEK/);assert.match(payload.text,/2026-11-14/);}
 }
});
test('email preparation cannot substitute recipient or frozen document and rejects unsupported template version',async()=>{
 for(const mutate of [j=>j.snapshot.recipient='other@example.test',j=>j.snapshot.documentSourceHash='a'.repeat(64),j=>j.snapshot.templateVersion=2,j=>j.snapshot.document.snapshot.grossTotalOre='999']){
  const j=job();mutate(j);await assert.rejects(prepareAdvertisingInvoiceEmail(j));
 }
});
test('provider transport uses one exact payload, stable idempotency key and no redirects; accepted is only provider acceptance',async()=>{
 const input={emailId:id(96),firstAttemptAt:new Date().toISOString(),body:'{"exact":"frozen-payload"}',apiKey:'test-key'};
 let calls=0;const fetcher=async(url,options)=>{calls++;assert.equal(url,'https://api.resend.com/emails');assert.equal(options.body,input.body);assert.equal(options.redirect,'error');assert.equal(options.headers['Idempotency-Key'],`trafexa/invoice-email/${id(96)}`);assert.equal(options.headers.Authorization,'Bearer test-key');return Response.json({id:'provider-1'});};
 assert.deepEqual(await sendPreparedAdvertisingInvoiceEmail(input,fetcher),{status:'accepted',providerId:'provider-1'});
 assert.deepEqual(await sendPreparedAdvertisingInvoiceEmail(input,fetcher),{status:'accepted',providerId:'provider-1'});assert.equal(calls,2);
});
test('known 429/concurrent conflicts retry later, ambiguous errors never automatically resend, and changed idempotent content stops',async()=>{
 const input={emailId:id(96),firstAttemptAt:new Date().toISOString(),body:'{}',apiKey:'test'};
 for(const [response,expected] of [[new Response('',{status:429}),'retryable'],[Response.json({name:'concurrent_idempotent_requests'},{status:409}),'retryable'],[Response.json({name:'invalid_idempotent_request'},{status:409}),'rejected'],[new Response('',{status:503}),'unknown'],[new Response('',{status:400}),'rejected'],[Response.json({}),'unknown'],[new Response('bad json'),'unknown']]){
  let count=0;assert.equal((await sendPreparedAdvertisingInvoiceEmail(input,async()=>{count++;return response;})).status,expected);assert.equal(count,1);
 }
 assert.equal((await sendPreparedAdvertisingInvoiceEmail(input,async()=>{throw Error('PRIVATE NETWORK ERROR');})).status,'unknown');
 for(const firstAttemptAt of [new Date(Date.now()-23*60*60*1000-1000).toISOString(),'invalid',new Date(Date.now()+120000).toISOString()]){
  let count=0;assert.equal((await sendPreparedAdvertisingInvoiceEmail({...input,firstAttemptAt},async()=>{count++;return Response.json({id:'provider'});})).status,'unknown');assert.equal(count,0);
 }
});

const secret=`whsec_${Buffer.alloc(32,7).toString('base64')}`;
export function signedEvent(options={}){
 const timestamp=options.timestamp??new Date(),event={type:options.type??'email.delivered',created_at:new Date().toISOString(),data:{email_id:'provider-1',to:['BILLING@example.test'],tags:{trafexa_invoice_email_id:id(96)},...options.data}};
 const raw=options.raw??JSON.stringify(event),headers=new Headers({'svix-id':'msg_test_invoice_1','svix-timestamp':String(Math.floor(timestamp.getTime()/1000)),'svix-signature':new Webhook(secret).sign('msg_test_invoice_1',timestamp,raw)});
 return{raw,headers,secret};
}
test('actual pinned Svix verifies raw whitespace payload; only signed invoice delivery facts return a hashed recipient',()=>{
 for(const type of ['email.delivered','email.bounced','email.complained']){
  const signed=signedEvent({type}),result=verifyAdvertisingInvoiceEmailWebhook(signed.raw,signed.headers,secret);
  assert.equal(result.eventType,type.slice(6));assert.equal(result.providerId,'provider-1');assert.equal(result.recipientHash,emailDigest('billing@example.test'));assert.equal('recipient'in result,false);
 }
 const raw='{ "type": "email.delivered", "created_at": "2026-10-15T00:00:00Z", "data": {"email_id":"provider-1","to":["billing@example.test"],"tags":{"trafexa_invoice_email_id":"'+id(96)+'"}} }';
 const signed=signedEvent({raw});assert.ok(verifyAdvertisingInvoiceEmailWebhook(raw,signed.headers,secret));
 assert.throws(()=>verifyAdvertisingInvoiceEmailWebhook(JSON.stringify(JSON.parse(raw)),signed.headers,secret));
});
test('signature tampering, stale/future headers, missing headers and malformed event fields fail before database facts',()=>{
 const signed=signedEvent();assert.throws(()=>verifyAdvertisingInvoiceEmailWebhook(signed.raw+' ',signed.headers,secret));assert.throws(()=>verifyAdvertisingInvoiceEmailWebhook(signed.raw,new Headers(),secret));
 for(const timestamp of [new Date(Date.now()-600000),new Date(Date.now()+600000)]){const s=signedEvent({timestamp});assert.throws(()=>verifyAdvertisingInvoiceEmailWebhook(s.raw,s.headers,secret));}
 for(const data of [{email_id:'bad\nprovider'},{to:['a@example.test','b@example.test']},{to:['bad address']},{tags:{trafexa_invoice_email_id:id(96)},email_id:null}]){const s=signedEvent({data});assert.throws(()=>verifyAdvertisingInvoiceEmailWebhook(s.raw,s.headers,secret));}
 for(const options of [{type:'email.opened'},{data:{tags:{}}},{data:{tags:undefined}}]){const s=signedEvent(options);assert.equal(verifyAdvertisingInvoiceEmailWebhook(s.raw,s.headers,secret),null);}
});
