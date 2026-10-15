import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createDatabase, asRole } from '../crm-db/helpers.mjs';
const id=n=>`ea160000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const admin=id(1),other=id(2),app=id(10),user=id(20),nonce=id(30),email='invite@example.invalid';
let databasePromise;
after(async()=>{if(databasePromise)await(await databasePromise).close();});
async function setup(){
 const db=await(databasePromise??=createDatabase({includeSigningArchive:false,approveEstablishedFixtures:false}));
 await db.exec(`do $$begin if not exists(select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin;end if;end$$;
 alter table auth.users add column if not exists invited_at timestamptz;
 alter table auth.users add column if not exists encrypted_password text;
 alter table auth.users add column if not exists last_sign_in_at timestamptz;
 create table if not exists auth.identities(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,provider text not null);
 create table if not exists auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade);
 create table if not exists auth.refresh_tokens(id uuid primary key,user_id text not null);
 grant usage on schema auth to supabase_auth_admin;grant select,insert,update on auth.users to supabase_auth_admin;
 truncate auth.users cascade;truncate auth.refresh_tokens;truncate private.demo_requests cascade;truncate private.platform_admin_bootstrap_reservations cascade;`);
 await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'admin@example.invalid',now()),($2,'other@example.invalid',now())",[admin,other]);
 await db.query('insert into private.platform_admins(user_id,created_by) values($1,$1)',[admin]);
 await db.query(`insert into private.demo_requests(id,request_id,name,email,company,phone,organisation_number,seeking,message,privacy_version,privacy_acknowledged_at,legacy)
 values($1,$2,'Invite Customer',$3,'Synthetic Dealer','0701234567','5568554884',array['system'],'Full system access','2026-10-14',now(),false)`,[app,id(11),email]);
 return db;
}
async function rpc(db,actor,name,args=[]){return asRole(db,'authenticated',actor,async tx=>(await tx.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result);}
const prepare=(db,opts={})=>rpc(db,opts.actor??admin,'prepare_platform_application_invitation',[opts.app??app,opts.version??1,opts.reason??'Kontrollerad ansökan',opts.nonce??nonce]);
async function authInsert(db,{invited=true,metadata={},target=user,targetEmail=email,confirm=false}={}){
 return db.transaction(async tx=>{
  await tx.exec('set local role supabase_auth_admin');
  await tx.query('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,case when $3 then now() else null end,$4)',[target,targetEmail,confirm,JSON.stringify(metadata)]);
  if(invited)await tx.query('update auth.users set invited_at=now() where id=$1',[target]);
 });
}
const claim=(db,invitation,actor=admin)=>rpc(db,actor,'claim_platform_application_invitation_delivery',[invitation.id]);
async function service(db,name,invitation,lease,tail=[],actor=admin){return asRole(db,'service_role',null,async tx=>(await tx.query(`select public.${name}(${[invitation.id,lease,actor,...tail].map((_,i)=>'$'+(i+1)).join(',')}) result`,[invitation.id,lease,actor,...tail])).rows[0].result);}
const load=(db,i,l,actor)=>service(db,'get_platform_application_invitation_delivery',i,l,[],actor);
const bind=(db,i,l,cipher='ciphertext.v1.'+'a'.repeat(100))=>service(db,'bind_platform_application_invitation_delivery',i,l,[cipher]);
const finish=(db,i,l,outcome,provider=null)=>service(db,'finish_platform_application_invitation_delivery',i,l,[outcome,provider]);
const denied=work=>assert.rejects(work,e=>e.code==='42501');
const conflict=work=>assert.rejects(work,e=>e.code==='40001');

test('actual Auth role denies open signup, forged metadata, autoconfirmed signup and unapproved invite at COMMIT',async()=>{
 const db=await setup();
 for(const options of [{invited:false},{invited:false,metadata:{approved:true,role:'superadmin',invited_at:new Date().toISOString()}},{invited:false,confirm:true},{invited:true}])await denied(()=>authInsert(db,options));
 assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,2);
 assert.equal((await db.query('select count(*)::int n from private.account_approvals')).rows[0].n,0);
});

test('actual GoTrue insert-then-update invite binds only approved application; email verification still separately gates access',async()=>{
 const db=await setup(),invitation=await prepare(db);
 await denied(()=>authInsert(db,{invited:false}));
 await denied(()=>authInsert(db,{targetEmail:'foreign@example.invalid'}));
 await authInsert(db);
 const read=await rpc(db,admin,'get_platform_application_invitation',[app]);
 assert.equal(read.invitation.id,invitation.id);assert.equal(read.invitation.userId,user);assert.equal(read.invitation.status,'created');
 assert.equal((await db.query('select status,updated_by from private.account_approvals where user_id=$1',[user])).rows[0].status,'approved');
 assert.equal((await rpc(db,user,'get_account_access')).emailVerified,false);
 await denied(()=>rpc(db,user,'create_company',['Denied unverified','5568554884']));
 assert.equal((await db.query('select count(*)::int n from public.memberships where user_id=$1',[user])).rows[0].n,0);
 await db.query('update auth.users set email_confirmed_at=now() where id=$1',[user]);
 assert.equal((await rpc(db,user,'get_account_access')).status,'approved');
 await denied(()=>authInsert(db,{target:id(21)}));
 assert.deepEqual(await prepare(db),read.invitation);
});

test('approval requires actual active UUID admin, strict case CAS, complete current application and unique existing identity',async()=>{
 const db=await setup();
 await denied(()=>prepare(db,{actor:other}));
 await conflict(()=>prepare(db,{version:2}));
 await db.query("update private.demo_requests set legacy=true where id=$1",[app]);await conflict(()=>prepare(db));
 await db.query("update private.demo_requests set legacy=false,status='closed' where id=$1",[app]);await conflict(()=>prepare(db));
 await db.query("update private.demo_requests set status='new' where id=$1",[app]);
 await db.query('insert into auth.users(id,email,email_confirmed_at)values($1,$2,now())',[user,email]);await assert.rejects(()=>prepare(db),e=>e.code==='23505');
 await db.query('delete from auth.users where id=$1',[user]);
 const invitation=await prepare(db);assert.deepEqual(await prepare(db),invitation);
 await conflict(()=>prepare(db,{reason:'Ändrad anledning'}));
 await conflict(()=>prepare(db,{nonce:id(31)}));
 await denied(()=>asRole(db,'anon',null,tx=>tx.query('select public.prepare_platform_application_invitation($1,1,$2,$3)',[app,'Kontroll',nonce])));
 await denied(()=>asRole(db,'authenticated',other,tx=>tx.query('select * from private.application_account_invitations')));
});

test('approval cannot be consumed after expiry, approver revocation, case mutation or application erasure',async()=>{
 for(const mutation of ['expiry','admin','case','erasure']){
  const db=await setup();await prepare(db);
  if(mutation==='expiry')await db.query("update private.application_account_invitations set expires_at=now()-interval '1 minute'");
  if(mutation==='admin')await db.query("update private.platform_admins set status='suspended' where user_id=$1",[admin]);
  if(mutation==='case')await db.query('update private.demo_requests set version=version+1 where id=$1',[app]);
  if(mutation==='erasure')await rpc(db,admin,'erase_platform_web_application',[app,1,'rights_request',id(70)]);
  await denied(()=>authInsert(db));assert.equal((await db.query('select count(*)::int n from auth.users where id=$1',[user])).rows[0].n,0);
 }
});

test('expired unconsumed approval renews only exact original request after fresh review',async()=>{
 const db=await setup(),first=await prepare(db);
 await db.query("update private.application_account_invitations set expires_at=now()-interval '1 minute'");
 assert.equal((await rpc(db,admin,'get_platform_application_invitation',[app])).invitation.status,'expired');
 await conflict(()=>prepare(db,{reason:'Ny orsak'}));const renewed=await prepare(db);assert.equal(renewed.id,first.id);assert.equal(renewed.status,'prepared');
 await authInsert(db);assert.equal((await rpc(db,user,'get_account_access')).emailVerified,false);
 await denied(()=>rpc(db,user,'create_company',['Denied unverified','5568554884']));
});

test('delivery generation lease serializes actions, safely recovers unsent created-user gap and hides all ciphertext from browser',async()=>{
 const db=await setup(),invitation=await prepare(db),first=await claim(db,invitation);
 assert.equal(first.status,'generate');assert.equal((await claim(db,invitation)).status,'busy');
 assert.equal((await load(db,invitation,first.leaseId)).ciphertext,null);
 await authInsert(db);
 await db.query("update private.application_invitation_deliveries set lease_until=now()-interval '1 second'");
 const recovered=await claim(db,invitation);assert.equal(recovered.status,'generate');assert.equal(recovered.userId,user);assert.notEqual(recovered.leaseId,first.leaseId);
 await conflict(()=>load(db,invitation,first.leaseId));
 await denied(()=>asRole(db,'authenticated',admin,tx=>tx.query('select public.get_platform_application_invitation_delivery($1,$2,$3)',[invitation.id,recovered.leaseId,admin])));
 await denied(()=>asRole(db,'service_role',null,tx=>tx.query('select ciphertext from private.application_invitation_deliveries')));
 await denied(()=>load(db,invitation,recovered.leaseId,other));
 const bound=await bind(db,invitation,recovered.leaseId);assert.equal(bound.status,'send');assert.ok(bound.firstAttemptAt);
 assert.deepEqual(await bind(db,invitation,recovered.leaseId),bound);
 await conflict(()=>bind(db,invitation,recovered.leaseId,'ciphertext.v1.'+'b'.repeat(100)));
 assert.equal((await load(db,invitation,recovered.leaseId)).ciphertext,'ciphertext.v1.'+'a'.repeat(100));
 const publicRead=await rpc(db,admin,'get_platform_application_invitation',[app]);assert.ok(!JSON.stringify(publicRead).includes('ciphertext'));
 const receipt=await finish(db,invitation,recovered.leaseId,'sent','provider-synthetic-id');assert.equal(receipt.outcome,'sent');
 assert.deepEqual(await finish(db,invitation,recovered.leaseId,'sent','provider-synthetic-id'),receipt);
 await conflict(()=>finish(db,invitation,recovered.leaseId,'sent','different-id'));
 assert.equal((await claim(db,invitation)).status,'sent');
});

test('known rate limits reuse immutable payload and stable invitation identity with bounded five-attempt retry',async()=>{
 const db=await setup(),invitation=await prepare(db);let lease=await claim(db,invitation);await authInsert(db);await bind(db,invitation,lease.leaseId);
 for(let attempt=1;attempt<=5;attempt++){
  assert.equal((await load(db,invitation,lease.leaseId)).ciphertext,'ciphertext.v1.'+'a'.repeat(100));
  await finish(db,invitation,lease.leaseId,'retryable');
  const next=await claim(db,invitation);
  if(attempt<5){assert.equal(next.status,'send');assert.equal(next.invitationId,invitation.id);assert.notEqual(next.leaseId,lease.leaseId);lease=next;}
  else assert.equal(next.status,'unknown');
 }
 assert.equal((await db.query('select attempt_count from private.application_invitation_deliveries')).rows[0].attempt_count,5);
});

test('expired sending lease, uncertain send and elapsed provider dedup window never automatically resend',async()=>{
 for(const scenario of ['expired','unknown','window']){
  const db=await setup(),invitation=await prepare(db),lease=await claim(db,invitation);await authInsert(db);await bind(db,invitation,lease.leaseId);
  if(scenario==='expired')await db.query("update private.application_invitation_deliveries set lease_until=now()-interval '1 second'");
  if(scenario==='unknown')await finish(db,invitation,lease.leaseId,'unknown');
  if(scenario==='window'){await finish(db,invitation,lease.leaseId,'retryable');await db.query("update private.application_invitation_deliveries set first_attempt_at=now()-interval '24 hours'");}
  assert.equal((await claim(db,invitation)).status,'unknown');assert.equal((await claim(db,invitation)).status,'unknown');
 }
});

test('service payload and finish require fresh application, approver and account approval; verified recipient is never resent invitation',async()=>{
 for(const scenario of ['admin','case','account','verified']){
  const db=await setup(),invitation=await prepare(db),lease=await claim(db,invitation);await authInsert(db);await bind(db,invitation,lease.leaseId);
  if(scenario==='admin')await db.query("update private.platform_admins set status='suspended' where user_id=$1",[admin]);
  if(scenario==='case')await db.query('update private.demo_requests set version=version+1 where id=$1',[app]);
  if(scenario==='account')await db.query("update private.account_approvals set status='suspended' where user_id=$1",[user]);
  await db.query("insert into auth.identities(id,user_id,provider)values($1,$2,'email')",[id(84),user]);
  if(scenario==='historical_signin')await db.query('update auth.users set last_sign_in_at=now() where id=$1',[user]);
  if(scenario==='oauth')await db.query("insert into auth.identities(id,user_id,provider)values($1,$2,'google')",[id(85),user]);
  if(scenario==='no_identity')await db.query('delete from auth.identities where user_id=$1',[user]);
  if(scenario==='verified')await db.query('update auth.users set email_confirmed_at=now() where id=$1',[user]);
  await assert.rejects(()=>load(db,invitation,lease.leaseId),e=>['42501','40001'].includes(e.code));
 }
});

test('application privacy erasure also deletes private invitation and encrypted delivery payload without granting new access',async()=>{
 const db=await setup(),invitation=await prepare(db),lease=await claim(db,invitation);await authInsert(db);await bind(db,invitation,lease.leaseId);
 await rpc(db,admin,'erase_platform_web_application',[app,1,'rights_request',id(71)]);
 assert.equal((await db.query('select count(*)::int n from private.application_account_invitations')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from private.application_invitation_deliveries')).rows[0].n,0);
 await assert.rejects(()=>load(db,invitation,lease.leaseId),e=>e.code==='P0002');
 assert.equal((await rpc(db,user,'get_account_access')).emailVerified,false);
 await denied(()=>rpc(db,user,'create_company',['Denied unverified','5568554884']));
});


test('historical send result persists after approver revocation while all future dispatch is denied',async()=>{
 const db=await setup(),invitation=await prepare(db),lease=await claim(db,invitation);await authInsert(db);await bind(db,invitation,lease.leaseId);
 await load(db,invitation,lease.leaseId); // Last fresh check before synthetic external acceptance.
 await db.query("update private.platform_admins set status='suspended' where user_id=$1",[admin]);
 const receipt=await finish(db,invitation,lease.leaseId,'sent','accepted-before-revocation');assert.equal(receipt.outcome,'sent');
 assert.deepEqual(await finish(db,invitation,lease.leaseId,'sent','accepted-before-revocation'),receipt);
 await denied(()=>claim(db,invitation));await denied(()=>load(db,invitation,lease.leaseId));
 assert.equal((await db.query('select state from private.application_invitation_deliveries')).rows[0].state,'sent');
});


test('explicit approved application safely adopts only an existing unverified pending identity and supports invite generation retry',async()=>{
 const db=await setup();await db.query('insert into auth.users(id,email,encrypted_password)values($1,$2,$3)',[user,email,'synthetic-old-password-hash']);
 await db.query("insert into auth.identities(id,user_id,provider)values($1,$2,'email')",[id(84),user]);
 await db.query('insert into auth.sessions(id,user_id)values($1,$2)',[id(82),user]);await db.query('insert into auth.refresh_tokens(id,user_id)values($1,$2)',[id(83),user]);
 const invitation=await prepare(db);
 assert.equal((await db.query('select encrypted_password from auth.users where id=$1',[user])).rows[0].encrypted_password,null);
 assert.equal((await db.query('select count(*)::int n from auth.sessions')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from auth.refresh_tokens')).rows[0].n,0);assert.equal(invitation.userId,user);assert.equal(invitation.status,'created');
 assert.equal((await rpc(db,user,'get_account_access')).emailVerified,false);await denied(()=>rpc(db,user,'create_company',['Denied unverified','5568554884']));
 const lease=await claim(db,invitation);assert.equal(lease.status,'generate');assert.equal(lease.userId,user);
 // Existing-unconfirmed GoTrue invite generation updates the same user; no second INSERT.
 await db.transaction(async tx=>{await tx.exec('set local role supabase_auth_admin');await tx.query('update auth.users set invited_at=now() where id=$1',[user]);});
 await bind(db,invitation,lease.leaseId);await finish(db,invitation,lease.leaseId,'retryable');
 const retry=await claim(db,invitation);assert.equal(retry.status,'send');assert.equal(retry.userId,user);
 assert.equal((await db.query('select count(*)::int n from auth.users where lower(btrim(email))=$1',[email])).rows[0].n,1);
 const audit=(await db.query('select payload from private.account_approval_audit where user_id=$1',[user])).rows[0].payload;assert.equal(audit.adoptedUnverified,true);
});

test('adoption never resets verified, rejected, suspended, already approved, banned, anonymous or SSO accounts',async()=>{
 for(const scenario of ['verified','rejected','suspended','approved','banned','anonymous','sso','registry','historical_signin','oauth','no_identity']){
  const db=await setup();await db.query('insert into auth.users(id,email)values($1,$2)',[user,email]);
  await db.query("insert into auth.identities(id,user_id,provider)values($1,$2,'email')",[id(84),user]);
  if(scenario==='historical_signin')await db.query('update auth.users set last_sign_in_at=now() where id=$1',[user]);
  if(scenario==='oauth')await db.query("insert into auth.identities(id,user_id,provider)values($1,$2,'google')",[id(85),user]);
  if(scenario==='no_identity')await db.query('delete from auth.identities where user_id=$1',[user]);
  if(scenario==='verified')await db.query('update auth.users set email_confirmed_at=now() where id=$1',[user]);
  if(['rejected','suspended','approved'].includes(scenario))await db.query('insert into private.account_approvals(user_id,status,updated_by)values($1,$2,$3)',[user,scenario,admin]);
  if(scenario==='banned')await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[user]);
  if(scenario==='anonymous')await db.query('update auth.users set is_anonymous=true where id=$1',[user]);
  if(scenario==='sso')await db.query('update auth.users set is_sso_user=true where id=$1',[user]);
  if(scenario==='registry')await db.query('insert into private.platform_admins(user_id,created_by)values($1,$2)',[user,admin]);
  await assert.rejects(()=>prepare(db),e=>e.code==='23505');
  assert.equal((await db.query('select count(*)::int n from private.application_account_invitations')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from private.account_approval_audit')).rows[0].n,0);
 }
});
