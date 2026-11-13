import {test}from'node:test';
import assert from'node:assert/strict';
import{readFile,readdir}from'node:fs/promises';
import{fixture,actionHarness,call,id,U,C,S,customer}from'./helpers/direct-deal-harness.mjs';
import{createSourceLoader}from'./helpers/source-loader.mjs';
test('new app accepts production schema before migration and the expanded schema after migration without switching ordinary RPC',async()=>{
 const db=await fixture({throughMigration:'20261113104058_direct_deal_contracts.sql'});
 try{
  const h=await actionHarness(db),options=await h.actions.getDirectDealOptionsAction({companyId:C});assert.equal(options.ok,true,JSON.stringify(options));assert.deepEqual(options.tradeIns,[]);
  const prepared=await h.actions.prepareDirectDealAction({companyId:C,requestId:id(801),dealId:null,stockItemId:S,customerId:null,customer,expectedCustomerVersion:null,agreedPrice:'125050',templateVersionId:null,expectedTemplateApprovalVersion:0});assert.equal(prepared.ok,true,JSON.stringify(prepared));assert.equal(h.calls.find(c=>c.name?.startsWith('prepare_direct_deal')).name,'prepare_direct_deal');
  const r=prepared.review,approved=await h.actions.approveAndSendDirectDealAction({companyId:C,dealId:r.dealId,draftId:r.draft.id,reviewHash:r.reviewHash,sellerName:'Synthetic Rollout Seller',acknowledged:true,requestId:id(802)});assert.equal(approved.ok,true,JSON.stringify(approved));
  const loader=await createSourceLoader({'next/cache':{revalidatePath(){}},'./context':{async requireFulfilmentContext(){return{companyId:C,userId:U,role:'owner',db:{async rpc(name,args){try{return{data:await call(db,name,args),error:null};}catch(error){return{data:null,error};}}}};}}});const actions=loader.load('@/lib/deal-fulfilment/actions'),before=await actions.getDealFulfilmentAction({companyId:C,dealId:r.dealId});assert.equal(before.ok,true,JSON.stringify(before));assert.equal(before.page.blockedReason,'contract_required');assert.equal(before.page.settlement,undefined);
  const directory=new URL('../supabase/migrations/',import.meta.url),names=await readdir(directory);for(const suffix of['_direct_trade_in_acquisition.sql','_trade_in_manual_settlement_final.sql']){const name=names.find(n=>n.endsWith(suffix));assert.ok(name);await db.exec(await readFile(new URL(name,directory),'utf8'));}
  const after=await actions.getDealFulfilmentAction({companyId:C,dealId:r.dealId});assert.equal(after.ok,true,JSON.stringify(after));assert.equal(after.page.blockedReason,'contract_required');assert.deepEqual(after.page.settlement,{customerIncomingOre:'0',customerPayoutOre:'0',lenderPaymentOre:'0'});assert.equal((await h.actions.getDirectDealOptionsAction({companyId:C,dealId:r.dealId})).ok,true);assert.equal((await db.query('select count(*)::int n from private.deal_payment_entries')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from public.offers')).rows[0].n,0);
 }finally{await db.close();}
});
