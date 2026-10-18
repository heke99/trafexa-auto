begin;
create or replace function private.finish_platform_application_invitation_delivery(p_invitation_id uuid,p_lease_id uuid,p_actor_user_id uuid,p_outcome text,p_provider_id text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare item private.application_account_invitations; delivery private.application_invitation_deliveries; next_state text; historical private.application_invitation_delivery_history;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'Service required' using errcode='42501';end if;
 if p_outcome is null or p_outcome not in ('sent','retryable','rejected','unknown')
 or (p_outcome='sent' and (p_provider_id is null or length(p_provider_id) not between 1 and 256 or p_provider_id ~ '[[:cntrl:]]'))
 or (p_outcome<>'sent' and p_provider_id is not null) then raise exception 'Invalid delivery outcome' using errcode='22023';end if;
 -- Record a historical external result even if the approver/account was revoked
 -- after the last pre-send check. This grants no future dispatch authorization.
 select * into item from private.application_account_invitations where id=p_invitation_id for update;
 if not found or item.actor_user_id is distinct from p_actor_user_id then raise exception 'Invitation delivery unavailable' using errcode='40001';end if;
 select * into delivery from private.application_invitation_deliveries where invitation_id=item.id for update;
 if p_lease_id is not null and (delivery.lease_id is distinct from p_lease_id) then
  select * into historical from private.application_invitation_delivery_history where invitation_id=item.id and lease_id=p_lease_id and actor_user_id=p_actor_user_id for update;
  if found then
   if historical.state='sent' then
    if p_outcome<>'sent' or historical.provider_id is distinct from p_provider_id then raise exception 'Historical delivery conflict' using errcode='40001';end if;
   elsif historical.state='unknown' and p_outcome='sent' and historical.attempt_count>0 then
    update private.application_invitation_delivery_history set state='sent',provider_id=p_provider_id,updated_at=clock_timestamp() where delivery_id=historical.delivery_id returning * into historical;
   elsif p_outcome<>'unknown' then raise exception 'Historical delivery conflict' using errcode='40001';end if;
   return jsonb_build_object('invitationId',item.id,'deliveryId',historical.delivery_id,'actorUserId',p_actor_user_id,'leaseId',p_lease_id,'outcome',p_outcome,'providerId',historical.provider_id);
  end if;
 end if;
 if delivery.invitation_id is null or p_lease_id is null or delivery.lease_id is distinct from p_lease_id or delivery.actor_user_id<>p_actor_user_id then
  raise exception 'Delivery lease unavailable' using errcode='40001';end if;
 next_state:=case p_outcome when 'sent' then 'sent' when 'rejected' then 'rejected' when 'unknown' then 'unknown' else 'pending' end;
 if delivery.state not in ('generating','sending') then
  if delivery.state=next_state and delivery.provider_id is not distinct from p_provider_id then
   return jsonb_build_object('invitationId',item.id,'deliveryId',delivery.delivery_id,'actorUserId',p_actor_user_id,'leaseId',p_lease_id,'outcome',p_outcome,'providerId',delivery.provider_id);
  end if;
  raise exception 'Delivery outcome conflict' using errcode='40001';end if;
 if p_outcome='sent' and (delivery.state<>'sending' or delivery.ciphertext is null or item.user_id is null) then raise exception 'Invitation payload unavailable' using errcode='40001';end if;
 if p_outcome='retryable' and (delivery.attempt_count>=5 or (delivery.first_attempt_at is not null and delivery.first_attempt_at<=clock_timestamp()-interval '23 hours')) then next_state:='unknown';end if;
 update private.application_invitation_deliveries set state=next_state,provider_id=p_provider_id,updated_at=clock_timestamp() where invitation_id=item.id returning * into delivery;
 return jsonb_build_object('invitationId',item.id,'deliveryId',delivery.delivery_id,'actorUserId',p_actor_user_id,'leaseId',p_lease_id,'outcome',p_outcome,'providerId',delivery.provider_id);
end $$;
commit;
