import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';
import { parseContractDraft } from '../src/lib/documents/contract-pdf.ts';
const company='cd290000-0000-4000-8000-000000000001',draftId='cd290000-0000-4000-8000-000000000002',actor='cd290000-0000-4000-8000-000000000003';
const bytes=Buffer.from('%PDF-1.7\nprivate unsigned immutable draft');
async function harness(config={}){
  let activeReads=0,proofs=0,reads=0,renders=0;const role=config.role??'finance';
  const loader=await createSourceLoader({
    '@/lib/data/company-context':{async getActiveCompanyContext(){activeReads++;if(config.unauthenticated)throw Error('PRIVATE_AUTH');return{company,user:actor,role};}},
    '@/lib/contracts/context':{async requireContractContext(id){proofs++;assert.equal(id,company);if(config.proofFailure?.at===proofs)throw{code:config.proofFailure.code,message:'PRIVATE_AUTH'};return{companyId:company,userId:proofs===2&&config.actorChanged?draftId:actor,role:proofs===2&&config.roleChanged?'sales':role};}},
    '@/lib/data/contract-actions':{async getSaleContractDraftAction(input){reads++;assert.deepEqual(input,{companyId:company,draftId});if(config.failure?.at===reads)return{ok:false,code:config.failure.code,message:'PRIVATE_BACKEND'};return{ok:true,draft:{id:draftId,companyId:company,version:2,source:'immutable source',...(reads===1?config.firstChanges:config.lastChanges)}};}},
    '@/lib/documents/contract-pdf':{parseContractDraft(value){if(config.malformed)throw Error('PRIVATE_DTO');return value;},async generateContractPdf(){renders++;if(config.renderFailure)throw Error('PRIVATE_RENDER');return bytes;}},
  });const route=loader.load('src/app/api/contracts/[id]/pdf/route.ts');return{get:(id=draftId)=>route.GET(new Request(`https://app.trafexa.com/api/contracts/${id}/pdf?companyId=${draftId}&providerState=completed`),{params:Promise.resolve({id})}),counts:()=>({activeReads,proofs,reads,renders})};
}
function privacy(response){assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(response.headers.get('vary'),'Cookie');assert.equal(response.headers.get('x-content-type-options'),'nosniff');}
test('actual route returns one private unsigned draft for owner/admin/finance with exact reread and fresh actor proof',async()=>{
  for(const role of ['owner','admin','finance']){const h=await harness({role}),result=await h.get();assert.equal(result.status,200);privacy(result);assert.equal(result.headers.get('content-type'),'application/pdf');assert.equal(result.headers.get('content-disposition'),`attachment; filename="avtalsutkast-${draftId}-v2.pdf"`);assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes);assert.deepEqual(h.counts(),{activeReads:1,proofs:2,reads:2,renders:1});}
});
test('sales/viewer, invalid UUID and unauthenticated or unapproved account never reach draft reading',async()=>{
  for(const [config,status]of [[{role:'sales'},403],[{role:'viewer'},403],[{unauthenticated:true},401],[{proofFailure:{at:1,code:'access_denied'}},403]]){const h=await harness(config),result=await h.get();assert.equal(result.status,status);privacy(result);assert.equal(h.counts().reads,0);assert.equal(h.counts().renders,0);}
  const h=await harness(),result=await h.get('../private');assert.equal(result.status,404);assert.deepEqual(h.counts(),{activeReads:0,proofs:0,reads:0,renders:0});
});
test('wrong company or draft identity and malformed source cannot generate a PDF',async()=>{
  for(const config of [{firstChanges:{id:actor}},{firstChanges:{companyId:draftId}},{malformed:true}]){const h=await harness(config),result=await h.get();assert.equal(result.status,503);privacy(result);assert.equal(h.counts().renders,0);assert.ok(!(await result.text()).includes('PRIVATE_'));}
});
test('changed frozen data, actor, role or revoked approval/session after rendering never releases private bytes',async()=>{
  for(const config of [{lastChanges:{source:'mutated source'}},{actorChanged:true},{roleChanged:true},{proofFailure:{at:2,code:'access_denied'}},{proofFailure:{at:2,code:'unauthenticated'}},{failure:{at:2,code:'access_denied'}}]){const h=await harness(config),result=await h.get();assert.ok([401,403,503].includes(result.status));privacy(result);assert.equal(h.counts().renders,1);assert.ok(!(await result.text()).startsWith('%PDF-'));}
});
test('failed exact source read or font/render error returns a controlled private response without leaking provider or party data',async()=>{
  for(const config of [{failure:{at:1,code:'unavailable'}},{failure:{at:1,code:'invalid_input'}},{renderFailure:true}]){const h=await harness(config),result=await h.get();assert.ok([404,503].includes(result.status));privacy(result);assert.ok(!(await result.text()).includes('PRIVATE_'));}
});

test('actual route, action and context trust fresh Auth and current membership before and after the PDF work',async()=>{
  for(const blocked of [null,'stale_claims','lost_auth','lost_membership','changed_actor']){
    let authReads=0,rpcReads=0,renders=0;
    const offer={schema_version:1,document_type:'offer',version:3,deal_id:actor,issued_at:'2026-10-13T14:00:00Z',valid_until:'2026-11-12',terms:'Originalvillkor måste bevaras.',currency:'SEK',price_basis:'gross',sale_price_ore:'19900029',company:{id:company,name:'Åberg Bil AB',organisation_number:'5560000001'},customer:{id:actor,name:'Änne Öström',kind:'person',email:null,phone:null,address:null},stock:{id:actor,vat_scheme:'standard'},vehicle:{id:actor,registration_number:'ABC123',vin:null,make:'Volvo',model:'Öresund',model_year:2020,mileage_km:50123,fuel:'hybrid',gearbox:'automatic'},vat:{rate_percent:25,amount_ore:'3980006',net_price_ore:'15920023'}};
    const raw={id:draftId,companyId:company,dealId:actor,version:2,offerId:actor,offerVersion:3,template:{id:actor,templateId:actor,version:4,approvalVersion:2,title:'Godkänd mall',body:'Kund {{customer.name}}, pris {{offer.price_ore}}.'},sourceOffer:offer,createdAt:'2026-10-14T17:00:00Z',createdBy:actor};
    const db={auth:{async getClaims(){assert.fail('Stale claims cannot authorize contracts');},async getUser(){authReads++;const late=authReads===6;return{error:null,data:{user:blocked==='stale_claims'||late&&blocked==='lost_auth'?null:{id:late&&blocked==='changed_actor'?draftId:actor,email:'actor@example.invalid',email_confirmed_at:'2026-10-14T10:00:00Z',is_anonymous:false}}};}},
      from(table){assert.equal(table,'memberships');const query={select(){return query;},eq(){return query;},async maybeSingle(){return{error:null,data:authReads===6&&blocked==='lost_membership'?null:{company_id:company,user_id:actor,role:'finance',status:'active',companies:{id:company,status:'active'}}};}};return query;},
      async rpc(name,args){rpcReads++;assert.equal(name,'get_sale_contract_draft');assert.deepEqual(args,{p_company_id:company,p_draft_id:draftId});return{error:null,data:{companyId:company,actorUserId:actor,actorRole:'finance',draft:raw}};}};
    const loader=await createSourceLoader({'@/lib/data/company-context':{getActiveCompanyContext:async()=>({company,user:actor,role:'finance'})},'@/lib/supabase/server':{createServerSupabaseClient:async()=>db},'next/cache':{revalidatePath(){assert.fail('GET cannot mutate');}},'@/lib/documents/contract-pdf':{parseContractDraft,async generateContractPdf(value){renders++;assert.equal(value.actorLabel,'Du');return bytes;}}});
    const route=loader.load('src/app/api/contracts/[id]/pdf/route.ts'),result=await route.GET(new Request(`https://app.trafexa.com/api/contracts/${draftId}/pdf`),{params:Promise.resolve({id:draftId})});privacy(result);
    if(blocked===null){assert.equal(result.status,200);assert.equal(authReads,6);assert.equal(rpcReads,2);assert.equal(renders,1);}else{assert.ok([401,403].includes(result.status),`${blocked}: ${result.status}`);assert.ok(!(await result.text()).startsWith('%PDF-'));if(blocked==='stale_claims'){assert.equal(renders,0);assert.equal(rpcReads,0);}else assert.equal(renders,1);}
  }
});
