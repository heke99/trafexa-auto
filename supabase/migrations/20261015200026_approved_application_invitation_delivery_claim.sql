begin;
create function private.claim_platform_application_invitation_delivery(p_invitation_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid; item private.application_account_invitations; delivery private.application_invitation_deliveries; result_status text;
begin
 actor:=private.account_approval_admin_identity();
 item:=private.application_invitation_delivery_context(p_invitation_id,actor);
 insert into private.application_invitation_deliveries(invitation_id,actor_user_id) values(item.id,actor) on conflict(invitation_id) do nothing;
 select * into delivery from private.application_invitation_deliveries where invitation_id=item.id for update;
 if delivery.state in ('sent','unknown','rejected') then
  result_status:=case when delivery.state='sent' then 'sent' else 'unknown' end;
 elsif delivery.state in ('generating','sending') and delivery.lease_until>clock_timestamp() then result_status:='busy';
 elsif delivery.state='sending' or (delivery.ciphertext is not null and (delivery.attempt_count>=5 or delivery.first_attempt_at<=clock_timestamp()-interval '23 hours')) then
  update private.application_invitation_deliveries set state='unknown',updated_at=clock_timestamp() where invitation_id=item.id returning * into delivery;
  result_status:='unknown';
 else
  result_status:=case when delivery.ciphertext is null then 'generate' else 'send' end;
  update private.application_invitation_deliveries set state=case when result_status='generate' then 'generating' else 'sending' end,
   lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp(),
   first_attempt_at=case when result_status='send' then coalesce(first_attempt_at,clock_timestamp()) else first_attempt_at end,
   attempt_count=attempt_count+case when result_status='send' then 1 else 0 end
   where invitation_id=item.id returning * into delivery;
 end if;
 return private.application_invitation_delivery_json(item,delivery,result_status);
end $$;
revoke all on function private.claim_platform_application_invitation_delivery(uuid) from public,anon,service_role;
grant execute on function private.claim_platform_application_invitation_delivery(uuid) to authenticated;
create function public.claim_platform_application_invitation_delivery(p_invitation_id uuid) returns jsonb
 language sql security invoker set search_path='' as $$select private.claim_platform_application_invitation_delivery(p_invitation_id);$$;
revoke all on function public.claim_platform_application_invitation_delivery(uuid) from public,anon,service_role;
grant execute on function public.claim_platform_application_invitation_delivery(uuid) to authenticated;
create function private.get_platform_application_invitation_delivery(p_invitation_id uuid,p_lease_id uuid,p_actor_user_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare item private.application_account_invitations; delivery private.application_invitation_deliveries; result_status text;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'Service required' using errcode='42501';end if;
 item:=private.application_invitation_delivery_context(p_invitation_id,p_actor_user_id);
 select * into delivery from private.application_invitation_deliveries where invitation_id=item.id for update;
 if not found or p_lease_id is null or delivery.lease_id is distinct from p_lease_id or delivery.actor_user_id<>p_actor_user_id
 or delivery.state not in ('generating','sending') or delivery.lease_until<=clock_timestamp()
 or (item.user_id is not null and exists(select 1 from auth.users where id=item.user_id and email_confirmed_at is not null)) then raise exception 'Delivery lease unavailable' using errcode='40001';end if;
 result_status:=case when delivery.state='generating' then 'generate' else 'send' end;
 return private.application_invitation_delivery_json(item,delivery,result_status)||jsonb_build_object('ciphertext',delivery.ciphertext);
end $$;
revoke all on function private.get_platform_application_invitation_delivery(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.get_platform_application_invitation_delivery(uuid,uuid,uuid) to service_role;
create function public.get_platform_application_invitation_delivery(p_invitation_id uuid,p_lease_id uuid,p_actor_user_id uuid) returns jsonb
 language sql security invoker set search_path='' as $$select private.get_platform_application_invitation_delivery(p_invitation_id,p_lease_id,p_actor_user_id);$$;
revoke all on function public.get_platform_application_invitation_delivery(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_platform_application_invitation_delivery(uuid,uuid,uuid) to service_role;
commit;
