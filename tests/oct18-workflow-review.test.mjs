import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSourceLoader } from './helpers/source-loader.mjs';

const id = n => `98000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),companyId=id(2),invoiceId=id(3),entryId=id(4),requestId=id(5),hash='a'.repeat(64),token='b'.repeat(64);
const input={companyId,invoiceId,expectedInvoiceSourceHash:hash,expectedReviewToken:token,reviewAcknowledged:true,requestId,amountOre:'9007199254740993',paymentIdentifier:'BANK:fixture-1',bankReference:'Synthetic bank evidence',bookedDate:'2026-10-17',reason:'Verified synthetic receipt',replacesEntryId:null,expectedReplacedEntryHash:null};
function entry(patch={}){
 const source={id:entryId,sequence:'1',companyId,invoiceId,invoiceNumber:'TEST-1',invoiceSourceHash:hash,sellerOrganisationNumber:'5568554884',kind:'receipt',amountOre:input.amountOre,paymentIdentifier:input.paymentIdentifier,bankReference:input.bankReference,bookedDate:input.bookedDate,reason:input.reason,createdAt:'2026-10-18T10:00:00Z',createdBy:actor,reversesEntryId:null,replacesEntryId:null,...patch};
 const canonicalSnapshot=JSON.stringify(source);return {...source,canonicalSnapshot,sourceHash:createHash('sha256').update(canonicalSnapshot).digest('hex'),isReversed:false,isReplaced:false};
}
function writeResponse(patch={}){const e=entry(patch);return{entry:e,receipt:{entryId:e.id,companyId,invoiceId,actorUserId:actor,requestId,sourceHash:e.sourceHash,reviewToken:token}};}
async function paymentHarness({data=writeResponse(),revoke=false,role='owner'}={}){
 const calls=[];let checks=0;
 class PlatformAdminError extends Error{constructor(code){super(code);this.code=code;}}
 class CrmError extends Error{constructor(code){super(code);this.code=code;}}
 const db={async rpc(name,args){calls.push({name,args});return{data,error:null};}};
 const check=async()=>{checks++;if(revoke&&checks>1)throw new PlatformAdminError('forbidden');return{userId:actor,db};};
 const loader=await createSourceLoader({'@/lib/platform-admin/context':{PlatformAdminError,requirePlatformAdminContext:check},'@/lib/contracts/context':{requireContractContext:async()=>({...await check(),role})},'@/lib/crm/context':{CrmError}});
 return{actions:loader.load('@/lib/advertising/payment-actions'),calls,get checks(){return checks;}};
}

test('independent review: payment inputs reject coercion, forged identity and incomplete correction before any IO',async()=>{
 for(const patch of [{amountOre:9007199254740992},{amountOre:'1.5'},{amountOre:'9223372036854775808'},{paymentIdentifier:'same id'},{reviewAcknowledged:false},{actorUserId:id(99)},{replacesEntryId:id(90)}]){
  const h=await paymentHarness();const result=await h.actions.registerAdvertisingPaymentAction({...input,...patch});assert.equal(result.ok,false);assert.equal(result.code,'invalid_input');assert.equal(h.checks,0);assert.deepEqual(h.calls,[]);
 }
});
test('independent review: exact amount above Number precision survives registration and receipt binding',async()=>{
 const h=await paymentHarness(),result=await h.actions.registerAdvertisingPaymentAction(input);assert.equal(result.ok,true);assert.equal(result.entry.amountOre,'9007199254740993');assert.equal(h.checks,2);assert.equal(h.calls[0].args.p_amount_ore,input.amountOre);assert.equal(h.calls[0].args.p_expected_review_token,token);
});
test('independent review: correctly hashed but wrong company, invoice, actor, source or reviewed amount never becomes a success receipt',async()=>{
 for(const patch of [{companyId:id(90)},{invoiceId:id(90)},{createdBy:id(90)},{invoiceSourceHash:'c'.repeat(64)},{amountOre:'1'},{paymentIdentifier:'OTHER-ID'},{reason:'Unreviewed reason'}]){
  const h=await paymentHarness({data:writeResponse(patch)}),result=await h.actions.registerAdvertisingPaymentAction(input);assert.equal(result.ok,false);assert.equal(result.code,'unavailable');assert.equal('entry' in result,false);assert.equal('receipt' in result,false);
 }
});
test('independent review: post-mutation superadmin revocation suppresses the persisted private receipt',async()=>{
 const h=await paymentHarness({revoke:true}),result=await h.actions.registerAdvertisingPaymentAction(input);assert.equal(h.calls.length,1);assert.equal(h.checks,2);assert.equal(result.ok,false);assert.equal(result.code,'access_denied');assert.equal('entry' in result,false);assert.equal('receipt' in result,false);
});
test('independent review: restricted company roles never reach private ledger reads',async()=>{
 const h=await paymentHarness({role:'sales'});const result=await h.actions.listAdvertisingPaymentPageAction({companyId,invoiceId,beforeSequence:null});assert.equal(result.ok,false);assert.equal(result.code,'access_denied');assert.deepEqual(h.calls,[]);
});
test('independent review: deliberate superadmin correction lookup preserves original company proof while post-IO revocation suppresses it',async()=>{
 const original=entry({companyId:id(90),invoiceId:id(91)}),data={companyId,invoiceId,actorUserId:actor,paymentIdentifier:input.paymentIdentifier,entry:original};
 let h=await paymentHarness({data}),result=await h.actions.lookupAdvertisingPaymentAction({companyId,invoiceId,paymentIdentifier:input.paymentIdentifier});assert.equal(result.ok,true);assert.equal(result.entry.companyId,id(90));assert.equal(result.companyId,companyId);
 h=await paymentHarness({data,revoke:true});result=await h.actions.lookupAdvertisingPaymentAction({companyId,invoiceId,paymentIdentifier:input.paymentIdentifier});assert.equal(result.ok,false);assert.equal('entry' in result,false);
});

const invitation={id:id(10),applicationId:id(11),applicationVersion:1,actorUserId:actor,requestId:id(12),email:'synthetic@example.invalid',name:'Synthetic applicant',reason:'Original reviewed approval',status:'created',userId:id(13),createdAt:'2026-10-15T10:00:00Z',expiresAt:'2026-10-15T10:15:00Z',consumedAt:'2026-10-15T10:01:00Z'};
const renewal={applicationId:invitation.applicationId,invitationId:invitation.id,expectedDeliveryId:id(14),expectedVersion:2,reason:'Synthetic renewed invitation',requestId:id(15),acknowledged:true,invalidatesPreviousLink:true};
test('independent review: a renewal receipt cannot change the already-bound Auth user or recipient despite a matching application and generation',async()=>{
 for(const patch of [{userId:id(99)},{email:'other@example.invalid'},{name:'Different applicant'},{reason:'Changed original approval'},{requestId:id(99)},{applicationVersion:99}]){
  const sent=[];
  class PlatformAdminError extends Error{}
  const db={async rpc(){return{error:null,data:{invitation:{...invitation,...patch},deliveryId:id(16),previousDeliveryId:renewal.expectedDeliveryId,applicationVersion:renewal.expectedVersion,reason:renewal.reason,requestId:renewal.requestId}};}};
  const loader=await createSourceLoader({'next/cache':{revalidatePath(){}},'./context':{PlatformAdminError,requirePlatformAdminContext:async()=>({db,userId:actor})},'./application-invitation-actions':{getPlatformApplicationInvitationAction:async()=>({ok:true,invitation})},'@/lib/email/account-invitation-server':{accountInvitationConfigured:()=>true,dispatchAccountInvitation:async value=>{sent.push(value);return'sent';}}});
  const result=await loader.load('@/lib/platform-admin/application-invitation-renew-actions').renewPlatformApplicationInvitationAction(renewal);assert.equal(result.ok,false,JSON.stringify(patch));assert.deepEqual(sent,[],JSON.stringify(patch));
 }
});
