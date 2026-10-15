import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { test } from 'node:test';
import { createRequestReact, createSourceLoader } from '../helpers/source-loader.mjs';
import { sql, seed, value, sales, company, otherCompany, id, asUser } from './helpers.mjs';
// Run schema.mjs first: this deliberately reuses its task-owned native database.
const customer={companyId:company,requestId:id(901),name:'Cross-layer customer',kind:'person',email:'buyer@fixture.invalid',phone:'',address:'',notes:''};
const intake={companyId:company,requestId:id(902),product:'stock',dealId:null,requestedAmount:'125000.29',deposit:'0',termMonths:'',note:'Cross-layer intake'};
const count=table=>Number(sql(`select count(*)from ${table}`));
async function fixture(){
 const requests=new AsyncLocalStorage(),state={actor:sales,cookie:company,calls:[],dropOnce:false,afterCommit:null};
 const json=source=>JSON.parse(asUser(state.actor,source));
 const db={auth:{async getUser(){return{data:{user:JSON.parse(sql(`select jsonb_build_object('id',id,'email',email,'email_confirmed_at',email_confirmed_at,'is_anonymous',is_anonymous)from auth.users where id=${value(state.actor)}`))},error:null};}},
  from(table){assert.equal(table,'memberships');const filters={};const run=()=>{
   const where=Object.entries(filters).map(([key,v])=>`${key==='companies.status'?'c.status':`m.${key}`}=${value(v)}`).join(' and ');
   return json(`select coalesce(jsonb_agg(jsonb_build_object('company_id',m.company_id,'user_id',m.user_id,'role',m.role,'status',m.status,'companies',jsonb_build_object('id',c.id,'name',c.name,'organisation_number',c.organisation_number,'status',c.status))order by m.company_id),'[]')from public.memberships m join public.companies c on c.id=m.company_id${where?' where '+where:''}`);
  };const q={select(){return q;},eq(k,v){filters[k]=v;return q;},order(){return q;},async maybeSingle(){return{data:run()[0]??null,error:null};},then(resolve,reject){return Promise.resolve({data:run(),error:null}).then(resolve,reject);}};return q;},
  rpc(name,args){let pending;const run=()=>pending??=(async()=>{
   state.calls.push({name,args});
   const fields=name==='create_customer_request'?['p_company_id','p_request_id','p_name','p_kind','p_email','p_phone','p_address','p_notes']:name==='create_finance_intake_request'?['p_company_id','p_request_id','p_product','p_deal_id','p_requested_amount_ore','p_deposit_ore','p_term_months','p_note']:[];
   try{const data=json(`select public.${name}(${fields.map(k=>value(args[k])).join(',')})`);
    if(fields.length){state.afterCommit?.();if(state.dropOnce){state.dropOnce=false;throw Error('Simulated API loss after actual commit');}}
    return{data,error:null};
   }catch(error){if(error.message.startsWith('Simulated'))throw error;return{data:null,error:{code:/payload conflict/.test(error.message)?'40001':/denied|required|permission/.test(error.message)?'42501':'XX000',message:error.message}};}
  })();return{abortSignal(){return run();},then(resolve,reject){return run().then(resolve,reject);}};
  }
 };
 const loader=await createSourceLoader({react:createRequestReact(requests),'@/lib/supabase/server':{createServerSupabaseClient:async()=>db},'next/headers':{cookies:async()=>({get:key=>key==='trafexa-company'?{value:state.cookie}:undefined})},'next/cache':{revalidatePath(){}},'next/navigation':{redirect(url){const e=Error('redirect');e.url=url;e.digest='NEXT_REDIRECT';throw e;}}});
 return{state,actions:loader.load('src/lib/data/create-record-actions.ts'),legacy:loader.load('src/lib/data/actions.ts'),run:work=>requests.run({reactCache:new Map()},work)};
}
test('actual TS action/context → native public/private SQL survives a lost committed response with one customer/intake',async()=>{
 for(const [name,input,table]of[['createCustomerRequestAction',customer,'public.customers'],['createFinanceIntakeRequestAction',intake,'public.finance_applications']]){
  seed();const h=await fixture(),before=count(table);h.state.dropOnce=true;
  const lost=await h.run(()=>h.actions[name](input));assert.equal(lost.code,'unavailable');assert.equal(count(table),before+1);
  const recovered=await h.run(()=>h.actions[name](input));assert.equal(recovered.ok,true);assert.equal(recovered.receipt.actorId,sales);assert.equal(count(table),before+1);assert.equal(count('private.dealer_create_receipts'),1);
  assert.deepEqual(await h.run(()=>h.actions[name](input)),recovered);
 }
});
test('actual SQL payload conflicts and company-selector mismatch cannot create another row or receipt',async()=>{
 seed();const h=await fixture();assert.equal((await h.run(()=>h.actions.createCustomerRequestAction(customer))).ok,true);
 assert.equal((await h.run(()=>h.actions.createCustomerRequestAction({...customer,notes:'Changed'}))).code,'conflict');
 h.state.cookie=otherCompany;const calls=h.state.calls.filter(c=>c.name==='create_customer_request').length;
 assert.equal((await h.run(()=>h.actions.createCustomerRequestAction(customer))).code,'company_changed');
 assert.equal(h.state.calls.filter(c=>c.name==='create_customer_request').length,calls);assert.equal(count('private.dealer_create_receipts'),1);
});
test('actual post-commit role revocation suppresses success; later authorized retry recovers the same durable record',async()=>{
 seed();const h=await fixture();h.state.afterCommit=()=>{sql(`update public.memberships set role='viewer'where company_id='${company}'and user_id='${sales}'`);h.state.afterCommit=null;};
 const denied=await h.run(()=>h.actions.createCustomerRequestAction(customer));assert.equal(denied.code,'access_denied');assert.equal(count('private.dealer_create_receipts'),1);
 sql(`update public.memberships set role='sales'where company_id='${company}'and user_id='${sales}'`);
 const recovered=await h.run(()=>h.actions.createCustomerRequestAction(customer));assert.equal(recovered.ok,true);assert.equal(count('public.customers'),3);
});
test('legacy FormData exports require a stable nonce and delegate to the same actual SQL receipt flow',async()=>{
 seed();const h=await fixture();const form=new FormData();for(const[k,v]of Object.entries({expected_company_id:company,request_id:id(901),name:'Legacy customer',kind:'person'}))form.set(k,v);
 for(let n=0;n<2;n++)await assert.rejects(h.run(()=>h.legacy.createCustomerAction(form)),error=>error.digest==='NEXT_REDIRECT'&&new URL(error.url,'https://app.invalid').searchParams.has('success'));
 assert.equal(count('public.customers'),3);assert.equal(count('private.dealer_create_receipts'),1);
 form.delete('request_id');await assert.rejects(h.run(()=>h.legacy.createCustomerAction(form)),error=>error.digest==='NEXT_REDIRECT'&&new URL(error.url,'https://app.invalid').searchParams.has('error'));
 assert.equal(count('public.customers'),3);
});
