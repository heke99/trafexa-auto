import assert from 'node:assert/strict';
import {test} from 'node:test';
import {asRole} from './crm-db/helpers.mjs';
import {C,D,U,id,check,claim,fixture,service} from './transactional-email-db/contract-invitation-fixtures.mjs';

async function application(db) {
 const request=id(40);
 await db.query(
  `insert into private.demo_requests(id,request_id,name,email,company,phone,organisation_number,seeking,message,privacy_version,privacy_acknowledged_at,legacy)
   values($1,$1,'Test Applicant','applicant@example.invalid','Test Company','0701234567','5560160680',array['system'],'Test application','2026-10-18',now(),false)`,
  [request],
 );
 return request;
}

async function invitation(db, signing) {
 return (await db.query(
  `select id,status,attempts,lease_id,first_attempt_at,customer_provider_started_at
   from private.transactional_email_outbox where kind='contract_invitation' and reference_id=$1`,
  [signing.id],
 )).rows[0];
}

async function companyStatus(db,status) {
 await db.query('update public.companies set status=$1 where id=$2',[status,C]);
}

test('enabled-kind claims skip an older disabled invitation and only recover in-scope leases',async()=>{
 const {db,signing}=await fixture();
 try {
  const older=await invitation(db,signing);
  const request=await application(db);
  await db.query("update private.transactional_email_outbox set created_at=now()-interval '1 day' where id=$1",[older.id]);
  const lease=await claim(db,signing);
  await db.query("update private.transactional_email_outbox set lease_until=now()-interval '1 second' where id=$1",[older.id]);
  const before=await invitation(db,signing);
  const enabled=await service(db,'claim_transactional_email_enabled',[['application_received']]);
  assert.equal(enabled.kind,'application_received');
  assert.equal(enabled.reference,request);
  assert.deepEqual(await invitation(db,signing),before);
  assert.equal(before.lease_id,lease.leaseId);
  const recovered=await claim(db,signing);
  assert.equal(recovered.id,older.id);
  assert.notEqual(recovered.leaseId,lease.leaseId);
 } finally {
  await db.close();
 }
});

test('a suspended company does not consume a queue attempt and resumes with source verification',async()=>{
 const {db,signing}=await fixture();
 try {
  const before=await invitation(db,signing);
  const request=await application(db);
  await db.query("update private.transactional_email_outbox set created_at=now()-interval '1 day' where reference_id=$1",[signing.id]);
  await companyStatus(db,'suspended');
  assert.equal(await claim(db,signing),null);
  const unrelated=await service(db,'claim_transactional_email_enabled',[['contract_invitation','application_received']]);
  assert.equal(unrelated.reference,request);
  assert.deepEqual(await invitation(db,signing),before);

  await companyStatus(db,'active');
  const lease=await claim(db,signing);
  assert.equal(lease.id,before.id);
  assert.equal(await check(db,lease),true);
  await companyStatus(db,'suspended');
  assert.equal(await check(db,lease),null);
  assert.equal(await service(db,'finish_transactional_email',[lease.id,lease.leaseId,'pending',null]),true);
  assert.deepEqual(await invitation(db,signing),before);

  await companyStatus(db,'active');
  await db.query("update public.deals set status='cancelled' where id=$1",[D]);
  assert.equal(await claim(db,signing),null);
  assert.equal((await invitation(db,signing)).status,'cancelled');
 } finally {
  await db.close();
 }
});

test('filtered drain accepts only a service-role kind allowlist',async()=>{
 const {db}=await fixture();
 try {
  for(const role of ['anon','authenticated'])await assert.rejects(
   asRole(db,role,U,tx=>tx.query('select public.claim_transactional_email_enabled($1)',['{application_received}'])),
   error=>error.code==='42501',
  );
  for(const kinds of [null,['unknown'],[null]])await assert.rejects(
   service(db,'claim_transactional_email_enabled',[kinds]),
   error=>error.code==='22023',
  );
  assert.equal(await service(db,'claim_transactional_email_enabled',[[]]),null);
 } finally {
  await db.close();
 }
});
