import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceLoader} from './helpers/source-loader.mjs';

const id=n=>`bf160000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),company=id(2),groupId=id(3),requestId=id(4),connectionId=id(5),instant='2026-10-15T12:00:00Z';
const user={id:actor,email:'admin@fixture.invalid',email_confirmed_at:instant,is_anonymous:false};
const group={id:groupId,version:1,groupReference:'Manually reviewed group',credentialReference:'blocket_group_main',scope:'dealer_group',status:'active',updatedAt:instant};
const binding={companyId:company,connectionId,connectionVersion:3,groupId,groupVersion:1,dealerCode:'dealer-a',evidenceReference:'Reviewed partner case 123',validUntil:'2026-11-01T12:00:00Z',status:'verified'};
const configure={groupId,expectedVersion:0,groupReference:group.groupReference,credentialReference:group.credentialReference,scope:group.scope,status:group.status,reason:'Reviewed group scope',acknowledged:true,requestId};
const bind={companyId:company,groupId,expectedGroupVersion:1,expectedConnectionVersion:2,dealerCode:binding.dealerCode,evidenceReference:binding.evidenceReference,validUntil:binding.validUntil,reason:'Reviewed authority',acknowledged:true,requestId};
const disable={companyId:company,expectedConnectionVersion:3,reason:'Authority withdrawn',acknowledged:true,requestId};
const page=()=>({actorUserId:actor,companyId:company,legalName:'Fixture Dealer AB',organisationNumber:'5568554884',groups:[group],nextPageKey:null,connectionVersion:2,binding:null});
const receipt=kind=>kind==='configure_blocket_group'?{actorUserId:actor,requestId,group}: {actorUserId:actor,requestId,companyId:company,binding:kind==='disable_blocket_company'?{...binding,status:'disabled',connectionVersion:4}:binding};
const loader=await createSourceLoader();const v=loader.load('./src/lib/blocket-provisioning/validation.ts');
async function fixture(options={}){
 const state={calls:[],auth:0,sessions:0,invalidations:[]};
 const db={auth:{async getUser(){state.auth++;return{data:{user:options.user===undefined?user:options.user},error:null};}},rpc(name,args){state.calls.push([name,args]);const query={abortSignal(signal){assert.ok(signal instanceof AbortSignal);return query;},then(resolve,reject){return Promise.resolve().then(()=>{
  if(name==='get_platform_admin_session'){state.sessions++;return{data:{user_id:options.switchActor&&state.sessions>1?id(99):actor,is_platform_admin:options.admin!==false&&!(options.revoke&&state.sessions>1)},error:null};}
  if(options.throw)throw Error('PRIVATE JWT provider detail');
  return{data:options.data??(name==='get_platform_blocket_provisioning'?page():receipt(name)),error:options.error??null};
 }).then(resolve,reject);}};return query;}};
 const graph=await createSourceLoader({'@/lib/supabase/server':{createServerSupabaseClient:async()=>db},'next/cache':{revalidatePath:path=>state.invalidations.push(path)}});
 return{state,actions:graph.load('./src/lib/blocket-provisioning/actions.ts')};
}

test('closed inputs reject secrets, forged authority, invalid labels/types/CAS/ack and unsupported scope',()=>{
 assert.deepEqual(v.parseConfigureBlocketGroupInput(configure),configure);assert.deepEqual(v.parseBindBlocketCompanyInput(bind),bind);assert.deepEqual(v.parseDisableBlocketCompanyInput(disable),disable);
 for(const patch of[{token:'never'},{credentialReference:'eyJ.header.signature'},{credentialReference:'API-KEY'},{credentialReference:'x'.repeat(101)},{scope:'all_accounts'},{status:'verified'},{acknowledged:false},{expectedVersion:'0'},{expectedVersion:-1},{requestId:'bad'},{reason:'x\u0085y'}])assert.throws(()=>v.parseConfigureBlocketGroupInput({...configure,...patch}));
 for(const patch of[{companyId:'bad'},{expectedGroupVersion:0},{expectedConnectionVersion:-1},{validUntil:'2026-02-30T12:00:00Z'},{validUntil:'tomorrow'},{evidenceReference:'x'.repeat(501)},{dealerCode:'x\ncode'},{reason:''},{acknowledged:false},{apiKey:'secret'}])assert.throws(()=>v.parseBindBlocketCompanyInput({...bind,...patch}));
 for(const query of[{companyId:company,limit:51},{companyId:company,pageKey:'bad'},{companyId:company,limit:1.2},{companyId:company,token:'secret'},null,[]])assert.throws(()=>v.parseBlocketProvisioningQuery(query));
});

test('strict outputs reject wrong actor/company/request/version, secret columns, duplicate/backwards pages and forged verification',()=>{
 const query={companyId:company,pageKey:null,limit:50};assert.deepEqual(v.parseBlocketProvisioningPage(page(),actor,query),page());
 for(const patch of[{actorUserId:id(99)},{companyId:id(99)},{apiKey:'secret'},{groups:[group,group]},{nextPageKey:groupId},{connectionVersion:-1},{binding:{...binding,companyId:id(99)}},{binding:{...binding},connectionVersion:2}])assert.throws(()=>v.parseBlocketProvisioningPage({...page(),...patch},actor,query));
 assert.equal(v.parseBlocketProvisioningPage({...page(),connectionVersion:7},actor,query).connectionVersion,7);
 const requestedAgain={...page(),connectionVersion:4,binding:{...binding,status:'disabled'}};
 assert.equal(v.parseBlocketProvisioningPage(requestedAgain,actor,query).binding.connectionVersion,3);
 assert.equal(v.parseBlocketProvisioningPage(requestedAgain,actor,query).connectionVersion,4);
 assert.throws(()=>v.parseBlocketProvisioningPage({...requestedAgain,binding},actor,query));
 for(const patch of[{group:{...group,version:2}},{group:{...group,credentialReference:'secret.token'}},{actorUserId:id(99)},{requestId:id(99)},{group:{...group,apiKey:'secret'}}])assert.throws(()=>v.parseBlocketGroupReceipt({...receipt('configure_blocket_group'),...patch},actor,configure));
 for(const patch of[{binding:{...binding,status:'disabled'}},{binding:{...binding,dealerCode:'foreign'}},{binding:{...binding,groupVersion:2}},{companyId:id(99)},{binding:{...binding,connectionVersion:4}}])assert.throws(()=>v.parseBlocketBindingReceipt({...receipt('bind_blocket_company'),...patch},actor,bind));
});

test('actual actions use fresh verified Auth/admin before and after every I/O and preserve typed nonce/CAS',async()=>{
 const{actions,state}=await fixture();assert.equal((await actions.getPlatformBlocketProvisioningAction({companyId:company})).ok,true);assert.equal((await actions.configureBlocketGroupAction(configure)).ok,true);assert.equal((await actions.bindBlocketCompanyAction(bind)).ok,true);assert.equal((await actions.disableBlocketCompanyAction(disable)).ok,true);
 assert.equal(state.auth,8);assert.equal(state.sessions,8);assert.deepEqual(state.calls.filter(([name])=>name!=='get_platform_admin_session').map(([name])=>name),['get_platform_blocket_provisioning','configure_blocket_group','bind_blocket_company','disable_blocket_company']);
 const forwarded=state.calls.find(([name])=>name==='bind_blocket_company')[1];assert.equal(forwarded.p_expected_connection_version,2);assert.equal(forwarded.p_request_id,requestId);assert.equal(forwarded.p_group_id,groupId);assert.equal(forwarded.p_acknowledged,true);assert.ok(state.invalidations.includes('/admin'));
});

test('ordinary owner/forged metadata, anonymous/unverified or missing Auth never reaches provisioning RPC',async()=>{
 for(const options of[{admin:false,user:{...user,app_metadata:{role:'superadmin'},user_metadata:{role:'owner'}}},{user:null},{user:{...user,is_anonymous:true}},{user:{...user,email_confirmed_at:null}}]){
  const{actions,state}=await fixture(options);assert.equal((await actions.getPlatformBlocketProvisioningAction({companyId:company})).code,'access_denied');assert.equal((await actions.bindBlocketCompanyAction(bind)).code,'access_denied');assert.equal(state.calls.some(([name])=>name!=='get_platform_admin_session'),false);
 }
});

test('post-I/O revocation or actor switch discards otherwise valid mutation/read receipts and cache invalidation',async()=>{
 for(const options of[{revoke:true},{switchActor:true}])for(const [method,input]of[['getPlatformBlocketProvisioningAction',{companyId:company}],['configureBlocketGroupAction',configure],['bindBlocketCompanyAction',bind],['disableBlocketCompanyAction',disable]]){const{actions,state}=await fixture(options);const result=await actions[method](input);assert.equal(result.code,'access_denied');assert.equal(JSON.stringify(result).includes('dealer-a'),false);assert.deepEqual(state.invalidations,[]);}
});

test('provider failures, malformed JSON receipts and network throws are safe and preserve conflict versus unavailable',async()=>{
 for(const options of[{error:{code:'40001',message:'SECRET TOKEN'}},{error:{code:'42501',message:'SECRET TOKEN'}},{error:{code:'22023',message:'SECRET TOKEN'}},{error:{code:'PGRST202',message:'SECRET TOKEN'}},{throw:true},{data:{actorUserId:actor,secret:'PRIVATE JWT'}}]){const{actions}=await fixture(options);const result=await actions.bindBlocketCompanyAction(bind);assert.equal(result.ok,false);assert.equal(JSON.stringify(result).includes('SECRET'),false);assert.equal(JSON.stringify(result).includes('JWT'),false);if(options.error?.code==='40001')assert.equal(result.code,'conflict');}
});

test('structurally valid historic expiry is sent unchanged for SQL receipt replay, without inferring current readiness',async()=>{
 const old={...bind,validUntil:'2000-01-01T12:00:00Z'};const{actions,state}=await fixture({data:{...receipt('bind_blocket_company'),binding:{...binding,validUntil:old.validUntil}}});const result=await actions.bindBlocketCompanyAction(old);assert.equal(result.ok,true);assert.equal(result.binding.status,'verified');assert.equal(state.calls.find(([name])=>name==='bind_blocket_company')[1].p_valid_until,old.validUntil);
});
