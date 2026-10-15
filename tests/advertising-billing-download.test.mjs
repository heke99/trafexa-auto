import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceLoader} from './helpers/source-loader.mjs';
import {billingFixture,id} from './helpers/advertising-billing/fixture.mjs';
async function harness(options={}){
 let reads=0,checks=0,adminChecks=0,selected=0;const row=billingFixture();if(options.admin)row.actorRole='platform_admin';
 const read=async input=>{reads++;assert.deepEqual(input,{companyId:id(1),month:'2026-09'});if(options.denyRead===reads)return{ok:false,code:'access_denied'};return{ok:true,page:{...row,...(reads===1?options.first:options.last)}};};
 const loader=await createSourceLoader({'server-only':{},
 '@/lib/data/company-context':{async getActiveCompanyContext(){selected++;if(options.noAuth)throw{code:'unauthenticated'};return{company:options.switchCompany&&selected>1?id(8):id(1),user:id(2),role:'finance'};}},
 '@/lib/contracts/context':{async requireContractContext(){checks++;if(options.denyContext||options.revoke&&checks>1)throw{code:'access_denied'};return{userId:id(2),companyId:id(1),role:options.changeRole&&checks>1?'sales':'finance'};}},
 '@/lib/platform-admin/context':{async requirePlatformAdminContext(){adminChecks++;if(options.notAdmin||options.revokeAdmin&&adminChecks>1)throw{code:'forbidden'};return{userId:id(2)};}},
 '@/lib/advertising/billing-actions':{listAdvertisingBillingAction:read,getPlatformAdvertisingBillingAction:read},
 });const route=loader.load('src/app/api/advertising/billing/[month]/csv/route.ts');return{get:(query=options.admin?`?companyId=${id(1)}`:'',month='2026-09')=>route.GET(new Request(`https://app.trafexa.com/api/advertising/billing/${month}/csv${query}`),{params:Promise.resolve({month})}),counts:()=>({reads,checks,adminChecks,selected})};
}
function privacy(r){assert.match(r.headers.get('cache-control'),/private, no-store/);assert.equal(r.headers.get('vary'),'Cookie');assert.equal(r.headers.get('x-content-type-options'),'nosniff');}
test('actual locked CSV route gives dealer or UUID-admin the immutable original with fresh readback/proofs',async()=>{
 for(const admin of [false,true]){const h=await harness({admin}),r=await h.get();assert.equal(r.status,200);privacy(r);assert.match(r.headers.get('content-type'),/text\/csv/);assert.ok((await r.text()).includes('9007199254740993'));assert.equal(h.counts().reads,2);assert.equal(h.counts().adminChecks,admin?2:0);}
});
test('invalid selector unauthenticated or missing admin/financial permission never fetches financial source',async()=>{
 for(const [options,query,month,status]of [[{noAuth:true},'','2026-09',401],[{notAdmin:true},`?companyId=${id(1)}`,'2026-09',403],[{denyContext:true},'','2026-09',403],[{},'?companyId=invalid','2026-09',404],[{},'?admin=true','2026-09',404],[{},'','2026-13',404]]){const h=await harness(options),r=await h.get(query,month);assert.equal(r.status,status);privacy(r);assert.equal(h.counts().reads,0);}
});
test('unlocked month or substituted company/actor/locked source cannot be exported as reviewed final',async()=>{
 for(const [options,status]of [[{first:{locked:null}},409],[{first:{companyId:id(8)}},503],[{first:{actorUserId:id(8)}},503],[{last:{locked:null}},503],[{last:{locked:{...billingFixture().locked,totalOre:'1'}}},503]]){const h=await harness(options),r=await h.get();assert.equal(r.status,status);privacy(r);assert.ok(!(await r.text()).includes('9007199254740993'));}
});
test('revoked account switched tenant role or admin registry during rendering withholds private bytes',async()=>{
 for(const options of [{revoke:true},{switchCompany:true},{changeRole:true},{admin:true,revokeAdmin:true},{denyRead:2}]){const h=await harness(options),r=await h.get();assert.equal(r.status,403);privacy(r);assert.ok(!(await r.text()).includes('9007199254740993'));}
});
test('unrelated current rate edits do not invalidate export of the preserved locked original',async()=>{
 const h=await harness({last:{rates:[{id:id(9),channel:'blocket',version:2,unitPriceOre:'999',effectiveAt:'2026-10-15T00:00:00Z'}]}}),r=await h.get();assert.equal(r.status,200);assert.ok((await r.text()).includes('9007199254740993'));
});
