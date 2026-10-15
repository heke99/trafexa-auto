// Actual server actions/context/parsers → complete migrated SQL in PGlite.
// Only Supabase I/O and selected-company routing are adapted. This proves no
// hosted Auth delivery, browser interaction or concurrent PostgreSQL locking.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before, beforeEach, after, test} from 'node:test';
import {createDatabase, asRole} from '../crm-db/helpers.mjs';
import {createSourceLoader} from '../helpers/source-loader.mjs';

const id = n => `af250000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER=id(1), ADMIN=id(2), OTHER=id(3), SALES=id(4), COMPANY=id(10), FOREIGN=id(11);
const OWNER_MEMBER=id(20), ADMIN_MEMBER=id(21);
let database;
before(async () => { database = await createDatabase(); });
beforeEach(async () => {
  await database.exec(`begin; truncate auth.users cascade;
    insert into auth.users(id,email,email_confirmed_at) values
      ('${OWNER}','ownership-owner@example.invalid',now()),('${ADMIN}','ownership-admin@example.invalid',now()),
      ('${OTHER}','ownership-other@example.invalid',now()),('${SALES}','ownership-sales@example.invalid',now());
    insert into public.companies(id,name,organisation_number,created_by) values
      ('${COMPANY}','Ownership fixture','5568554884','${OWNER}'),('${FOREIGN}','Foreign fixture','5568554884','${OTHER}');
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
    async rpc(name,args) {
      assert.match(name,/^(get_account_access|get_company_ownership_transfer|request_company_ownership_transfer|accept_company_ownership_transfer|cancel_company_ownership_transfer|list_company_team)$/);
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
    },
  };
  const loader=await createSourceLoader({
    'next/cache':{revalidatePath:path=>state.invalidations.push(path)},
    'next/headers':{async cookies(){return {set(){throw new Error('Ownership must not choose a company cookie');}};}},
    '@/lib/supabase/server':{async createServerSupabaseClient(){return db;}},
    '@/lib/data/company-context':{async getActiveCompanyContext(){return {db,company:state.company,user:state.actor,role:'owner'};}},
  });
  return {state,actions:loader.load('@/lib/company-ownership/actions'),team:loader.load('@/lib/company-team/actions')};
}
function success(result,h){assert.equal(result.ok,true,JSON.stringify({result,sqlErrors:h.state.errors}));return result;}
async function roles(){return (await database.query('select user_id,role,status,version from public.memberships where company_id=$1 order by user_id',[COMPANY])).rows;}

const review = page => ({companyId:COMPANY,targetMembershipId:ADMIN_MEMBER,expectedOwnerVersion:page.owner.version,
  expectedTargetVersion:page.candidates.find(m=>m.membershipId===ADMIN_MEMBER).version,expectedTeamVersion:page.teamVersion,
  reason:'Överlåt appbehörighet till ansvarig administratör',acknowledged:true,attestationVersion:'2026-10-15',requestId:randomUUID()});
const resolution = page => ({companyId:COMPANY,transferId:page.transfer.id,expectedVersion:page.transfer.version,
  expectedTeamVersion:page.teamVersion,acknowledged:true,attestationVersion:'2026-10-15',requestId:randomUUID()});
async function page(h){return success(await h.actions.getCompanyOwnershipTransferAction({companyId:COMPANY}),h);}
async function requested(){const owner=await integration();const input=review(await page(owner));const receipt=success(await owner.actions.requestCompanyOwnershipTransferAction(input),owner).receipt;return {owner,input,receipt};}
async function counts(){return (await database.query("select jsonb_build_object('transfers',(select count(*) from private.company_ownership_transfers),'audits',(select count(*) from private.company_ownership_audit),'teamVersion',(select team_version from public.companies where id=$1)) result",[COMPANY])).rows[0].result;}

test('ownership cross-layer: only reviewed two-party acceptance swaps exact membership roles and team read reflects live authority',async()=>{
  const {owner,input,receipt}=await requested();
  assert.equal(receipt.transfer.status,'pending');assert.equal(receipt.transfer.from.userId,OWNER);assert.equal(receipt.transfer.to.userId,ADMIN);
  assert.deepEqual((await roles()).map(m=>m.role),['owner','admin','sales']);
  const recipient=await integration({actor:ADMIN});const pending=await page(recipient);assert.equal(pending.canAccept,true);assert.equal(pending.canRequest,false);
  const accept=resolution(pending),accepted=success(await recipient.actions.acceptCompanyOwnershipTransferAction(accept),recipient).receipt;
  assert.equal(accepted.transfer.status,'accepted');assert.equal(accepted.transfer.version,2);
  assert.deepEqual((await roles()).map(m=>[m.role,m.version]),[['admin',2],['owner',2],['sales',1]]);
  const team=success(await recipient.team.listCompanyTeamAction({companyId:COMPANY}),recipient);
  assert.equal(team.actorRole,'owner');assert.equal(team.members.find(m=>m.userId===OWNER).role,'admin');
  assert.equal((await page(owner)).actorRole,'admin');
  assert.deepEqual(success(await owner.actions.requestCompanyOwnershipTransferAction(input),owner).receipt,receipt,'Historical request survives sender demotion to admin');
  assert.deepEqual(success(await recipient.actions.acceptCompanyOwnershipTransferAction(accept),recipient).receipt,accepted,'Historical accept survives recipient promotion to owner');
  assert.deepEqual(await counts(),{transfers:1,audits:2,teamVersion:3});
});

test('ownership cross-layer: cancellation keeps roles and prevents later acceptance, and request nonce binds the reviewed payload',async()=>{
  const {owner,input}=await requested();const pending=await page(owner);
  const cancel={...resolution(pending),reason:'Återkallar före mottagarens accept'};
  const cancelled=success(await owner.actions.cancelCompanyOwnershipTransferAction(cancel),owner).receipt;
  assert.equal(cancelled.transfer.status,'cancelled');assert.equal(cancelled.transfer.cancelReason,cancel.reason);
  assert.deepEqual(success(await owner.actions.cancelCompanyOwnershipTransferAction(cancel),owner).receipt,cancelled);
  assert.equal((await owner.actions.requestCompanyOwnershipTransferAction({...input,reason:'Annan motivering'})).code,'conflict');
  const recipient=await integration({actor:ADMIN});assert.equal((await recipient.actions.acceptCompanyOwnershipTransferAction(resolution(pending))).code,'conflict');
  assert.deepEqual((await roles()).map(m=>m.role),['owner','admin','sales']);assert.deepEqual(await counts(),{transfers:1,audits:2,teamVersion:3});
});

test('ownership cross-layer: fresh actor, tenant, role and account approval guard reads, mutations and historical receipts',async()=>{
  const {owner,input}=await requested();const recipient=await integration({actor:ADMIN}),accept=resolution(await page(recipient));
  for(const opts of [{actor:OTHER},{actor:SALES},{company:FOREIGN}]){
    const denied=await integration(opts);
    assert.equal((await denied.actions.getCompanyOwnershipTransferAction({companyId:COMPANY})).code,'access_denied');
    assert.equal((await denied.actions.acceptCompanyOwnershipTransferAction(accept)).code,'access_denied');
  }
  const signedOut=await integration();signedOut.state.authenticated=false;
  assert.equal((await signedOut.actions.requestCompanyOwnershipTransferAction(input)).code,'unauthenticated');
  await database.query("update private.account_approvals set status='suspended' where user_id=$1",[OWNER]);
  assert.equal((await owner.actions.requestCompanyOwnershipTransferAction(input)).code,'access_denied');
  assert.equal((await recipient.actions.acceptCompanyOwnershipTransferAction(accept)).code,'access_denied');
  assert.deepEqual((await roles()).map(m=>m.role),['owner','admin','sales']);assert.deepEqual(await counts(),{transfers:1,audits:1,teamVersion:2});
});

test('ownership cross-layer: changed member or team review and expired transfer cannot partially swap roles',async()=>{
  const {owner}=await requested(),recipient=await integration({actor:ADMIN}),accept=resolution(await page(recipient));
  await database.query('update public.memberships set version=version+1 where id=$1',[ADMIN_MEMBER]);
  assert.equal((await recipient.actions.acceptCompanyOwnershipTransferAction(accept)).code,'conflict');
  await database.query('update public.memberships set version=1 where id=$1',[ADMIN_MEMBER]);
  await database.query('update public.companies set team_version=team_version+1 where id=$1',[COMPANY]);
  assert.equal((await recipient.actions.acceptCompanyOwnershipTransferAction(accept)).code,'conflict');
  await database.query('update public.companies set team_version=2 where id=$1',[COMPANY]);
  // Fixture-only clock travel: immutable terms remain guarded in ordinary calls.
  await database.exec('alter table private.company_ownership_transfers disable trigger guard_company_ownership_transfer');
  await database.exec("update private.company_ownership_transfers set created_at=now()-interval '25 hours',expires_at=now()-interval '1 hour'");
  await database.exec('alter table private.company_ownership_transfers enable trigger guard_company_ownership_transfer');
  const expired=await page(owner);assert.equal(expired.transfer.status,'expired');assert.equal(expired.canCancel,false);
  assert.equal((await recipient.actions.acceptCompanyOwnershipTransferAction(accept)).code,'conflict');
  assert.deepEqual((await roles()).map(m=>m.role),['owner','admin','sales']);assert.deepEqual(await counts(),{transfers:1,audits:1,teamVersion:2});
});

test('ownership cross-layer: lost committed receipts retry exactly and safe errors never expose private database information',async()=>{
  const owner=await integration(),input=review(await page(owner));owner.state.loseReceipt='request_company_ownership_transfer';
  const lost=await owner.actions.requestCompanyOwnershipTransferAction(input);assert.equal(lost.code,'unavailable');assert.doesNotMatch(JSON.stringify(lost),/PRIVATE|ownership-owner/);
  const recovered=success(await owner.actions.requestCompanyOwnershipTransferAction(input),owner).receipt;
  const recipient=await integration({actor:ADMIN}),accept=resolution(await page(recipient));recipient.state.loseReceipt='accept_company_ownership_transfer';
  assert.equal((await recipient.actions.acceptCompanyOwnershipTransferAction(accept)).code,'unavailable');
  const accepted=success(await recipient.actions.acceptCompanyOwnershipTransferAction(accept),recipient).receipt;assert.equal(accepted.transfer.id,recovered.transfer.id);
  assert.deepEqual(await counts(),{transfers:1,audits:2,teamVersion:3});
  const before=owner.state.calls.length;
  assert.equal((await owner.actions.requestCompanyOwnershipTransferAction({...input,acknowledged:false})).code,'invalid_input');
  assert.equal(owner.state.calls.length,before,'Invalid attestation is rejected before authentication or SQL');
});

test('ownership cross-layer: sender or recipient revocation and immutable audit failure leave both roles unchanged',async()=>{
  await requested();const recipient=await integration({actor:ADMIN}),accept=resolution(await page(recipient));
  await database.query('update public.memberships set version=version+1 where id=$1',[OWNER_MEMBER]);
  assert.equal((await recipient.actions.acceptCompanyOwnershipTransferAction(accept)).code,'conflict');
  await database.query('update public.memberships set version=1 where id=$1',[OWNER_MEMBER]);
  await database.query("update public.memberships set status='suspended' where id=$1",[ADMIN_MEMBER]);
  assert.equal((await recipient.actions.acceptCompanyOwnershipTransferAction(accept)).code,'access_denied');
  await database.query("update public.memberships set status='active' where id=$1",[ADMIN_MEMBER]);
  await database.exec(`create function private.ownership_fixture_reject_audit() returns trigger language plpgsql as $$ begin raise exception 'PRIVATE fixture audit failure' using errcode='P0001';end $$;
    create trigger ownership_fixture_reject_audit before insert on private.company_ownership_audit for each row execute function private.ownership_fixture_reject_audit();`);
  try {
    const denied=await recipient.actions.acceptCompanyOwnershipTransferAction(accept);
    assert.equal(denied.code,'unavailable');assert.doesNotMatch(JSON.stringify(denied),/PRIVATE|fixture|ownership-owner/);
    assert.deepEqual((await roles()).map(m=>[m.role,m.version]),[['owner',1],['admin',1],['sales',1]]);
    assert.deepEqual(await counts(),{transfers:1,audits:1,teamVersion:2});
    assert.equal((await page(recipient)).transfer.status,'pending');
  } finally {await database.exec('drop trigger ownership_fixture_reject_audit on private.company_ownership_audit;drop function private.ownership_fixture_reject_audit()');}
});


test('ownership cross-layer: revocation after SQL response suppresses private page and committed receipt until fresh access returns',async()=>{
  const owner=await integration();
  owner.state.afterRpc=async name=>{if(name==='get_company_ownership_transfer')await database.query("update private.account_approvals set status='suspended' where user_id=$1",[OWNER]);};
  const read=await owner.actions.getCompanyOwnershipTransferAction({companyId:COMPANY});
  assert.equal(read.code,'access_denied');assert.equal(read.transfer,undefined);assert.equal(read.candidates,undefined);
  await database.query("update private.account_approvals set status='approved' where user_id=$1",[OWNER]);owner.state.afterRpc=null;
  const input=review(await page(owner));
  owner.state.afterRpc=async name=>{if(name==='request_company_ownership_transfer')await database.query("update private.account_approvals set status='suspended' where user_id=$1",[OWNER]);};
  const committed=await owner.actions.requestCompanyOwnershipTransferAction(input);
  assert.equal(committed.code,'access_denied');assert.equal(committed.receipt,undefined);
  assert.deepEqual(await counts(),{transfers:1,audits:1,teamVersion:2});
  await database.query("update private.account_approvals set status='approved' where user_id=$1",[OWNER]);owner.state.afterRpc=null;
  assert.equal(success(await owner.actions.requestCompanyOwnershipTransferAction(input),owner).receipt.transfer.status,'pending');
});
