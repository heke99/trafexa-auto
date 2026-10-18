begin;
create function public.claim_transactional_email_exact(p_kind text,p_reference uuid,p_expected_email_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare e private.transactional_email_outbox;i private.guest_document_invitations;l uuid:=gen_random_uuid();saved private.customer_document_renewals;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 if p_kind is null or p_kind not in('offer_invitation','contract_invitation','contract_completed') or p_reference is null or p_expected_email_id is null then raise exception 'Invalid reviewed dispatch' using errcode='22023';end if;
 select * into e from private.transactional_email_outbox where id=p_expected_email_id for update;
 select * into saved from private.customer_document_renewals where email_id=e.id;
 select * into i from private.guest_document_invitations where id=saved.invitation_id and email_id=e.id;
 if e.id is null or e.kind<>p_kind or e.reference_id<>p_reference or saved.email_id is null or i.id is null or not private.customer_document_email_latest(e)
 or i.dealer_actor_user_id<>saved.actor_user_id or i.company_id<>saved.company_id or i.recipient_email<>e.recipient
 or i.document_hash is distinct from saved.receipt->>'documentHash' or i.document_version is distinct from (saved.receipt->>'documentVersion')::integer
 or e.delivery_generation is distinct from(saved.receipt->>'generation')::integer or i.revoked_at is not null or i.expires_at<=clock_timestamp() then raise exception 'Reviewed delivery changed' using errcode='40001';end if;
 perform private.guest_email_source(e);
 if e.status='processing' and e.lease_until<=clock_timestamp() then
  update private.transactional_email_outbox set status=case when customer_provider_started_at is null then 'pending' else 'unknown' end,
   lease_id=null,lease_until=null,updated_at=clock_timestamp()where id=e.id returning * into e;
 end if;
 if e.status<>'pending' or e.attempts>=5 then return null;end if;
 update private.transactional_email_outbox set status='processing',lease_id=l,lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp()
 where id=e.id returning * into e;
 return jsonb_build_object('id',e.id,'kind',e.kind,'reference',e.reference_id,'recipient',e.recipient,
 'createdAt',coalesce(e.first_attempt_at,clock_timestamp()),'leaseId',l,'generation',e.delivery_generation,
 'review',jsonb_build_object('companyId',i.company_id,'actorUserId',saved.actor_user_id,'invitationId',i.id,
 'recipientEmail',e.recipient,'documentHash',i.document_hash,'documentVersion',i.document_version,'generation',e.delivery_generation));
end$$;
revoke all on function public.claim_transactional_email_exact(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_transactional_email_exact(text,uuid,uuid) to service_role;
commit;
