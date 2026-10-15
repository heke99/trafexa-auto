import assert from 'node:assert/strict';
import {bootstrap,sql,session,waitForLock} from './approved-application-invitation-review-helpers.mjs';

// Reproduce with the official pinned image (no host ports or persistent volumes):
// docker --host=unix:///var/run/docker.sock run -d --name trafexa-application-invite-review-pg \
//   --network none --read-only --tmpfs /var/lib/postgresql/data:rw,size=768m \
//   --tmpfs /var/run/postgresql:rw,size=16m --tmpfs /tmp:rw,size=32m \
//   -e POSTGRES_HOST_AUTH_METHOD=trust postgres@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929
// node tests/approved-application-invitation-review-native.mjs
// docker --host=unix:///var/run/docker.sock rm -f trafexa-application-invite-review-pg
// Clear inherited DOCKER_HOST/CONTEXT/TLS selectors for those local-socket commands.
// An isolated PostgreSQL database: no network, real customer identity or delivery.
// Auth's real insert-then-update transaction is reproduced deliberately. See
// supabase/auth ce9a8eee0 internal/api/mail.go 163–195; invited_at is not present
// on the INSERT, so a trigger that assumes it is would reject all real invites.
await bootstrap();
const uid=n=>`ee770000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=uid(1),app=uid(2),recipient='invite-review@example.invalid';
const lit=s=>`'${String(s).replaceAll("'","''")}'`;
const auth=(body,role='authenticated',actor=admin)=>`begin;set local role ${role};set local request.jwt.claim.sub=${lit(actor)};${body};commit;`;
const prepare=(req=uid(10))=>`select public.prepare_platform_application_invitation('${app}',1,'Reviewed synthetic application','${req}')`;
const insert=(id,email=recipient,extra='')=>`insert into auth.users(id,email,raw_user_meta_data)values('${id}',${lit(email)},'{"approved":true,"role":"superadmin","invited_at":"2026-01-01"}');${extra}`;
const invite=id=>insert(id,recipient,`update auth.users set invited_at=clock_timestamp() where id='${id}'`);
sql(`insert into auth.users(id,email,email_confirmed_at)values('${admin}','invite-admin@example.invalid',now());insert into private.platform_admins(user_id,created_by)values('${admin}','${admin}');
insert into private.demo_requests(id,request_id,name,email,company,phone,message,organisation_number,seeking,privacy_version,privacy_acknowledged_at,legacy,status)
values('${app}','${uid(3)}','Synthetic applicant','${recipient}','Synthetic company','0701234567','Application to the system','5568554884',array['system'],'test',now(),false,'in_review');`);
for(const role of ['anon','authenticated','service_role'])assert.throws(()=>sql(auth(prepare(),role,uid(99))),/permission|admin|access|identity|verified/i);
console.log('PASS anon, ordinary authenticated and service roles cannot approve applications or create invitation intents');
assert.throws(()=>sql(auth(insert(uid(20)),'supabase_auth_admin')),/invitation|Registration/i);
assert.equal(sql(`select count(*) from auth.users where id='${uid(20)}'`),'0');
console.log('PASS direct public-signup transaction and forged editable approval/invitation metadata roll back');
const receipt=JSON.parse(sql(auth(prepare())));
assert.equal(JSON.stringify(receipt).includes('token'),false);
// An intent for an approved email alone cannot turn public signup into invitation.
assert.throws(()=>sql(auth(insert(uid(21)),'supabase_auth_admin')),/invitation|Registration/i);
assert.equal(sql(`select count(*) from auth.users where id='${uid(21)}'`),'0');
assert.throws(()=>sql(auth(invite(uid(22)).replaceAll(recipient,'wrong-review@example.invalid'),'supabase_auth_admin')),/invitation|Registration/i);
console.log('PASS a reviewed email intent cannot authorize public signup, and actual invited_at cannot authorize an unreviewed email');
sql(auth(invite(uid(23)),'supabase_auth_admin'));
assert.equal(sql(`select status from private.account_approvals where user_id='${uid(23)}'`),'approved');
assert.equal(sql(`select user_id from private.application_account_invitations where application_id='${app}'`),uid(23));
assert.equal(JSON.parse(sql(auth('select public.get_account_access()','authenticated',uid(23)))).emailVerified,false);
console.log('PASS actual GoTrue insert-then-update invite commits and binds exactly one approved account while email remains unverified');
assert.throws(()=>sql(auth(invite(uid(24)),'supabase_auth_admin')),/invitation|Registration|duplicate/i);
assert.equal(sql(`select count(*) from auth.users where lower(email)=${lit(recipient)}`),'1');
console.log('PASS consumed intent cannot create a second account');

// Use a second reviewed application for a real competing backend race.
const app2=uid(30),email2='invite-race@example.invalid';
sql(`insert into private.demo_requests(id,request_id,name,email,company,phone,message,organisation_number,seeking,privacy_version,privacy_acknowledged_at,legacy,status)
values('${app2}','${uid(31)}','Synthetic race','${email2}','Synthetic company','0701234567','Application to the system','5568554884',array['system'],'test',now(),false,'in_review');`);
sql(auth(prepare(uid(32)).replaceAll(app,app2)));
const a=session('inviteRaceA'),b=session('inviteRaceB');
try{
 await Promise.all([a.ready(),b.ready()]);
 assert.notEqual(await a.query('select pg_backend_pid()'),await b.query('select pg_backend_pid()'));
 await a.query(`begin;set local role supabase_auth_admin;${invite(uid(33)).replaceAll(recipient,email2)};set constraints all immediate`);
 const pending=b.query(auth(invite(uid(34)).replaceAll(recipient,email2),'supabase_auth_admin'));
 const denied=assert.rejects(pending,/invitation|Registration|duplicate/i);
 await waitForLock('inviteRaceB');await a.query('commit');await denied;
 assert.equal(sql(`select count(*) from auth.users where email=${lit(email2)}`),'1');
 console.log('PASS two real Auth backends serialize on the reviewed invitation and only one account commits');
}finally{a.close();b.close();}
// Revocation winning the registry lock must be observed at the deferred commit.
for (const [n,mutation,restore,label] of [
 [40,`update private.platform_admins set status='suspended' where user_id='${admin}'`,`update private.platform_admins set status='active' where user_id='${admin}'`,'admin revocation'],
 [50,`update private.demo_requests set status='closed',version=version+1 where id='${uid(50)}'`,null,'application closure'],
]) {
 const target=uid(n), email=`invite-revocation-${n}@example.invalid`;
 sql(`insert into private.demo_requests(id,request_id,name,email,company,phone,message,organisation_number,seeking,privacy_version,privacy_acknowledged_at,legacy,status)
 values('${target}','${uid(n+1)}','Synthetic revocation','${email}','Synthetic company','0701234567','Application to the system','5568554884',array['system'],'test',now(),false,'in_review');`);
 sql(auth(prepare(uid(n+2)).replaceAll(app,target)));
 const blocker=session('inviteRevoke'+n+'A'), waiter=session('inviteRevoke'+n+'B');
 try {
  await Promise.all([blocker.ready(),waiter.ready()]);
  await blocker.query(`begin;${mutation}`);
  const waiting=waiter.query(auth(invite(uid(n+3)).replaceAll(recipient,email),'supabase_auth_admin'));
  const denied=assert.rejects(waiting,/Approver|application|invitation/i);
  await waitForLock('inviteRevoke'+n+'B');await blocker.query('commit');await denied;
  assert.equal(sql(`select count(*) from auth.users where email=${lit(email)}`),'0');
  console.log(`PASS actual deferred Auth commit waits for ${label} and refuses stale approval`);
 } finally {blocker.close();waiter.close();if(restore)sql(restore);}
}
const claimBody=`select public.claim_platform_application_invitation_delivery('${receipt.id}')`;
const ca=session('inviteClaimA'),cb=session('inviteClaimB');
try{
 await Promise.all([ca.ready(),cb.ready()]);
 const first=JSON.parse(await ca.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${admin}';${claimBody}`));
 assert.equal(first.status,'generate');
 const waiting=cb.query(auth(claimBody));
 await waitForLock('inviteClaimB');await ca.query('commit');
 const second=JSON.parse(await waiting);assert.equal(second.status,'busy');
 assert.equal(sql(`select count(*) from private.application_invitation_deliveries where invitation_id='${receipt.id}'`),'1');
 assert.equal(sql(`select attempt_count from private.application_invitation_deliveries where invitation_id='${receipt.id}'`),'0');
 console.log('PASS two real admin backends competing for invitation generation receive exactly one lease and one busy result');
}finally{ca.close();cb.close();}
// The original failed open-signup case: preserve the actual UUID and require
// independent email verification, while retiring any pre-existing password.
const old=uid(70),oldApp=uid(71),oldEmail='previous-signup@example.invalid';
sql(`insert into auth.users(id,email,encrypted_password)values('${old}','${oldEmail}','synthetic-old-attacker-known-hash');
insert into auth.identities(user_id,provider)values('${old}','email');
insert into auth.sessions(user_id)values('${old}');insert into auth.refresh_tokens(user_id)values('${old}');
insert into private.demo_requests(id,request_id,name,email,company,phone,message,organisation_number,seeking,privacy_version,privacy_acknowledged_at,legacy,status)
values('${oldApp}','${uid(72)}','Synthetic existing signup','${oldEmail}','Synthetic company','0701234567','Application to the system','5568554884',array['system'],'test',now(),false,'in_review');`);
assert.equal(JSON.parse(sql(auth('select public.get_account_access()','authenticated',old))).status,'pending');
const adopted=JSON.parse(sql(auth(prepare(uid(73)).replaceAll(app,oldApp))));
assert.equal(adopted.userId,old);
assert.equal(sql(`select count(*) from auth.users where email='${oldEmail}'`),'1');
assert.equal(sql(`select coalesce(encrypted_password,'') from auth.users where id='${old}'`),'');
assert.equal(sql(`select count(*) from auth.sessions where user_id='${old}'`),'0');
assert.equal(sql(`select count(*) from auth.refresh_tokens where user_id='${old}'`),'0');
const access=JSON.parse(sql(auth('select public.get_account_access()','authenticated',old)));
assert.equal(access.status,'approved');assert.equal(access.emailVerified,false);
// generateLink(invite) finds the existing user and updates rather than inserts.
sql(auth(`update auth.users set invited_at=clock_timestamp() where id='${old}'`,'supabase_auth_admin'));
assert.equal(sql(`select user_id from private.application_account_invitations where application_id='${oldApp}'`),old);
console.log('PASS explicitly reviewed old unverified signup keeps its UUID, retires old password and still requires email verification');
console.log('PASS native approved application invitation security review complete');
