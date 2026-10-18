begin;
create function private.customer_document_renewal_lifecycle(src jsonb) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare e private.transactional_email_outbox;i private.guest_document_invitations;b text;t text;link text;valid boolean;
begin
 select * into e from private.transactional_email_outbox where kind=src->>'kind' and reference_id=(src->>'referenceId')::uuid
 and recipient=src->>'recipientEmail' order by delivery_generation desc limit 1;
 select * into i from private.guest_document_invitations where email_id=e.id;
 link:=case when i.id is null then 'missing' when i.revoked_at is not null then 'revoked' when i.expires_at<=clock_timestamp() then 'expired' else 'active' end;
 valid:=coalesce((src->>'sourceCurrent')::boolean and i.company_id=(src->>'companyId')::uuid and i.document_hash=src->>'documentHash'
 and i.document_version=(src->>'documentVersion')::integer and i.recipient_email=src->>'recipientEmail' and private.guest_document_source_current(i,false),false);
 b:=case when i.id is null then 'no_link'
 when i.dealer_actor_user_id<>(src->>'actorUserId')::uuid then 'actor_changed'
 when not (src->>'actorRole'=any(case when src->>'kind'='offer_invitation' then array['owner','admin','sales'] else array['owner','admin'] end)) then 'unavailable'
 when i.revoked_at is not null then 'revoked' when not valid then 'source_changed'
 when link<>'expired' then 'not_expired' when e.status='processing'and e.lease_until>clock_timestamp() then 'lease_active'
 when e.status='unknown' then 'provider_unknown' when e.status not in('accepted','rejected') and not(e.status in('pending','processing') and e.attempts=0 and e.first_attempt_at is null and e.customer_provider_started_at is null and e.provider_id is null and (e.status='pending' and e.lease_id is null or e.status='processing' and e.lease_until<=clock_timestamp()))then 'unavailable' else null end;
 if i.id is not null then t:=encode(sha256(convert_to(jsonb_build_object('source',src,'emailId',e.id,'invitationId',i.id,
 'generation',e.delivery_generation,'status',e.status,'expiresAt',i.expires_at,'revokedAt',i.revoked_at)::text,'UTF8')),'hex');end if;
 return (src-'sourceCurrent')||jsonb_build_object('emailId',e.id,'invitationId',i.id,'generation',e.delivery_generation,
 'documentHash',coalesce(i.document_hash,src->>'documentHash'),'documentVersion',coalesce(i.document_version,(src->>'documentVersion')::integer),
 'expiresAt',i.expires_at,'revoked',i.revoked_at is not null,'linkStatus',link,'status',e.status,'canRenew',b is null,'blockedReason',b,'reviewToken',t);
end$$;
revoke all on function private.customer_document_renewal_lifecycle(jsonb) from public,anon,authenticated,service_role;
create function private.get_customer_document_renewal(p_company_id uuid,p_deal_id uuid,p_reference_id uuid,p_kind text) returns jsonb
 language plpgsql security definer set search_path='' as $$begin
 return private.customer_document_renewal_lifecycle(private.customer_document_renewal_source(p_company_id,p_deal_id,p_reference_id,p_kind,false));
end$$;
revoke all on function private.get_customer_document_renewal(uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function private.get_customer_document_renewal(uuid,uuid,uuid,text) to authenticated;
commit;
