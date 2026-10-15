import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceLoader} from './helpers/source-loader.mjs';
const id='ad300000-0000-4000-8000-000000000001',company='ad300000-0000-4000-8000-000000000002',user='ad300000-0000-4000-8000-000000000003';
async function setup(options={}){
 let accounts=0,companies=0,reads=0,renders=0;
 const account={userId:user,email:'customer@example.invalid',emailVerified:true,status:'approved'};
 const signing={id,companyId:company,status:'completed',draftVersion:2,content:'immutable'};
 const loader=await createSourceLoader({
 'server-only':{},
 '@/lib/account-access/context':{async getAccountAccessContext(){accounts++;return options.noAuth?null:{...account,...(accounts===1?options.firstAccount:options.lastAccount)};}},
 '@/lib/data/company-context':{async getActiveCompanyContext(){companies++;return {company,user,role:'finance',...(companies===1?options.firstCompany:options.lastCompany)};}},
 '@/lib/data/contract-signing-actions':{async getContractSigningAction(input){reads++;assert.equal(input.signingId,id);if(options.denial===reads)return{ok:false,code:'access_denied'};return{ok:true,signing:{...signing,...(reads===1?options.firstSigning:options.lastSigning)}};}},
 '@/lib/data/contract-archive-actions':{async getContractArchiveAction(input){return {ok:true,archive:null,actorId:user,companyId:company,signingId:id,role:input.companyId?'finance':'customer'};}},
 './signed-contract-pdf':{parseCompletedContract(v){if(v.status!=='completed'||options.malformed)throw Error('SECRET_DTO');return v;},async generateSignedContractPdf(){renders++;return new Uint8Array(Buffer.from('%PDF-private'));},async generateSigningEvidence(){renders++;return{checksum:'fixture'};}},
 });
 const route=loader.load('src/lib/documents/signed-contract-download.ts');return{get:(query='',format='pdf',path=id)=>route.downloadSignedContract(new Request(`https://app.trafexa.com/api/contract-signings/${path}/${format}${query}`),path,format),counts:()=>({accounts,companies,reads,renders})};
}
function privateResponse(r){assert.match(r.headers.get('cache-control'),/private, no-store/);assert.equal(r.headers.get('vary'),'Cookie');assert.equal(r.headers.get('x-content-type-options'),'nosniff');}
test('customer and selected-dealer completed files require exact reread and fresh account/role proof',async()=>{
 for(const query of ['',`?companyId=${company}`])for(const format of ['pdf','evidence']){const h=await setup(),r=await h.get(query,format);assert.equal(r.status,200);privateResponse(r);assert.equal(h.counts().reads,2);assert.equal(h.counts().accounts,2);assert.equal(h.counts().companies,query?2:0);assert.ok(r.headers.get('content-disposition').includes(format==='pdf'?'.pdf':'-signeringsbevis.json'));}
});
test('malformed selectors, unauthenticated/pending accounts, wrong tenant and sales role do not render',async()=>{
 for(const [config,query,status]of [[{noAuth:true},'',401],[{firstAccount:{status:'pending'}},'',403],[{firstAccount:{emailVerified:false}},'',403],[{firstCompany:{company:id}},`?companyId=${company}`,403],[{firstCompany:{role:'sales'}},`?companyId=${company}`,403],[{},'?provider=completed',404],[{},`?companyId=${company}&companyId=${company}`,404]]){const h=await setup(config),r=await h.get(query);assert.equal(r.status,status);privateResponse(r);assert.equal(h.counts().renders,0);}
});
test('pending signatures and wrong immutable binding never produce signed downloads',async()=>{
 for(const [config,status]of [[{firstSigning:{status:'pending'}},409],[{firstSigning:{id:company}},503],[{malformed:true},503],[{denial:1},403]]){const h=await setup(config),r=await h.get();assert.equal(r.status,status);assert.equal(h.counts().renders,0);privateResponse(r);}
});
test('revocation, switched actor/email/tenant/role or changed source during rendering withholds bytes',async()=>{
 for(const [config,query]of [[{lastAccount:{status:'suspended'}},''],[{lastAccount:{userId:company}},''],[{lastAccount:{email:'other@example.invalid'}},''],[{lastSigning:{content:'changed'}},''],[{denial:2},''],[{lastCompany:{company:id}},`?companyId=${company}`],[{lastCompany:{role:'sales'}},`?companyId=${company}`]]){const h=await setup(config),r=await h.get(query);assert.ok([403,503].includes(r.status));privateResponse(r);assert.ok(!(await r.text()).includes('%PDF'));assert.equal(h.counts().renders,1);}
});
