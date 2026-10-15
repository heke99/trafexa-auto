import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceLoader} from './helpers/source-loader.mjs';
import {financialAssessment,id} from './helpers/advertising-financial/fixture.mjs';

async function harness(options={}){
 let reads=0,checks=0,adminChecks=0,selected=0,renders=0;
 const draft=financialAssessment();
 const read=async input=>{
  reads++;assert.deepEqual(input,{companyId:id(1),id:id(70)});
  if(options.denyRead===reads)return{ok:false,code:'access_denied'};
  if(options.missing)return{ok:false,code:'not_found'};
  return{ok:true,assessment:{...draft,...(reads===1?options.first:options.last)},isOutdated:reads>1&&Boolean(options.outdated)};
 };
 const loader=await createSourceLoader({
  '@/lib/data/company-context':{async getActiveCompanyContext(){selected++;if(options.noAuth)throw{code:'unauthenticated'};return{company:options.switchCompany&&selected>1?id(8):id(1),user:id(2),role:options.role??'finance'};}},
  '@/lib/contracts/context':{async requireContractContext(){checks++;if(options.denyContext||options.revoke&&checks>1)throw{code:'access_denied'};return{userId:id(2),companyId:id(1),role:options.changeRole&&checks>1?'sales':options.role??'finance'};}},
  '@/lib/platform-admin/context':{async requirePlatformAdminContext(){adminChecks++;if(options.notAdmin||options.revokeAdmin&&adminChecks>1)throw{code:'forbidden'};return{userId:id(2)};}},
  '@/lib/advertising/financial-actions':{getAdvertisingFinancialAssessmentAction:read,getPlatformAdvertisingFinancialAssessmentAction:read},
  '@/lib/documents/advertising-financial-pdf':{async generateAdvertisingFinancialPdf(value){renders++;assert.equal(value.id,id(70));if(options.renderFailure)throw Error('PRIVATE INTERNAL FAILURE');return new TextEncoder().encode('%PDF-TEST-PRIVATE');}},
 });
 const route=loader.load('src/app/api/advertising/financial/[id]/pdf/route.ts');
 return{get:(query=options.admin?`?companyId=${id(1)}`:'',draftId=id(70))=>route.GET(new Request(`https://app.trafexa.com/api/advertising/financial/${draftId}/pdf${query}`),{params:Promise.resolve({id:draftId})}),counts:()=>({reads,renders})};
}
function privacy(r){assert.match(r.headers.get('cache-control'),/private, no-store/);assert.equal(r.headers.get('vary'),'Cookie');assert.equal(r.headers.get('x-content-type-options'),'nosniff');}
test('selected saved reviewed assessment downloads privately for own finance or actual superadmin with fresh scope proofs',async()=>{
 for(const admin of[false,true]){const h=await harness({admin}),r=await h.get();assert.equal(r.status,200);privacy(r);assert.equal(r.headers.get('content-type'),'application/pdf');assert.ok(r.headers.get('content-disposition').includes('v1.pdf'));assert.equal(await r.text(),'%PDF-TEST-PRIVATE');assert.equal(h.counts().reads,2);}
});
test('untrusted company/query/id or unauthenticated and nonfinancial roles cannot reach financial sources',async()=>{
 for(const[options,query,draftId,status]of[[{noAuth:true},'',id(70),401],[{notAdmin:true},`?companyId=${id(1)}`,id(70),403],[{role:'sales'},'',id(70),403],[{role:'viewer'},'',id(70),403],[{denyContext:true},'',id(70),403],[{},'?companyId=bad',id(70),404],[{},'?role=platform_admin',id(70),404],[{},`?companyId=${id(1)}&companyId=${id(1)}`,id(70),404],[{},'','invalid',404]]){
  const h=await harness(options),r=await h.get(query,draftId);assert.equal(r.status,status);privacy(r);assert.deepEqual(h.counts(),{reads:0,renders:0});
 }
});
test('foreign draft/company substitutions and changing immutable version withhold all rendered bytes',async()=>{
 for(const options of[{first:{companyId:id(9)}},{first:{id:id(9)}},{last:{version:4}},{last:{sourceHash:'a'.repeat(64)}},{last:{companyId:id(9)}}]){
  const h=await harness(options),r=await h.get();assert.equal(r.status,503);privacy(r);assert.ok(!(await r.text()).includes('%PDF'));
 }
});
test('new current profiles may mark a saved draft outdated without rewriting or blocking its historical PDF',async()=>{
 const h=await harness({outdated:true}),r=await h.get();assert.equal(r.status,200);privacy(r);assert.equal(await r.text(),'%PDF-TEST-PRIVATE');
});
test('revoked approval/admin status, role or selected company during render prevents private byte release',async()=>{
 for(const options of[{revoke:true},{switchCompany:true},{changeRole:true},{admin:true,revokeAdmin:true},{denyRead:2}]){
  const h=await harness(options),r=await h.get();assert.equal(r.status,403);privacy(r);assert.ok(!(await r.text()).includes('%PDF'));
 }
});
test('missing draft or rendering failure returns sanitized private errors without internal diagnostics',async()=>{
 for(const[options,status]of[[{missing:true},404],[{renderFailure:true},503]]){const h=await harness(options),r=await h.get();assert.equal(r.status,status);privacy(r);assert.ok(!(await r.text()).includes('PRIVATE INTERNAL'));}
});
