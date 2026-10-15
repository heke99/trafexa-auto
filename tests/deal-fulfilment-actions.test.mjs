import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';
const id=n=>`fc230000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const companyId=id(1),dealId=id(2),actorId=id(3),requestId=id(4);
const scope={companyId,dealId};
const payment={...scope,requestId,operation:'payment',expectedVersion:0,amountOre:'12345',bankReference:'BANK-001',bookedOn:'2026-10-15',reason:'Kontrollerat bankunderlag'};
const base={...scope,actorId,role:'owner',version:0,businessDate:'2026-10-15',source:null,blockedReason:'original_required',entries:[],registeredOre:'0',delivery:null,canDeliver:false};
async function setup(options={}){
 const calls=[],invalidations=[];let contexts=0;
 class CrmError extends Error{constructor(code){super(code);this.code=code;}}
 const loader=await createSourceLoader({'next/cache':{revalidatePath(p){invalidations.push(p);}},'@/lib/crm/context':{CrmError,async requireCrmContext(company){contexts++;if(options.foreign||company!==companyId)throw new CrmError('access_denied');return {companyId,userId:actorId,role:options.demoted&&contexts>1?'sales':options.role??'owner',db:{async rpc(name,args){calls.push([name,args]);return{data:options.data??{...base,role:options.role??'owner'},error:options.error??null};}}};}},'@/lib/account-access/context':{async requireApprovedAccountAccess(){if(options.unapproved)throw new CrmError('access_denied');return{userId:options.otherActor?dealId:actorId};}}});
 return{actions:loader.load('@/lib/deal-fulfilment/actions'),calls,invalidations};
}
test('fulfilment actual context supports owner/admin writes, finance reads and no sales/viewer data',async()=>{
 for(const role of['owner','admin','finance','sales','viewer']){const h=await setup({role});const r=await h.actions.getDealFulfilmentAction(scope);assert.equal(r.ok,['owner','admin','finance'].includes(role),role);const before=h.calls.length;const w=await h.actions.mutateDealFulfilmentAction(payment);assert.equal(w.ok,['owner','admin'].includes(role),role);if(!['owner','admin'].includes(role))assert.equal(h.calls.length,before);}
});
test('fulfilment validates operation-specific financial input before RPC',async()=>{
 const h=await setup();for(const patch of[{amountOre:'1.25'},{amountOre:'0'},{amountOre:'001'},{amountOre:'1000000000000'},{expectedVersion:-1},{operation:'reverse'},{operation:'deliver'},{bankReference:'bad\nref'},{reason:'x'},{actorId},{companyId:'bad'}]){const r=await h.actions.mutateDealFulfilmentAction({...payment,...patch});assert.equal(r.ok,false,JSON.stringify(patch));assert.equal(r.code,'invalid_input');}assert.equal(h.calls.length,0);
});
test('fulfilment fresh post-read role demotion, approval and company identity fail closed',async()=>{
 for(const options of[{demoted:true},{unapproved:true},{foreign:true},{otherActor:true}]){const h=await setup(options);assert.equal((await h.actions.getDealFulfilmentAction(scope)).ok,false);assert.equal(h.invalidations.length,0);}
});
test('fulfilment rejects forged scope, actor, role, extra/private fields and malformed exact amounts',async()=>{
 for(const patch of[{companyId:dealId},{dealId:actorId},{actorId:dealId},{role:'finance'},{purchasePriceOre:'100'},{registeredOre:'1.5'},{canDeliver:null}]){const h=await setup({data:{...base,...patch}});assert.equal((await h.actions.getDealFulfilmentAction(scope)).ok,false,JSON.stringify(patch));}
});
test('fulfilment RPC binds company/deal/payload and invalidates only a verified mutation',async()=>{
 const h=await setup();assert.equal((await h.actions.mutateDealFulfilmentAction(payment)).ok,true);assert.deepEqual(h.calls,[['mutate_deal_fulfilment',{p_company_id:companyId,p_deal_id:dealId,p_input:payment}]]);assert.deepEqual(h.invalidations,['/deals','/inventory','/dashboard']);
});
test('fulfilment typed conflicts/access/validation failures and unknown diagnostics stay private',async()=>{
 for(const [code,expected]of[['40001','conflict'],['23505','conflict'],['42501','access_denied'],['22023','invalid_input'],['22008','invalid_input'],['XX000','unavailable']]){const h=await setup({error:{code,message:'secret diagnostic'}});const r=await h.actions.mutateDealFulfilmentAction(payment);assert.equal(r.code,expected);assert.doesNotMatch(r.message,/secret/);assert.equal(h.invalidations.length,0);}
});
