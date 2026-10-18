import assert from 'node:assert/strict';
import test from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';
const id=n=>`eb160000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const actor=id(1),applicationId=id(2),requestId=id(3),now='2026-10-15T17:00:00Z';
const lifecycle={applicationVersion:1,delivery:{id:null,state:'not_started',attemptCount:0,firstAttemptAt:null,updatedAt:null,canRetry:true},account:{emailVerified:null,approvalStatus:null},canRenew:false};
const input={applicationId,expectedVersion:1,requestId,reason:'Kontrollerad ansökan',reviewAcknowledged:true};
const invitation={id:id(4),applicationId,applicationVersion:1,actorUserId:actor,requestId,email:'customer@example.invalid',name:'Synthetic Customer',reason:input.reason,status:'prepared',userId:null,createdAt:now,expiresAt:'2026-10-15T17:15:00Z',consumedAt:null};
async function fixture(options={}){
 const calls=[];let allowed=true;
 const db={auth:{async getUser(){calls.push('auth');return{data:{user:options.noUser?null:{id:actor,email:'admin@example.invalid',email_confirmed_at:now}},error:null};}},async rpc(name,args){calls.push([name,args]);if(name==='get_platform_admin_session')return{data:{is_platform_admin:allowed,user_id:actor},error:null};if(options.revokeAfterRpc)allowed=false;return{data:options.reply?.(name,args)??options.data??(name==='get_platform_application_invitation'?{applicationId,invitation,lifecycle}:invitation),error:options.error??null};}};
 const loader=await createSourceLoader({'@/lib/supabase/server':{createServerSupabaseClient:async()=>db},'next/cache':{revalidatePath(){}}});
 return{actions:loader.load('./src/lib/platform-admin/application-invitation-actions.ts'),calls,revoke(){allowed=false;}};
}
test('application invitation approval maps only reviewed application/version/reason/nonce and strips private delivery data',async()=>{
 const f=await fixture({data:{...invitation,ciphertext:'never-client',raw_metadata:{role:'superadmin'}}});
 const result=await f.actions.preparePlatformApplicationInvitationAction(input);assert.equal(result.ok,true);assert.deepEqual(result.invitation,invitation);
 assert.deepEqual(f.calls.find(value=>Array.isArray(value)&&value[0]==='prepare_platform_application_invitation'),['prepare_platform_application_invitation',{p_application_id:applicationId,p_expected_version:1,p_reason:input.reason,p_request_id:requestId}]);
 assert.equal(f.calls.filter(value=>value==='auth').length,2);assert.ok(!JSON.stringify(result).includes('never-client'));
});
test('invitation approval rejects browser email/user/admin authority, missing review and invalid CAS/nonces before mutation',async()=>{
 for(const patch of [{email:'attacker@example.invalid'},{actorUserId:id(9)},{userId:id(9)},{reviewAcknowledged:false},{reviewAcknowledged:undefined},{expectedVersion:0},{expectedVersion:2147483648},{expectedVersion:1.2},{requestId:'invalid'},{reason:' A '},{reason:'x'},{reason:'Hello\nthere'}]){
  const f=await fixture(),result=await f.actions.preparePlatformApplicationInvitationAction({...input,...patch});assert.equal(result.code,'invalid_input',JSON.stringify(patch));assert.ok(!f.calls.some(value=>Array.isArray(value)&&value[0]==='prepare_platform_application_invitation'));
 }
});
test('approval receipts must bind actual actor, case/version, nonce and reviewed reason; inconsistent state fails closed',async()=>{
 for(const patch of [{actorUserId:id(9)},{applicationId:id(9)},{applicationVersion:2},{requestId:id(9)},{reason:'Other reason'},{email:'Mixed@example.invalid'},{status:'created'},{userId:id(9)},{createdAt:'invalid'},{expiresAt:'2026-10-15T16:00:00Z'},{name:'\nInjected'}]){
  const f=await fixture({data:{...invitation,...patch}});assert.equal((await f.actions.preparePlatformApplicationInvitationAction(input)).code,'unavailable',JSON.stringify(patch));
 }
});
test('read returns null or exact scoped invitation, rejects injected selectors and mismatched backend case',async()=>{
 let f=await fixture(),result=await f.actions.getPlatformApplicationInvitationAction({applicationId});assert.equal(result.ok,true);assert.deepEqual(result.invitation,invitation);
 f=await fixture({data:{applicationId,invitation:null,lifecycle:{...lifecycle,delivery:{...lifecycle.delivery,canRetry:false}}}});assert.deepEqual(await f.actions.getPlatformApplicationInvitationAction({applicationId}),{ok:true,invitation:null,lifecycle:{...lifecycle,delivery:{...lifecycle.delivery,canRetry:false}}});
 for(const data of [{applicationId:id(9),invitation},{applicationId,invitation:{...invitation,applicationId:id(9)}}]){f=await fixture({data});assert.equal((await f.actions.getPlatformApplicationInvitationAction({applicationId})).ok,false);}
 for(const value of [null,{applicationId,email:'attacker@example.invalid'},{applicationId:'bad'}]){f=await fixture();assert.equal((await f.actions.getPlatformApplicationInvitationAction(value)).ok,false);}
});
test('revoked actual admin or missing Auth blocks approval and late revocation blocks returned success',async()=>{
 const missing=await fixture({noUser:true});assert.equal((await missing.actions.preparePlatformApplicationInvitationAction(input)).code,'access_denied');
 const denied=await fixture();denied.revoke();assert.equal((await denied.actions.preparePlatformApplicationInvitationAction(input)).code,'access_denied');
 const late=await fixture({revokeAfterRpc:true});assert.equal((await late.actions.preparePlatformApplicationInvitationAction(input)).code,'access_denied');
 const lateRead=await fixture({revokeAfterRpc:true});assert.equal((await lateRead.actions.getPlatformApplicationInvitationAction({applicationId})).code,'access_denied');
});
test('SQL failures become bounded actionable results without provider or applicant secrets',async()=>{
 for(const [code,expected] of [['23505','existing_account'],['42501','access_denied'],['40001','conflict'],['P0002','not_found'],['22023','invalid_input'],['XX000','unavailable']]){
  const f=await fixture({error:{code,message:'private-token-secret'}}),result=await f.actions.preparePlatformApplicationInvitationAction(input);assert.equal(result.code,expected);assert.ok(!JSON.stringify(result).includes('private-token-secret'));
 }
});
test('durable lifecycle read strips delivery secrets and rejects malformed or contradictory eligibility before returning an admin DTO',async()=>{
 const valid={...lifecycle,applicationVersion:2,delivery:{id:id(8),state:'unknown',attemptCount:1,firstAttemptAt:now,updatedAt:now,canRetry:false},account:{emailVerified:false,approvalStatus:'approved'},canRenew:true};
 const bound={...invitation,status:'created',userId:id(9),consumedAt:now};
 let f=await fixture({data:{applicationId,invitation:bound,lifecycle:{...valid,ciphertext:'secret',delivery:{...valid.delivery,ciphertext:'secret',leaseId:id(99)}}}});
 const result=await f.actions.getPlatformApplicationInvitationAction({applicationId});assert.equal(result.ok,true);assert.deepEqual(result.lifecycle,valid);assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('leaseId'));
 for(const invalid of [{...valid,applicationVersion:0},{...valid,canRenew:'yes'},{...valid,delivery:{...valid.delivery,id:'bad'}},{...valid,delivery:{...valid.delivery,attemptCount:6}},{...valid,delivery:{...valid.delivery,canRetry:true}},{...valid,account:{...valid.account,emailVerified:true}},{...valid,delivery:{...valid.delivery,state:'not_started'}},{...valid,delivery:{...valid.delivery,firstAttemptAt:null}},{...valid,account:{...valid.account,approvalStatus:'metadata-admin'}}]){
  f=await fixture({data:{applicationId,invitation:bound,lifecycle:invalid}});assert.equal((await f.actions.getPlatformApplicationInvitationAction({applicationId})).code,'unavailable');
 }
});
test('renewal parser requires both reviews, a fresh case version and generation scope while rejecting browser identity and transport authority',async()=>{
 const loader=await createSourceLoader({}),parse=loader.load('./src/lib/platform-admin/application-invitation-validation.ts').parseRenewApplicationInvitationInput;
 const value={applicationId,invitationId:id(4),expectedDeliveryId:id(8),expectedVersion:2,reason:'Reviewed replacement invitation',requestId,acknowledged:true,invalidatesPreviousLink:true};
 assert.deepEqual(parse(value),value);
 for(const patch of [{acknowledged:false},{invalidatesPreviousLink:false},{invalidatesPreviousLink:undefined},{expectedVersion:0},{expectedDeliveryId:'bad'},{email:'forged@example.invalid'},{actorUserId:id(99)},{ciphertext:'forged'},{reason:' Invalid whitespace '}])assert.throws(()=>parse({...value,...patch}));
});
test('fresh preparation action binds old approval and actual current case, preserves recipient and returns a separately fenced generation',async()=>{
 const reprepare={...input,invitationId:invitation.id,expectedApplicationVersion:1,expectedVersion:2,reason:'Fresh reviewed case',requestId:id(21)};
 const priorLifecycle={...lifecycle,applicationVersion:2,delivery:{...lifecycle.delivery,id:id(22),updatedAt:now}};
 const updated={...invitation,applicationVersion:2,reason:reprepare.reason,requestId:reprepare.requestId};
 const response={invitation:updated,deliveryId:id(23),previousApplicationVersion:1};
 const make=patch=>fixture({reply:name=>name==='get_platform_application_invitation'?{applicationId,invitation,lifecycle:priorLifecycle}:{...response,...patch}});
 let f=await make();const result=await f.actions.repreparePlatformApplicationInvitationAction(reprepare);assert.deepEqual(result,{ok:true,invitation:updated,deliveryId:id(23)});
 assert.deepEqual(f.calls.find(call=>Array.isArray(call)&&call[0]==='reprepare_platform_application_invitation')[1],{p_invitation_id:invitation.id,p_expected_application_version:1,p_expected_version:2,p_reason:reprepare.reason,p_request_id:reprepare.requestId});
 for(const patch of [{deliveryId:id(22)},{deliveryId:null},{previousApplicationVersion:99},{invitation:{...updated,email:'forged@example.invalid'}},{invitation:{...updated,name:'Unreviewed name'}},{invitation:{...updated,userId:id(99),status:'created',consumedAt:now}},{invitation:{...updated,requestId:id(99)}}]){f=await make(patch);assert.equal((await f.actions.repreparePlatformApplicationInvitationAction(reprepare)).code,'unavailable');}
 for(const patch of [{reviewAcknowledged:false},{expectedApplicationVersion:2},{expectedVersion:0},{email:'forged@example.invalid'}]){f=await make();assert.equal((await f.actions.repreparePlatformApplicationInvitationAction({...reprepare,...patch})).code,'invalid_input');assert.ok(!f.calls.some(call=>Array.isArray(call)&&call[0]==='reprepare_platform_application_invitation'));}
 f=await fixture({reply:name=>name==='get_platform_application_invitation'?{applicationId,invitation:{...invitation,id:id(99)},lifecycle:priorLifecycle}:response});assert.equal((await f.actions.repreparePlatformApplicationInvitationAction(reprepare)).code,'conflict');assert.ok(!f.calls.some(call=>Array.isArray(call)&&call[0]==='reprepare_platform_application_invitation'));
});
