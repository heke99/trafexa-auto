import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceLoader} from './helpers/source-loader.mjs';
const reference='a1300000-0000-4000-8000-000000000001';
async function harness(options={}){
 let sent=0,proofs=0;const calls=[];
 const loader=await createSourceLoader({'server-only':{},
 '@supabase/supabase-js':{createClient(){return {async rpc(name,args){calls.push([name,args]);if(name==='claim_transactional_email'||name==='claim_transactional_email_exact')return{data:{id:reference,kind:'contract_completed_company',reference,recipient:'customer@example.invalid',createdAt:new Date().toISOString(),firstAttemptAt:new Date().toISOString(),leaseId:reference,...options.row}};if(name==='check_transactional_email_lease'){if(options.leaseThrows)throw Error('private db detail');return options.lease??{data:true};}if(name==='finish_transactional_email'){if(options.finishThrows)throw Error('private db detail');return options.finish??{data:true};}throw Error('Unexpected RPC');}};}},
 '@/lib/platform-admin/context':{async requirePlatformAdminContext(){proofs++;if(options.revoke&&proofs>1||options.revokeAfterSend&&sent>0)throw Error('Private denial');return{userId:reference};}},
 './transport':{emailConfigurationStatus:()=> 'configured',async sendTransactionalEmail(){sent++;return options.sendResult??{status:'accepted',providerId:'fixture-provider-id'};}},
 });return {server:loader.load('src/lib/email/server.ts'),counts:()=>({sent,proofs,calls})};
}
async function configured(fn){const prior={};const values={SUPABASE_SECRET_KEY:'synthetic-only',NEXT_PUBLIC_SUPABASE_URL:'https://buqdtssxrotkzndublrt.supabase.co'};for(const [key,value]of Object.entries(values)){prior[key]=process.env[key];process.env[key]=value;}try{return await fn();}finally{for(const key of Object.keys(values)){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}}}
test('persisted-event dispatcher claims only bound kind/reference and finishes one verified lease',()=>configured(async()=>{
 const h=await harness(),r=await h.server.dispatchTransactionalEvent('contract_completed_company',reference);assert.equal(r.status,'accepted');assert.equal(h.counts().sent,1);assert.deepEqual(h.counts().calls[0],['claim_transactional_email',{p_kind:'contract_completed_company',p_reference:reference}]);assert.equal(h.counts().calls.at(-1)[0],'finish_transactional_email');
}));
test('substituted event/reference or revoked platform-admin proof cannot trigger outbound email',()=>configured(async()=>{
 for(const row of [{kind:'account_approved'},{reference:'a1300000-0000-4000-8000-000000000002'}]){const h=await harness({row}),r=await h.server.dispatchTransactionalEvent('contract_completed_company',reference);assert.equal(r.status,'unavailable');assert.equal(h.counts().sent,0);}
 const h=await harness({revoke:true});await assert.rejects(()=>h.server.dispatchNextTransactionalEmail());assert.equal(h.counts().sent,0);
}));
test('missing or malformed event binding cannot accidentally claim the next unrelated queue item',()=>configured(async()=>{
 for(const [kind,id]of [['contract_completed_company',''],['contract_completed_company','invalid'],['unknown',reference]]){
  const h=await harness();assert.equal((await h.server.dispatchTransactionalEvent(kind,id)).status,'unavailable');assert.equal(h.counts().calls.length,0);assert.equal(h.counts().sent,0);
 }
}));
test('unverifiable lease returns the unsent item to pending instead of claiming it was revoked',()=>configured(async()=>{
 for(const options of [{lease:{data:null,error:{code:'XX000',message:'private db detail'}}},{leaseThrows:true},{lease:{data:null}}]){
  const h=await harness(options);assert.equal((await h.server.dispatchTransactionalEvent('contract_completed_company',reference)).status,'unavailable');assert.equal(h.counts().sent,0);
  assert.equal(h.counts().calls.at(-1)[1].p_status,'pending');
 }
}));
test('known revoked source is cancelled only after the queue confirms that status',()=>configured(async()=>{
 const h=await harness({lease:{data:false}});assert.equal((await h.server.dispatchTransactionalEvent('contract_completed_company',reference)).status,'cancelled');assert.equal(h.counts().sent,0);assert.equal(h.counts().calls.at(-1)[1].p_status,'cancelled');
 for(const options of [{finish:{data:false}},{finish:{data:null,error:{code:'XX000'}}},{finishThrows:true}]){
  const failed=await harness({lease:{data:false},...options});assert.equal((await failed.server.dispatchTransactionalEvent('contract_completed_company',reference)).status,'unknown');assert.equal(failed.counts().sent,0);
 }
}));
test('provider acceptance is preserved before post-send admin revocation suppresses the response',()=>configured(async()=>{
 const h=await harness({revokeAfterSend:true});await assert.rejects(()=>h.server.dispatchNextTransactionalEmail());assert.equal(h.counts().sent,1);assert.equal(h.counts().proofs,3);
 assert.deepEqual(h.counts().calls.at(-1),['finish_transactional_email',{p_id:reference,p_lease_id:reference,p_status:'accepted',p_provider_id:'fixture-provider-id'}]);
}));
test('only persisted provider acknowledgement is reported as accepted; safe rate limit remains pending',()=>configured(async()=>{
 for(const options of [{finish:{data:false}},{finishThrows:true}]){
  const h=await harness(options);assert.equal((await h.server.dispatchTransactionalEvent('contract_completed_company',reference)).status,'unknown');assert.equal(h.counts().sent,1);
 }
 const h=await harness({sendResult:{status:'retryable'}});assert.equal((await h.server.dispatchTransactionalEvent('contract_completed_company',reference)).status,'retryable');assert.equal(h.counts().calls.at(-1)[1].p_status,'pending');assert.equal(h.counts().calls.at(-1)[1].p_provider_id,null);
}));

test('reviewed guest renewal claims exact email ID and rejects substituted rows before sending',()=>configured(async()=>{
 for(const row of [{id:reference,kind:'offer_invitation'}, {id:reference,kind:'contract_invitation'}, {id:reference,kind:'contract_completed'}]){
  // Stop before the guest worker by rejecting the lease; the exact claim is the boundary under test.
  const denied=await harness({row:{...row,generation:1,review:{companyId:reference,actorUserId:reference,invitationId:reference,recipientEmail:'customer@example.invalid',documentHash:'a'.repeat(64),documentVersion:1,generation:1}},lease:{data:false}});
  assert.equal((await denied.server.dispatchGuestInvitationEmail(row.kind,reference,reference)).status,'cancelled');
  assert.deepEqual(denied.counts().calls[0],['claim_transactional_email_exact',{p_kind:row.kind,p_reference:reference,p_expected_email_id:reference}]);
 }
 for(const row of [{id:'a1300000-0000-4000-8000-000000000002',kind:'offer_invitation'},{kind:'contract_completed_company'}]){
  const h=await harness({row});assert.equal((await h.server.dispatchGuestInvitationEmail('offer_invitation',reference,reference)).status,'unavailable');assert.equal(h.counts().sent,0);assert.equal(h.counts().calls.length,1);
 }
 for(const args of [['contract_completed_company',reference,reference],['offer_invitation','bad',reference],['offer_invitation',reference,'bad']]){const h=await harness();assert.equal((await h.server.dispatchGuestInvitationEmail(...args)).status,'unavailable');assert.equal(h.counts().calls.length,0);}
}));
