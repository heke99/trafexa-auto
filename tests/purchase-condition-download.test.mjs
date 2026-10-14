import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';
import { parsePurchaseConditionSnapshot } from '../src/lib/documents/purchase-condition-pdf.ts';

const company = 'cc190000-0000-4000-8000-000000000001', stock = 'cc190000-0000-4000-8000-000000000002', actor = 'cc190000-0000-4000-8000-000000000003';
const saved = () => ({ id: stock, companyId: company, stockId: stock, version: 4, immutable: 'saved value' });
const bytes = Buffer.from('%PDF-1.7\nprivate immutable purchase version');
async function harness(config = {}) {
  let activeReads = 0, proofs = 0, reads = 0, renders = 0;
  const role = config.role ?? 'finance';
  const loader = await createSourceLoader({
    '@/lib/data/company-context': { async getActiveCompanyContext() { activeReads++; if (config.noActive) throw Error('Auth private data'); return { company, user: actor, role }; } },
    '@/lib/purchase-condition/context': { async requirePurchaseConditionContext(id) { proofs++; assert.equal(id, company); if (config.proofFailure && proofs === config.proofFailure.at) throw { code: config.proofFailure.code, message: 'PRIVATE_PROOF_SECRET' }; return {companyId:company,userId:proofs > 1 && config.actorChanged ? stock : actor,role:proofs > 1 && config.roleChanged ? 'sales' : role}; } },
    '@/lib/data/purchase-condition-actions': { async getPurchaseConditionVersionAction(input) { reads++; assert.deepEqual(input, {companyId:company,stockId:stock,version:4}); if (config.failure && reads === config.failure.at) return {ok:false,code:config.failure.code,message:'PRIVATE_BACKEND_SECRET'}; return {ok:true,purchaseCondition:{...saved(),...(reads === 1 ? config.firstChanges : config.lastChanges)}}; } },
    '@/lib/documents/purchase-condition-pdf': {
      parsePurchaseConditionSnapshot(value) { if (config.malformed) throw Error('PRIVATE_DTO_SECRET'); return value; },
      async generatePurchaseConditionPdf(value) { renders++; assert.equal(value.version, 4); if (config.renderFailure) throw Error('PRIVATE_RENDER_SECRET'); return bytes; },
    },
  });
  const handler = loader.load('src/app/api/purchase-condition/[stockId]/[version]/pdf/route.ts');
  return { get: (params = {stockId:stock,version:'4'}) => handler.GET(new Request(`https://app.trafexa.com/api/purchase-condition/${stock}/4/pdf?companyId=${stock}`), {params:Promise.resolve(params)}), counts:()=>({activeReads,proofs,reads,renders}) };
}
function privateFailure(response) { assert.match(response.headers.get('cache-control'), /private, no-store/); assert.equal(response.headers.get('vary'), 'Cookie'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); }
test('actual route binds cookie-selected company and exact version, with fresh actor proof before and after rendering', async () => {
  for (const role of ['owner','admin','finance']) {
    const h = await harness({role}), result = await h.get(); assert.equal(result.status,200); privateFailure(result);
    assert.equal(result.headers.get('content-type'),'application/pdf'); assert.match(result.headers.get('content-disposition'),new RegExp(`${stock}-v4.pdf`));
    assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes); assert.deepEqual(h.counts(),{activeReads:1,proofs:2,reads:2,renders:1});
  }
});
test('sales/viewer and unauthenticated or pending account proofs cannot read or generate the private PDF', async () => {
  for (const [config,status] of [[{role:'sales'},403],[{role:'viewer'},403],[{noActive:true},401],[{proofFailure:{at:1,code:'access_denied'}},403],[{proofFailure:{at:1,code:'unauthenticated'}},401]]) {
    const h = await harness(config), result = await h.get(); assert.equal(result.status,status); privateFailure(result); assert.equal(h.counts().reads,0); assert.equal(h.counts().renders,0);
    assert.ok(!(await result.text()).includes('PRIVATE_'));
  }
});
test('malformed stock/version identifiers are rejected before authentication or backend reads', async () => {
  for (const params of [{stockId:'../private',version:'4'},...['0','04','-1','1e2','2147483648','9007199254740993'].map(version=>({stockId:stock,version}))]) {
    const h = await harness(), result = await h.get(params); assert.equal(result.status,404); privateFailure(result); assert.deepEqual(h.counts(),{activeReads:0,proofs:0,reads:0,renders:0});
  }
});
test('wrong company, stock, version and malformed DTO fail before PDF rendering', async () => {
  for (const config of [{firstChanges:{companyId:stock}},{firstChanges:{stockId:company}},{firstChanges:{version:5}},{malformed:true}]) {
    const h = await harness(config), result = await h.get(); assert.equal(result.status,503); privateFailure(result); assert.equal(h.counts().renders,0); assert.ok(!(await result.text()).includes('PRIVATE_'));
  }
});
test('revoked Auth/approval/membership, changed actor/role or changed immutable source after rendering never releases bytes', async () => {
  for (const config of [{proofFailure:{at:2,code:'access_denied'}},{proofFailure:{at:2,code:'unauthenticated'}},{actorChanged:true},{roleChanged:true},{failure:{at:2,code:'access_denied'}},{lastChanges:{immutable:'mutated'}}]) {
    const h = await harness(config), result = await h.get(); assert.ok([401,403,503].includes(result.status)); privateFailure(result);
    assert.equal(h.counts().renders,1); assert.ok(!(await result.text()).startsWith('%PDF-'));
  }
});
test('backend or render failures return controlled private responses without supplier/Auth/provider information', async () => {
  for (const config of [{failure:{at:1,code:'unavailable'}},{failure:{at:1,code:'invalid_input'}},{renderFailure:true}]) {
    const h = await harness(config), result = await h.get(); assert.ok([404,503].includes(result.status)); privateFailure(result); assert.ok(!(await result.text()).includes('PRIVATE_'));
  }
});

test('actual route, actual action and actual context use fresh getUser and current membership before and after rendering', async () => {
  for (const blocked of [null, 'stale_claims', 'lost_auth', 'unverified', 'approval_or_membership_revoked', 'actor_changed']) {
    let authReads = 0, rpcReads = 0, renders = 0;
    const raw = { ...saved(), company:{name:'Åberg Bil AB',organisationNumber:'5560000001'},
      basis:{purchasePriceOre:'10000029',vatScheme:'standard',purchaseVatOre:'2000006',vatBasisConfirmed:false,calculationVersion:'9007199254740993',vehicle:{id:stock,registration:'ABC123',make:'Volvo',model:'Öresund',modelYear:2020,mileageKm:50123}},
      supplierKind:'person',supplierName:'Änne Öström',supplierOrganisationNumber:null,acquiredOn:'2026-10-10',documentReference:null,checkedOn:'2026-10-09',mileageKm:50125,
      conditions:Object.fromEntries(['body','interior','engine','transmission','tyres','service'].map(key=>[key,{status:'unassessed',notes:''}])),repairEstimateOre:null,createdAt:'2026-10-14T15:00:00Z',createdBy:actor };
    const db = {
      auth:{
        async getClaims(){assert.fail('Cached claims must not authorize a private PDF');},
        async getUser(){authReads++;const late=authReads===6;return{error:null,data:{user:blocked==='stale_claims'||late&&blocked==='lost_auth'?null:{id:late&&blocked==='actor_changed'?stock:actor,email:'actor@example.invalid',email_confirmed_at:late&&blocked==='unverified'?null:'2026-10-14T10:00:00Z',is_anonymous:false}}};},
      },
      from(table){assert.equal(table,'memberships');const query={select(){return query;},eq(){return query;},async maybeSingle(){return{error:null,data:authReads===6&&blocked==='approval_or_membership_revoked'?null:{company_id:company,user_id:actor,role:'finance',status:'active',companies:{id:company,status:'active'}}};}};return query;},
      async rpc(name,args){rpcReads++;assert.equal(name,'get_purchase_condition_version');assert.deepEqual(args,{p_company_id:company,p_stock_id:stock,p_version:4});return{error:null,data:{companyId:company,actorUserId:actor,actorRole:'finance',purchaseCondition:raw}};},
    };
    const loader = await createSourceLoader({
      '@/lib/data/company-context':{getActiveCompanyContext:async()=>({company,user:actor,role:'finance'})},
      '@/lib/supabase/server':{createServerSupabaseClient:async()=>db},'next/cache':{revalidatePath(){assert.fail('GET must not mutate');}},
      '@/lib/documents/purchase-condition-pdf':{parsePurchaseConditionSnapshot,async generatePurchaseConditionPdf(value){renders++;assert.equal(value.actorLabel,'Du');return bytes;}},
    });
    const route = loader.load('src/app/api/purchase-condition/[stockId]/[version]/pdf/route.ts');
    const result = await route.GET(new Request(`https://app.trafexa.com/api/purchase-condition/${stock}/4/pdf`),{params:Promise.resolve({stockId:stock,version:'4'})});
    privateFailure(result);
    if(blocked===null){assert.equal(result.status,200);assert.equal(authReads,6);assert.equal(rpcReads,2);assert.equal(renders,1);}
    else {assert.ok([401,403].includes(result.status),`${blocked}: ${result.status}`);assert.ok(!(await result.text()).startsWith('%PDF-'));if(blocked==='stale_claims'){assert.equal(renders,0);assert.equal(rpcReads,0);}else assert.equal(renders,1);}
  }
});
