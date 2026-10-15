import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceLoader} from './helpers/source-loader.mjs';
import {correctionFixture,id} from './helpers/advertising-corrections/fixture.mjs';

async function harness(options={}){
  let reads=0,checks=0,adminChecks=0,selected=0;
  const row=correctionFixture();if(options.admin)row.actorRole='platform_admin';
  const read=async input=>{
    reads++;assert.deepEqual(input,{companyId:id(1),month:'2026-09'});
    if(options.denyRead===reads)return{ok:false,code:'access_denied'};
    const result={...row,...(reads===1?options.first:options.last)};
    if(reads>1&&options.newReduction){const next=correctionFixture({amount:'994'});Object.assign(result,next,{actorRole:row.actorRole});}
    return{ok:true,page:result};
  };
  const loader=await createSourceLoader({
    '@/lib/data/company-context':{async getActiveCompanyContext(){selected++;if(options.noAuth)throw{code:'unauthenticated'};return{company:options.switchCompany&&selected>1?id(8):id(1),user:id(2),role:'finance'};}},
    '@/lib/contracts/context':{async requireContractContext(){checks++;if(options.denyContext||options.revoke&&checks>1)throw{code:'access_denied'};return{userId:id(2),companyId:id(1),role:options.changeRole&&checks>1?'sales':'finance'};}},
    '@/lib/platform-admin/context':{async requirePlatformAdminContext(){adminChecks++;if(options.notAdmin||options.revokeAdmin&&adminChecks>1)throw{code:'forbidden'};return{userId:id(2)};}},
    '@/lib/advertising/correction-actions':{listAdvertisingCorrectionsAction:read,getPlatformAdvertisingCorrectionsAction:read},
  });
  const route=loader.load('src/app/api/advertising/billing/[month]/corrections/csv/route.ts');
  return{get:(query=options.admin?`?companyId=${id(1)}`:'',month='2026-09')=>route.GET(new Request(`https://app.trafexa.com/api/advertising/billing/${month}/corrections/csv${query}`),{params:Promise.resolve({month})}),reads:()=>reads};
}
function privacy(response){assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(response.headers.get('vary'),'Cookie');assert.equal(response.headers.get('x-content-type-options'),'nosniff');}
test('private corrected download provides exact reviewed scope to dealer or actual superadmin with fresh readback',async()=>{
  for(const admin of [false,true]){const h=await harness({admin}),r=await h.get();assert.equal(r.status,200);privacy(r);assert.match(r.headers.get('content-type'),/text\/csv/);assert.ok((await r.text()).includes('9007199254740000'));assert.equal(h.reads(),2);}
});
test('malformed selectors and unverified access deny before private data read',async()=>{
  for(const [options,query,month,status]of [[{noAuth:true},'','2026-09',401],[{notAdmin:true},`?companyId=${id(1)}`,'2026-09',403],[{denyContext:true},'','2026-09',403],[{},'?companyId=invalid','2026-09',404],[{},'?admin=true','2026-09',404],[{},`?companyId=${id(1)}&companyId=${id(1)}`,'2026-09',404],[{},'','2026-13',404]]){
    const h=await harness(options),r=await h.get(query,month);assert.equal(r.status,status);privacy(r);assert.equal(h.reads(),0);
  }
});
test('unlocked or forged corrected data never produces private CSV bytes',async()=>{
  for(const [options,status]of [[{first:{original:null}},409],[{first:{companyId:id(8)}},503],[{first:{actorUserId:id(8)}},503],[{first:{netTotalOre:'1'}},503],[{last:{original:null}},409],[{last:{actorRole:'owner'}},503]]){
    const h=await harness(options),r=await h.get();assert.equal(r.status,status);privacy(r);assert.ok(!(await r.text()).includes('9007199254740000'));
  }
});
test('new concurrent ledger revision withholds bytes so the user can reload and review',async()=>{
  const h=await harness({newReduction:true}),r=await h.get();assert.equal(r.status,409);privacy(r);assert.ok(!(await r.text()).includes('9007199254740000'));
});
test('revoked account admin status switched company or changed role during export denies all bytes',async()=>{
  for(const options of [{revoke:true},{switchCompany:true},{changeRole:true},{admin:true,revokeAdmin:true},{denyRead:2}]){
    const h=await harness(options),r=await h.get();assert.equal(r.status,403);privacy(r);assert.ok(!(await r.text()).includes('9007199254740000'));
  }
});
