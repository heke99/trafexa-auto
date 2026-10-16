import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceLoader} from '../helpers/source-loader.mjs';
import {asRole} from '../crm-db/helpers.mjs';
import {fixture,id,U,C,D,claim,service} from './contract-invitation-fixtures.mjs';

/** Actual action, dealer/approval contexts and SQL; only Supabase network I/O is adapted. */
async function setup(){
 const{db,signing}=await fixture();
 const state={transport:'paused',deliveryReads:0,afterRead:null};
 const sdk={
  auth:{async getUser(){const user=(await db.query('select id,email,email_confirmed_at,is_anonymous from auth.users where id=$1',[U])).rows[0];return{data:{user},error:null};}},
  from(table){assert.equal(table,'memberships');const values={};const query={select(){return query;},eq(key,value){values[key]=value;return query;},async maybeSingle(){try{return{data:await asRole(db,'authenticated',U,async tx=>(await tx.query("select jsonb_build_object('company_id',m.company_id,'user_id',m.user_id,'role',m.role,'status',m.status,'companies',jsonb_build_object('id',c.id,'status',c.status)) value from public.memberships m join public.companies c on c.id=m.company_id where m.company_id=$1 and m.user_id=$2 and m.status=$3 and c.status=$4",[values.company_id,values.user_id,values.status,values['companies.status']])).rows[0]?.value??null),error:null};}catch(error){return{data:null,error};}}};return query;},
  async rpc(name,args){try{const data=await asRole(db,'authenticated',U,async tx=>(await tx.query(`select public.${name}(${Object.values(args).map((_,i)=>'$'+(i+1)).join(',')}) value`,Object.values(args))).rows[0].value);if(name==='get_contract_signing_delivery'){state.deliveryReads++;await state.afterRead?.();}return{data,error:null};}catch(error){return{data:null,error};}},
 };
 const loader=await createSourceLoader({
  'next/cache':{revalidatePath(){assert.fail('Read-only action');}},
  '@/lib/supabase/server':{async createServerSupabaseClient(){return sdk;}},
  '@/lib/data/company-context':{async getActiveCompanyContext(){return{company:C,user:U};}},
  '@/lib/email/server':{contractEmailConfigurationStatus:()=>({transport:state.transport}),dispatchTransactionalEvent(){assert.fail('A delivery read cannot send');}},
 });
 return{db,signing,state,action:loader.load('@/lib/data/contract-signing-actions').getContractSigningDeliveryAction,input:{companyId:C,dealId:D,signingId:signing.id}};
}

test('actual dealer action and contexts read actual pending/accepted SQL state with separate paused configuration and no queue mutation',async()=>{
 const h=await setup();try{
  const before=(await h.db.query('select to_jsonb(e) value from private.transactional_email_outbox e where reference_id=$1',[h.signing.id])).rows;
  assert.deepEqual(await h.action(h.input),{ok:true,delivery:{...h.input,recipientEmail:h.signing.customerEmail,status:'pending',transport:'paused'}});
  assert.deepEqual((await h.db.query('select to_jsonb(e) value from private.transactional_email_outbox e where reference_id=$1',[h.signing.id])).rows,before);
  const lease=await claim(h.db,h.signing);await service(h.db,'finish_transactional_email',[lease.id,lease.leaseId,'accepted','synthetic-provider-accepted']);
  const result=await h.action(h.input);assert.equal(result.ok,true);assert.equal(result.delivery.status,'accepted');assert.equal(result.delivery.transport,'paused');assert.ok(!JSON.stringify(result).includes('synthetic-provider'));
  assert.equal((await h.action({...h.input,companyId:id(99)})).code,'access_denied');assert.equal(h.state.deliveryReads,2);
 }finally{await h.db.close();}
});

test('actual SQL receipt is suppressed when private account approval is revoked before post-I/O revalidation',async()=>{
 const h=await setup();try{
  h.state.afterRead=()=>h.db.query("update private.account_approvals set status='suspended' where user_id=$1",[U]);
  const result=await h.action(h.input);assert.equal(result.ok,false);assert.equal(result.code,'access_denied');assert.equal(h.state.deliveryReads,1);assert.ok(!JSON.stringify(result).includes(h.signing.customerEmail));
 }finally{await h.db.close();}
});
