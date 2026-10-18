import{test}from'node:test';import assert from'node:assert/strict';import{createSourceLoader}from'./helpers/source-loader.mjs';
const id=n=>`fd350000-0000-4000-8000-${String(n).padStart(12,'0')}`,companyId=id(1),dealId=id(2),referenceId=id(3),actor=id(4);const base={companyId,dealId,referenceId,kind:'contract_invitation'};
async function setup(o={}){let contexts=0,reads=0,approval=0;const sends=[];const ctx={companyId,userId:actor,role:o.role??'owner',db:{async rpc(name,args){reads++;if(o.error)return{data:null,error:o.error};return{data:{companyId,dealId,signingId:referenceId,reviewId:referenceId,actorUserId:actor,actorRole:o.role??'owner',recipientEmail:'customer@fixture.invalid',status:reads>1&&o.afterStatus!==undefined?o.afterStatus:Object.hasOwn(o,'status')?o.status:'pending',completionStatus:reads>1&&o.afterCompletionStatus!==undefined?o.afterCompletionStatus:Object.hasOwn(o,'completionStatus')?o.completionStatus:'pending',...o.patch},error:null}}}};const gate=async(_company,mode)=>{contexts++;if(o.denied||o.revoke&&contexts>1||o.revokeAfterSend&&sends.length>0)throw Object.assign(Error('denied'),{code:'access_denied'});return ctx};const loader=await createSourceLoader({'server-only':{},'next/cache':{revalidatePath(){}},'@/lib/contracts/signing-context':{requireDealerSigningContext:gate},'@/lib/offer-review/context':{requireDealerReviewContext:gate},'@/lib/account-access/context':{async requireApprovedAccountAccess(){approval++;if(o.revokeApproval&&approval>1)throw Object.assign(Error('revoked'),{code:'access_denied'});return{userId:actor}}},'@/lib/email/server':{contractEmailConfigurationStatus(){return{transport:o.transport??'configured'}},async dispatchTransactionalEvent(kind,reference){sends.push({kind,reference});if(o.throwSend)throw Error('Unknown response');return{status:'accepted'}}}});return{actions:loader.load('@/lib/data/customer-email-actions'),sends,reads:()=>reads,contexts:()=>contexts};}
test('unified dealer delivery read normalizes all three source kinds and exposes no raw worker data',async()=>{for(const kind of['offer_invitation','contract_invitation','contract_completed']){const h=await setup({patch:{ciphertext:'private',providerId:'private'}});const r=await h.actions.getCustomerEmailDeliveryAction({...base,kind});assert.equal(r.ok,true);assert.equal(r.delivery.referenceId,referenceId);assert.equal(r.delivery.kind,kind);assert.equal(r.delivery.actorUserId,actor);assert.ok(!JSON.stringify(r).includes('private'));assert.equal(h.sends.length,0);}});
test('only fresh pending configured existing email can retry; current protected state is returned after dispatch',async()=>{for(const kind of['offer_invitation','contract_invitation','contract_completed']){const h=await setup({afterStatus:'accepted',afterCompletionStatus:'accepted'});const r=await h.actions.retryCustomerEmailAction({...base,kind,acknowledged:true});assert.equal(r.ok,true);assert.equal(r.delivery.status,'accepted');assert.deepEqual(h.sends,[{kind,reference:referenceId}]);assert.equal(h.reads(),2);}for(const status of['processing','accepted','rejected','unknown','cancelled',null]){const h=await setup({status});const r=await h.actions.retryCustomerEmailAction({...base,acknowledged:true});assert.equal(r.ok,true);assert.equal(r.delivery.status,status);assert.equal(h.sends.length,0);}for(const transport of['paused','unconfigured']){const h=await setup({transport});assert.equal((await h.actions.retryCustomerEmailAction({...base,acknowledged:true})).delivery.transport,transport);assert.equal(h.sends.length,0);}});
test('retry requires explicit acknowledgement and refuses recipient actor or arbitrary payload overrides before IO',async()=>{for(const patch of[{acknowledged:false},{acknowledged:undefined},{recipientEmail:'foreign@fixture.invalid'},{actorUserId:actor},{kind:'account_approved'},{kind:[]},{referenceId:'bad'}]){const h=await setup();const r=await h.actions.retryCustomerEmailAction({...base,acknowledged:true,...patch});assert.equal(r.code,'invalid_input');assert.equal(h.contexts(),0);assert.equal(h.sends.length,0);}});
test('contract read and retry respect role capabilities; offer sellers can retry while finance cannot',async()=>{for(const role of['owner','admin','finance','sales','viewer'])for(const kind of['offer_invitation','contract_invitation','contract_completed']){const h=await setup({role});const canRead=(kind!=='offer_invitation'?['owner','admin','finance']:['owner','admin','sales','finance','viewer']).includes(role);assert.equal((await h.actions.getCustomerEmailDeliveryAction({...base,kind})).ok,canRead);const write=(kind!=='offer_invitation'?['owner','admin']:['owner','admin','sales']).includes(role);const retried=await h.actions.retryCustomerEmailAction({...base,kind,acknowledged:true});assert.equal(retried.ok,write);assert.equal(h.sends.length,write?1:0);}});
test('foreign scope malformed receipt and postread membership or dealer approval revocation fail closed without dispatch',async()=>{for(const patch of[{companyId:id(99)},{dealId:id(99)},{signingId:id(99)},{actorUserId:id(99)},{actorRole:'finance'},{recipientEmail:'bad'},{status:'invented'}]){const h=await setup({patch});const r=await h.actions.retryCustomerEmailAction({...base,acknowledged:true});assert.equal(r.ok,false);assert.equal(Object.hasOwn(r,'delivery'),false);assert.equal(h.sends.length,0);}for(const o of[{revoke:true},{revokeApproval:true}]){const h=await setup(o);assert.equal((await h.actions.retryCustomerEmailAction({...base,acknowledged:true})).ok,false);assert.equal(h.sends.length,0);}});
test('unknown dispatch response is resolved by fresh protected state and sanitized SQL errors reveal no worker details',async()=>{const h=await setup({throwSend:true,afterStatus:'unknown'});const r=await h.actions.retryCustomerEmailAction({...base,acknowledged:true});assert.equal(r.ok,true);assert.equal(r.delivery.status,'unknown');for(const code of['42501','40001','XX000']){const fail=await setup({error:{code,message:'secret-provider-key'}});const result=await fail.actions.getCustomerEmailDeliveryAction(base);assert.equal(result.ok,false);assert.ok(!JSON.stringify(result).includes('secret-provider-key'));}});

test('revocation after dispatch discards the current delivery response and never performs another send',async()=>{const h=await setup({revokeAfterSend:true});const r=await h.actions.retryCustomerEmailAction({...base,acknowledged:true});assert.equal(r.ok,false);assert.equal(Object.hasOwn(r,'delivery'),false);assert.equal(h.sends.length,1);assert.equal(h.reads(),1);});

test('completed-contract email uses its own protected status and never falls back to the accepted signing invitation',async()=>{
 const completion={...base,kind:'contract_completed'};
 const read=await setup({status:'accepted',completionStatus:'pending'});
 assert.equal((await read.actions.getCustomerEmailDeliveryAction(completion)).delivery.status,'pending');
 const pending=await setup({status:'accepted',completionStatus:'pending',afterCompletionStatus:'accepted'});
 const retried=await pending.actions.retryCustomerEmailAction({...completion,acknowledged:true});
 assert.equal(retried.delivery.status,'accepted');assert.deepEqual(pending.sends,[{kind:'contract_completed',reference:referenceId}]);
 for(const completionStatus of [null,'processing','accepted','rejected','unknown','cancelled']){
  const h=await setup({status:'pending',completionStatus});
  assert.equal((await h.actions.retryCustomerEmailAction({...completion,acknowledged:true})).delivery.status,completionStatus);
  assert.equal(h.sends.length,0);
 }
 for(const transport of ['paused','unconfigured']){
  const h=await setup({status:'accepted',completionStatus:'pending',transport});
  assert.equal((await h.actions.retryCustomerEmailAction({...completion,acknowledged:true})).delivery.transport,transport);
  assert.equal(h.sends.length,0);
 }
 for(const completionStatus of [undefined,'delivered',{},['pending']]){
  const h=await setup({patch:{completionStatus},status:'accepted'});
  const failed=await h.actions.retryCustomerEmailAction({...completion,acknowledged:true});
  assert.equal(failed.ok,false);assert.equal(Object.hasOwn(failed,'delivery'),false);assert.equal(h.sends.length,0);
 }
});

test('completion retry keeps current dealer approval and role checks before and after provider work',async()=>{
 for(const options of [{revoke:true},{revokeApproval:true},{revokeAfterSend:true}]){
  const h=await setup(options);
  const r=await h.actions.retryCustomerEmailAction({...base,kind:'contract_completed',acknowledged:true});
  assert.equal(r.ok,false);assert.equal(Object.hasOwn(r,'delivery'),false);
  assert.equal(h.sends.length,options.revokeAfterSend?1:0);
 }
});
