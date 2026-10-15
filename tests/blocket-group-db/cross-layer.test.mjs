// Actual server actions/context/parsers → complete migrated SQL in PGlite.
// Only Supabase I/O and selected-company routing are adapted. This proves no
// hosted Auth delivery, browser interaction or concurrent PostgreSQL locking.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile}from 'node:fs/promises';
import {before, beforeEach, after, test} from 'node:test';
import {createDatabase, asRole} from '../crm-db/helpers.mjs';
import {createSourceLoader} from '../helpers/source-loader.mjs';

const id=n=>`fd190000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const PLATFORM=id(1),OWNER=id(2),SALES=id(3),FOREIGN=id(4),COMPANY=id(101),OTHER_COMPANY=id(102),GROUP=id(201);
const fixture=(await readFile(new URL('../../supabase/tests/blocket_group_delivery.sql',import.meta.url),'utf8')).split('-- BEGIN BLOCKET FIXTURES')[1].split('-- END BLOCKET FIXTURES')[0];
let database;
before(async()=>{database=await createDatabase({approveEstablishedFixtures:false});});
beforeEach(async()=>{await database.exec(`begin;truncate auth.users,private.blocket_groups cascade;${fixture}commit;`);});
after(async()=>{await database?.close();});

async function integration({actor=PLATFORM}={}) {
  const state={actor, authenticated:true, calls:[], errors:[], invalidations:[], loseReceipt:null};
  const db={
    auth:{async getUser() {
      state.calls.push(['auth']);
      const user=state.authenticated ? (await database.query('select id,email,email_confirmed_at::text,is_anonymous from auth.users where id=$1',[state.actor])).rows[0] : null;
      return {data:{user:user??null},error:null};
    }},
    rpc(name,args) {
      const work=(async()=>{
      assert.match(name,/^(get_platform_admin_session|get_platform_blocket_provisioning|configure_blocket_group|bind_blocket_company|disable_blocket_company)$/);
      state.calls.push(['rpc',name,structuredClone(args)]);
      try {
        const entries=Object.entries(args);
        assert.ok(entries.every(([key])=>/^p_[a-z_][a-z_0-9]*$/.test(key)));
        const params=entries.map(([key],i)=>`${key} => $${i+1}`).join(',');
        const data=await asRole(database,'authenticated',state.actor,async tx=>(await tx.query(`select public.${name}(${params}) result`,entries.map(([,value])=>value))).rows[0].result);
        if(state.afterRpc) await state.afterRpc(name);
        if(state.loseReceipt===name){state.loseReceipt=null;return {data:null,error:{code:'FIXTURE_NETWORK',message:'PRIVATE lost response'}};}
        return {data,error:null};
      }catch(error){state.errors.push({code:error.code,message:error.message});return {data:null,error:{code:error.code,message:'PRIVATE database details'}};}
      })();work.abortSignal=()=>work;return work;
    },
  };
  const loader=await createSourceLoader({
    'next/cache':{revalidatePath:path=>state.invalidations.push(path)},
    'next/headers':{async cookies(){return {set(){throw new Error('Branches must not choose a company cookie');}};}},
    '@/lib/supabase/server':{async createServerSupabaseClient(){return db;}},

  });
  return {state,actions:loader.load('@/lib/blocket-provisioning/actions')};
}
function success(result,h){assert.equal(result.ok,true,JSON.stringify({result,sqlErrors:h.state.errors}));return result;}
const groupInput=(overrides={})=>({groupId:GROUP,expectedVersion:0,groupReference:'Granskat handlaravtal',credentialReference:'blocket_group_label',scope:'dealer_group',status:'active',reason:'Godkänt underlag för plattformsgrupp',acknowledged:true,requestId:randomUUID(),...overrides});
const bindInput=(overrides={})=>({companyId:COMPANY,groupId:GROUP,expectedGroupVersion:1,expectedConnectionVersion:0,dealerCode:'dealer-a',evidenceReference:'Verifierat partnerunderlag ärende-1',validUntil:new Date(Date.now()+86400000).toISOString(),reason:'Granskad koppling till juridiskt företag',acknowledged:true,requestId:randomUUID(),...overrides});
const disableInput=(overrides={})=>({companyId:COMPANY,expectedConnectionVersion:1,reason:'Kopplingen återkallas efter granskning',acknowledged:true,requestId:randomUUID(),...overrides});
async function page(h,overrides={}){return success(await h.actions.getPlatformBlocketProvisioningAction({companyId:COMPANY,...overrides}),h);}
async function configured(){const h=await integration(),input=groupInput(),receipt=success(await h.actions.configureBlocketGroupAction(input),h);return {h,input,receipt};}
async function counts(){return (await database.query("select jsonb_build_object('groups',(select count(*)from private.blocket_groups),'bindings',(select count(*)from private.blocket_company_bindings),'audit',(select count(*)from private.blocket_provision_audit),'deliveries',(select count(*)from private.blocket_delivery_revisions))result")).rows[0].result;}

test('Blocket group cross-layer: platform configuration binds correct legal company and dealer, supports exact historical disable and rotation receipts',async()=>{
 const {h,input,receipt}=await configured();assert.equal(receipt.group.credentialReference,'blocket_group_label');
 const initial=await page(h);assert.equal(initial.companyId,COMPANY);assert.equal(initial.legalName,'Blocket fixture A');assert.equal(initial.organisationNumber,'5568554884');assert.equal(initial.connectionVersion,0);assert.equal(initial.binding,null);
 const bind=bindInput(),bound=success(await h.actions.bindBlocketCompanyAction(bind),h);assert.equal(bound.binding.companyId,COMPANY);assert.equal(bound.binding.dealerCode,'dealer-a');assert.equal(bound.binding.connectionVersion,1);assert.equal((await page(h)).binding.status,'verified');
 const disable=disableInput(),off=success(await h.actions.disableBlocketCompanyAction(disable),h);assert.equal(off.binding.status,'disabled');assert.equal(off.binding.connectionVersion,2);
 const rotate={...input,expectedVersion:1,credentialReference:'blocket_rotated_label',requestId:randomUUID()};success(await h.actions.configureBlocketGroupAction(rotate),h);
 assert.deepEqual(success(await h.actions.configureBlocketGroupAction(input),h),receipt);assert.deepEqual(success(await h.actions.bindBlocketCompanyAction(bind),h),bound);assert.deepEqual(success(await h.actions.disableBlocketCompanyAction(disable),h),off);
 const rebound=success(await h.actions.bindBlocketCompanyAction(bindInput({expectedGroupVersion:2,expectedConnectionVersion:2})),h);assert.equal(rebound.binding.groupVersion,2);assert.equal(rebound.binding.connectionVersion,3);
 assert.doesNotMatch(JSON.stringify(await page(h)),/claimToken|claim_token|rawToken|access_token|provider_request|payloadSha256|snapshot/);
 assert.deepEqual(await counts(),{groups:1,bindings:1,audit:5,deliveries:0});
});

test('Blocket group cross-layer: actual Auth/platform session deny dealer roles, signed-out and newly revoked admin before reads, writes and receipt replay',async()=>{
 const {h,input}=await configured();for(const actor of[OWNER,SALES,FOREIGN]){
  const denied=await integration({actor});assert.equal((await denied.actions.getPlatformBlocketProvisioningAction({companyId:COMPANY})).code,'access_denied');
  assert.equal((await denied.actions.configureBlocketGroupAction(groupInput())).code,'access_denied');assert.equal((await denied.actions.bindBlocketCompanyAction(bindInput())).code,'access_denied');
 }
 const absent=await integration();absent.state.authenticated=false;assert.equal((await absent.actions.configureBlocketGroupAction(groupInput())).code,'access_denied');
 await database.query("update private.platform_admins set status='suspended'where user_id=$1",[PLATFORM]);
 assert.equal((await h.actions.configureBlocketGroupAction(input)).code,'access_denied');assert.equal((await h.actions.getPlatformBlocketProvisioningAction({companyId:COMPANY})).code,'access_denied');assert.deepEqual(await counts(),{groups:1,bindings:0,audit:1,deliveries:0});
});

test('Blocket group cross-layer: company/dealer uniqueness, group scope, CAS and nonce binding prevent misprovisioning',async()=>{
 const {h}=await configured(),input=bindInput();success(await h.actions.bindBlocketCompanyAction(input),h);
 assert.equal((await h.actions.bindBlocketCompanyAction(bindInput({companyId:OTHER_COMPANY}))).code,'conflict');
 assert.equal((await h.actions.bindBlocketCompanyAction({...input,dealerCode:'wrong-dealer'})).code,'conflict');
 assert.equal((await h.actions.bindBlocketCompanyAction(bindInput())).code,'conflict');
 assert.equal((await h.actions.bindBlocketCompanyAction(bindInput({expectedConnectionVersion:1,expectedGroupVersion:2}))).code,'conflict');
 assert.equal((await h.actions.disableBlocketCompanyAction(disableInput({expectedConnectionVersion:2}))).code,'conflict');
 assert.equal((await h.actions.configureBlocketGroupAction(groupInput({credentialReference:'Bearer raw-token'}))).code,'invalid_input');
 assert.equal((await h.actions.bindBlocketCompanyAction({...input,rawToken:'never accepted'})).code,'invalid_input');
 assert.equal((await page(h,{companyId:OTHER_COMPANY})).binding,null);assert.deepEqual(await counts(),{groups:1,bindings:1,audit:2,deliveries:0});
});

test('Blocket group cross-layer: expired current binding still returns exact authorized historical receipt after SQL replay precedes date bounds',async()=>{
 const {h}=await configured();const stamp=(await database.query("select (clock_timestamp()+interval '300 milliseconds')::text at")).rows[0].at;
 const input=bindInput({validUntil:new Date(stamp).toISOString()}),receipt=success(await h.actions.bindBlocketCompanyAction(input),h);
 await new Promise(resolve=>setTimeout(resolve,350));assert.equal((await page(h)).binding.status,'disabled');
 assert.deepEqual(success(await h.actions.bindBlocketCompanyAction(input),h),receipt);assert.equal(receipt.binding.status,'verified');
 assert.equal((await h.actions.bindBlocketCompanyAction({...input,expectedConnectionVersion:1,requestId:randomUUID()})).code,'invalid_input');
});

test('Blocket group cross-layer: lost committed receipt retries once, and admin revocation after I/O suppresses private page and durable receipt',async()=>{
 const h=await integration(),input=groupInput();h.state.loseReceipt='configure_blocket_group';const lost=await h.actions.configureBlocketGroupAction(input);assert.equal(lost.code,'unavailable');assert.doesNotMatch(JSON.stringify(lost),/PRIVATE|database/);
 const group=success(await h.actions.configureBlocketGroupAction(input),h);
 h.state.afterRpc=async name=>{if(name==='get_platform_blocket_provisioning')await database.query("update private.platform_admins set status='suspended'where user_id=$1",[PLATFORM]);};
 const denied=await h.actions.getPlatformBlocketProvisioningAction({companyId:COMPANY});assert.equal(denied.code,'access_denied');assert.equal(denied.groups,undefined);
 await database.query("update private.platform_admins set status='active'where user_id=$1",[PLATFORM]);h.state.afterRpc=null;assert.deepEqual(success(await h.actions.configureBlocketGroupAction(input),h),group);
 const bind=bindInput();h.state.afterRpc=async name=>{if(name==='bind_blocket_company')await database.query("update private.platform_admins set status='suspended'where user_id=$1",[PLATFORM]);};
 const committed=await h.actions.bindBlocketCompanyAction(bind);assert.equal(committed.code,'access_denied');assert.equal(committed.binding,undefined);
 await database.query("update private.platform_admins set status='active'where user_id=$1",[PLATFORM]);h.state.afterRpc=null;assert.equal(success(await h.actions.bindBlocketCompanyAction(bind),h).binding.companyId,COMPANY);
 assert.deepEqual(await counts(),{groups:1,bindings:1,audit:2,deliveries:0});
});

test('Blocket group cross-layer: failed audit rolls group and binding creation back with safe generic server errors',async()=>{
 const h=await integration();await database.exec(`create function private.blocket_cross_layer_failure()returns trigger language plpgsql as $$begin raise exception 'PRIVATE synthetic audit failure';end$$;create trigger blocket_cross_layer_failure before insert on private.blocket_provision_audit for each row execute function private.blocket_cross_layer_failure()`);
 try{const out=await h.actions.configureBlocketGroupAction(groupInput());assert.equal(out.code,'unavailable');assert.doesNotMatch(JSON.stringify(out),/PRIVATE|synthetic/);assert.deepEqual(await counts(),{groups:0,bindings:0,audit:0,deliveries:0});}
 finally{await database.exec('drop trigger blocket_cross_layer_failure on private.blocket_provision_audit;drop function private.blocket_cross_layer_failure()');}
});
