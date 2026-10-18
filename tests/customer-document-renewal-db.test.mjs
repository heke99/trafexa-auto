import test from'node:test';import assert from'node:assert/strict';
import{fixture,id,U,K,C,D,rpc,claim,service,sign}from'./transactional-email-db/contract-invitation-fixtures.mjs';
const token='a'.repeat(64),cipher='synthetic-frozen-ciphertext-'.repeat(3);
async function setup(kind='contract_invitation',state='accepted'){
 const h=await fixture();if(kind==='contract_completed'){const s=(await sign(h.db,h.signing)).signing;await sign(h.db,s,'company',id(321));}
 const e=await claim(h.db,h.signing,kind),cap=await service(h.db,'prepare_customer_contract_invitation',[e.id,e.leaseId]);
 await service(h.db,'bind_guest_document_invitation',[e.id,e.leaseId,cap.invitationId,token,cipher]);
 if(state==='accepted'||state==='rejected'){await service(h.db,'begin_customer_contract_invitation_send',[e.id,e.leaseId]);await service(h.db,'finish_transactional_email',[e.id,e.leaseId,state,state==='accepted'?'synthetic-provider-original':null]);}
 else await service(h.db,'finish_transactional_email',[e.id,e.leaseId,'pending',null]);
 await h.db.exec("alter table private.guest_document_invitations disable trigger guest_invitation_immutable");
 await h.db.query("update private.guest_document_invitations set created_at=statement_timestamp()-interval '8 days',expires_at=statement_timestamp()-interval '1 day'where id=$1",[cap.invitationId]);
 await h.db.exec("alter table private.guest_document_invitations enable trigger guest_invitation_immutable");
 return{...h,kind,email:e,cap,async read(){return rpc(h.db,U,'get_customer_document_renewal',[C,D,h.signing.id,kind]);}};
}
function args(h,l,nonce=id(330),allow=true){return[C,D,h.signing.id,h.kind,l.emailId,l.invitationId,l.generation,l.documentHash,l.documentVersion,l.recipientEmail,l.reviewToken,'Reviewed expired personal document link',nonce,allow];}
const renew=(h,l,nonce=id(330),allow=true)=>rpc(h.db,U,'renew_customer_document_link',args(h,l,nonce,allow));
const conflict=f=>assert.rejects(f,e=>e.code==='40001');
test('expired reviewed guest link creates a new generation while retaining historical body/token/provider, without customer Auth changes',async()=>{
 const h=await setup();try{const before=await h.read(),users=(await h.db.query('select count(*)::int n from auth.users')).rows[0].n;assert.equal(before.canRenew,true);assert.equal(before.linkStatus,'expired');assert.equal(before.generation,0);
 const old=(await h.db.query('select to_jsonb(e)row from private.transactional_email_outbox e where id=$1',[before.emailId])).rows[0].row;
 const r=await renew(h,before);assert.equal(r.generation,1);assert.notEqual(r.emailId,before.emailId);assert.notEqual(r.invitationId,before.invitationId);assert.equal(r.reviewToken,before.reviewToken);assert.deepEqual(await renew(h,before),r);assert.deepEqual(await renew(h,before,id(330),false),r);
 assert.deepEqual((await h.db.query('select to_jsonb(e)row from private.transactional_email_outbox e where id=$1',[before.emailId])).rows[0].row,old);
 assert.equal((await h.db.query('select token_hash from private.guest_document_invitations where id=$1',[before.invitationId])).rows[0].token_hash,token);
 assert.ok((await h.db.query('select revoked_at from private.guest_document_invitations where id=$1',[before.invitationId])).rows[0].revoked_at);
 const latest=await h.read();assert.equal(latest.emailId,r.emailId);assert.equal(latest.status,'pending');assert.equal(latest.linkStatus,'active');assert.equal(latest.canRenew,false);
 const legacy=await rpc(h.db,U,'get_contract_signing_delivery',[C,D,h.signing.id]);assert.equal(legacy.status,'pending');
 const exact=await service(h.db,'claim_transactional_email_exact',[h.kind,h.signing.id,r.emailId]);assert.equal(exact.id,r.emailId);assert.equal(exact.generation,1);assert.equal(exact.review.invitationId,r.invitationId);
 const prepared=await service(h.db,'prepare_customer_contract_invitation',[exact.id,exact.leaseId]);assert.equal(prepared.generation,1);assert.equal(prepared.documentHash,before.documentHash);assert.equal(prepared.ciphertext,null);assert.equal(prepared.dealerActorUserId,U);
 assert.equal((await h.db.query('select count(*)::int n from auth.users')).rows[0].n,users);
 await conflict(()=>renew(h,{...before,documentHash:'f'.repeat(64)}));
 assert.equal((await service(h.db,'finish_transactional_email',[before.emailId,h.email.leaseId,'accepted','late-original'])),false);
 }finally{await h.db.close();}
});
test('strict never-attempted pending expired link can be reviewed again; superseded pending is cancelled and generic retry carries saved review',async()=>{
 const h=await setup('contract_invitation','pending');try{const before=await h.read();assert.equal(before.canRenew,true);const r=await renew(h,before);assert.equal((await h.db.query('select status from private.transactional_email_outbox where id=$1',[before.emailId])).rows[0].status,'cancelled');const e=await claim(h.db,h.signing);assert.equal(e.id,r.emailId);assert.equal(e.generation,1);assert.equal(e.review.invitationId,r.invitationId);assert.equal(e.review.documentHash,before.documentHash);assert.equal(e.review.actorUserId,U);
 await h.db.query("select private.enqueue_transactional_email('contract_invitation',$1,$2,null)",[h.signing.id,before.recipientEmail]);assert.equal((await h.db.query("select count(*)::int n from private.transactional_email_outbox where kind='contract_invitation'and reference_id=$1",[h.signing.id])).rows[0].n,2);
 }finally{await h.db.close();}
});
test('unknown, attempted pending, processing and unsigned-source changes cannot produce a replacement generation',async()=>{
 for(const mode of['unknown','attempted','processing','signed','cancelled','wrongactor']){const h=await setup();try{const before=await h.read();
 if(mode==='unknown')await h.db.query("update private.transactional_email_outbox set status='unknown'where id=$1",[before.emailId]);
 if(mode==='attempted')await h.db.query("update private.transactional_email_outbox set status='pending'where id=$1",[before.emailId]);
 if(mode==='processing')await h.db.query("update private.transactional_email_outbox set status='processing',lease_id=$2,lease_until=clock_timestamp()+interval '1 minute'where id=$1",[before.emailId,id(333)]);
 if(mode==='signed')await sign(h.db,h.signing);
 if(mode==='cancelled')await h.db.query("update public.deals set status='cancelled'where id=$1",[D]);
 if(mode==='wrongactor'){await h.db.query("insert into public.memberships(company_id,user_id,role)values($1,$2,'admin')",[C,K]);await assert.rejects(()=>rpc(h.db,K,'renew_customer_document_link',args(h,before)),e=>['40001','42501'].includes(e.code));}
 else await conflict(()=>renew(h,before));
 assert.equal((await h.db.query('select count(*)::int n from private.customer_document_renewals')).rows[0].n,0);
 }finally{await h.db.close();}}
});
test('completed read-only document renewal requires complete current source and readonly paused replay never creates an intent',async()=>{
 const h=await setup('contract_completed');try{const before=await h.read();assert.equal(before.canRenew,true);assert.equal(await renew(h,before,id(330),false),null);assert.equal((await h.db.query('select count(*)::int n from private.customer_document_renewals')).rows[0].n,0);const r=await renew(h,before);assert.equal(r.kind,'contract_completed');assert.deepEqual(await renew(h,before,id(330),false),r);const current=await h.read();assert.equal(current.invitationId,r.invitationId);assert.equal(current.canRenew,false);
 }finally{await h.db.close();}
});
test('expired processing with zero provider evidence may recover, but each poisoned or live-lease variant is blocked',async()=>{
 for(const mode of['safe','live','first','provider','attempt']){const h=await setup('contract_invitation','pending');try{const before=await h.read();await h.db.query("update private.transactional_email_outbox set status='processing',lease_id=$2,lease_until=clock_timestamp()-interval '1 second'where id=$1",[before.emailId,id(350)]);if(mode==='live')await h.db.query("update private.transactional_email_outbox set lease_until=clock_timestamp()+interval '1 minute'where id=$1",[before.emailId]);if(mode==='first')await h.db.query('update private.transactional_email_outbox set first_attempt_at=clock_timestamp()where id=$1',[before.emailId]);if(mode==='provider')await h.db.query('update private.transactional_email_outbox set customer_provider_started_at=clock_timestamp()where id=$1',[before.emailId]);if(mode==='attempt')await h.db.query('update private.transactional_email_outbox set attempts=1 where id=$1',[before.emailId]);const current=await h.read();if(mode==='safe'){assert.equal(current.canRenew,true);const r=await renew(h,current);assert.equal(r.generation,1);const old=(await h.db.query('select status,lease_id,lease_until,customer_ciphertext from private.transactional_email_outbox where id=$1',[before.emailId])).rows[0];assert.equal(old.status,'cancelled');assert.equal(old.lease_id,null);assert.equal(old.lease_until,null);assert.equal(old.customer_ciphertext,cipher);assert.equal(await service(h.db,'check_transactional_email_lease',[before.emailId,id(350)]),false);await assert.rejects(()=>service(h.db,'begin_customer_contract_invitation_send',[before.emailId,id(350)]),e=>e.code==='42501');}else{assert.equal(current.canRenew,false);await conflict(()=>renew(h,current));}}finally{await h.db.close();}}
});
test('same full reviewed request replays receipt after source becomes signed, before current generation or expiry eligibility',async()=>{const h=await setup();try{const before=await h.read(),r=await renew(h,before);await sign(h.db,h.signing);assert.deepEqual(await renew(h,before,id(330),false),r);assert.equal((await h.read()).canRenew,false);await assert.rejects(()=>service(h.db,'claim_transactional_email_exact',[h.kind,h.signing.id,r.emailId]),e=>['42501','40001'].includes(e.code));}finally{await h.db.close();}});
test('offer renewal supports actual original sales actor but cannot change original actor provenance',async()=>{const g=await import('./guest-customer-db/helpers.mjs');const h=await g.fixture();try{const cap=await g.capability(h.db,'offer_invitation',h.review.id);await g.service(h.db,'begin_customer_contract_invitation_send',[cap.lease.id,cap.lease.leaseId]);await g.service(h.db,'finish_transactional_email',[cap.lease.id,cap.lease.leaseId,'accepted','synthetic-offer-provider']);await h.db.exec('alter table private.guest_document_invitations disable trigger guest_invitation_immutable');await h.db.query("update private.guest_document_invitations set created_at=statement_timestamp()-interval '8 days',expires_at=statement_timestamp()-interval '1 day'where id=$1",[cap.invitationId]);await h.db.exec('alter table private.guest_document_invitations enable trigger guest_invitation_immutable');await h.db.query("update public.memberships set role='sales'where company_id=$1 and user_id=$2",[g.C,g.U]);const l=await g.rpc(h.db,g.U,'get_customer_document_renewal',[g.C,g.D,h.review.id,'offer_invitation']);assert.equal(l.canRenew,true);assert.equal(l.actorRole,'sales');const r=await g.rpc(h.db,g.U,'renew_customer_document_link',[g.C,g.D,h.review.id,'offer_invitation',l.emailId,l.invitationId,l.generation,l.documentHash,l.documentVersion,l.recipientEmail,l.reviewToken,'Reviewed expired offer link',g.id(390),true]);assert.equal(r.actorUserId,g.U);assert.equal(r.kind,'offer_invitation');assert.equal((await g.rpc(h.db,g.U,'get_offer_review_delivery',[g.C,g.D,h.review.id])).status,'pending');const job=await g.service(h.db,'claim_transactional_email_exact',['offer_invitation',h.review.id,r.emailId]);assert.equal(job.review.actorUserId,g.U);assert.equal((await h.db.query('select count(*)::int n from auth.users')).rows[0].n,1);}finally{await h.db.close();}});
