import test from 'node:test';
import assert from 'node:assert/strict';
import { createSourceLoader } from './helpers/source-loader.mjs';
const id=n=>`96000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const companyId=id(1),dealId=id(2),referenceId=id(3),actor=id(4),oldEmail=id(5),oldInvitation=id(6),newEmail=id(7),newInvitation=id(8),requestId=id(9),docHash='a'.repeat(64),reviewToken='b'.repeat(64);
const scope={companyId,dealId,referenceId,kind:'offer_invitation'},input={...scope,expectedEmailId:oldEmail,expectedInvitationId:oldInvitation,expectedGeneration:0,expectedDocumentHash:docHash,expectedDocumentVersion:2,expectedRecipientEmail:'synthetic@example.invalid',expectedReviewToken:reviewToken,requestId,reason:'Reviewed synthetic expired link',acknowledged:true,invalidatesPreviousLink:true};
const receipt={...scope,actorUserId:actor,actorRole:'owner',requestId,previousEmailId:oldEmail,previousInvitationId:oldInvitation,emailId:newEmail,invitationId:newInvitation,generation:1,recipientEmail:input.expectedRecipientEmail,documentHash:docHash,documentVersion:2,reason:input.reason,reviewToken,expiresAt:'2026-10-26T10:00:00Z'};
const lifecycle={...scope,actorUserId:actor,actorRole:'owner',recipientEmail:input.expectedRecipientEmail,documentHash:docHash,documentVersion:2,emailId:newEmail,invitationId:newInvitation,generation:1,expiresAt:receipt.expiresAt,revoked:false,linkStatus:'active',status:'accepted',canRenew:false,blockedReason:'not_expired',reviewToken:'c'.repeat(64)};
async function harness({mutationError=null,readError=null,revokeAfterMutation=false,receiptPatch={},role='owner'}={}){
 const calls=[],sent=[];let contextChecks=0;
 const db={async rpc(name,args){calls.push({name,args});return name==='renew_customer_document_link'?{data:{...receipt,...receiptPatch},error:mutationError}:{data:{...lifecycle,actorRole:role},error:readError};}};
 const context=async()=>{contextChecks++;if(revokeAfterMutation&&contextChecks>1)throw{code:'access_denied'};return{userId:actor,companyId,role,db};};
 const loader=await createSourceLoader({'next/cache':{revalidatePath(){}},'@/lib/contracts/signing-context':{requireDealerSigningContext:context},'@/lib/offer-review/context':{requireDealerReviewContext:context},'@/lib/account-access/context':{requireApprovedAccountAccess:async()=>({userId:actor})},'@/lib/email/server':{contractEmailConfigurationStatus:()=>({transport:'configured'}),dispatchReviewedCustomerDocumentRenewal:async(...args)=>{sent.push(args);return{status:'accepted'};}}});
 return{actions:loader.load('@/lib/data/customer-document-renewal-actions'),calls,sent};
}

test('independent renewal review: immutable receipt binds exact new queue ID and strips bearer and ciphertext fields from returned state',async()=>{
 const h=await harness({receiptPatch:{token:'never-expose-bearer',ciphertext:'never-expose-ciphertext'}}),r=await h.actions.renewCustomerDocumentAction(input);assert.equal(r.ok,true);assert.deepEqual(h.sent,[[scope.kind,referenceId,newEmail]]);assert.equal(JSON.stringify(r).includes('never-expose'),false);assert.equal(r.receipt.previousEmailId,oldEmail);assert.equal(r.receipt.previousInvitationId,oldInvitation);
});
test('independent renewal review: a correctly formatted receipt for another recipient or document never reaches dispatch',async()=>{
 for(const patch of [{recipientEmail:'other@example.invalid'},{documentHash:'f'.repeat(64)},{documentVersion:3},{previousInvitationId:id(88)},{generation:2},{actorUserId:id(88)}]){
  const h=await harness({receiptPatch:patch}),r=await h.actions.renewCustomerDocumentAction(input);assert.equal(r.ok,false);assert.deepEqual(h.sent,[]);assert.equal('receipt'in r,false);assert.equal('lifecycle'in r,false);
 }
});
test('independent renewal review: first atomic mutation rejection may prove no creation, but a later read conflict cannot discard the reviewed request',async()=>{
 let h=await harness({mutationError:{code:'40001'}}),r=await h.actions.renewCustomerDocumentAction(input);assert.equal(r.ok,false);assert.equal(r.code,'conflict');assert.equal(r.mutationStarted,false);assert.deepEqual(h.sent,[]);
 h=await harness({readError:{code:'40001'}});r=await h.actions.renewCustomerDocumentAction(input);assert.equal(h.sent.length,1);assert.equal(r.ok,false);assert.equal(r.code,'conflict');assert.notEqual(r.mutationStarted,false,'A committed renewal followed by a read conflict must retain uncertainty and the exact nonce');assert.equal('receipt'in r,false);
});
test('independent renewal review: post-mutation authorization loss suppresses private data without claiming the saved mutation did not happen',async()=>{
 const h=await harness({revokeAfterMutation:true}),r=await h.actions.renewCustomerDocumentAction(input);assert.equal(h.calls[0].name,'renew_customer_document_link');assert.equal(r.ok,false);assert.equal(r.code,'access_denied');assert.notEqual(r.mutationStarted,false);assert.deepEqual(h.sent,[]);assert.equal('receipt'in r,false);assert.equal('lifecycle'in r,false);
});

test('independent renewal review: a historical receipt role is preserved while a replay proves the same actor current authorized role separately',async()=>{
 const h=await harness({role:'admin'}),r=await h.actions.renewCustomerDocumentAction(input);assert.equal(r.ok,true);assert.equal(r.receipt.actorRole,'owner');assert.equal(r.lifecycle.actorRole,'admin');assert.equal(r.receipt.actorUserId,r.lifecycle.actorUserId);assert.deepEqual(h.sent,[[scope.kind,referenceId,newEmail]]);
});
