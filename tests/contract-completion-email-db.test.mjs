import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceLoader} from './helpers/source-loader.mjs';
import {asRole} from './crm-db/helpers.mjs';
import {fixture,id,U,C,D,EMAIL,rpc,service,capability,createSigning,approveContract,strokes} from './guest-customer-db/helpers.mjs';

const env={CONTRACT_EMAIL_ENABLED:'true',TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED:'true',RESEND_API_KEY:'synthetic-completion-provider',SUPABASE_SECRET_KEY:'synthetic-completion-secret',NEXT_PUBLIC_SUPABASE_URL:'https://buqdtssxrotkzndublrt.supabase.co'};
/** Real actions, fresh dealer contexts, dispatcher, guest worker and SQL. Only SDK I/O/provider are adapted. */
async function setup(t){
 const previous=Object.fromEntries([...Object.keys(env),'TRANSACTIONAL_EMAIL_ENABLED'].map(key=>[key,process.env[key]]));Object.assign(process.env,env);delete process.env.TRANSACTIONAL_EMAIL_ENABLED;
 const h=await fixture();t.after(async()=>{await h.db.close();for(const[key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});
 const offerCap=await capability(h.db,'offer_invitation',h.review.id),signing=await createSigning(h,offerCap),cap=await capability(h.db,'contract_invitation',signing.id);
 await service(h.db,'begin_customer_contract_invitation_send',[cap.emailId,cap.leaseId]);await service(h.db,'finish_transactional_email',[cap.emailId,cap.leaseId,'accepted','synthetic-invitation-accepted']);
 // Prove completion and its email also work when the dealer signs before the guest.
 await rpc(h.db,U,'sign_contract',[signing.id,C,1,signing.documentHash,'Dealer Owner',strokes,true,'2026-10-14',id(31)]);await approveContract(h.db,cap,2);
 const state={providers:[],responses:[],afterRead:null,selected:C};
 const dealer={auth:{async getUser(){return{data:{user:(await h.db.query('select id,email,email_confirmed_at,is_anonymous from auth.users where id=$1',[U])).rows[0]},error:null};}},
  from(table){assert.equal(table,'memberships');const values={};const query={select(){return query;},eq(key,value){values[key]=value;return query;},async maybeSingle(){try{return{data:await asRole(h.db,'authenticated',U,async tx=>(await tx.query("select jsonb_build_object('company_id',m.company_id,'user_id',m.user_id,'role',m.role,'status',m.status,'companies',jsonb_build_object('id',c.id,'status',c.status)) value from public.memberships m join public.companies c on c.id=m.company_id where m.company_id=$1 and m.user_id=$2 and m.status=$3 and c.status=$4",[values.company_id,values.user_id,values.status,values['companies.status']])).rows[0]?.value??null),error:null};}catch(error){return{data:null,error};}}};return query;},
  async rpc(name,args){try{const data=await rpc(h.db,U,name,Object.values(args));if(name==='get_contract_signing_delivery')await state.afterRead?.();return{data,error:null};}catch(error){return{data:null,error};}}};
 const worker={async rpc(name,args){try{return{data:await service(h.db,name,Object.values(args)),error:null};}catch(error){return{data:null,error};}}};Object.defineProperty(worker,'auth',{get(){assert.fail('A completion mail must never access buyer Auth');}});
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(String(url),'https://api.resend.com/emails');assert.equal(options.method,'POST');state.providers.push({body:options.body,key:options.headers['Idempotency-Key']});const response=state.responses.shift()??200;if(response==='timeout')throw Error('Synthetic timeout');return response===200?Response.json({id:'synthetic-completion-'+state.providers.length}):new Response('',{status:response});});
 const loader=await createSourceLoader({'next/cache':{revalidatePath(){}},'@/lib/supabase/server':{async createServerSupabaseClient(){return dealer;}},'@/lib/data/company-context':{async getActiveCompanyContext(){return{company:state.selected,user:U};}},'@supabase/supabase-js':{createClient(url,key){assert.equal(url,env.NEXT_PUBLIC_SUPABASE_URL);assert.equal(key,env.SUPABASE_SECRET_KEY);return worker;}}});
 return{...h,signing,state,actions:loader.load('@/lib/data/customer-email-actions'),sender:loader.load('@/lib/email/server'),input:{companyId:C,dealId:D,referenceId:signing.id,kind:'contract_completed'},queue:async()=>(await h.db.query("select * from private.transactional_email_outbox where kind='contract_completed' and reference_id=$1",[signing.id])).rows[0]};
}

test('completed email 429 remains pending and explicit owner retry sends the identical guest body/key, independently of the accepted invitation and paused generic queue',async t=>{
 const h=await setup(t),before=await h.queue();
 const initial=await h.actions.getCustomerEmailDeliveryAction(h.input);assert.equal(initial.ok,true,JSON.stringify(initial));assert.equal(initial.delivery.status,'pending');assert.equal(initial.delivery.transport,'configured');assert.deepEqual(await h.queue(),before);assert.equal(h.state.providers.length,0);
 const invitation=await h.actions.getCustomerEmailDeliveryAction({...h.input,kind:'contract_invitation'});assert.equal(invitation.delivery.status,'accepted');
 h.state.responses=[429,200];assert.equal((await h.sender.dispatchTransactionalEvent('contract_completed',h.signing.id)).status,'retryable');assert.equal((await h.queue()).status,'pending');
 const retried=await h.actions.retryCustomerEmailAction({...h.input,acknowledged:true});assert.equal(retried.ok,true,JSON.stringify(retried));assert.equal(retried.delivery.status,'accepted');assert.equal(h.state.providers.length,2);assert.deepEqual(h.state.providers[0],h.state.providers[1]);
 assert.deepEqual(JSON.parse(h.state.providers[0].body).to,[EMAIL]);assert.match(JSON.parse(h.state.providers[0].body).text,/behöver inget konto eller lösenord/i);
 const current=await h.actions.retryCustomerEmailAction({...h.input,acknowledged:true});assert.equal(current.delivery.status,'accepted');assert.equal(h.state.providers.length,2);
 assert.equal((await h.db.query('select count(*)::int n from auth.users')).rows[0].n,1);assert.equal((await h.db.query('select count(*)::int n from private.account_approvals')).rows[0].n,1);
});

test('unknown completion outcome is visible and explicit retry never makes a second provider attempt',async t=>{
 const h=await setup(t);h.state.responses=['timeout'];assert.equal((await h.sender.dispatchTransactionalEvent('contract_completed',h.signing.id)).status,'unknown');
 const result=await h.actions.retryCustomerEmailAction({...h.input,acknowledged:true});assert.equal(result.ok,true);assert.equal(result.delivery.status,'unknown');assert.equal(h.state.providers.length,1);
});

test('completion reads and retries enforce real fresh dealer roles, tenant binding and approval without exposing private worker metadata',async t=>{
 const h=await setup(t);
 for(const role of ['owner','admin','finance']){await h.db.query('update public.memberships set role=$1 where company_id=$2 and user_id=$3',[role,C,U]);const result=await h.actions.getCustomerEmailDeliveryAction(h.input);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.delivery.actorRole,role);assert.equal(result.delivery.status,'pending');assert.ok(!/ciphertext|providerId|tokenHash|leaseId/.test(JSON.stringify(result)));}
 assert.equal((await h.actions.retryCustomerEmailAction({...h.input,acknowledged:true})).code,'access_denied');
 for(const role of ['sales','viewer']){await h.db.query('update public.memberships set role=$1 where company_id=$2 and user_id=$3',[role,C,U]);assert.equal((await h.actions.getCustomerEmailDeliveryAction(h.input)).code,'access_denied');}
 await h.db.query("update public.memberships set role='owner' where company_id=$1 and user_id=$2",[C,U]);
 assert.equal((await h.actions.getCustomerEmailDeliveryAction({...h.input,companyId:id(99)})).code,'access_denied');assert.equal((await h.actions.getCustomerEmailDeliveryAction({...h.input,dealId:id(99)})).code,'access_denied');assert.equal((await h.actions.getCustomerEmailDeliveryAction({...h.input,referenceId:id(99)})).code,'access_denied');
 h.state.afterRead=()=>h.db.query("update private.account_approvals set status='suspended'where user_id=$1",[U]);const revoked=await h.actions.retryCustomerEmailAction({...h.input,acknowledged:true});assert.equal(revoked.ok,false);assert.equal(Object.hasOwn(revoked,'delivery'),false);assert.equal(h.state.providers.length,0);
});
