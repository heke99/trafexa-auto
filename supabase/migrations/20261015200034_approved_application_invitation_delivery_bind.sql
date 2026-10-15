begin;
create function private.bind_platform_application_invitation_delivery(p_invitation_id uuid,p_lease_id uuid,p_actor_user_id uuid,p_ciphertext text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare item private.application_account_invitations; delivery private.application_invitation_deliveries;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'Service required' using errcode='42501';end if;
 if p_ciphertext is null or length(p_ciphertext) not between 32 and 16384 or p_ciphertext ~ '[[:cntrl:]]' then raise exception 'Invalid encrypted invitation' using errcode='22023';end if;
 item:=private.application_invitation_delivery_context(p_invitation_id,p_actor_user_id);
 if item.user_id is null or exists(select 1 from auth.users where id=item.user_id and email_confirmed_at is not null) then raise exception 'Invited account unavailable' using errcode='40001';end if;
 select * into delivery from private.application_invitation_deliveries where invitation_id=item.id for update;
 if not found or p_lease_id is null or delivery.lease_id is distinct from p_lease_id or delivery.actor_user_id<>p_actor_user_id
 or delivery.state not in ('generating','sending') or delivery.lease_until<=clock_timestamp() then raise exception 'Delivery lease unavailable' using errcode='40001';end if;
 if delivery.ciphertext is not null then
  if delivery.ciphertext<>p_ciphertext then raise exception 'Encrypted invitation conflict' using errcode='40001';end if;
 else
  update private.application_invitation_deliveries set ciphertext=p_ciphertext,state='sending',first_attempt_at=clock_timestamp(),attempt_count=1,updated_at=clock_timestamp()
  where invitation_id=item.id returning * into delivery;
 end if;
 return private.application_invitation_delivery_json(item,delivery,'send');
end $$;
revoke all on function private.bind_platform_application_invitation_delivery(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.bind_platform_application_invitation_delivery(uuid,uuid,uuid,text) to service_role;
create function public.bind_platform_application_invitation_delivery(p_invitation_id uuid,p_lease_id uuid,p_actor_user_id uuid,p_ciphertext text) returns jsonb
 language sql security invoker set search_path='' as $$select private.bind_platform_application_invitation_delivery(p_invitation_id,p_lease_id,p_actor_user_id,p_ciphertext);$$;
revoke all on function public.bind_platform_application_invitation_delivery(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.bind_platform_application_invitation_delivery(uuid,uuid,uuid,text) to service_role;
commit;
