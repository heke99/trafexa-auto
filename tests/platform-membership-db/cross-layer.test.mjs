// Actual server actions and fresh admin context -> all migrated SQL in PGlite.
// Only Supabase I/O and Next cache invalidation are adapted; no hosted writes.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before, beforeEach, after, test} from 'node:test';
import {createDatabase, asRole} from '../crm-db/helpers.mjs';
import {createSourceLoader} from '../helpers/source-loader.mjs';
const id=n=>`ab280000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ADMIN=id(1), OWNER=id(2), MEMBER=id(3), FOREIGN=id(4), EMPTY=id(5);
const COMPANY=id(10), OTHER=id(11), OWNER_MEMBER=id(20), MEMBER_ID=id(21), OTHER_MEMBER=id(22);
let db;
before(async()=>{db=await createDatabase();});
beforeEach(async()=>{
 await db.exec(`begin;truncate auth.users cascade;
 insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('${ADMIN}','membership-platform@example.invalid',now(),'{}'),
 ('${OWNER}','membership-owner@example.invalid',now(),'{"is_platform_admin":true}'),
 ('${MEMBER}','membership-sales@example.invalid',now(),'{}'),
 ('${FOREIGN}','membership-foreign@example.invalid',now(),'{}'),
 ('${EMPTY}','membership-empty@example.invalid',now(),'{}');
 insert into private.platform_admins(user_id,created_by) values('${ADMIN}','${ADMIN}');
 insert into public.companies(id,name,organisation_number,created_by) values
 ('${COMPANY}','Admin integration company','5568554884','${OWNER}'),
 ('${OTHER}','Other integration company','5568554884','${FOREIGN}');
 insert into public.memberships(id,company_id,user_id,role) values
 ('${OWNER_MEMBER}','${COMPANY}','${OWNER}','owner'),('${MEMBER_ID}','${COMPANY}','${MEMBER}','sales'),
 ('${OTHER_MEMBER}','${OTHER}','${MEMBER}','viewer'),('${id(23)}','${OTHER}','${FOREIGN}','owner');commit;`);
});
after(async()=>{await db?.close();});
async function integration(actor=ADMIN){
 const state={actor,authenticated:true,calls:[],errors:[],invalidations:[],loseReceipt:false,afterRpc:null};
 const client={auth:{async getUser(){state.calls.push('auth');const user=state.authenticated?(await db.query('select id,email,email_confirmed_at::text,is_anonymous from auth.users where id=$1',[state.actor])).rows[0]:null;return{data:{user:user??null},error:null};}},
 rpc(name,args){
  const work=(async()=>{assert.match(name,/^(get_platform_admin_session|list_platform_accounts|set_platform_account_access|list_platform_company_members|list_platform_account_memberships|update_platform_company_member)$/);state.calls.push({name,args:structuredClone(args)});
   try{const entries=Object.entries(args);assert.ok(entries.every(([key])=>/^p_[a-z_]+$/.test(key)));const params=entries.map(([key],i)=>`${key} => $${i+1}`).join(',');
    const data=await asRole(db,'authenticated',state.actor,async tx=>(await tx.query(`select public.${name}(${params}) result`,entries.map(([,value])=>value))).rows[0].result);
    if(state.afterRpc)await state.afterRpc(name);
    if(state.loseReceipt&&name==='update_platform_company_member'){state.loseReceipt=false;return{data:null,error:{code:'NETWORK',message:'PRIVATE lost result'}};}
    return{data,error:null};
   }catch(error){state.errors.push({code:error.code,message:error.message});return{data:null,error:{code:error.code,message:'PRIVATE database detail'}};}
  })();work.abortSignal=()=>work;return work;
 }};
 const loader=await createSourceLoader({'@/lib/supabase/server':{async createServerSupabaseClient(){return client;}},'next/cache':{revalidatePath:path=>state.invalidations.push(path)}});
 return{state,actions:loader.load('@/lib/platform-admin/membership-actions'),accounts:loader.load('@/lib/platform-admin/account-actions')};
}
function success(result,h){assert.equal(result.ok,true,JSON.stringify({result,sqlErrors:h.state.errors}));return result;}
const change=(patch={})=>({companyId:COMPANY,membershipId:MEMBER_ID,expectedVersion:1,role:'finance',status:'active',reason:'Kontrollerad ändring av arbetsuppgifter',requestId:randomUUID(),...patch});

test('both list directions return actual migrated memberships and verified scope, including account without companies',async()=>{
 const h=await integration();const company=success(await h.actions.listPlatformCompanyMembersAction({companyId:COMPANY}),h);
 assert.equal(company.actorUserId,ADMIN);assert.equal(company.companyId,COMPANY);assert.deepEqual(new Set(company.members.map(m=>m.membershipId)),new Set([OWNER_MEMBER,MEMBER_ID]));
 const account=success(await h.actions.listPlatformAccountMembershipsAction({userId:MEMBER,limit:1}),h);assert.equal(account.userId,MEMBER);assert.equal(account.memberships.length,1);assert.ok(account.nextPageKey);
 const second=success(await h.actions.listPlatformAccountMembershipsAction({userId:MEMBER,pageKey:account.nextPageKey,limit:1}),h);assert.equal(second.memberships.length,1);assert.notEqual(second.memberships[0].membershipId,account.memberships[0].membershipId);assert.equal(second.nextPageKey,null);
 const empty=success(await h.actions.listPlatformAccountMembershipsAction({userId:EMPTY}),h);assert.equal(empty.email,'membership-empty@example.invalid');assert.deepEqual(empty.memberships,[]);
});
test('reviewed edit changes real dealer authorization and both membership versions; exact retry never reapplies',async()=>{
 const h=await integration(),input=change({role:'viewer'});const before=success(await h.actions.listPlatformCompanyMembersAction({companyId:COMPANY}),h);
 const first=success(await h.actions.updatePlatformCompanyMemberAction(input),h);assert.equal(first.receipt.member.role,'viewer');assert.equal(first.receipt.member.version,2);assert.equal(first.receipt.teamVersion,before.teamVersion+1);
 const authorized=await asRole(db,'authenticated',MEMBER,async tx=>(await tx.query(`select private.has_company_role($1,array['sales','admin','owner']::text[]) permitted`,[COMPANY])).rows[0].permitted);assert.equal(authorized,false);
 const repeat=success(await h.actions.updatePlatformCompanyMemberAction(input),h);assert.deepEqual(repeat.receipt,first.receipt);
 assert.equal((await db.query('select version from public.memberships where id=$1',[MEMBER_ID])).rows[0].version,2);
});
test('lost mutation response reuses immutable receipt and fresh read establishes current status',async()=>{
 const h=await integration(),input=change({status:'suspended'});h.state.loseReceipt=true;
 const lost=await h.actions.updatePlatformCompanyMemberAction(input);assert.equal(lost.ok,false);assert.equal(lost.code,'unavailable');
 const retry=success(await h.actions.updatePlatformCompanyMemberAction(input),h);assert.equal(retry.receipt.member.status,'suspended');
 const current=success(await h.actions.listPlatformAccountMembershipsAction({userId:MEMBER}),h);assert.equal(current.memberships.find(m=>m.membershipId===MEMBER_ID).version,2);
 assert.equal((await db.query('select version from public.memberships where id=$1',[OTHER_MEMBER])).rows[0].version,1);
});
test('actual SQL denies forged dealer metadata, cross-company mutation, owner edit and owner promotion',async()=>{
 const dealer=await integration(OWNER);assert.equal((await dealer.actions.listPlatformCompanyMembersAction({companyId:COMPANY})).code,'access_denied');
 const h=await integration();for(const input of [change({companyId:OTHER}),change({membershipId:OWNER_MEMBER}),change({role:'owner'})]){const r=await h.actions.updatePlatformCompanyMemberAction(input);assert.equal(r.ok,false);}
 assert.deepEqual((await db.query('select role,version from public.memberships where id=$1',[OWNER_MEMBER])).rows[0],{role:'owner',version:1});
});
test('live account and company restrictions block activation while suspension remains possible',async()=>{
 const h=await integration();await db.query("update private.account_approvals set status='suspended',version=version+1 where user_id=$1",[MEMBER]);
 assert.equal((await h.actions.updatePlatformCompanyMemberAction(change())).ok,false);
 const blocked=success(await h.actions.updatePlatformCompanyMemberAction(change({status:'suspended'})),h);assert.equal(blocked.receipt.member.accountStatus,'suspended');
 await db.query("update private.account_approvals set status='approved',version=version+1 where user_id=$1",[MEMBER]);await db.query("update public.companies set status='suspended' where id=$1",[COMPANY]);
 assert.equal((await h.actions.updatePlatformCompanyMemberAction(change({expectedVersion:2,status:'active'}))).ok,false);
});
test('revocation after SQL read or committed edit fails closed without exposing the private DTO',async()=>{
 for(const mutation of [false,true]){
  await db.query("update private.platform_admins set status='active' where user_id=$1",[ADMIN]);const h=await integration();
  h.state.afterRpc=async name=>{if(name===(mutation?'update_platform_company_member':'list_platform_company_members'))await db.query("update private.platform_admins set status='suspended' where user_id=$1",[ADMIN]);};
  const r=mutation?await h.actions.updatePlatformCompanyMemberAction(change()):await h.actions.listPlatformCompanyMembersAction({companyId:COMPANY});assert.equal(r.ok,false);assert.equal(r.code,'access_denied');assert.equal('members'in r,false);assert.equal('receipt'in r,false);
 }
});

test('suspended platform registry entries stay visibly protected in both account and company views',async()=>{
 await db.query("insert into private.platform_admins(user_id,created_by,status) values($1,$2,'suspended')",[MEMBER,ADMIN]);
 const h=await integration();const accounts=success(await h.accounts.listPlatformAccountsAction({filter:'all'}),h);assert.equal(accounts.accounts.find(a=>a.userId===MEMBER).isPlatformAdmin,true);
 const company=success(await h.actions.listPlatformCompanyMembersAction({companyId:COMPANY}),h);assert.equal(company.members.find(m=>m.userId===MEMBER).isPlatformAdmin,true);
 const denied=await h.actions.updatePlatformCompanyMemberAction(change());assert.equal(denied.ok,false);
 const decision=await h.accounts.setPlatformAccountAccessAction({userId:MEMBER,expectedVersion:1,status:'suspended',reason:'Skyddad målidentitet',requestId:randomUUID()});assert.equal(decision.ok,false);
});
