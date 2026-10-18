begin;
create function private.claim_platform_application_invitation_delivery_v2(p_invitation_id uuid,p_expected_delivery_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid;item private.application_account_invitations;delivery private.application_invitation_deliveries;
begin
 actor:=private.account_approval_admin_identity();
 item:=private.application_invitation_delivery_context(p_invitation_id,actor);
 select * into delivery from private.application_invitation_deliveries where invitation_id=item.id for update;
 if p_expected_delivery_id is not null and (delivery.invitation_id is null or delivery.delivery_id<>p_expected_delivery_id) then
  raise exception 'Delivery generation changed' using errcode='40001';end if;
 return private.claim_platform_application_invitation_delivery(item.id);
end$$;
revoke all on function private.claim_platform_application_invitation_delivery_v2(uuid,uuid) from public,anon,service_role;
grant execute on function private.claim_platform_application_invitation_delivery_v2(uuid,uuid) to authenticated;
create function public.claim_platform_application_invitation_delivery_v2(p_invitation_id uuid,p_expected_delivery_id uuid) returns jsonb
 language sql security invoker set search_path='' as $$select private.claim_platform_application_invitation_delivery_v2(p_invitation_id,p_expected_delivery_id);$$;
revoke all on function public.claim_platform_application_invitation_delivery_v2(uuid,uuid) from public,anon,service_role;
grant execute on function public.claim_platform_application_invitation_delivery_v2(uuid,uuid) to authenticated;
commit;
