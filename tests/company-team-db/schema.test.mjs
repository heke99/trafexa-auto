import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase, asRole, runSqlTests } from './helpers.mjs';
const uuid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const U={owner:uuid(1),admin:uuid(2),sales:uuid(3),finance:uuid(4),viewer:uuid(5),owner2:uuid(6),recipient:uuid(7),other:uuid(8),pending:uuid(9),sso:uuid(10),anonymous:uuid(11),banned:uuid(12)};
const C=uuid(101),C2=uuid(102),M={owner:uuid(201),admin:uuid(202),sales:uuid(203),finance:uuid(204),viewer:uuid(205),owner2:uuid(206)};
export async function rpc(db,user,name,args={},role='authenticated') {
 assert.match(name,/^[a-z_]+$/);
 const entries=Object.entries(args); for(const [key] of entries)assert.match(key,/^p_[a-z_]+$/);
 return asRole(db,role,user,async tx=>(await tx.query(`select public.${name}(${entries.map(([key],n)=>`${key} => $${n+1}`).join(',')}) as result`,entries.map(([,value])=>value))).rows[0].result);
}
async function fixture(options={}) {
 const db=await createDatabase(options);
 for(const [name,id] of Object.entries(U))await db.query(`insert into auth.users(id,email,email_confirmed_at,is_anonymous,is_sso_user,banned_until,raw_user_meta_data)
 values($1,$2,case when $3 then null else now() end,$4,$5,case when $6 then now()+interval '1 day' else null end,'{"role":"owner","email":"owner@example.test"}')`,[id,`${name}@example.test`,name==='pending',name==='anonymous',name==='sso',name==='banned']);
 await db.query("insert into public.companies(id,name,organisation_number,created_by) values($1,'First Company','1234567890',$3),($2,'Second Company','1234567891',$4)",[C,C2,U.owner,U.owner2]);
 for(const role of ['owner','admin','sales','finance','viewer'])await db.query('insert into public.memberships(id,company_id,user_id,role) values($1,$2,$3,$4)',[M[role],C,U[role],role]);
 await db.query("insert into public.memberships(id,company_id,user_id,role) values($1,$2,$3,'owner')",[M.owner2,C2,U.owner2]);
 return db;
}
const list=(db,user=U.owner,args={})=>rpc(db,user,'list_company_team',{p_company_id:C,...args});
async function invite(db,{user=U.owner,email='recipient@example.test',role='sales',version,request=randomUUID(),company=C}={}) {
 if(version===undefined)version=(await rpc(db,user,'list_company_team',{p_company_id:company})).teamVersion;
 return rpc(db,user,'create_company_invitation',{p_company_id:company,p_email:email,p_role:role,p_expected_team_version:version,p_request_id:request});
}
const accept=(db,i,{user=U.recipient,version=i.version,request=randomUUID()}={})=>rpc(db,user,'accept_company_invitation',{p_invitation_id:i.id,p_expected_version:version,p_request_id:request});
const change=(db,member,{user=U.owner,role='finance',status='active',version=1,reason='Personaladministration',request=randomUUID()}={})=>rpc(db,user,'update_company_team_member',{p_company_id:C,p_membership_id:member,p_expected_version:version,p_role:role,p_status:status,p_reason:reason,p_request_id:request});
const revoke=(db,i,{user=U.owner,version=i.version,reason='Inbjudan återkallas',request=randomUUID(),company=C}={})=>rpc(db,user,'revoke_company_invitation',{p_company_id:company,p_invitation_id:i.id,p_expected_version:version,p_reason:reason,p_request_id:request});
const fails=(f,code)=>assert.rejects(f,e=>{assert.equal(e.code,code,`${e.code}: ${e.message}`);return true;});

test('actual complete migration chain: rollback SQL security contract',async()=>{await runSqlTests();});
test('tenant team gate, actual verified account, private grants and existing dealer RLS',async()=>{
 const db=await fixture();try{
  const team=await list(db);assert.equal(team.members.length,5);assert.equal(team.actorRole,'owner');assert.equal(team.teamVersion,1);
  assert.equal((await list(db,U.admin)).members.length,5);
  for(const name of ['sales','finance','viewer','owner2','recipient','pending','sso','anonymous','banned'])await fails(()=>list(db,U[name]),'42501');
  for(const role of ['anon','service_role'])await fails(()=>rpc(db,U.owner,'list_company_team',{p_company_id:C},role),'42501');
  await fails(()=>rpc(db,null,'list_company_team',{p_company_id:C}),'42501');
  await fails(()=>list(db,U.owner,{p_limit:51}),'22023');
  const own=await asRole(db,'authenticated',U.sales,tx=>tx.query('select id from public.companies'));assert.deepEqual(own.rows.map(x=>x.id),[C]);
  const memberships=await asRole(db,'authenticated',U.sales,tx=>tx.query('select company_id from public.memberships'));assert.equal(memberships.rows.length,5);assert.ok(memberships.rows.every(x=>x.company_id===C));
  for(const sql of ['select * from private.company_team_invitations','select * from private.company_team_audit',"update public.memberships set role='owner'",'delete from public.memberships'])await fails(()=>asRole(db,'authenticated',U.owner,tx=>tx.query(sql)),'42501');
  await db.query('update auth.users set email=$1 where id=$2',['OWNER@example.test',U.other]);await fails(()=>list(db),'42501');
 }finally{await db.close();}
});

test('invite normalization, role restrictions, CAS creation, exact replay and expiry re-invite',async()=>{
 const db=await fixture();try{
  const request=randomUUID();const receipt=await invite(db,{email:' Recipient@Example.Test ',request,version:1});assert.equal(receipt.invitation.email,'recipient@example.test');assert.equal(receipt.invitation.version,1);assert.equal(receipt.teamVersion,2);assert.equal(receipt.requestId,request);assert.equal(receipt.actorUserId,U.owner);
  assert.deepEqual(await invite(db,{email:'recipient@example.test',request,version:1}),receipt);
  await fails(()=>invite(db,{email:'other@example.test',request,version:1}),'40001');
  await fails(()=>invite(db,{email:'other@example.test',version:1}),'40001');
  await fails(()=>invite(db,{email:'recipient@example.test'}),'40001');
  await fails(()=>invite(db,{role:'owner',email:'other@example.test'}),'22023');
  await fails(()=>invite(db,{user:U.admin,role:'admin',email:'other@example.test'}),'42501');
  await fails(()=>invite(db,{email:'sales@example.test'}),'42501');
  await fails(()=>invite(db,{email:'owner@example.test'}),'42501');
  const admin=await invite(db,{role:'admin',email:'other@example.test'});assert.equal(admin.invitation.role,'admin');
  await fails(()=>revoke(db,admin.invitation,{user:U.admin}),'42501');
  await db.query("update private.company_team_invitations set created_at=now()-interval '8 days',expires_at=now()-interval '1 day' where id=$1",[receipt.invitation.id]);
  assert.equal((await list(db)).invitations.find(i=>i.id===receipt.invitation.id).status,'expired');
  const replacement=await invite(db);assert.notEqual(replacement.invitation.id,receipt.invitation.id);
  assert.equal((await db.query('select status,version from private.company_team_invitations where id=$1',[receipt.invitation.id])).rows[0].status,'expired');
  assert.deepEqual(await invite(db,{request,version:1}),receipt);
 }finally{await db.close();}
});

test('member administration protects owners/self/admin peers, CAS, no-op and immutable receipts',async()=>{
 const db=await fixture();try{
  for(const target of [M.owner,M.admin])await fails(()=>change(db,target,{user:U.admin}),'42501');
  await fails(()=>change(db,M.owner),'42501');
  await fails(()=>change(db,M.admin,{user:U.admin,role:'viewer'}),'42501');
  await fails(()=>change(db,M.sales,{user:U.admin,role:'admin'}),'42501');
  await fails(()=>change(db,M.sales,{reason:'\n'}),'22023');
  await fails(()=>change(db,M.sales,{role:'owner'}),'22023');
  const request=randomUUID();const changed=await change(db,M.sales,{user:U.admin,request});assert.equal(changed.member.role,'finance');assert.equal(changed.member.version,2);assert.equal(changed.teamVersion,2);
  assert.deepEqual(await change(db,M.sales,{user:U.admin,request}),changed);
  await fails(()=>change(db,M.sales,{user:U.admin,request,reason:'Different'}),'40001');
  await fails(()=>change(db,M.sales,{user:U.admin}),'40001');
  const noop=await change(db,M.sales,{user:U.admin,version:2});assert.equal(noop.member.version,2);assert.equal(noop.teamVersion,2);
  const suspended=await change(db,M.sales,{version:2,status:'suspended'});assert.equal(suspended.member.version,3);
  await fails(()=>invite(db,{email:'sales@example.test'}),'42501');
  const restored=await change(db,M.sales,{version:3,status:'active'});assert.equal(restored.member.version,4);
  const promotion=await change(db,M.viewer,{role:'admin'});assert.equal(promotion.member.role,'admin');
  await fails(()=>change(db,M.viewer,{user:U.admin,version:2,role:'viewer'}),'42501');
  assert.deepEqual(await change(db,M.sales,{user:U.admin,request}),changed);
  await db.query("update public.memberships set status='suspended' where id=$1",[M.admin]);await fails(()=>change(db,M.sales,{user:U.admin,request}),'42501');
  await fails(()=>db.query("update private.company_team_audit set reason='rewrite'"),'55000');
  await fails(()=>db.query('delete from private.company_team_audit'),'55000');
 }finally{await db.close();}
});

test('personal invitations bind actual verified email, acceptance single use and suspended no-reactivation',async()=>{
 const db=await fixture();try{
  const created=await invite(db);const i=created.invitation;
  assert.equal((await rpc(db,U.recipient,'list_my_company_invitations')).invitations[0].companyName,'First Company');
  assert.equal((await rpc(db,U.other,'list_my_company_invitations')).invitations.length,0);
  for(const name of ['pending','sso','anonymous','banned'])await fails(()=>rpc(db,U[name],'list_my_company_invitations'),'42501');
  await fails(()=>accept(db,i,{user:U.other}),'42501');
  await fails(()=>accept(db,i,{version:2}),'40001');
  const request=randomUUID();const accepted=await accept(db,i,{request});assert.equal(accepted.userId,U.recipient);assert.equal(accepted.role,'sales');assert.equal(accepted.version,1);assert.equal(accepted.requestId,request);
  assert.deepEqual(await accept(db,i,{request}),accepted);
  await fails(()=>accept(db,i),'40001');
  assert.equal((await rpc(db,U.recipient,'list_my_company_invitations')).invitations.length,0);
  await change(db,accepted.membershipId,{status:'suspended',role:'sales'});
  await fails(()=>accept(db,i,{request}),'42501');
  await fails(()=>invite(db),'42501');
  assert.equal((await db.query('select count(*)::int as n from public.memberships where company_id=$1 and user_id=$2',[C,U.recipient])).rows[0].n,1);
 }finally{await db.close();}
});

test('acceptance rechecks company, inviter current role, expiry and existing membership',async()=>{
 const db=await fixture();try{
  const a=(await invite(db,{role:'admin'})).invitation;
  await db.query("update public.memberships set role='admin' where id=$1",[M.owner]);
  await fails(()=>accept(db,a),'42501');assert.equal((await rpc(db,U.recipient,'list_my_company_invitations')).invitations.length,0);
  await db.query("update public.memberships set role='owner' where id=$1",[M.owner]);
  await db.query("update public.companies set status='suspended' where id=$1",[C]);await fails(()=>accept(db,a),'42501');
  await db.query("update public.companies set status='active' where id=$1",[C]);
  await db.query("update public.memberships set status='suspended' where id=$1",[M.owner]);await fails(()=>accept(db,a),'42501');
  await db.query("update public.memberships set status='active' where id=$1",[M.owner]);
  await db.query("update private.company_team_invitations set created_at=now()-interval '8 days',expires_at=now()-interval '1 day' where id=$1",[a.id]);await fails(()=>accept(db,a),'40001');
  const next=(await invite(db)).invitation;
  await db.query("insert into public.memberships(company_id,user_id,role,status) values($1,$2,'viewer','suspended')",[C,U.recipient]);await fails(()=>accept(db,next),'42501');
  await db.query("update public.memberships set status='active' where company_id=$1 and user_id=$2",[C,U.recipient]);await fails(()=>accept(db,next),'42501');
 }finally{await db.close();}
});

test('revocation CAS/replay, lower admin permitted, revoke/accept outcomes atomic',async()=>{
 const db=await fixture();try{
  const i=(await invite(db,{user:U.admin})).invitation;const request=randomUUID();const revoked=await revoke(db,i,{user:U.admin,request});assert.equal(revoked.invitation.status,'revoked');assert.equal(revoked.invitation.version,2);
  assert.deepEqual(await revoke(db,i,{user:U.admin,request}),revoked);
  await fails(()=>revoke(db,i,{user:U.admin}),'40001');await fails(()=>accept(db,i),'40001');
  const next=(await invite(db)).invitation;
  // PGlite serializes transactions; Promise.all tests one winner/outcome, not
  // independent PostgreSQL connections waiting on row locks.
  const results=await Promise.allSettled([accept(db,next),revoke(db,next)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'40001');
  assert.equal((await db.query("select count(*)::int n from private.company_team_audit where action in ('revoke','accept')")).rows[0].n,2);
 }finally{await db.close();}
});

test('bounded UUID keyset pages, 50 live pending cap, no cross-tenant/email disclosure',async()=>{
 const db=await fixture();try{
  for(let n=0;n<50;n++)await invite(db,{email:`invite${n}@example.test`});
  await fails(()=>invite(db,{email:'overflow@example.test'}),'22023');
  const first=await list(db,U.owner,{p_limit:2});assert.equal(first.members.length,2);assert.equal(first.invitations.length,2);assert.ok(first.nextMembersPageKey);assert.ok(first.nextInvitationsPageKey);
  const second=await list(db,U.owner,{p_limit:2,p_members_page_key:first.nextMembersPageKey,p_invitations_page_key:first.nextInvitationsPageKey});assert.equal(second.members.length,2);assert.ok(!first.members.some(m=>second.members.some(x=>x.id===m.id)));assert.ok(!first.invitations.some(i=>second.invitations.some(x=>x.id===i.id)));
  const other=await rpc(db,U.owner2,'list_company_team',{p_company_id:C2});assert.equal(other.members.length,1);assert.equal(other.invitations.length,0);
  await fails(()=>revoke(db,first.invitations[0],{user:U.owner2,company:C2}),'42501');
  await revoke(db,first.invitations[0]);await invite(db,{email:'overflow@example.test'});
 }finally{await db.close();}
});

test('module depends only on hosted foundation, no pending signing/archive migration',async()=>{
 const db=await fixture({includeSigningArchive:false});try{
  const i=(await invite(db)).invitation;assert.equal((await accept(db,i)).role,'sales');
  assert.equal((await db.query("select to_regclass('public.signing_jobs') as missing")).rows[0].missing,null);
 }finally{await db.close();}
});

test('inviter Auth revocation invalidates old invitations, duplicate account and spoofed metadata rejected',async()=>{
 const db=await fixture();try{
  const i=(await invite(db)).invitation;
  const invalid=["banned_until=now()+interval '1 day'",'email_confirmed_at=null','is_anonymous=true','is_sso_user=true'];
  for(const field of invalid){
   await db.query(`update auth.users set ${field} where id=$1`,[U.owner]);
   assert.equal((await rpc(db,U.recipient,'list_my_company_invitations')).invitations.length,0);
   await fails(()=>accept(db,i),'42501');
   await db.query('update auth.users set banned_until=null,email_confirmed_at=now(),is_anonymous=false,is_sso_user=false where id=$1',[U.owner]);
  }
  await db.query('update auth.users set email=$1 where id=$2',['Recipient@example.test',U.other]);
  await fails(()=>rpc(db,U.recipient,'list_my_company_invitations'),'42501');await fails(()=>accept(db,i),'42501');
  await db.query('update auth.users set email=$1 where id=$2',['other@example.test',U.other]);
  await db.query("update auth.users set raw_user_meta_data='{"+String.raw`"role":"owner","email":"recipient@example.test","email_confirmed_at":"2020-01-01"}`+"' where id=$1",[U.other]);
  await fails(()=>accept(db,i,{user:U.other}),'42501');
  await db.query('update auth.users set email=$1 where id=$2',['changed@example.test',U.recipient]);await fails(()=>accept(db,i),'42501');
 }finally{await db.close();}
});

test('expiry compares actual wall clock after transaction began, never transaction-start now()',async()=>{
 const db=await fixture();try{
  const i=(await invite(db)).invitation;
  await db.query("update private.company_team_invitations set created_at=now()-interval '1 day',expires_at=clock_timestamp()+interval '150 milliseconds' where id=$1",[i.id]);
  const expires=(await db.query('select expires_at from private.company_team_invitations where id=$1',[i.id])).rows[0].expires_at;
  await fails(()=>asRole(db,'authenticated',U.recipient,async tx=>{
   const start=(await tx.query('select now() as started')).rows[0].started;
   assert.ok(new Date(start)<new Date(expires),'Transaction starts before deadline');
   await new Promise(resolve=>setTimeout(resolve,180));
   return tx.query('select public.accept_company_invitation($1,1,$2)',[i.id,randomUUID()]);
  }),'40001');
  assert.equal((await db.query('select status from private.company_team_invitations where id=$1',[i.id])).rows[0].status,'pending');
 }finally{await db.close();}
});

test('same request parallel replay grants one member and one audit, stale creates only one invitation',async()=>{
 const db=await fixture();try{
  const request=randomUUID();const args={request,version:1};
  const [a,b]=await Promise.all([invite(db,args),invite(db,args)]);assert.deepEqual(a,b);
  const acceptRequest=randomUUID();const receipts=await Promise.all([accept(db,a.invitation,{request:acceptRequest}),accept(db,a.invitation,{request:acceptRequest})]);assert.deepEqual(receipts[0],receipts[1]);
  assert.equal((await db.query("select count(*)::int n from private.company_team_audit where action='accept'")).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from public.memberships where company_id=$1 and user_id=$2',[C,U.recipient])).rows[0].n,1);
  const version=(await list(db)).teamVersion;
  const created=await Promise.allSettled([invite(db,{email:'one@example.test',version}),invite(db,{email:'two@example.test',version})]);assert.equal(created.filter(x=>x.status==='fulfilled').length,1);assert.equal(created.find(x=>x.status==='rejected').reason.code,'40001');
 }finally{await db.close();}
});

test('personal invitation keyset across permitted companies reveals only current actual email',async()=>{
 const db=await fixture();try{
  await invite(db);await invite(db,{company:C2,user:U.owner2});await invite(db,{email:'other@example.test'});
  const first=await rpc(db,U.recipient,'list_my_company_invitations',{p_limit:1});assert.equal(first.invitations.length,1);assert.ok(first.nextPageKey);
  const second=await rpc(db,U.recipient,'list_my_company_invitations',{p_limit:1,p_page_key:first.nextPageKey});assert.equal(second.invitations.length,1);assert.equal(second.nextPageKey,null);
  assert.notEqual(first.invitations[0].companyId,second.invitations[0].companyId);
  const third=await rpc(db,U.other,'list_my_company_invitations');assert.equal(third.invitations.length,1);assert.equal(third.invitations[0].companyId,C);
 }finally{await db.close();}
});
