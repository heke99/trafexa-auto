import assert from 'node:assert/strict';
import {bootstrap,sql,session,waitForLock} from './application-invitation-lifecycle-native-helpers.mjs';

// Official PostgreSQL 17.6 digest and isolated network-none container are the
// same as approved-application-invitation-review-native.mjs; use the distinct
// container trafexa-application-lifecycle-oct18-pg. No customer mail or real Auth.
await bootstrap();
const id=n=>`ec180000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=id(1),app=id(2),user=id(3),email='lifecycle-oct18@fixture.invalid';
const auth=(body,role='authenticated',actor=admin)=>`begin;set local role ${role};set local request.jwt.claim.sub='${actor}';${body};commit;`;
const call=(name,args,role='authenticated')=>JSON.parse(sql(auth(`select public.${name}(${args})`,role)));
sql(`insert into auth.users(id,email,email_confirmed_at)values('${admin}','lifecycle-admin@fixture.invalid',now());insert into private.platform_admins(user_id,created_by)values('${admin}','${admin}');
insert into private.demo_requests(id,request_id,name,email,company,phone,message,organisation_number,seeking,privacy_version,privacy_acknowledged_at,legacy,status)
values('${app}','${id(4)}','Synthetic Applicant','${email}','Synthetic Dealer AB','0701234567','Synthetic complete request','5568554884',array['system'],'test',now(),false,'in_review');`);
const read=()=>call('get_platform_application_invitation',`'${app}'`);
assert.deepEqual(read().lifecycle,{applicationVersion:1,delivery:{id:null,state:'not_started',attemptCount:0,firstAttemptAt:null,updatedAt:null,canRetry:false},account:{emailVerified:null,approvalStatus:null},canRenew:false});
const invitation=call('prepare_platform_application_invitation',`'${app}',1,'Reviewed synthetic approval','${id(5)}'`);
sql(`update private.application_account_invitations set expires_at=clock_timestamp()-interval '1 second'where id='${invitation.id}'`);
assert.equal(read().invitation.status,'expired');assert.equal(read().lifecycle.delivery.canRetry,true);
assert.throws(()=>call('claim_platform_application_invitation_delivery_v2',`'${invitation.id}',null`),/invitation unavailable/i);
assert.equal(call('prepare_platform_application_invitation',`'${app}',1,'Reviewed synthetic approval','${id(5)}'`).status,'prepared');
console.log('PASS expired unconsumed approval stays reviewable, but actual claim refuses it until explicit exact reviewed preparation refreshes the intent');
let job=call('claim_platform_application_invitation_delivery_v2',`'${invitation.id}',null`);
assert.equal(job.deliveryId,invitation.id);assert.equal(read().lifecycle.delivery.state,'generating');assert.equal(read().lifecycle.delivery.canRetry,false);
sql(auth(`insert into auth.users(id,email)values('${user}','${email}');update auth.users set invited_at=now()where id='${user}'`,'supabase_auth_admin'));
const bind=()=>call('bind_platform_application_invitation_delivery',`'${invitation.id}','${job.leaseId}','${admin}','${'synthetic-encrypted-payload-'.repeat(3)}'`,'service_role');
const finish=(lease,outcome,provider='null')=>call('finish_platform_application_invitation_delivery',`'${invitation.id}','${lease}','${admin}','${outcome}',${provider}`,'service_role');
bind();finish(job.leaseId,'retryable');
assert.equal(read().lifecycle.delivery.state,'retryable');assert.equal(read().lifecycle.delivery.canRetry,true);assert.equal(read().lifecycle.canRenew,false);
const renewArgs=(generation=job.deliveryId,nonce=id(7),version=1)=>`'${invitation.id}','${generation}',${version},'Reviewed fresh personal invitation','${nonce}'`;
assert.throws(()=>call('renew_platform_application_invitation',renewArgs()),/renewal conflict/i);
job=call('claim_platform_application_invitation_delivery_v2',`'${invitation.id}','${job.deliveryId}'`);
assert.equal(job.status,'send');assert.throws(()=>call('renew_platform_application_invitation',renewArgs()),/renewal conflict/i);
finish(job.leaseId,'sent',"'synthetic-provider-first'");
let current=read();assert.equal(current.lifecycle.delivery.state,'sent');assert.equal(current.lifecycle.account.emailVerified,false);assert.equal(current.lifecycle.account.approvalStatus,'approved');assert.equal(current.lifecycle.canRenew,true);
assert.equal(current.lifecycle.delivery.attemptCount,2);
assert.equal(JSON.stringify(current).includes('synthetic-encrypted'),false);assert.equal(JSON.stringify(current).includes('ciphertext'),false);assert.equal(JSON.stringify(current).includes('leaseId'),false);
console.log('PASS durable read separates actual provider acceptance, retry eligibility and real account verification without exposing bearer/ciphertext/lease');

// A handling-status change after actual Auth creation must not strand the invite.
sql(`update private.demo_requests set status='contacted',version=version+1 where id='${app}'`);
assert.equal(read().lifecycle.applicationVersion,2);
assert.throws(()=>call('renew_platform_application_invitation',renewArgs()),/review conflict/i);
const renewed=call('renew_platform_application_invitation',renewArgs(job.deliveryId,id(7),2));
assert.equal(renewed.invitation.id,invitation.id);assert.equal(renewed.invitation.applicationVersion,1);assert.equal(renewed.applicationVersion,2);assert.notEqual(renewed.deliveryId,invitation.id);
assert.equal(read().lifecycle.delivery.id,renewed.deliveryId);assert.equal(read().lifecycle.delivery.state,'not_started');assert.equal(read().lifecycle.delivery.attemptCount,0);
assert.deepEqual(call('renew_platform_application_invitation',renewArgs(job.deliveryId,id(7),2)),renewed);
assert.throws(()=>call('renew_platform_application_invitation',renewArgs(job.deliveryId,id(7),2).replace('fresh personal','different personal')),/request conflict/i);
assert.equal(sql('select count(*)from private.application_invitation_delivery_history'),'1');
assert.equal(sql('select count(*)from private.application_invitation_renewals'),'1');
assert.throws(()=>call('claim_platform_application_invitation_delivery_v2',`'${invitation.id}','${job.deliveryId}'`),/generation changed/i);
assert.equal(read().lifecycle.delivery.state,'not_started');
assert.equal(sql('select lease_id is null from private.application_invitation_deliveries'),'t');
console.log('PASS reviewed renewal uses fresh case version, stable nonce and new generation; stale generation claim cannot lease or send the current job');

// A late provider response belongs to its archived generation only.
finish(job.leaseId,'sent',"'synthetic-provider-first'");
assert.equal(read().lifecycle.delivery.state,'not_started');
assert.equal(sql('select provider_id is null from private.application_invitation_deliveries'),'t');
job=call('claim_platform_application_invitation_delivery_v2',`'${invitation.id}','${renewed.deliveryId}'`);bind();
sql("update private.application_invitation_deliveries set lease_until=clock_timestamp()-interval '1 second'");
assert.equal(read().lifecycle.delivery.state,'unknown');assert.equal(read().lifecycle.delivery.canRetry,false);assert.equal(read().lifecycle.canRenew,true);
const next=call('renew_platform_application_invitation',renewArgs(job.deliveryId,id(8),2));
const late=finish(job.leaseId,'sent',"'synthetic-late-acceptance'");assert.equal(late.deliveryId,renewed.deliveryId);
assert.equal(sql(`select state from private.application_invitation_delivery_history where delivery_id='${renewed.deliveryId}'`),'sent');
assert.equal(read().lifecycle.delivery.id,next.deliveryId);assert.equal(read().lifecycle.delivery.state,'not_started');
console.log('PASS expired sending is unknown and never automatically retried; delayed provider finish updates only its historical generation');

// Competing renewals must serialize on the real case/invitation locks.
job=call('claim_platform_application_invitation_delivery_v2',`'${invitation.id}','${next.deliveryId}'`);bind();finish(job.leaseId,'sent',"'synthetic-third'");
const a=session('lifecycleRenewA'),b=session('lifecycleRenewB');
try{
 await Promise.all([a.ready(),b.ready()]);assert.notEqual(await a.query('select pg_backend_pid()'),await b.query('select pg_backend_pid()'));
 const first=JSON.parse(await a.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${admin}';select public.renew_platform_application_invitation(${renewArgs(next.deliveryId,id(9),2)})`));
 const pending=b.query(auth(`select public.renew_platform_application_invitation(${renewArgs(next.deliveryId,id(10),2)})`));
 const denied=assert.rejects(pending,/renewal conflict/i);await waitForLock('lifecycleRenewB');await a.query('commit');await denied;
 assert.equal(read().lifecycle.delivery.id,first.deliveryId);
 console.log('PASS two real PostgreSQL sessions serialize distinct renewal nonces; only one replacement generation commits');
}finally{a.close();b.close();}

// Real Auth verification winning its row lock must be seen after waiting.
job=call('claim_platform_application_invitation_delivery_v2',`'${invitation.id}','${read().lifecycle.delivery.id}'`);bind();finish(job.leaseId,'sent',"'synthetic-fourth'");
const blocker=session('lifecycleVerifiedA'),waiter=session('lifecycleVerifiedB');
try{
 await Promise.all([blocker.ready(),waiter.ready()]);await blocker.query(`begin;update auth.users set email_confirmed_at=now()where id='${user}'`);
 const pending=waiter.query(auth(`select public.renew_platform_application_invitation(${renewArgs(job.deliveryId,id(11),2)})`));
 const denied=assert.rejects(pending,/already verified/i);await waitForLock('lifecycleVerifiedB');await blocker.query('commit');await denied;
 assert.equal(read().lifecycle.canRenew,false);assert.equal(read().lifecycle.account.emailVerified,true);
 console.log('PASS renewal waiting behind actual Auth verification rechecks the committed user and cannot create another activation link');
}finally{blocker.close();waiter.close();}
sql(`update auth.users set email_confirmed_at=null where id='${user}'`);
for(const [n,mutation,restore,pattern,label] of [
 [20,`update private.platform_admins set status='suspended'where user_id='${admin}'`,`update private.platform_admins set status='active'where user_id='${admin}'`,/admin|identity/i,'real admin revocation'],
 [21,`update private.demo_requests set status='closed',version=version+1 where id='${app}'`,`update private.demo_requests set status='contacted',version=2 where id='${app}'`,/invitation unavailable/i,'application closure'],
 [22,`update private.account_approvals set status='suspended'where user_id='${user}'`,`update private.account_approvals set status='approved'where user_id='${user}'`,/account unavailable/i,'private account suspension'],
]){
 const left=session('lifecycleRevokeA'+n),right=session('lifecycleRevokeB'+n);
 try{
  await Promise.all([left.ready(),right.ready()]);await left.query(`begin;${mutation}`);
  const pending=right.query(auth(`select public.renew_platform_application_invitation(${renewArgs(job.deliveryId,id(n),2)})`));
  const denied=assert.rejects(pending,pattern);await waitForLock('lifecycleRevokeB'+n);await left.query('commit');await denied;
  assert.equal(sql(`select delivery_id from private.application_invitation_deliveries`),job.deliveryId);
  console.log(`PASS renewal blocked behind ${label} rechecks the committed permission before changing generation`);
 }finally{left.close();right.close();sql(restore);}
}
for(const role of ['anon','service_role'])assert.throws(()=>call('renew_platform_application_invitation',renewArgs(job.deliveryId,id(12),2),role),/permission|admin|identity/i);
sql(`delete from private.demo_requests where id='${app}'`);
for(const table of ['application_account_invitations','application_invitation_deliveries','application_invitation_delivery_history','application_invitation_renewals','application_invitation_preparation_history'])assert.equal(sql(`select count(*)from private.${table}`),'0');
assert.equal(sql(`select count(*)from auth.users where id='${user}'`),'1');
console.log('PASS application erasure cascades active encrypted delivery and all generation audit; unrelated account retention remains separate');

const newApp=id(100),newEmail='reprepare-oct18@fixture.invalid';
sql(`insert into private.demo_requests(id,request_id,name,email,company,phone,message,organisation_number,seeking,privacy_version,privacy_acknowledged_at,legacy)
values('${newApp}','${id(101)}','Synthetic fresh reviewer','${newEmail}','Synthetic Changed Dealer','0701234567','Fresh reviewed system request','5568554884',array['system'],'test',now(),false);`);
const original=call('prepare_platform_application_invitation',`'${newApp}',1,'Original reviewed case','${id(102)}'`);
const oldJob=call('claim_platform_application_invitation_delivery_v2',`'${original.id}',null`);
sql(`update private.demo_requests set status='contacted',version=2 where id='${newApp}'`);
const reprepareArgs=`'${original.id}',1,2,'Fresh changed-case review','${id(103)}'`;
assert.throws(()=>call('reprepare_platform_application_invitation',reprepareArgs),/still in progress/i);
sql(`update private.application_invitation_deliveries set lease_until=clock_timestamp()-interval '1 second'where invitation_id='${original.id}'`);
assert.equal(call('get_platform_application_invitation',`'${newApp}'`).lifecycle.delivery.canRetry,true);
const freshReview=session('lifecycleFreshReviewA'),oldWorker=session('lifecycleOldWorkerB');
try{
 await Promise.all([freshReview.ready(),oldWorker.ready()]);
 const receipt=JSON.parse(await freshReview.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${admin}';select public.reprepare_platform_application_invitation(${reprepareArgs})`));
 assert.notEqual(receipt.deliveryId,oldJob.deliveryId);assert.equal(receipt.invitation.applicationVersion,2);
 const pending=oldWorker.query(auth(`select public.get_platform_application_invitation_delivery('${original.id}','${oldJob.leaseId}','${admin}')`,'service_role'));
 const denied=assert.rejects(pending,/lease unavailable/i);await waitForLock('lifecycleOldWorkerB');await freshReview.query('commit');await denied;
 assert.deepEqual(call('reprepare_platform_application_invitation',reprepareArgs),receipt);
 assert.throws(()=>call('claim_platform_application_invitation_delivery_v2',`'${original.id}','${oldJob.deliveryId}'`),/generation changed/i);
 assert.throws(()=>call('bind_platform_application_invitation_delivery',`'${original.id}','${oldJob.leaseId}','${admin}','${'synthetic-old-ciphertext-'.repeat(3)}'`,'service_role'),/account unavailable/i);
 assert.deepEqual(JSON.parse(sql('select previous_approval from private.application_invitation_preparation_history')),original);
 const newJob=call('claim_platform_application_invitation_delivery_v2',`'${original.id}','${receipt.deliveryId}'`);assert.equal(newJob.status,'generate');
 sql(auth(`insert into auth.users(id,email)values('${id(104)}','${newEmail}');update auth.users set invited_at=now()where id='${id(104)}'`,'supabase_auth_admin'));
 assert.equal(sql(`select reason from private.account_approval_audit where user_id='${id(104)}'`),'Fresh changed-case review');
 console.log('PASS explicit fresh review replaces only an unconsumed changed case, audits original approval and fences a real old worker waiting on its locks');
}finally{freshReview.close();oldWorker.close();}
sql(`delete from private.demo_requests where id='${newApp}'`);
for(const table of ['application_account_invitations','application_invitation_deliveries','application_invitation_delivery_history','application_invitation_renewals','application_invitation_preparation_history'])assert.equal(sql(`select count(*)from private.${table}`),'0');
