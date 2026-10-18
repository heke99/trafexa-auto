import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {fixture,id,U,C,D,rpc,service,capability,createSigning,approveContract,strokes} from './guest-customer-db/helpers.mjs';
import {createDatabase} from './crm-db/helpers.mjs';
const checkpoint='20261018171408_guest_document_link_recovery.sql';
async function upgrade(db){const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n>checkpoint).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));}
const denied=(p,code)=>assert.rejects(p,e=>e.code===code);
const review=h=>rpc(h.db,U,'get_guest_invitation_renewal_review',[C,D,h.kind,h.reference]);
const renew=(h,r,nonce=id(190))=>rpc(h.db,U,'renew_guest_document_invitation',[C,D,h.kind,h.reference,r.emailId,r.generation,r.documentHash,nonce]);
async function age(db,invitationId){await db.exec('alter table private.guest_document_invitations disable trigger guest_invitation_immutable');await db.query("update private.guest_document_invitations set created_at=now()-interval '8 days',expires_at=now()-interval '1 day' where id=$1",[invitationId]);await db.exec('alter table private.guest_document_invitations enable trigger guest_invitation_immutable');}
async function setup(t,{kind='offer_invitation',status='pending',unbound=false,attempt=true}={}){
 const h=await fixture({throughMigration:checkpoint});t.after(()=>h.db.close());let reference=h.review.id;
 if(kind!=='offer_invitation'){
  const offerCap=await capability(h.db,'offer_invitation',h.review.id),signing=await createSigning(h,offerCap);reference=signing.id;h.signing=signing;
  if(kind==='contract_completed'){const c=await capability(h.db,'contract_invitation',signing.id);await approveContract(h.db,c);await rpc(h.db,U,'sign_contract',[signing.id,C,2,signing.documentHash,'Dealer Owner',strokes,true,'2026-10-14',id(131)]);}
 }
 const lease=await service(h.db,'claim_transactional_email',[kind,reference]),p=await service(h.db,'prepare_customer_contract_invitation',[lease.id,lease.leaseId]);
 const tokenHash='7'.repeat(64);if(!unbound)await service(h.db,'bind_guest_document_invitation',[lease.id,lease.leaseId,p.invitationId,tokenHash,'opaque-recovery-original-'.repeat(4)]);
 if(attempt&&!unbound)await service(h.db,'begin_customer_contract_invitation_send',[lease.id,lease.leaseId]);
 await service(h.db,'finish_transactional_email',[lease.id,lease.leaseId,status,status==='accepted'?'recovery-original-provider':null]);await age(h.db,p.invitationId);
 return{...h,kind,reference,cap:{...p,tokenHash,lease}};
}
async function newCapability(h,receipt){const lease=await service(h.db,'claim_transactional_email_exact',[receipt.emailId]),p=await service(h.db,'prepare_customer_contract_invitation',[lease.id,lease.leaseId]),tokenHash='8'.repeat(64);await service(h.db,'bind_guest_document_invitation',[lease.id,lease.leaseId,p.invitationId,tokenHash,'opaque-recovery-new-'.repeat(5)]);return{...p,tokenHash,lease};}
test('PR53 historical checkpoint: completed accepted-expired links renew read-only with original two-party signatures and document hash unchanged',async t=>{
 const h=await setup(t,{kind:'contract_completed',status:'accepted'}),before=(await h.db.query('select to_jsonb(x) value from private.contract_party_signatures($1) x order by party',[h.reference])).rows;
 const r=await review(h);assert.equal(r.canRenew,true);assert.equal(r.canRecoverPending,false);const receipt=await renew(h,r);assert.equal(receipt.kind,'contract_completed');assert.equal(receipt.generation,1);
 const p=await newCapability(h,receipt),doc=await service(h.db,'get_guest_customer_document',[p.invitationId,p.tokenHash]);assert.equal(doc.kind,'contract_completed');assert.equal(doc.document.status,'completed');assert.equal(doc.documentHash,r.documentHash);
 await denied(service(h.db,'sign_guest_contract',[p.invitationId,p.tokenHash,3,r.documentHash,'Guest Buyer',[],true,'2026-10-14',id(191)]),'42501');await denied(service(h.db,'respond_guest_offer',[p.invitationId,p.tokenHash,1,'accepted','Guest Buyer',null,true,'2026-10-14',id(192)]),'42501');
 assert.deepEqual((await h.db.query('select to_jsonb(x) value from private.contract_party_signatures($1) x order by party',[h.reference])).rows,before);const delivery=await rpc(h.db,U,'get_contract_signing_delivery',[C,D,h.reference]);assert.equal(delivery.completionStatus,'processing');
 await denied(service(h.db,'get_guest_customer_document',[h.cap.invitationId,h.cap.tokenHash]),'42501');assert.deepEqual(await renew(h,r),receipt);
});
test('PR53 historical checkpoint: known 429 pending-expired invitation recovery atomically cancels old generation and replays one immutable receipt',async t=>{
 const h=await setup(t),r=await review(h);assert.equal(r.canRenew,false);assert.equal(r.canRecoverPending,true);const old=(await h.db.query('select customer_ciphertext,attempts,first_attempt_at from private.transactional_email_outbox where id=$1',[r.emailId])).rows[0];assert.equal(old.attempts,1);
 const receipt=await renew(h,r);assert.deepEqual(await renew(h,r),receipt);await denied(renew(h,r,id(191)),'40001');const previous=(await h.db.query('select status,customer_ciphertext,attempts,first_attempt_at from private.transactional_email_outbox where id=$1',[r.emailId])).rows[0];assert.equal(previous.status,'cancelled');assert.equal(previous.customer_ciphertext,old.customer_ciphertext);assert.equal(previous.attempts,old.attempts);assert.deepEqual(previous.first_attempt_at,old.first_attempt_at);
 assert.equal(await service(h.db,'claim_transactional_email_exact',[r.emailId]),null);const p=await newCapability(h,receipt);assert.notEqual(p.invitationId,h.cap.invitationId);assert.equal((await service(h.db,'get_guest_customer_document',[p.invitationId,p.tokenHash])).documentHash,r.documentHash);await denied(service(h.db,'get_guest_customer_document',[h.cap.invitationId,h.cap.tokenHash]),'42501');assert.equal((await review(h)).canRecoverPending,false);
});
test('PR53 historical checkpoint: prepared-before-provider crash can recover completed read-only mail without reviving old unsigned token',async t=>{
 const h=await setup(t,{kind:'contract_completed',unbound:true,attempt:false}),r=await review(h);assert.equal(r.canRenew,false);assert.equal(r.canRecoverPending,true);const receipt=await renew(h,r),p=await newCapability(h,receipt);assert.equal((await service(h.db,'get_guest_customer_document',[p.invitationId,p.tokenHash])).kind,'contract_completed');assert.equal((await h.db.query('select token_hash from private.guest_document_invitations where id=$1',[h.cap.invitationId])).rows[0].token_hash,null);
 await denied(service(h.db,'sign_guest_contract',[p.invitationId,p.tokenHash,3,r.documentHash,'Guest Buyer',[],true,'2026-10-14',id(191)]),'42501');
});
test('PR53 historical checkpoint: pending recovery denies provider-start marker, provider receipt, unknown/processing/rejected/cancelled and requires frozen body consistency',async t=>{
 const h=await setup(t),r=await review(h);
 const patches=["customer_provider_started_at=now()","provider_id='historical-provider'","status='unknown'","status='processing',lease_id=gen_random_uuid(),lease_until=now()+interval '1 minute'","status='rejected'","status='cancelled'","customer_ciphertext=null","attempts=0,first_attempt_at=now()","attempts=1,first_attempt_at=null"];
 for(const patch of patches){await h.db.query("update private.transactional_email_outbox set status='pending',lease_id=null,lease_until=null,provider_id=null,customer_provider_started_at=null,attempts=1,first_attempt_at=now()-interval '8 days',customer_ciphertext=$2 where id=$1",[r.emailId,'opaque-recovery-original-'.repeat(4)]);await h.db.query(`update private.transactional_email_outbox set ${patch} where id=$1`,[r.emailId]);const current=await review(h);assert.equal(current.canRecoverPending,false,patch);await denied(renew(h,r,id(191)),'40001');}
});
test('PR53 historical checkpoint: unbound pending recovery requires no historical provider attempt and live expiry never recovers',async t=>{
 const h=await setup(t,{unbound:true,attempt:false}),r=await review(h);assert.equal(r.canRecoverPending,true);await h.db.query('update private.transactional_email_outbox set attempts=1,first_attempt_at=now() where id=$1',[r.emailId]);assert.equal((await review(h)).canRecoverPending,false);await denied(renew(h,r),'40001');
 await h.db.query('update private.transactional_email_outbox set attempts=0,first_attempt_at=null where id=$1',[r.emailId]);await h.db.exec('alter table private.guest_document_invitations disable trigger guest_invitation_immutable');await h.db.query("update private.guest_document_invitations set created_at=now(),expires_at=now()+interval '7 days' where id=$1",[h.cap.invitationId]);await h.db.exec('alter table private.guest_document_invitations enable trigger guest_invitation_immutable');assert.equal((await review(h)).canRecoverPending,false);await denied(renew(h,r),'40001');
});
test('PR53 historical checkpoint: completed recovery grants finance read only and refuses legacy source with fewer than two valid signatures',async t=>{
 const h=await setup(t,{kind:'contract_completed'}),finance=id(170);await h.db.query('insert into auth.users(id,email,email_confirmed_at)values($1,$2,now())',[finance,'recovery-finance@example.invalid']);await h.db.query("insert into private.account_approvals(user_id,status,updated_by)values($1,'approved',$1)",[finance]);await h.db.query("insert into public.memberships(company_id,user_id,role)values($1,$2,'finance')",[C,finance]);const r=await review(h),fr=await rpc(h.db,finance,'get_guest_invitation_renewal_review',[C,D,h.kind,h.reference]);assert.equal(fr.canWrite,false);assert.equal(fr.canRenew,false);assert.equal(fr.canRecoverPending,false);await denied(rpc(h.db,finance,'renew_guest_document_invitation',[C,D,h.kind,h.reference,r.emailId,r.generation,r.documentHash,id(191)]),'42501');
 await h.db.exec('alter table private.contract_signatures disable trigger contract_signature_immutable');await h.db.query("delete from private.contract_signatures where signing_id=$1 and party='company'",[h.reference]);await h.db.exec('alter table private.contract_signatures enable trigger contract_signature_immutable');assert.equal((await review(h)).canRecoverPending,false);await denied(renew(h,r),'40001');
});
test('PR53 historical checkpoint: hosted-safe recovery rollback proof preserves immutable triggers and leaves zero synthetic rows',async()=>{
 const db=await createDatabase({approveEstablishedFixtures:false,throughMigration:checkpoint});try{await db.exec("create or replace function auth.role() returns text language sql stable as $$select current_setting('role',true)$$;grant execute on function auth.role() to authenticated,anon,service_role;");await db.exec(await readFile(new URL('../supabase/tests/guest_document_link_recovery.sql',import.meta.url),'utf8'));const row=(await db.query(await readFile(new URL('../supabase/tests/guest_document_link_recovery_cleanup.sql',import.meta.url),'utf8'))).rows[0];assert.ok(Object.values(row).every(x=>Number(x)===0),JSON.stringify(row));}finally{await db.close();}
});


test('upgrade preserves PR53 known-429 recovery receipt and denies every fresh retired RPC request',async t=>{
 const h=await setup(t),r=await review(h);assert.equal(r.canRecoverPending,true);
 const receipt=await renew(h,r);
 const frozen=(await h.db.query('select to_jsonb(e) value from private.transactional_email_outbox e where reference_id=$1 order by generation',[h.reference])).rows;
 await upgrade(h.db);
 assert.deepEqual(await renew(h,r),receipt);
 await denied(renew(h,r,id(193)),'40001');
 assert.deepEqual((await h.db.query('select to_jsonb(e) value from private.transactional_email_outbox e where reference_id=$1 order by generation',[h.reference])).rows,frozen);
 const lease=await service(h.db,'claim_transactional_email_exact',[h.kind,h.reference,receipt.emailId]);
 assert.equal(lease.id,receipt.emailId);assert.equal(lease.generation,1);assert.equal(lease.review.documentHash,r.documentHash);
});
test('current reviewed API cannot renew a historical pending source with a previous provider attempt',async t=>{
 const h=await setup(t),r=await review(h);assert.equal(r.canRecoverPending,true);
 await upgrade(h.db);
 const lifecycle=await rpc(h.db,U,'get_customer_document_renewal',[C,D,h.reference,h.kind]);
 assert.equal(lifecycle.canRenew,false);
 await denied(renew(h,r),'40001');
 assert.equal((await h.db.query('select count(*)::int n from private.transactional_email_outbox where reference_id=$1',[h.reference])).rows[0].n,1);
});
