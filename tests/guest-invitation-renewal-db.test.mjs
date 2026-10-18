import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,id,U,C,D,rpc,service,capability,createSigning,approveContract} from './guest-customer-db/helpers.mjs';
import {asRole,createDatabase} from './crm-db/helpers.mjs';
const review=(h,kind,reference,user=U)=>rpc(h.db,user,'get_guest_invitation_renewal_review',[C,D,kind,reference]);
const renew=(h,r,nonce=id(90),user=U,changes={})=>{const v={...r,...changes};return rpc(h.db,user,'renew_guest_document_invitation',[v.companyId,v.dealId,v.kind,v.referenceId,v.emailId,v.generation,v.documentHash,nonce]);};
const denied=(p,code)=>assert.rejects(p,e=>e.code===code);
async function setup(t,kind='offer_invitation'){
 const h=await fixture();t.after(()=>h.db.close());
 const offer=await capability(h.db,'offer_invitation',h.review.id);
 const signing=kind==='contract_invitation'?await createSigning(h,offer):null;
 const cap=signing?await capability(h.db,kind,signing.id):offer;
 await service(h.db,'begin_customer_contract_invitation_send',[cap.emailId,cap.leaseId]);
 await service(h.db,'finish_transactional_email',[cap.emailId,cap.leaseId,'accepted','renewal-fixture-provider']);
 await h.db.exec('alter table private.guest_document_invitations disable trigger guest_invitation_immutable');
 await h.db.query("update private.guest_document_invitations set created_at=now()-interval '8 days',expires_at=now()-interval '1 day' where id=$1",[cap.invitationId]);
 await h.db.exec('alter table private.guest_document_invitations enable trigger guest_invitation_immutable');
 return{...h,kind,reference:signing?.id??h.review.id,cap,signing};
}
async function addMember(h,user,role){await h.db.query('insert into auth.users(id,email,email_confirmed_at)values($1,$2,now())',[user,`renewal-${user}@example.invalid`]);await h.db.query("insert into private.account_approvals(user_id,status,updated_by)values($1,'approved',$1)",[user]);await h.db.query('insert into public.memberships(company_id,user_id,role)values($1,$2,$3)',[C,user,role]);}
test('reviewed offer renewal creates one new generation and preserves expired token, actor and original enqueue idempotence',async t=>{
 const h=await setup(t),r=await review(h,h.kind,h.reference);assert.equal(r.canRenew,true);
 const before=(await h.db.query('select to_jsonb(i) value from private.guest_document_invitations i where id=$1',[h.cap.invitationId])).rows[0].value;
 const receipt=await renew(h,r);assert.equal(receipt.generation,1);assert.notEqual(receipt.emailId,r.emailId);assert.deepEqual(await renew(h,r),receipt);
 await denied(renew(h,r,id(91)),'40001');await denied(renew(h,r,id(90),U,{documentHash:'f'.repeat(64)}),'40001');
 const latest=await review(h,h.kind,h.reference);assert.equal(latest.status,'pending');assert.equal(latest.canRenew,false);assert.equal((await rpc(h.db,U,'get_offer_review_delivery',[C,D,h.reference])).status,'pending');
 await h.db.query('select private.enqueue_transactional_email($1,$2,$3)',[h.kind,h.reference,r.recipientEmail]);
 assert.equal((await h.db.query('select count(*)::int n from private.transactional_email_outbox where reference_id=$1',[h.reference])).rows[0].n,2);
 assert.deepEqual((await h.db.query('select to_jsonb(i) value from private.guest_document_invitations i where id=$1',[h.cap.invitationId])).rows[0].value,before);
 await denied(service(h.db,'get_guest_customer_document',[h.cap.invitationId,h.cap.tokenHash]),'42501');
 await denied(h.db.query("update private.guest_invitation_renewal_audit set receipt='{}'::jsonb where email_id=$1",[receipt.emailId]),'55000');
 const lease=await service(h.db,'claim_transactional_email_exact',[receipt.emailId]);assert.equal(lease.id,receipt.emailId);
 const p=await service(h.db,'prepare_customer_contract_invitation',[lease.id,lease.leaseId]);assert.notEqual(p.invitationId,h.cap.invitationId);assert.equal(p.ciphertext,null);
 await service(h.db,'bind_guest_document_invitation',[lease.id,lease.leaseId,p.invitationId,'c'.repeat(64),'opaque-renewal-live-proof-'.repeat(4)]);await service(h.db,'begin_customer_contract_invitation_send',[lease.id,lease.leaseId]);await service(h.db,'finish_transactional_email',[lease.id,lease.leaseId,'accepted','renewal-fixture-live']);assert.equal((await review(h,h.kind,h.reference)).canRenew,false);await denied(renew(h,await review(h,h.kind,h.reference),id(94)),'40001');
});
test('contract roles separate finance read from owner/admin write and deny cross-company/deal identifiers',async t=>{
 const h=await setup(t,'contract_invitation'),finance=id(71),sales=id(72),viewer=id(73);await addMember(h,finance,'finance');await addMember(h,sales,'sales');await addMember(h,viewer,'viewer');
 const r=await review(h,h.kind,h.reference);assert.equal(r.canRenew,true);assert.equal((await review(h,h.kind,h.reference,finance)).canRenew,false);assert.equal((await review(h,h.kind,h.reference,finance)).canWrite,false);
 for(const user of[finance,sales,viewer])await denied(renew(h,r,id(91),user),'42501');
 for(const user of[sales,viewer])await denied(review(h,h.kind,h.reference,user),'42501');
 await denied(renew(h,r,id(92),U,{dealId:id(999)}),'42501');await denied(renew(h,r,id(93),U,{emailId:id(999)}),'42501');
 assert.equal((await h.db.query('select count(*)::int n from private.guest_invitation_renewal_audit')).rows[0].n,0);
});
test('unsafe pending with historical provider receipt, processing unknown rejected cancelled and revoked invitations cannot be renewed',async t=>{
 const h=await setup(t),r=await review(h,h.kind,h.reference);
 for(const status of['pending','processing','unknown','rejected','cancelled']){
  await h.db.query("update private.transactional_email_outbox set status=$1,lease_id=case when $1='processing' then gen_random_uuid() end,lease_until=case when $1='processing' then now()+interval '1 minute' end where id=$2",[status,r.emailId]);
  assert.equal((await review(h,h.kind,h.reference)).canRenew,false);assert.equal((await review(h,h.kind,h.reference)).canRecoverPending,false);await denied(renew(h,r,id(91)),'40001');
 }
 await h.db.query("update private.transactional_email_outbox set status='accepted' where id=$1",[r.emailId]);
 await h.db.query('update private.guest_document_invitations set revoked_at=now() where id=$1',[h.cap.invitationId]);assert.equal((await review(h,h.kind,h.reference)).canRenew,false);await denied(renew(h,r,id(92)),'40001');
 await denied(review(h,'contract_completed',h.reference),'42501');
});
test('renewal read handles no capability and no queue safely without claiming or creating state',async t=>{
 const h=await fixture();t.after(()=>h.db.close());let r=await review(h,'offer_invitation',h.review.id);assert.equal(r.status,'pending');assert.equal(r.invitationId,null);assert.equal(r.canRenew,false);
 await h.db.query('delete from private.transactional_email_outbox where id=$1',[r.emailId]);r=await review(h,'offer_invitation',h.review.id);assert.equal(r.emailId,null);assert.equal(r.status,null);assert.equal(r.generation,0);assert.equal(r.expiresAt,null);assert.equal(r.canRenew,false);
});
test('immutable receipt recovers after source progresses but denies current role or account revocation',async t=>{
 const h=await setup(t,'contract_invitation'),r=await review(h,h.kind,h.reference),receipt=await renew(h,r);
 const lease=await service(h.db,'claim_transactional_email_exact',[receipt.emailId]),p=await service(h.db,'prepare_customer_contract_invitation',[lease.id,lease.leaseId]);const hash='e'.repeat(64);await service(h.db,'bind_guest_document_invitation',[lease.id,lease.leaseId,p.invitationId,hash,'opaque-renewal-proof-'.repeat(4)]);
 await service(h.db,'sign_guest_contract',[p.invitationId,hash,1,r.documentHash,'Guest Buyer',[],true,'2026-10-14',id(98)]);
 assert.equal((await review(h,h.kind,h.reference)).canRenew,false);assert.deepEqual(await renew(h,r),receipt);
 await h.db.query("update public.memberships set role='admin' where company_id=$1 and user_id=$2",[C,U]);await denied(renew(h,r),'42501');
 await h.db.query("update public.memberships set role='owner' where company_id=$1 and user_id=$2",[C,U]);await h.db.query("update private.account_approvals set status='suspended' where user_id=$1",[U]);await denied(renew(h,r),'42501');
});
test('renewal actor revocation blocks prepare and begin as well as exact and generic claims',async t=>{
 const h=await setup(t),admin=id(70);await addMember(h,admin,'admin');const r=await review(h,h.kind,h.reference,admin),receipt=await renew(h,r,id(90),admin),l=await service(h.db,'claim_transactional_email_exact',[receipt.emailId]);
 const p=await service(h.db,'prepare_customer_contract_invitation',[l.id,l.leaseId]);await service(h.db,'bind_guest_document_invitation',[l.id,l.leaseId,p.invitationId,'d'.repeat(64),'opaque-renewal-proof-'.repeat(4)]);
 await h.db.query("update public.memberships set status='suspended' where company_id=$1 and user_id=$2",[C,admin]);await denied(service(h.db,'prepare_customer_contract_invitation',[l.id,l.leaseId]),'42501');await denied(service(h.db,'begin_customer_contract_invitation_send',[l.id,l.leaseId]),'42501');
 await service(h.db,'finish_transactional_email',[l.id,l.leaseId,'pending',null]);assert.equal(await service(h.db,'claim_transactional_email_exact',[l.id]),null);assert.equal((await review(h,h.kind,h.reference)).status,'cancelled');assert.equal(await service(h.db,'claim_transactional_email',[h.kind,h.reference]),null);
});
test('exact claim has narrow grants and never cleans unrelated expired processing rows',async t=>{
 const h=await setup(t),r=await review(h,h.kind,h.reference),receipt=await renew(h,r);
 await h.db.query("insert into private.transactional_email_outbox(kind,reference_id,recipient,status,lease_id,lease_until)values('application_received',$1,'unrelated@example.invalid','processing',$2,now()-interval '1 minute')",[id(95),id(96)]);
 const before=(await h.db.query("select to_jsonb(e) value from private.transactional_email_outbox e where reference_id=$1",[id(95)])).rows[0].value;
 for(const role of['anon','authenticated'])await denied(asRole(h.db,role,U,tx=>tx.query('select public.claim_transactional_email_exact($1)',[receipt.emailId])),'42501');
 assert.equal((await service(h.db,'claim_transactional_email_exact',[receipt.emailId])).id,receipt.emailId);assert.deepEqual((await h.db.query('select to_jsonb(e) value from private.transactional_email_outbox e where reference_id=$1',[id(95)])).rows[0].value,before);
 assert.equal(await service(h.db,'claim_transactional_email_exact',[before.id]),null);
 for(const role of['anon','service_role'])await denied(asRole(h.db,role,U,tx=>tx.query('select public.get_guest_invitation_renewal_review($1,$2,$3,$4)',[C,D,h.kind,h.reference])),'42501');
});
test('hosted-safe rollback proof passes with immutable capability triggers and zero remaining fixtures',async()=>{
 const db=await createDatabase({approveEstablishedFixtures:false});try{await db.exec("create or replace function auth.role() returns text language sql stable as $$select current_setting('role',true)$$;grant execute on function auth.role() to authenticated,anon,service_role;");await db.exec(await readFile(new URL('../supabase/tests/guest_invitation_renewal.sql',import.meta.url),'utf8'));const row=(await db.query(await readFile(new URL('../supabase/tests/guest_invitation_renewal_cleanup.sql',import.meta.url),'utf8'))).rows[0];assert.ok(Object.values(row).every(x=>Number(x)===0),JSON.stringify(row));}finally{await db.close();}
});
