import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceLoader} from './helpers/source-loader.mjs';

const id=n=>`fd350000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const companyId=id(1),dealId=id(2),signingId=id(3),userId=id(4);
const input={companyId,dealId,signingId};
const base={...input,actorUserId:userId,actorRole:'owner',recipientEmail:'contract-customer@fixture.invalid',status:'pending'};

async function setup(options={}){
 const state={contexts:0,approvals:0,rpc:[],configurationReads:0,dispatches:0};
 class CrmError extends Error{constructor(code){super('Synthetic denial');this.code=code;}}
 const db={async rpc(name,args){state.rpc.push([name,args]);if(options.throwRpc)throw Error('PRIVATE database detail');return{data:options.data??{...base,actorRole:options.role??'owner'},error:options.error??null};}};
 const loader=await createSourceLoader({
  'next/cache':{revalidatePath(){assert.fail('A status read must not invalidate or mutate');}},
  '@/lib/crm/context':{CrmError,async requireCrmContext(expectedCompany){
   state.contexts++;if(options.denied||expectedCompany!==companyId||options.revoke&&state.contexts>1)throw new CrmError('access_denied');
   return{db,userId:options.actorChanged&&state.contexts>1?id(5):userId,companyId,role:options.roleChanged&&state.contexts>1?'finance':options.role??'owner'};
  }},
  '@/lib/account-access/context':{async requireApprovedAccountAccess(){state.approvals++;if(options.approvalDenied)throw Error('PRIVATE approval detail');return{userId:options.approvalActor??userId,emailVerified:true,status:'approved'};}},
  '@/lib/email/server':{
   contractEmailConfigurationStatus(){state.configurationReads++;return{transport:options.transport??'paused',privateKey:'PRIVATE should never return'};},
   dispatchTransactionalEvent(){state.dispatches++;assert.fail('A status read must never dispatch email');},
  },
 });
 return{action:loader.load('@/lib/data/contract-signing-actions').getContractSigningDeliveryAction,state};
}

test('dealer delivery reads exact frozen recipient and actual queue state without dispatching, claiming or leaking internals',async()=>{
 for(const role of ['owner','admin','finance'])for(const status of [null,'pending','processing','accepted','rejected','unknown','cancelled']){
  const h=await setup({role,data:{...base,actorRole:role,status,providerId:'PRIVATE provider id',leaseId:id(9),otherRecipient:'PRIVATE'}});
  assert.deepEqual(await h.action(input),{ok:true,delivery:{...input,recipientEmail:base.recipientEmail,status,transport:'paused'}});
  assert.deepEqual(h.state.rpc,[['get_contract_signing_delivery',{p_company_id:companyId,p_deal_id:dealId,p_signing_id:signingId}]]);
  assert.equal(h.state.contexts,2);assert.equal(h.state.approvals,2);assert.equal(h.state.configurationReads,1);assert.equal(h.state.dispatches,0);
 }
});

test('paused, unconfigured and configured transport are separate facts from a historical provider acceptance',async()=>{
 for(const transport of ['paused','unconfigured','configured']){
  const h=await setup({transport,data:{...base,status:'accepted'}}),result=await h.action(input);
  assert.equal(result.ok,true);assert.equal(result.delivery.transport,transport);assert.equal(result.delivery.status,'accepted');
 }
});

test('delivery input requires an explicit valid company deal and signing and accepts no recipient or credential override',async()=>{
 const h=await setup();
 for(const value of [null,[],{}, {...input,companyId:''},{...input,dealId:'invalid'},{...input,signingId:null},{...input,recipientEmail:'attacker@fixture.invalid'},{...input,enabled:true}]){
  assert.equal((await h.action(value)).code,'invalid_input');
 }
 assert.equal(h.state.contexts,0);assert.equal(h.state.rpc.length,0);assert.equal(h.state.configurationReads,0);
});

test('sales, viewer, missing approval and foreign selected company cannot reach the private status RPC',async()=>{
 for(const options of [{role:'sales'},{role:'viewer'},{denied:true},{approvalDenied:true},{approvalActor:id(99)}]){
  const h=await setup(options),result=await h.action(input);assert.equal(result.ok,false);assert.equal(result.code,'access_denied');assert.equal(h.state.rpc.length,0);assert.equal(h.state.configurationReads,0);
 }
 const h=await setup();assert.equal((await h.action({...input,companyId:id(99)})).code,'access_denied');assert.equal(h.state.rpc.length,0);
});

test('wrong actor company deal signing recipient format or queue enum cannot become a delivery receipt',async()=>{
 for(const patch of [{actorUserId:id(99)},{actorRole:'finance'},{companyId:id(99)},{dealId:id(99)},{signingId:id(99)},{recipientEmail:'bad\r\nBcc: attacker@fixture.invalid'},{status:'delivered'},{status:undefined}]){
  const h=await setup({data:{...base,...patch}}),result=await h.action(input);assert.equal(result.ok,false);assert.ok(!('delivery'in result));
 }
 const h=await setup({transport:'enabled'});assert.equal((await h.action(input)).ok,false);
});

test('post-read account membership role or actor changes suppress every private delivery value',async()=>{
 for(const options of [{revoke:true},{roleChanged:true},{actorChanged:true}]){
  const h=await setup(options),result=await h.action(input);assert.equal(result.ok,false);assert.equal(result.code,'access_denied');assert.equal(h.state.rpc.length,1);assert.ok(!JSON.stringify(result).includes(base.recipientEmail));
 }
});

test('database failures return safe errors without raw provider, configuration or recipient data',async()=>{
 for(const [code,expected]of [['42501','access_denied'],['40001','conflict'],['22023','invalid_input'],['XX000','unavailable']]){
  const h=await setup({error:{code,message:'PRIVATE database detail'}}),result=await h.action(input);assert.equal(result.code,expected);assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.equal(h.state.configurationReads,0);
 }
 const h=await setup({throwRpc:true});assert.equal((await h.action(input)).code,'unavailable');
});
