// Actual server actions/context/parsers → complete migrated SQL in PGlite.
// Only Supabase I/O and selected-company routing are adapted. This proves no
// hosted Auth delivery, browser interaction or concurrent PostgreSQL locking.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before, beforeEach, after, test} from 'node:test';
import {createDatabase, asRole} from '../crm-db/helpers.mjs';
import {createSourceLoader} from '../helpers/source-loader.mjs';

const id = n => `af260000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER=id(1), ADMIN=id(2), OTHER=id(3), SALES=id(4), COMPANY=id(10), FOREIGN=id(11);
const OWNER_MEMBER=id(20), ADMIN_MEMBER=id(21);
let database;
before(async () => { database = await createDatabase(); });
beforeEach(async () => {
  await database.exec(`begin; truncate auth.users cascade;
    insert into auth.users(id,email,email_confirmed_at) values
      ('${OWNER}','branches-owner@example.invalid',now()),('${ADMIN}','branches-admin@example.invalid',now()),
      ('${OTHER}','branches-other@example.invalid',now()),('${SALES}','branches-sales@example.invalid',now());
    insert into public.companies(id,name,organisation_number,created_by) values
      ('${COMPANY}','Branches fixture','5568554884','${OWNER}'),('${FOREIGN}','Foreign fixture','5568554884','${OTHER}');
    insert into public.memberships(id,company_id,user_id,role) values
      ('${OWNER_MEMBER}','${COMPANY}','${OWNER}','owner'),('${ADMIN_MEMBER}','${COMPANY}','${ADMIN}','admin'),
      ('${id(22)}','${COMPANY}','${SALES}','sales'),('${id(23)}','${FOREIGN}','${OTHER}','owner');
    commit;`);
});
after(async () => { await database?.close(); });

async function integration({actor=OWNER, company=COMPANY}={}) {
  const state={actor, company, authenticated:true, calls:[], errors:[], invalidations:[], loseReceipt:null};
  const db={
    auth:{async getUser() {
      state.calls.push(['auth']);
      const user=state.authenticated ? (await database.query('select id,email,email_confirmed_at::text,is_anonymous from auth.users where id=$1',[state.actor])).rows[0] : null;
      return {data:{user:user??null},error:null};
    }},
    from(table) {
      assert.equal(table,'memberships');
      const filters={}, query={select(){return query;},eq(key,value){filters[key]=value;return query;},async maybeSingle(){
        const data=await asRole(database,'authenticated',state.actor,async tx=>{
          const {rows}=await tx.query(`select m.*,jsonb_build_object('id',c.id,'status',c.status) companies
            from public.memberships m join public.companies c on c.id=m.company_id
            where m.company_id=$1 and m.user_id=$2 and m.status=$3 and c.status=$4`,
          [filters.company_id,filters.user_id,filters.status,filters['companies.status']]);
          return rows[0]??null;
        });
        state.calls.push(['membership']);return {data,error:null};
      }};return query;
    },
    rpc(name,args) {
      const work=(async()=>{
      assert.match(name,/^(get_account_access|list_company_branches|save_company_branch|set_company_branch_status)$/);
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
    '@/lib/data/company-context':{async getActiveCompanyContext(){return {db,company:state.company,user:state.actor,role:'owner'};}},
  });
  return {state,actions:loader.load('@/lib/company-branches/actions')};
}
function success(result,h){assert.equal(result.ok,true,JSON.stringify({result,sqlErrors:h.state.errors}));assert.equal(Object.hasOwn(result,'branch'),false,'Mutation actions expose the agreed wrapped receipt');return result.receipt ?? result;}
const fields=(code='sthlm')=>({code,name:'Stockholm butik',addressLine1:'Testgatan 1',postalCode:'11122',city:'Stockholm',publicEmail:'butik@example.invalid',publicPhone:'+468123456'});
const saveInput=(overrides={})=>({companyId:COMPANY,branchId:randomUUID(),expectedVersion:0,fields:fields(),acknowledged:true,requestId:randomUUID(),...overrides});
const statusInput=(branch,status='archived')=>({companyId:COMPANY,branchId:branch.id,expectedVersion:branch.version,status,reason:'Granskad ändring av filialstatus',acknowledged:true,requestId:randomUUID()});
async function page(h,overrides={}){return success(await h.actions.listCompanyBranchesAction({companyId:COMPANY,status:'active',...overrides}),h);}
async function counts(){return (await database.query("select jsonb_build_object('branches',(select count(*) from private.company_branches),'audits',(select count(*) from private.company_branch_audit)) result")).rows[0].result;}

test('branches cross-layer: reviewed create/edit/archive/reactivate preserve legal company and exact historical receipts',async()=>{
  const owner=await integration(),initial=await page(owner);assert.equal(initial.branches.length,0);assert.equal(initial.organisationNumber,'5568554884');
  const input=saveInput(),created=success(await owner.actions.saveCompanyBranchAction(input),owner);
  assert.equal(created.branch.version,1);assert.equal(created.branch.status,'active');assert.deepEqual(created.branch.fields,input.fields);
  const admin=await integration({actor:ADMIN});
  const edit={...input,expectedVersion:1,fields:{...input.fields,name:'Uppdaterad butik'},requestId:randomUUID()};
  const edited=success(await admin.actions.saveCompanyBranchAction(edit),admin);assert.equal(edited.branch.version,2);
  const archive=statusInput(edited.branch),archived=success(await owner.actions.setCompanyBranchStatusAction(archive),owner);
  assert.equal(archived.branch.status,'archived');assert.equal((await page(owner)).branches.length,0);
  assert.equal((await page(owner,{status:'archived'})).branches[0].id,created.branch.id);
  const reactivate=statusInput(archived.branch,'active'),active=success(await admin.actions.setCompanyBranchStatusAction(reactivate),admin);
  assert.equal(active.branch.version,4);assert.equal((await page(owner)).branches[0].fields.name,'Uppdaterad butik');
  assert.deepEqual(success(await owner.actions.saveCompanyBranchAction(input),owner),created);
  assert.deepEqual(success(await owner.actions.setCompanyBranchStatusAction(archive),owner),archived);
  assert.deepEqual(success(await admin.actions.setCompanyBranchStatusAction(reactivate),admin),active);
  assert.equal((await page(owner)).legalName,'Branches fixture');assert.deepEqual(await counts(),{branches:1,audits:4});
});

test('branches cross-layer: reviewed CAS, unique codes and nonce payload binding reject without partial writes',async()=>{
  const h=await integration(),input=saveInput();const branch=success(await h.actions.saveCompanyBranchAction(input),h).branch;
  assert.equal((await h.actions.saveCompanyBranchAction(saveInput())).code,'conflict');
  assert.equal((await h.actions.saveCompanyBranchAction({...input,fields:{...input.fields,name:'Changed nonce'}})).code,'conflict');
  const edit={...input,expectedVersion:1,fields:{...input.fields,code:'north'},requestId:randomUUID()};
  const newer=success(await h.actions.saveCompanyBranchAction(edit),h).branch;
  assert.equal((await h.actions.saveCompanyBranchAction({...edit,requestId:randomUUID()})).code,'conflict');
  assert.equal((await h.actions.setCompanyBranchStatusAction(statusInput(branch))).code,'conflict');
  assert.deepEqual(await counts(),{branches:1,audits:2});assert.equal((await page(h)).branches[0].version,newer.version);
});

test('branches cross-layer: two companies remain isolated, owner/admin only and live approval protect every operation',async()=>{
  const h=await integration(),input=saveInput(),branch=success(await h.actions.saveCompanyBranchAction(input),h).branch;
  const foreign=await integration({actor:OTHER,company:FOREIGN});
  const other=saveInput({companyId:FOREIGN});success(await foreign.actions.saveCompanyBranchAction(other),foreign);
  for(const opts of [{actor:OTHER},{actor:SALES},{company:FOREIGN}]){
    const denied=await integration(opts);
    assert.equal((await denied.actions.listCompanyBranchesAction({companyId:COMPANY,status:'active'})).code,'access_denied');
    assert.equal((await denied.actions.saveCompanyBranchAction({...input,expectedVersion:1,requestId:randomUUID()})).code,'access_denied');
    assert.equal((await denied.actions.setCompanyBranchStatusAction(statusInput(branch))).code,'access_denied');
  }
  assert.equal((await foreign.actions.setCompanyBranchStatusAction({...statusInput(branch),companyId:FOREIGN})).ok,false);
  const signedOut=await integration();signedOut.state.authenticated=false;
  assert.equal((await signedOut.actions.saveCompanyBranchAction(input)).code,'unauthenticated');
  await database.query("update private.account_approvals set status='suspended' where user_id=$1",[OWNER]);
  assert.equal((await h.actions.saveCompanyBranchAction(input)).code,'access_denied');assert.deepEqual(await counts(),{branches:2,audits:2});
});

test('branches cross-layer: stable keyset pagination is ordered, status-specific and never crosses company boundaries',async()=>{
  const h=await integration();for(let n=1;n<=3;n++)success(await h.actions.saveCompanyBranchAction(saveInput({branchId:id(100+n),fields:fields('shop'+n)})),h);
  const first=await page(h,{limit:2});assert.deepEqual(first.branches.map(b=>b.id),[id(101),id(102)]);assert.equal(first.nextPageKey,id(102));
  const second=await page(h,{limit:2,pageKey:first.nextPageKey});assert.deepEqual(second.branches.map(b=>b.id),[id(103)]);assert.equal(second.nextPageKey,null);
  success(await h.actions.setCompanyBranchStatusAction(statusInput(first.branches[0])),h);
  const archived=await page(h,{status:'archived',limit:2});assert.deepEqual(archived.branches.map(b=>b.id),[id(101)]);
});

test('branches cross-layer: lost commit response recovers exact receipt and post-SQL approval revocation suppresses DTO',async()=>{
  const h=await integration(),input=saveInput();h.state.loseReceipt='save_company_branch';
  const lost=await h.actions.saveCompanyBranchAction(input);assert.equal(lost.code,'unavailable');assert.doesNotMatch(JSON.stringify(lost),/PRIVATE|branches-owner/);
  const receipt=success(await h.actions.saveCompanyBranchAction(input),h);
  h.state.afterRpc=async name=>{if(name==='list_company_branches')await database.query("update private.account_approvals set status='suspended' where user_id=$1",[OWNER]);};
  const denied=await h.actions.listCompanyBranchesAction({companyId:COMPANY,status:'active'});assert.equal(denied.code,'access_denied');assert.equal(denied.branches,undefined);
  await database.query("update private.account_approvals set status='approved' where user_id=$1",[OWNER]);h.state.afterRpc=null;
  assert.deepEqual(success(await h.actions.saveCompanyBranchAction(input),h),receipt);assert.deepEqual(await counts(),{branches:1,audits:1});
  const edit={...input,expectedVersion:1,fields:{...input.fields,name:'Committed before revocation'},requestId:randomUUID()};
  h.state.afterRpc=async name=>{if(name==='save_company_branch')await database.query("update private.account_approvals set status='suspended' where user_id=$1",[OWNER]);};
  const committed=await h.actions.saveCompanyBranchAction(edit);assert.equal(committed.code,'access_denied');assert.equal(committed.receipt,undefined);
  assert.deepEqual(await counts(),{branches:1,audits:2});
  await database.query("update private.account_approvals set status='approved' where user_id=$1",[OWNER]);h.state.afterRpc=null;
  assert.equal(success(await h.actions.saveCompanyBranchAction(edit),h).branch.fields.name,edit.fields.name);
});

test('branches cross-layer: failed audit atomically rolls back create, edit and archive with safe errors',async()=>{
  const h=await integration(),input=saveInput(),branch=success(await h.actions.saveCompanyBranchAction(input),h).branch;
  await database.exec(`create function private.branches_fixture_reject_audit() returns trigger language plpgsql as $$ begin raise exception 'PRIVATE fixture audit failure' using errcode='P0001';end $$;
    create trigger branches_fixture_reject_audit before insert on private.company_branch_audit for each row execute function private.branches_fixture_reject_audit();`);
  try {
    for(const operation of [()=>h.actions.saveCompanyBranchAction(saveInput({fields:fields('south')})),
      ()=>h.actions.saveCompanyBranchAction({...input,expectedVersion:1,fields:{...input.fields,name:'Must roll back'},requestId:randomUUID()}),
      ()=>h.actions.setCompanyBranchStatusAction(statusInput(branch))]){
      const result=await operation();assert.equal(result.code,'unavailable');assert.doesNotMatch(JSON.stringify(result),/PRIVATE|fixture|branches-owner/);
      assert.deepEqual(await counts(),{branches:1,audits:1});assert.deepEqual((await page(h)).branches,[branch]);
    }
  } finally {await database.exec('drop trigger branches_fixture_reject_audit on private.company_branch_audit;drop function private.branches_fixture_reject_audit()');}
});
