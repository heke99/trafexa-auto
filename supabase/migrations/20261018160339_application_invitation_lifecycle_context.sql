begin;
create or replace function private.application_invitation_delivery_context(p_invitation_id uuid,p_actor_user_id uuid) returns private.application_account_invitations
 language plpgsql security definer set search_path='' as $$
declare item private.application_account_invitations; app private.demo_requests;
begin
 if p_invitation_id is null or p_actor_user_id is null then raise exception 'Invalid invitation delivery' using errcode='22023';end if;
 perform 1 from auth.users where id=p_actor_user_id and email_confirmed_at is not null and not coalesce(is_anonymous,false)
 and not coalesce(is_sso_user,false) and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception 'Platform admin required' using errcode='42501';end if;
 perform 1 from private.platform_admins where user_id=p_actor_user_id and status='active' for share;
 if not found then raise exception 'Platform admin required' using errcode='42501';end if;
 select d.* into app from private.demo_requests d join private.application_account_invitations i on i.application_id=d.id where i.id=p_invitation_id for update of d;
 if not found then raise exception 'Application unavailable' using errcode='P0002';end if;
 select * into item from private.application_account_invitations where id=p_invitation_id for update;
 if item.actor_user_id<>p_actor_user_id or app.legacy or app.status='closed' or (item.user_id is null and app.version<>item.application_version)
 or lower(btrim(app.email))<>item.email or (item.user_id is null and item.expires_at<=clock_timestamp()) then
  raise exception 'Approved invitation unavailable' using errcode='42501';end if;
 if item.user_id is not null then
  perform 1 from auth.users u join private.account_approvals a on a.user_id=u.id
  where u.id=item.user_id and lower(btrim(u.email))=item.email and a.status='approved'
  and not coalesce(u.is_anonymous,false) and not coalesce(u.is_sso_user,false)
  and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of u,a;
  if not found then raise exception 'Invited account unavailable' using errcode='42501';end if;
 end if;
 return item;
end $$;
create or replace function private.application_invitation_delivery_json(p_invitation private.application_account_invitations,p_delivery private.application_invitation_deliveries,p_status text) returns jsonb
 language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('invitationId',p_invitation.id,'deliveryId',p_delivery.delivery_id,'actorUserId',p_delivery.actor_user_id,'leaseId',p_delivery.lease_id,
 'status',p_status,'email',p_invitation.email,'userId',p_invitation.user_id,'firstAttemptAt',p_delivery.first_attempt_at);
$$;
commit;
