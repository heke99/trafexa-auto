import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';
const company='fd230000-0000-4000-8000-000000000101',actor='fd230000-0000-4000-8000-000000000003',request='fd230000-0000-4000-8000-000000000901',record='fd230000-0000-4000-8000-000000000911',foreign='fd230000-0000-4000-8000-000000000102';
const customer={companyId:company,requestId:request,name:'Customer',kind:'person',email:'buyer@example.invalid',phone:'',address:'',notes:''};
const finance={companyId:company,requestId:request,product:'stock',dealId:null,requestedAmount:'125000,29',deposit:'1000.09',termMonths:'36',note:'Internal intake only'};
const output=kind=>({companyId:company,actorId:actor,requestId:request,kind,recordId:record,createdAt:'2026-10-15T10:00:00.123456+00:00'});
async function setup(options={}){
 const state={role:options.role??'sales',approval:'approved',user:{id:actor,email:'dealer@example.invalid',email_confirmed_at:'2026-10-15T09:00:00Z',user_metadata:{role:'owner',company_id:foreign}},...options.state};
 const calls=[],invalidations=[];
 const db={auth:{async getUser(){calls.push('auth');return{data:{user:state.user},error:null};}},from(table){assert.equal(table,'memberships');const q={select(){return q;},eq(){return q;},async maybeSingle(){calls.push('membership');return{data:state.revoked?null:{company_id:company,user_id:actor,role:state.role,status:'active',companies:{id:company,status:'active'}},error:null};}};return q;},rpc(name,args){
  if(name==='get_account_access'){calls.push('approval');return Promise.resolve({data:{userId:state.user.id,email:state.user.email,emailVerified:true,status:state.approval,version:1,isPlatformAdmin:false},error:null});}
  return{async abortSignal(signal){assert.ok(signal instanceof AbortSignal);calls.push({name,args});if(options.transport)throw Error('PRIVATE_DATABASE_DIAGNOSTIC');options.afterRpc?.(state);return{data:options.response===undefined?output(name==='create_customer_request'?'customer':'finance_intake'):options.response,error:options.error??null};}};
 }};
 const selected={async getActiveCompanyContext(){if(options.noSelected)throw Error('Private session');return{db,company:options.selected??company,user:actor,role:'owner'};}};
 const loader=await createSourceLoader({'./company-context':selected,'@/lib/data/company-context':selected,'@/lib/supabase/server':{async createServerSupabaseClient(){return db;}},'next/cache':{revalidatePath:p=>invalidations.push(p)}});
 return{actions:loader.load('src/lib/data/create-record-actions.ts'),state,calls,invalidations};
}
test('actual customer action normalizes fields and sends only actor-free RPC input, returning a minimal verified receipt',async()=>{
 const h=await setup();const result=await h.actions.createCustomerRequestAction({...customer,name:' Customer ',email:' Buyer@Example.Invalid ',notes:' Line1\nLine2 '});
 assert.deepEqual(result,{ok:true,receipt:output('customer')});
 assert.deepEqual(h.calls.filter(c=>typeof c==='object'),[{name:'create_customer_request',args:{p_company_id:company,p_request_id:request,p_name:'Customer',p_kind:'person',p_email:'buyer@example.invalid',p_phone:'',p_address:'',p_notes:'Line1\nLine2'}}]);
 assert.deepEqual(h.invalidations,['/dashboard','/customers']);assert.equal(h.calls.filter(c=>c==='auth').length,4);
});
test('actual finance action preserves exact ore, selected deal UUID and nullable term without external-provider claims',async()=>{
 const h=await setup({role:'finance'});assert.deepEqual(await h.actions.createFinanceIntakeRequestAction(finance),{ok:true,receipt:output('finance_intake')});
 assert.deepEqual(h.calls.find(c=>c.name==='create_finance_intake_request').args,{p_company_id:company,p_request_id:request,p_product:'stock',p_deal_id:null,p_requested_amount_ore:12500029,p_deposit_ore:100009,p_term_months:36,p_note:'Internal intake only'});
 const empty=await setup();assert.equal((await empty.actions.createFinanceIntakeRequestAction({...finance,deposit:'',termMonths:''})).ok,true);
 const args=empty.calls.find(c=>c.name==='create_finance_intake_request').args;assert.equal(args.p_deposit_ore,0);assert.equal(args.p_term_months,null);
});
test('actual current role, tenant selection and verified account authorize every create instead of cached metadata',async()=>{
 for(const role of['owner','admin','sales','finance','viewer'])for(const [action,input,allowed]of[['createCustomerRequestAction',customer,['owner','admin','sales']],['createFinanceIntakeRequestAction',finance,['owner','admin','sales','finance']]]){
  const h=await setup({role});const result=await h.actions[action](input);assert.equal(result.ok,allowed.includes(role));if(!result.ok)assert.equal(h.calls.some(c=>typeof c==='object'),false);
 }
 for(const options of[{selected:foreign},{noSelected:true},{state:{user:null}},{state:{approval:'suspended'}},{state:{revoked:true}}]){
  const h=await setup(options);const result=await h.actions.createCustomerRequestAction(customer);assert.equal(result.ok,false);assert.equal(h.calls.some(c=>typeof c==='object'),false);
  assert.equal(result.code,options.selected?'company_changed':'access_denied');
 }
});
test('unknown keys, missing nonces, controls, malformed email and invalid money never start Auth or business I/O',async()=>{
 for(const patch of[{requestId:undefined},{actorId:actor},{name:'a'},{name:'x'.repeat(161)},{name:'Bad\u0080'},{email:'wrong'},{notes:'Bad\u0001'}]){
  const h=await setup();assert.equal((await h.actions.createCustomerRequestAction({...customer,...patch})).code,'invalid_input');assert.deepEqual(h.calls,[]);
 }
 for(const patch of[{dealId:'invalid'},{requestedAmount:'0'},{requestedAmount:'1e3'},{deposit:'-1'},{termMonths:'1.5'},{termMonths:'121'},{note:'Bad\u0080'},{partnerId:actor}]){
  const h=await setup();assert.equal((await h.actions.createFinanceIntakeRequestAction({...finance,...patch})).code,'invalid_input');assert.deepEqual(h.calls,[]);
 }
});
test('transport/SDK failures never show success or raw diagnostics, and altered-payload conflicts remain explicit',async()=>{
 for(const [options,code]of[[{transport:true},'unavailable'],[{error:{code:'XX000',message:'PRIVATE_DATABASE_DIAGNOSTIC'}},'unavailable'],[{error:{code:'40001',message:'PRIVATE_DATABASE_DIAGNOSTIC'}},'conflict'],[{error:{code:'42501',message:'PRIVATE_DATABASE_DIAGNOSTIC'}},'access_denied'],[{error:{code:'23503',message:'PRIVATE_DATABASE_DIAGNOSTIC'}},'invalid_input']]){
  const h=await setup(options);const result=await h.actions.createCustomerRequestAction(customer);assert.equal(result.ok,false);assert.equal(result.code,code);assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);assert.deepEqual(h.invalidations,[]);
 }
});
test('receipt actor/company/request/kind/identity/timestamp and unknown fields are verified before success',async()=>{
 for(const patch of[{companyId:foreign},{actorId:foreign},{requestId:foreign},{kind:'finance_intake'},{recordId:'invalid'},{createdAt:'invalid'},{internalSecret:'PRIVATE_DATABASE_DIAGNOSTIC'}]){
  const h=await setup({response:{...output('customer'),...patch}});const result=await h.actions.createCustomerRequestAction(customer);assert.equal(result.ok,false);assert.equal(result.code,'unavailable');assert.equal('receipt'in result,false);assert.deepEqual(h.invalidations,[]);
 }
});
test('an account, membership or role revoked during committed RPC I/O cannot release even a historical receipt',async()=>{
 for(const afterRpc of[state=>{state.role='viewer';},state=>{state.approval='suspended';},state=>{state.revoked=true;},state=>{state.user={...state.user,id:foreign};}]){
  const h=await setup({afterRpc});const result=await h.actions.createCustomerRequestAction(customer);assert.equal(result.ok,false);assert.equal(result.code,'access_denied');assert.equal('receipt'in result,false);assert.deepEqual(h.invalidations,[]);
 }
});
