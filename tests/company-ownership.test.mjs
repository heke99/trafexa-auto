import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceLoader} from './helpers/source-loader.mjs';

const id=n=>`af260000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const C=id(1),OWNER=id(2),ADMIN=id(3),OWNER_M=id(4),ADMIN_M=id(5),T=id(6),R=id(7),OTHER=id(8);
const NOW='2026-10-15T12:00:00.000Z',END='2026-10-16T12:00:00.000Z',LATER='2026-10-15T13:00:00.000Z';
const from={membershipId:OWNER_M,userId:OWNER,email:'owner@example.test',version:1};
const to={membershipId:ADMIN_M,userId:ADMIN,email:'admin@example.test',version:1};
const transfer={id:T,companyId:C,from,to,status:'pending',version:1,teamVersionAtRequest:2,reason:'Ny ansvarig administratör',attestationVersion:'2026-10-15',createdAt:NOW,expiresAt:END,resolvedAt:null,cancelReason:null};
const page={companyId:C,actorUserId:OWNER,actorRole:'owner',teamVersion:1,serverNow:NOW,owner:from,candidates:[to],nextPageKey:null,transfer:null,canRequest:true,canAccept:false,canCancel:false,blockReason:null};
const request={companyId:C,targetMembershipId:ADMIN_M,expectedOwnerVersion:1,expectedTargetVersion:1,expectedTeamVersion:1,reason:transfer.reason,acknowledged:true,attestationVersion:'2026-10-15',requestId:R};
const accept={companyId:C,transferId:T,expectedVersion:1,expectedTeamVersion:2,acknowledged:true,attestationVersion:'2026-10-15',requestId:R};
const cancel={...accept,reason:'Bytet behövs inte'};
function receipt(kind,actor=kind==='accept'?ADMIN:OWNER){return {companyId:C,actorUserId:actor,requestId:R,teamVersion:kind==='request'?2:3,transfer:kind==='request'?transfer:{...transfer,status:kind==='accept'?'accepted':'cancelled',version:2,resolvedAt:LATER,cancelReason:kind==='cancel'?cancel.reason:null}};}
async function fixture(options={}){
 const state={actor:options.actor??OWNER,role:options.role??'owner',contexts:0,calls:[],invalidations:[]};let ErrorClass;
 const db={async rpc(name,args){state.calls.push([name,args]);if(options.rpc)return options.rpc(name,args,state);return {data:name==='get_company_ownership_transfer'?options.page??page:options.receipt??receipt(name.startsWith('request_')?'request':name.startsWith('accept_')?'accept':'cancel',state.actor),error:options.error??null};}};
 const loader=await createSourceLoader({
  './context':{async requireOwnershipContext(companyId){state.contexts++;if(options.context)options.context(state,ErrorClass);return {db,companyId,userId:state.actor,role:state.role};}},
  '../company-team/context':{CompanyTeamError:class extends Error{}},
  '../account-access/context':{AccountAccessError:class extends Error{}},
  'next/cache':{revalidatePath:path=>state.invalidations.push(path)},
 });
 ErrorClass=loader.load('@/lib/company-ownership/validation').OwnershipError;
 return {state,actions:loader.load('@/lib/company-ownership/actions')};
}

test('ownership actions normalize and forward exact reviewed request without client-controlled role or expiry',async()=>{
 const f=await fixture(),result=await f.actions.requestCompanyOwnershipTransferAction({...request,reason:` ${request.reason} `});
 assert.equal(result.ok,true);assert.deepEqual(result.receipt,receipt('request'));
 assert.deepEqual(f.state.calls,[['request_company_ownership_transfer',{p_company_id:C,p_expected_team_version:1,p_acknowledged:true,p_attestation_version:'2026-10-15',p_request_id:R,p_target_membership_id:ADMIN_M,p_expected_owner_version:1,p_expected_target_version:1,p_reason:request.reason}]]);
 assert.equal(f.state.contexts,2);assert.deepEqual(f.state.invalidations,['/settings','/dashboard']);
});
test('ownership malformed inputs and unchecked or stale attestations fail before any authority or SQL lookup',async()=>{
 for(const patch of [{acknowledged:false},{attestationVersion:'old'},{reason:''},{reason:'x'.repeat(501)},{reason:'one\ntwo'},{reason:'x\u0080'},{targetMembershipId:'x'},{expectedOwnerVersion:0},{expectedTargetVersion:1.5},{expectedTeamVersion:2147483648},{requestId:null},{role:'owner'},{expiresAt:END}]){
  const f=await fixture();assert.equal((await f.actions.requestCompanyOwnershipTransferAction({...request,...patch})).code,'invalid_input');assert.equal(f.state.contexts,0);assert.deepEqual(f.state.calls,[]);
 }
 for(const method of ['acceptCompanyOwnershipTransferAction','cancelCompanyOwnershipTransferAction']){
  const f=await fixture();assert.equal((await f.actions[method]({...accept,expectedVersion:0,reason:'ignored'})).code,'invalid_input');assert.equal(f.state.contexts,0);
 }
});
test('ownership pages are bound to actual actor, role, candidate order, cursor and private DTO allowlists',async()=>{
 const f=await fixture({page:{...page,secret:'PRIVATE',candidates:[{...to,internal:'PRIVATE'}]}});
 const read=await f.actions.getCompanyOwnershipTransferAction({companyId:C});assert.equal(read.ok,true);assert.equal(JSON.stringify(read).includes('PRIVATE'),false);
 assert.deepEqual(f.state.calls[0],['get_company_ownership_transfer',{p_company_id:C,p_page_key:null,p_limit:50}]);assert.equal(f.state.contexts,2);
 for(const patch of [{companyId:OTHER},{actorUserId:OTHER},{actorRole:'admin'},{candidates:[to,to]},{nextPageKey:ADMIN_M},{canAccept:true},{canCancel:true},{owner:null},{blockReason:'unknown'},{serverNow:'bad'}]){
  const bad=await fixture({page:{...page,...patch}});assert.equal((await bad.actions.getCompanyOwnershipTransferAction({companyId:C})).code,'unavailable');
 }
});
test('ownership pagination preserves UUID cursor and never exposes administrator candidates to another administrator',async()=>{
 const next={...to,membershipId:OTHER,userId:OTHER,email:'next@example.test'};
 const f=await fixture({page:{...page,candidates:[next],nextPageKey:OTHER}});
 assert.equal((await f.actions.getCompanyOwnershipTransferAction({companyId:C,pageKey:ADMIN_M,limit:1})).nextPageKey,OTHER);
 assert.equal(f.state.calls[0][1].p_page_key,ADMIN_M);
 const bad=await fixture({actor:ADMIN,role:'admin',page:{...page,actorUserId:ADMIN,actorRole:'admin',canRequest:false,blockReason:'not_owner'}});
 assert.equal((await bad.actions.getCompanyOwnershipTransferAction({companyId:C})).code,'unavailable');
});
test('ownership receipt binding rejects wrong company actor request recipient version status and malformed frozen terms',async()=>{
 const base=receipt('request');
 for(const patch of [{companyId:OTHER},{actorUserId:OTHER},{requestId:OTHER},{teamVersion:3},{transfer:{...transfer,companyId:OTHER}},{transfer:{...transfer,to:{...to,membershipId:OTHER}}},{transfer:{...transfer,from:{...from,version:2}}},{transfer:{...transfer,teamVersionAtRequest:1}},{transfer:{...transfer,expiresAt:LATER}},{transfer:{...transfer,reason:`\u00a0${transfer.reason}`}},{transfer:{...transfer,cancelReason:'unexpected'}}]){
  const f=await fixture({receipt:{...base,...patch}});assert.equal((await f.actions.requestCompanyOwnershipTransferAction(request)).code,'unavailable');assert.deepEqual(f.state.invalidations,[]);
 }
});
test('ownership acceptance allows the actual role promotion while a later revoked context suppresses committed success',async()=>{
 const f=await fixture({actor:ADMIN,role:'admin',context(state){if(state.contexts===2)state.role='owner';}});
 const result=await f.actions.acceptCompanyOwnershipTransferAction(accept);assert.equal(result.ok,true);assert.equal(result.receipt.transfer.status,'accepted');assert.equal(f.state.contexts,2);
 const revoked=await fixture({actor:ADMIN,role:'admin',context(state,ErrorClass){if(state.contexts===2)throw new ErrorClass('access_denied');}});
 assert.equal((await revoked.actions.acceptCompanyOwnershipTransferAction(accept)).code,'access_denied');assert.equal(revoked.state.calls.length,1);assert.deepEqual(revoked.state.invalidations,[]);
 const wrong=await fixture({actor:ADMIN,role:'admin',receipt:{...receipt('accept'),transfer:{...receipt('accept').transfer,to:{...to,userId:OTHER}}}});
 assert.equal((await wrong.actions.acceptCompanyOwnershipTransferAction(accept)).code,'unavailable');
});
test('ownership historical receipts remain historical through sender demotion and recipient promotion',async()=>{
 const oldOwner=await fixture({role:'admin',receipt:receipt('request')});assert.deepEqual((await oldOwner.actions.requestCompanyOwnershipTransferAction(request)).receipt,receipt('request'));
 const newOwner=await fixture({actor:ADMIN,role:'owner',receipt:receipt('accept')});assert.deepEqual((await newOwner.actions.acceptCompanyOwnershipTransferAction(accept)).receipt,receipt('accept'));
 const cancelled=await fixture({role:'admin',receipt:receipt('cancel')});assert.deepEqual((await cancelled.actions.cancelCompanyOwnershipTransferAction(cancel)).receipt,receipt('cancel'));
});
test('ownership cancellation requires original sender and exact reviewed cancellation reason',async()=>{
 const f=await fixture();assert.equal((await f.actions.cancelCompanyOwnershipTransferAction(cancel)).ok,true);
 assert.equal(f.state.calls[0][1].p_reason,cancel.reason);
 for(const patch of [{transfer:{...receipt('cancel').transfer,cancelReason:'Different'}},{transfer:{...receipt('cancel').transfer,from:{...from,userId:OTHER}}}]){
  const f=await fixture({receipt:{...receipt('cancel'),...patch}});assert.equal((await f.actions.cancelCompanyOwnershipTransferAction(cancel)).code,'unavailable');
 }
});
test('ownership uncertain outcomes retry exact same nonce and CAS; database diagnostics stay private',async()=>{
 let attempts=0;
 const f=await fixture({rpc(){if(!attempts++)throw Error('PRIVATE transport');return {data:receipt('request'),error:null};}});
 assert.equal((await f.actions.requestCompanyOwnershipTransferAction(request)).code,'unavailable');assert.equal((await f.actions.requestCompanyOwnershipTransferAction(request)).ok,true);assert.deepEqual(f.state.calls[0],f.state.calls[1]);
 for(const [code,want]of [['42501','access_denied'],['40001','conflict'],['23505','conflict'],['22023','invalid_input'],['P0002','unavailable'],['XX000','unavailable']]){
  const f=await fixture({error:{code,message:'PRIVATE server diagnostic'}}),result=await f.actions.requestCompanyOwnershipTransferAction(request);assert.equal(result.code,want);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
 }
});
test('ownership page role changes or actor changes during IO cannot release stale authority',async()=>{
 for(const field of ['actor','role']){
  const f=await fixture({context(state){if(state.contexts===2)state[field]=field==='actor'?OTHER:'admin';}});assert.equal((await f.actions.getCompanyOwnershipTransferAction({companyId:C})).code,'access_denied');
 }
});
