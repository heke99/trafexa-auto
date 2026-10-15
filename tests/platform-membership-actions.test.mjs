import assert from 'node:assert/strict';
import test from 'node:test';
import {createSourceLoader} from './helpers/source-loader.mjs';

const id=n=>`ca170000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),target=id(2),company=id(101),otherCompany=id(102),membershipId=id(201),requestId=id(901);
const verified={id:actor,email:'platform@fixture.invalid',email_confirmed_at:'2026-10-15T12:00:00Z',is_anonymous:false};
const member=(patch={})=>({membershipId,userId:target,email:'dealer@fixture.invalid',role:'sales',status:'active',version:1,companyId:company,companyName:'Fixture Dealer AB',companyStatus:'active',accountStatus:'approved',emailVerified:true,isPlatformAdmin:false,...patch});
const companyPage=(patch={})=>({companyId:company,companyName:'Fixture Dealer AB',companyStatus:'active',actorUserId:actor,teamVersion:3,members:[member()],nextPageKey:null,...patch});
const accountPage=(patch={})=>({userId:target,actorUserId:actor,email:'dealer@fixture.invalid',accountStatus:'approved',emailVerified:true,memberships:[member()],nextPageKey:null,...patch});
const mutation={companyId:company,membershipId,expectedVersion:1,role:'finance',status:'suspended',reason:'Reviewed company role and account',requestId};
const receipt=(patch={})=>({companyId:company,actorUserId:actor,requestId,teamVersion:4,member:member({version:2,role:'finance',status:'suspended'}),...patch});

async function fixture(options={}) {
 const state={calls:[],authReads:0,sessions:0,invalidations:[],signal:null};
 const db={auth:{async getUser(){state.authReads++;return{data:{user:options.user===undefined?verified:options.user},error:options.authError??null};}},rpc(name,args){
  state.calls.push({name,args:structuredClone(args)});
  const query={abortSignal(signal){state.signal=signal;return query;},then(resolve,reject){
   return Promise.resolve().then(async()=>{
    if(name==='get_platform_admin_session'){state.sessions++;return{data:{is_platform_admin:options.admin!==false&&!(options.revoke&&state.sessions>1),user_id:options.switchActor&&state.sessions>1?id(99):actor},error:options.sessionError??null};}
    if(options.throw)throw Error('PRIVATE provider token and SQL diagnostics');
    if(options.hold)return new Promise(()=>{});
    if(options.rpc)return options.rpc(name,args,state);
    const data=options.data??(name==='list_platform_company_members'?companyPage():name==='list_platform_account_memberships'?accountPage():receipt());
    return{data,error:options.error??null};
   }).then(resolve,reject);
  }};return query;
 }};
 const graph=await createSourceLoader({'@/lib/supabase/server':{createServerSupabaseClient:async()=>db},'next/cache':{revalidatePath(path){state.invalidations.push(path);if(options.cacheError)throw Error('Cache unavailable');}}});
 return{state,actions:graph.load('./src/lib/platform-admin/membership-actions.ts')};
}
const calls=f=>f.state.calls.filter(call=>call.name!=='get_platform_admin_session');

test('actual list/mutation actions use fresh verified Auth and platform registry identity before/after each private RPC',async()=>{
 const f=await fixture();
 assert.deepEqual(await f.actions.listPlatformCompanyMembersAction({companyId:company}),{ok:true,...companyPage()});
 assert.deepEqual(await f.actions.listPlatformAccountMembershipsAction({userId:target}),{ok:true,...accountPage()});
 assert.deepEqual(await f.actions.updatePlatformCompanyMemberAction(mutation),{ok:true,receipt:receipt()});
 assert.equal(f.state.authReads,6);assert.equal(f.state.sessions,6);assert.equal(f.state.signal instanceof AbortSignal,true);
 assert.deepEqual(calls(f).map(call=>call.name),['list_platform_company_members','list_platform_account_memberships','update_platform_company_member']);
 assert.deepEqual(calls(f)[2].args,{p_company_id:company,p_membership_id:membershipId,p_expected_version:1,p_role:'finance',p_status:'suspended',p_reason:mutation.reason,p_request_id:requestId});
 assert.deepEqual(f.state.invalidations,['/admin','/settings']);
});

test('read scopes include legitimate empty accounts, nullable legacy email and protected owner/self/platform rows',async()=>{
 const f=await fixture({data:accountPage({email:null,emailVerified:false,accountStatus:'pending',memberships:[]})});
 const empty=await f.actions.listPlatformAccountMembershipsAction({userId:target});assert.equal(empty.ok,true);assert.equal(empty.email,null);assert.deepEqual(empty.memberships,[]);
 const protectedRows=[member({userId:actor,role:'owner',isPlatformAdmin:true}),member({membershipId:id(202),userId:id(3),email:null,emailVerified:false,accountStatus:'pending',status:'suspended'})];
 const legacy=await fixture({data:companyPage({members:protectedRows})});const page=await legacy.actions.listPlatformCompanyMembersAction({companyId:company});assert.equal(page.ok,true);assert.equal(page.members[0].role,'owner');assert.equal(page.members[0].isPlatformAdmin,true);assert.equal(page.members[1].email,null);
});

test('UUID keysets and limits are forwarded exactly and reject duplicate, backwards or dishonest next pages',async()=>{
 const next=member({membershipId:id(202)});
 const f=await fixture({data:companyPage({members:[next],nextPageKey:id(202)})});
 const result=await f.actions.listPlatformCompanyMembersAction({companyId:company,pageKey:membershipId,limit:1});assert.equal(result.ok,true);assert.equal(result.nextPageKey,id(202));assert.deepEqual(calls(f)[0].args,{p_company_id:company,p_page_key:membershipId,p_limit:1});
 for(const data of[companyPage({members:[member(),member()]}),companyPage({members:[member({membershipId:id(202)}),member()]}),companyPage({nextPageKey:id(999)}),companyPage({members:[],nextPageKey:membershipId}),companyPage({members:[member({membershipId:id(202)}),member({membershipId:id(203)})]})]){
  const bad=await fixture({data});assert.equal((await bad.actions.listPlatformCompanyMembersAction({companyId:company,pageKey:membershipId,limit:1})).code,'unavailable');
 }
});

test('input bounds reject malformed scopes, forged metadata, owner promotion, inactive alias and missing/stale version types before I/O',async()=>{
 for(const input of[null,[],{}, {companyId:company,limit:0},{companyId:company,limit:51},{companyId:company,limit:null},{companyId:company,pageKey:'invalid'},{companyId:company,role:'owner'}]){
  const f=await fixture();assert.equal((await f.actions.listPlatformCompanyMembersAction(input)).code,'invalid_input');assert.deepEqual(calls(f),[]);
 }
 for(const patch of[{companyId:'bad'},{membershipId:null},{expectedVersion:0},{expectedVersion:'1'},{expectedVersion:2147483647},{role:'owner'},{role:'superadmin'},{status:'inactive'},{reason:''},{reason:'a\nb'},{reason:'a\u0085b'},{reason:'a'.repeat(501)},{requestId:'bad'},{userId:actor},{acknowledged:true},{serviceRole:'secret'}]){
  const f=await fixture();const r=await f.actions.updatePlatformCompanyMemberAction({...mutation,...patch});assert.equal(r.code,'invalid_input');assert.deepEqual(calls(f),[]);
 }
 const f=await fixture();const r=await f.actions.updatePlatformCompanyMemberAction({...mutation,reason:'  Motivering Åäö 🚘  '});assert.equal(r.ok,true);assert.equal(calls(f)[0].args.p_reason,'Motivering Åäö 🚘');
});

test('company/user output scopes, row/header relationships and closed DTO keys reject private metadata and crossed tenants',async()=>{
 for(const data of[companyPage({actorUserId:id(99)}),companyPage({companyId:otherCompany}),companyPage({members:[member({companyId:otherCompany})]}),companyPage({members:[member({companyName:'Foreign name'})]}),companyPage({members:[member({companyStatus:'suspended'})]}),companyPage({serviceRole:'PRIVATE'}),companyPage({members:[member({privateNotes:'PRIVATE'})]}),companyPage({members:[member({emailVerified:'true'})]})]){
  const f=await fixture({data});const result=await f.actions.listPlatformCompanyMembersAction({companyId:company});assert.equal(result.code,'unavailable');assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
 }
 for(const data of[accountPage({userId:id(99)}),accountPage({actorUserId:id(99)}),accountPage({memberships:[member({userId:id(99)})]}),accountPage({memberships:[member({email:'different@fixture.invalid'})]}),accountPage({memberships:[member({accountStatus:'pending'})]}),accountPage({memberships:[member({emailVerified:false})]}),accountPage({memberships:[member(),member({membershipId:id(202)})]})]){
  const f=await fixture({data});assert.equal((await f.actions.listPlatformAccountMembershipsAction({userId:target})).code,'unavailable');
 }
});

test('receipt binds actor/company/member/request/version/role/status and protects owner/self/any platform target',async()=>{
 const original=receipt();
 for(const patch of[{actorUserId:id(99)},{companyId:otherCompany},{requestId:id(999)},{teamVersion:0},{member:{...original.member,membershipId:id(999)}},{member:{...original.member,companyId:otherCompany}},{member:{...original.member,version:1}},{member:{...original.member,role:'owner'}},{member:{...original.member,status:'active'}},{member:{...original.member,userId:actor}},{member:{...original.member,isPlatformAdmin:true}},{unexpected:'PRIVATE'}]){
  const f=await fixture({data:receipt(patch)});const result=await f.actions.updatePlatformCompanyMemberAction(mutation);assert.equal(result.code,'unavailable');assert.deepEqual(f.state.invalidations,[]);
 }
});

test('activation receipts require approved/verified account and active company; suspension can retain blocked target status',async()=>{
 const active={...mutation,status:'active'};
 const valid=receipt({member:member({version:2,role:'finance'})});assert.equal((await(await fixture({data:valid})).actions.updatePlatformCompanyMemberAction(active)).ok,true);
 for(const patch of[{accountStatus:'pending'},{accountStatus:'rejected'},{accountStatus:'suspended'},{emailVerified:false},{companyStatus:'suspended'}]){
  const f=await fixture({data:receipt({member:{...valid.member,...patch}})});assert.equal((await f.actions.updatePlatformCompanyMemberAction(active)).code,'unavailable');
 }
 const f=await fixture({data:receipt({member:member({version:2,role:'finance',status:'suspended',accountStatus:'suspended',companyStatus:'suspended',emailVerified:false,email:null})})});assert.equal((await f.actions.updatePlatformCompanyMemberAction(mutation)).ok,true);
});

test('ordinary dealer or forged metadata, unverified/anonymous/missing Auth and revoked registry never reach membership data',async()=>{
 for(const options of[{admin:false,user:{...verified,user_metadata:{role:'owner'},app_metadata:{role:'superadmin'}}},{user:null},{user:{...verified,email_confirmed_at:null}},{user:{...verified,is_anonymous:true}},{authError:{message:'PRIVATE'}},{sessionError:{code:'42501',message:'PRIVATE'}}]){
  const f=await fixture(options);assert.equal((await f.actions.listPlatformCompanyMembersAction({companyId:company})).code,'access_denied');assert.equal((await f.actions.updatePlatformCompanyMemberAction(mutation)).code,'access_denied');assert.deepEqual(calls(f),[]);
 }
});

test('post-I/O actor/registry changes discard otherwise valid list/receipt before any cache invalidation',async()=>{
 for(const options of[{revoke:true},{switchActor:true}])for(const [method,input]of[['listPlatformCompanyMembersAction',{companyId:company}],['listPlatformAccountMembershipsAction',{userId:target}],['updatePlatformCompanyMemberAction',mutation]]){
  const f=await fixture(options);const result=await f.actions[method](input);assert.equal(result.code,'access_denied');assert.equal(JSON.stringify(result).includes('dealer@'),false);assert.deepEqual(f.state.invalidations,[]);
 }
});

test('stable caller nonce survives an unknown committed reply and cache failure without a mutable target preflight',async()=>{
 let attempted=0;const f=await fixture({cacheError:true,rpc(){attempted++;if(attempted===1)throw Error('PRIVATE lost response');return{data:receipt(),error:null};}});
 assert.equal((await f.actions.updatePlatformCompanyMemberAction(mutation)).code,'unavailable');assert.deepEqual(await f.actions.updatePlatformCompanyMemberAction(mutation),{ok:true,receipt:receipt()});
 assert.deepEqual(calls(f)[0].args,calls(f)[1].args);assert.equal(calls(f)[0].args.p_request_id,requestId);assert.equal(calls(f).length,2);
});

test('RPC errors distinguish CAS/not-found/forbidden/no-op while never exposing raw provider text',async()=>{
 for(const [rpcCode,expected]of[['40001','conflict'],['23505','conflict'],['42501','access_denied'],['P0002','not_found'],['22023','invalid_input'],['PGRST202','unavailable']]){
  const f=await fixture({error:{code:rpcCode,message:'PRIVATE sql/token'}});const result=await f.actions.updatePlatformCompanyMemberAction(mutation);assert.equal(result.code,expected);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
 }
 const f=await fixture({throw:true});assert.equal((await f.actions.listPlatformAccountMembershipsAction({userId:target})).code,'unavailable');
});

test('a bounded unresolved membership RPC aborts and returns an unknown safe result instead of hanging',async t=>{
 const f=await fixture({hold:true});t.mock.timers.enable({apis:['setTimeout']});
 const pending=f.actions.updatePlatformCompanyMemberAction(mutation);
 for(let n=0;n<50&&!f.state.signal;n++)await Promise.resolve();
 assert.ok(f.state.signal instanceof AbortSignal);t.mock.timers.tick(15000);
 const result=await pending;assert.equal(result.code,'unavailable');assert.equal(f.state.signal.aborted,true);assert.deepEqual(f.state.invalidations,[]);
});
