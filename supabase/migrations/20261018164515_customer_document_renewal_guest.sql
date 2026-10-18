begin;
create or replace function private.guest_delivery_state(p_email_id uuid,p_lease_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$declare e private.transactional_email_outbox;i private.guest_document_invitations;begin
 select * into e from private.transactional_email_outbox where id=p_email_id for update;
 if e.id is null or not private.customer_document_email_latest(e) or e.kind not in('offer_invitation','contract_invitation','contract_completed') or e.status<>'processing' or e.lease_id is distinct from p_lease_id or e.lease_until<=clock_timestamp() then raise exception 'Guest delivery unavailable' using errcode='42501';end if;
 perform private.guest_email_source(e);
 select * into i from private.guest_document_invitations where email_id=e.id for update;
 if i.id is null or i.expires_at<=clock_timestamp() or not private.guest_document_source_current(i,false) then raise exception 'Guest delivery unavailable' using errcode='42501';end if;
 return jsonb_build_object('companyId',i.company_id,'dealerActorUserId',i.dealer_actor_user_id,'documentHash',i.document_hash,'documentVersion',i.document_version,'generation',e.delivery_generation,'emailId',e.id,'leaseId',e.lease_id,'referenceId',e.reference_id,'kind',e.kind,'recipient',e.recipient,'mode','guest','invitationId',i.id,'userId',null,'expiresAt',i.expires_at,'ciphertext',e.customer_ciphertext,'firstAttemptAt',e.first_attempt_at);
end $$;
commit;
