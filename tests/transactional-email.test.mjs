import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderTransactionalEmail,EMAIL_KINDS} from '../src/lib/email/templates.ts';
import {sendTransactionalEmail} from '../src/lib/email/transport.ts';
const message={id:'11000000-0000-4000-8000-000000000001',reference:'11000000-0000-4000-8000-000000000002',recipient:'customer@example.test',createdAt:new Date().toISOString(),kind:'contract_invitation'};
test('six businessmail templates use canonical authenticated links without customer or application PII',()=>{for(const kind of EMAIL_KINDS){const mail=renderTransactionalEmail({...message,kind});assert.match(mail.html,/<html lang="sv">/);assert.doesNotMatch(mail.html,/localhost|script|token=|utm_/);assert.match(mail.text,/info@trafexa.com/);assert.equal(mail.html.includes(message.recipient),false);}assert.match(renderTransactionalEmail(message).text,/my-contracts\?contract=/);});
test('invalid recipients and references cannot become header or link injection',()=>{for(const change of [{recipient:'good@test.com\r\nBcc:evil@test.com'},{reference:'"><script>'},{kind:'unknown'}])assert.throws(()=>renderTransactionalEmail({...message,...change}));});
test('unconfigured business email performs no network operation',async()=>{let called=false;assert.deepEqual(await sendTransactionalEmail(message,{enabled:false,apiKey:'fixture'},async()=>{called=true;}),{status:'unconfigured'});assert.equal(called,false);});
test('provider send uses stable idempotency key and intended sender reply address',async()=>{let recorded;const result=await sendTransactionalEmail(message,{enabled:true,apiKey:'fixture'},async(url,options)=>{recorded={url,options};return new Response(JSON.stringify({id:'fixture-id'}),{status:200});});assert.equal(result.status,'accepted');assert.equal(recorded.url,'https://api.resend.com/emails');assert.equal(recorded.options.headers['Idempotency-Key'],`trafexa/${message.id}`);const body=JSON.parse(recorded.options.body);assert.equal(body.from,'Trafexa <kundtjanst@trafexa.com>');assert.equal(body.reply_to,'info@trafexa.com');assert.equal(recorded.options.redirect,'error');});
test('network failures and server unknown outcomes never retry automatically',async()=>{let attempts=0;for(const response of [()=>{throw new Error('provider-secret');},()=>new Response('',{status:500}),()=>new Response('{}',{status:200})]){assert.deepEqual(await sendTransactionalEmail(message,{enabled:true,apiKey:'fixture'},async()=>{attempts++;return response();}),{status:'unknown'});}assert.equal(attempts,3);});
test('provider rate limit is retryable while explicit rejection is terminal',async()=>{for(const [code,status] of [[429,'retryable'],[403,'rejected']])assert.equal((await sendTransactionalEmail(message,{enabled:true,apiKey:'fixture'},async()=>new Response('',{status:code}))).status,status);});
test('expired idempotency window prevents network replay',async()=>{let called=false;assert.equal((await sendTransactionalEmail({...message,createdAt:'2020-01-01T00:00:00Z'},{enabled:true,apiKey:'fixture'},async()=>{called=true;})).status,'unknown');assert.equal(called,false);});
test('invalid or future attempt timestamps and the exact expiry boundary never reach the provider',async t=>{
 const now=Date.parse('2026-10-16T12:00:00Z');t.mock.method(Date,'now',()=>now);
 let attempts=0;const fetcher=async()=>{attempts++;return Response.json({id:'fixture-id'});};
 for(const createdAt of ['invalid',new Date(now+60_001).toISOString(),new Date(now-23*60*60*1000).toISOString()]){
  assert.deepEqual(await sendTransactionalEmail({...message,createdAt},{enabled:true,apiKey:'fixture'},fetcher),{status:'unknown'});
 }
 assert.equal(attempts,0);
 assert.equal((await sendTransactionalEmail({...message,createdAt:new Date(now+60_000).toISOString()},{enabled:true,apiKey:'fixture'},fetcher)).status,'accepted');
 assert.equal((await sendTransactionalEmail({...message,createdAt:new Date(now-23*60*60*1000+1).toISOString()},{enabled:true,apiKey:'fixture'},fetcher)).status,'accepted');
 assert.equal(attempts,2);
});
test('malformed persisted envelope has a safe terminal result without sending or throwing',async()=>{
 let attempts=0;
 for(const patch of [{recipient:'invalid'},{id:'invalid'},{reference:'invalid'},{kind:'unknown'}]){
  assert.deepEqual(await sendTransactionalEmail({...message,...patch},{enabled:true,apiKey:'fixture'},async()=>{attempts++;throw Error('must not send');}),{status:'rejected'});
 }
 assert.equal(attempts,0);
});
