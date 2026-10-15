import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceLoader} from './helpers/source-loader.mjs';
const company='ac340000-0000-4000-8000-000000000001',actor='ac340000-0000-4000-8000-000000000002';
async function harness(options={}){
 let reads=0,proofs=0,platformProofs=0,selected=0;
 const counts={queued:0,dispatching:0,outcomeUnknown:0,submitted:0,published:0,rejected:0,retryable:0,newPublications:0};
 const row={ok:true,companyId:company,actorUserId:actor,actorRole:options.admin?'platform_admin':'finance',month:'2026-10',timeZone:'Europe/Stockholm',periodStart:'2026-09-30T22:00:00Z',periodEnd:'2026-10-31T23:00:00Z',trackingStartedAt:'2026-10-14T17:00:00Z',legacyPublishedJobs:0,totals:{...counts,drafts:2,ready:1},channels:[{...counts,channel:'blocket'},{...counts,channel:'wayke'}],billing:{status:'quantity_only',unitPriceOre:null,totalOre:null,unpricedPublications:0}};
 const read=async input=>{reads++;assert.deepEqual(input,{companyId:company,month:'2026-10'});if(options.denial===reads)return{ok:false,code:'access_denied'};return{...row,...(reads===1?options.first:options.last)};};
 const loader=await createSourceLoader({'server-only':{},
 '@/lib/data/company-context':{async getActiveCompanyContext(){selected++;if(options.noAuth)throw{code:'unauthenticated'};return{company:options.changedSelected&&selected>1?actor:company,user:actor,role:'finance'};}},
 '@/lib/contracts/context':{async requireContractContext(){proofs++;if(options.deniedProof===proofs)throw{code:'access_denied'};return{companyId:company,userId:options.changedActor&&proofs>1?company:actor,role:options.changedRole&&proofs>1?'sales':'finance'};}},
 '@/lib/platform-admin/context':{async requirePlatformAdminContext(){platformProofs++;if(options.nonAdmin||options.revokeAdmin&&platformProofs>1)throw{code:'forbidden'};return{userId:actor};}},
 '@/lib/advertising/usage-actions':{listAdvertisingUsageAction:read,getPlatformAdvertisingUsageAction:read},
 });const route=loader.load('src/app/api/advertising/usage/[month]/csv/route.ts');return{get:(query=options.admin?`?companyId=${company}`:'',month='2026-10')=>route.GET(new Request(`https://app.trafexa.com/api/advertising/usage/${month}/csv${query}`),{params:Promise.resolve({month})}),counts:()=>({reads,proofs,platformProofs,selected})};
}
function privacy(r){assert.match(r.headers.get('cache-control'),/private, no-store/);assert.equal(r.headers.get('vary'),'Cookie');assert.equal(r.headers.get('x-content-type-options'),'nosniff');}
test('dealer or real platform-admin downloads exact month with private headers and fresh scoped rechecks',async()=>{
 for(const admin of [false,true]){const h=await harness({admin}),r=await h.get();assert.equal(r.status,200);privacy(r);assert.equal(r.headers.get('content-type'),'text/csv; charset=utf-8');assert.ok((await r.text()).includes('Priser ingår inte'));assert.equal(h.counts().reads,2);assert.equal(h.counts().platformProofs,admin?2:0);}
});
test('invalid month/query/company and unauthenticated/unprivileged caller never receive underlying counts',async()=>{
 for(const [options,query,month,status]of [[{noAuth:true},'','2026-10',401],[{nonAdmin:true},`?companyId=${company}`,'2026-10',403],[{},'?role=platform_admin','2026-10',404],[{},'?companyId=invalid','2026-10',404],[{},'','2026-13',404],[{deniedProof:1},'','2026-10',403]]){const h=await harness(options),r=await h.get(query,month);assert.equal(r.status,status);privacy(r);assert.equal(h.counts().reads,0);}
});
test('forged actor/company/month and revoked current account or role cannot release report bytes',async()=>{
 for(const options of [{first:{companyId:actor}},{first:{actorUserId:company}},{first:{month:'2026-09'}},{changedActor:true},{changedRole:true},{changedSelected:true},{admin:true,revokeAdmin:true},{denial:2}]){const h=await harness(options),r=await h.get();assert.ok([403,503].includes(r.status));privacy(r);assert.ok(!(await r.text()).includes('Priser ingår inte'));}
});
test('changed report totals during rendering return controlled failure instead of inconsistent billing basis',async()=>{
 const h=await harness({last:{legacyPublishedJobs:1}}),r=await h.get();assert.equal(r.status,503);privacy(r);assert.equal(h.counts().reads,2);assert.ok(!(await r.text()).includes('Totalt'));
});
