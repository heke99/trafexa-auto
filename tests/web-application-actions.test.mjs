import test from 'node:test';
import assert from 'node:assert/strict';
import { createSourceLoader } from './helpers/source-loader.mjs';
const USER='11111111-1111-4111-8111-111111111111', ID='22222222-2222-4222-8222-222222222222', NONCE='33333333-3333-4333-8333-333333333333', OTHER='44444444-4444-4444-8444-444444444444', NOW='2026-10-14T07:00:00Z';
const application={id:ID,name:'Anna Andersson',email:'anna@example.com',company:'Bil AB',phone:'+46701234567',organisation_number:'5568554884',seeking:['system'],message:'Jag söker affärssystem',privacy_version:'2026-10-14',privacy_acknowledged_at:NOW,legacy:false,status:'new',version:1,created_at:NOW,internal_secret:'never-client'};
const mutation={applicationId:ID,expectedVersion:1,status:'in_review',reason:'Granskning påbörjad',requestId:NONCE};
const receipt={application_id:ID,actor_user_id:USER,request_id:NONCE,previous_status:'new',status:'in_review',version:2,changed:true,reason:mutation.reason,created_at:NOW,internal_secret:'never-client'};
async function fixture(options={}) {
 const calls=[]; let permitted=true;
 const db={auth:{async getUser(){calls.push(['auth']); return {data:{user:options.user===undefined?{id:USER,email:'hekmat.h@trafexa.com',email_confirmed_at:NOW,is_anonymous:false}:options.user},error:null};}},async rpc(name,args){calls.push([name,args]);if(name==='get_platform_admin_session')return{data:{is_platform_admin:permitted,user_id:USER},error:null};if(options.error)return{data:null,error:options.error};if(name==='list_platform_contact_requests')return{data:options.page??{requests:[application],next_page_key:null},error:null};if(name==='get_platform_web_application')return{data:options.detail??{application,audit:[]},error:null};if(name==='erase_platform_web_application')return{data:options.receipt??{application_id:ID,actor_user_id:USER,request_id:NONCE,expected_version:1,reason:'rights_request',erased:true,created_at:NOW,submission_request_id:OTHER},error:null};if(name==='set_platform_web_application_status')return{data:options.receipt??receipt,error:null};throw Error('Unexpected '+name);}};
 const loader=await createSourceLoader({'@/lib/supabase/server':{createServerSupabaseClient:async()=>db},'next/cache':{revalidatePath(){}}});
 return{actions:loader.load('./src/lib/platform-admin/actions.ts'),calls,revoke(){permitted=false;}};
}
test('web applications list exposes requested fields and strips unapproved backend properties',async()=>{
 const f=await fixture(),r=await f.actions.listPlatformContactRequestsAction();assert.equal(r.ok,true);assert.equal(r.requests[0].organisationNumber,'5568554884');assert.deepEqual(r.requests[0].seeking,['system']);assert.equal(r.requests[0].privacyVersion,'2026-10-14');assert.equal(r.requests[0].version,1);assert.equal(JSON.stringify(r).includes('never-client'),false);assert.deepEqual(f.calls.map(x=>x[0]),['auth','get_platform_admin_session','list_platform_contact_requests']);
});
test('application detail verifies actual returned identity and never trusts injected applicant identity',async()=>{
 const f=await fixture();let r=await f.actions.getPlatformWebApplicationAction({applicationId:ID});assert.equal(r.ok,true);assert.equal(r.application.id,ID);assert.equal(JSON.stringify(r).includes('never-client'),false);
 const mismatched=await fixture({detail:{application:{...application,id:OTHER},audit:[]}});assert.equal((await mismatched.actions.getPlatformWebApplicationAction({applicationId:ID})).ok,false);
 for(const value of [{applicationId:ID,actorUserId:USER},{applicationId:'bad'},null]){const g=await fixture();assert.equal((await g.actions.getPlatformWebApplicationAction(value)).ok,false);assert.equal(g.calls.some(x=>x[0]==='get_platform_web_application'),false);}
});
test('application mutations refresh authorization after read and fail closed on revoked registry',async()=>{
 const f=await fixture();assert.equal((await f.actions.listPlatformContactRequestsAction()).ok,true);f.revoke();assert.equal((await f.actions.setPlatformWebApplicationStatusAction(mutation)).code,'access_denied');assert.equal(f.calls.filter(x=>x[0]==='auth').length,2);assert.equal(f.calls.some(x=>x[0]==='set_platform_web_application_status'),false);
});
test('application status writes use explicit version and stable request nonce',async()=>{
 const f=await fixture(),r=await f.actions.setPlatformWebApplicationStatusAction(mutation);assert.equal(r.ok,true);assert.equal(r.receipt.applicationId,ID);assert.equal(r.receipt.requestId,NONCE);assert.equal(r.receipt.version,2);assert.equal(JSON.stringify(r).includes('never-client'),false);assert.deepEqual(f.calls.at(-1),['set_platform_web_application_status',{p_application_id:ID,p_expected_version:1,p_status:'in_review',p_reason:mutation.reason,p_request_id:NONCE}]);
});
test('status receipts with wrong actor, case, nonce, version or payload fail closed',async()=>{
 for(const patch of [{actor_user_id:OTHER},{application_id:OTHER},{request_id:OTHER},{status:'closed'},{version:3},{changed:false},{reason:'Unrelated reason'}]){const f=await fixture({receipt:{...receipt,...patch}});assert.equal((await f.actions.setPlatformWebApplicationStatusAction(mutation)).ok,false,JSON.stringify(patch));}
});
test('status input forbids unsafe versions, unsupported transitions and leaked identity authority',async()=>{
 for(const patch of [{expectedVersion:0},{expectedVersion:1.5},{expectedVersion:Number.MAX_SAFE_INTEGER+1},{status:'accepted'},{reason:''},{reason:'x'.repeat(501)},{actorUserId:USER},{requestId:'bad'}]){const f=await fixture();assert.equal((await f.actions.setPlatformWebApplicationStatusAction({...mutation,...patch})).ok,false);assert.equal(f.calls.some(x=>x[0]==='set_platform_web_application_status'),false);}
});
test('SQL conflicts and revoked access produce safe actionable errors without backend PII',async()=>{
 for(const [sql,expected] of [['40001','conflict'],['42501','access_denied'],['P0002','not_found'],['XX000','unavailable']]){const f=await fixture({error:{code:sql,message:'applicant-secret'}}),r=await f.actions.setPlatformWebApplicationStatusAction(mutation);assert.equal(r.code,expected);assert.equal(JSON.stringify(r).includes('applicant-secret'),false);}
});
test('incomplete nonlegacy application DTO and invalid page receipts fail closed',async()=>{
 for(const patch of [{organisation_number:null},{phone:null},{seeking:[]},{privacy_version:null},{privacy_acknowledged_at:null},{version:0},{legacy:'false'}]){const f=await fixture({page:{requests:[{...application,...patch}],next_page_key:null}});assert.equal((await f.actions.listPlatformContactRequestsAction()).ok,false,JSON.stringify(patch));}
 const f=await fixture({page:{requests:[application],next_page_key:OTHER}});assert.equal((await f.actions.listPlatformContactRequestsAction()).ok,false);
});
test('legacy incomplete requests remain readable without being represented as complete applications',async()=>{
 const old={...application,phone:null,message:null,organisation_number:null,seeking:[],privacy_version:null,privacy_acknowledged_at:null,legacy:true};
 const f=await fixture({page:{requests:[old],next_page_key:null}}),r=await f.actions.listPlatformContactRequestsAction();assert.equal(r.ok,true);assert.equal(r.requests[0].legacy,true);assert.equal(r.requests[0].organisationNumber,null);assert.deepEqual(r.requests[0].seeking,[]);
});

test('erasure returns minimal verified receipt and invokes versioned fixed-purpose removal',async()=>{
 const f=await fixture(),r=await f.actions.erasePlatformWebApplicationAction({applicationId:ID,expectedVersion:1,reason:'rights_request',requestId:NONCE});assert.equal(r.ok,true);assert.deepEqual(Object.keys(r.receipt).sort(),['applicationId','createdAt','erased','requestId']);assert.deepEqual(f.calls.at(-1),['erase_platform_web_application',{p_application_id:ID,p_expected_version:1,p_reason:'rights_request',p_request_id:NONCE}]);
});
test('erasure rejects forged receipts and uncontrolled retention reasons',async()=>{
 const good={application_id:ID,actor_user_id:USER,request_id:NONCE,expected_version:1,reason:'rights_request',erased:true,created_at:NOW};const input={applicationId:ID,expectedVersion:1,reason:'rights_request',requestId:NONCE};
 for(const patch of [{application_id:OTHER},{actor_user_id:OTHER},{request_id:OTHER},{expected_version:2},{reason:'no_longer_needed'},{erased:false}]){const f=await fixture({receipt:{...good,...patch}});assert.equal((await f.actions.erasePlatformWebApplicationAction(input)).ok,false);}
 for(const patch of [{expectedVersion:0},{expectedVersion:2147483648},{reason:'Delete Anna by email'},{actorUserId:USER}]){const f=await fixture();assert.equal((await f.actions.erasePlatformWebApplicationAction({...input,...patch})).ok,false);assert.equal(f.calls.some(x=>x[0]==='erase_platform_web_application'),false);}
 const f=await fixture();f.revoke();assert.equal((await f.actions.erasePlatformWebApplicationAction(input)).code,'access_denied');assert.equal(f.calls.some(x=>x[0]==='erase_platform_web_application'),false);
});
