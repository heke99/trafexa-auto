begin;
create function public.claim_transactional_email_exact(p_kind text,p_reference uuid,p_expected_email_id uuid)returns jsonb
 language plpgsql security definer set search_path=''as $$
declare e private.transactional_email_outbox;i private.guest_document_invitations;l uuid:=gen_random_uuid();proof jsonb;
begin
 if current_setting('role',true)is distinct from 'service_role'then raise exception 'Service required'using errcode='42501';end if;
 if p_kind is null or p_kind not in('offer_invitation','contract_invitation','contract_completed')or p_reference is null or p_expected_email_id is null then raise exception 'Invalid reviewed dispatch'using errcode='22023';end if;
 select *into e from private.transactional_email_outbox where id=p_expected_email_id for update;
 if e.id is null or e.kind<>p_kind or e.reference_id<>p_reference or e.generation<=0 or not private.customer_document_email_latest(e)
 or(not exists(select 1 from private.customer_document_renewals where email_id=e.id)and not exists(select 1 from private.guest_invitation_renewal_audit where email_id=e.id))then raise exception 'Reviewed delivery changed'using errcode='40001';end if;
 if e.status='processing'and e.lease_until<=clock_timestamp()then
  update private.transactional_email_outbox set status=case when customer_provider_started_at is null then 'pending'else 'unknown'end,
   lease_id=null,lease_until=null,updated_at=clock_timestamp()where id=e.id returning *into e;
 end if;
 if e.status<>'pending'or e.attempts>=5 then return null;end if;
 proof:=private.customer_document_saved_review(e);
 select *into i from private.guest_document_invitations where id=(proof->>'invitationId')::uuid and email_id=e.id for update;
 if i.id is null or i.revoked_at is not null or i.expires_at<=clock_timestamp()then raise exception 'Reviewed capability expired'using errcode='40001';end if;
 update private.transactional_email_outbox set status='processing',lease_id=l,lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp()
 where id=e.id returning *into e;
 return jsonb_build_object('id',e.id,'kind',e.kind,'reference',e.reference_id,'recipient',e.recipient,
 'createdAt',coalesce(e.first_attempt_at,clock_timestamp()),'leaseId',l,'generation',e.generation,'review',proof);
end$$;
revoke all on function public.claim_transactional_email_exact(text,uuid,uuid)from public,anon,authenticated;
grant execute on function public.claim_transactional_email_exact(text,uuid,uuid)to service_role;
-- Preserve the already deployed PR51 dispatcher signature, with current fencing.
create or replace function public.claim_transactional_email_exact(p_email_id uuid)returns jsonb
 language plpgsql security definer set search_path=''as $$
declare e private.transactional_email_outbox;begin
 if current_setting('role',true)is distinct from 'service_role'then raise exception 'Service required'using errcode='42501';end if;
 select *into e from private.transactional_email_outbox where id=p_email_id;
 if e.id is null then return null;end if;
 return public.claim_transactional_email_exact(e.kind,e.reference_id,e.id);
end$$;
revoke all on function public.claim_transactional_email_exact(uuid)from public,anon,authenticated;
grant execute on function public.claim_transactional_email_exact(uuid)to service_role;
commit;
