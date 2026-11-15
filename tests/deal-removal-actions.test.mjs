import test from'node:test';import assert from'node:assert/strict';
import{fixture,call,id,U,C,OTHER,prepare}from'./helpers/direct-deal-harness.mjs';
import{createSourceLoader}from'./helpers/source-loader.mjs';
async function actions(db,{revokeAfter=null}={}){
 let revoked=false;const invalidations=[];
 async function context(company){
  if(revoked||company!==C)throw{code:'access_denied'};
  return{companyId:C,userId:U,role:'owner',db:{async rpc(name,args){
   try{const data=await call(db,name,args);if(name===revokeAfter)revoked=true;return{data,error:null};}
   catch(error){return{data:null,error};}
  }}};
 }
 const loader=await createSourceLoader({'@/lib/crm/context':{requireCrmContext:context},'@/lib/account-access/context':{requireApprovedAccountAccess:async()=>({userId:revoked?OTHER:U})},'next/cache':{revalidatePath:path=>invalidations.push(path)}});
 return{module:loader.load('@/lib/deal-archives/actions'),invalidations};
}
test('actual action review and exact same request remove unsigned primary draft once and revalidate both views',async()=>{const db=await fixture();try{const{review}=await call(db,'prepare_direct_deal',prepare()),a=await actions(db),scope={companyId:C,dealId:review.dealId},p=await a.module.getDealDeleteAction(scope);assert.equal(p.ok,true);assert.equal(p.page.canDelete,true);const input={...scope,reviewHash:p.page.reviewHash,acknowledged:true,requestId:id(900)};const saved=await a.module.mutateDealDeleteAction(input);assert.equal(saved.ok,true);assert.equal(saved.receipt.deleted,true);assert.deepEqual(await a.module.mutateDealDeleteAction(input),saved);assert.deepEqual(a.invalidations,['/deals','/dashboard','/deals','/dashboard']);assert.equal((await db.query('select count(*)::int n from private.deal_list_removals')).rows[0].n,1);}finally{await db.close();}});
test('fresh access revocation suppresses receipt even after committed removal; malformed/foreign inputs never change other deals',async()=>{const db=await fixture();try{const{review}=await call(db,'prepare_direct_deal',prepare()),scope={companyId:C,dealId:review.dealId},read=await actions(db),p=await read.module.getDealDeleteAction(scope),a=await actions(db,{revokeAfter:'mutate_deal_delete'}),r=await a.module.mutateDealDeleteAction({...scope,reviewHash:p.page.reviewHash,acknowledged:true,requestId:id(901)});assert.equal(r.ok,false);assert.equal(r.code,'access_denied');assert.deepEqual(a.invalidations,[]);assert.equal((await db.query('select count(*)::int n from private.deal_list_removals')).rows[0].n,1);assert.equal((await read.module.mutateDealDeleteAction({...scope,reviewHash:p.page.reviewHash,acknowledged:false,requestId:id(902)})).code,'invalid_input');assert.equal((await read.module.getDealDeleteAction({...scope,companyId:id(999)})).code,'access_denied');}finally{await db.close();}});
