begin;
create table private.application_invitation_deliveries(
 invitation_id uuid primary key references private.application_account_invitations(id) on delete cascade,
 actor_user_id uuid not null references auth.users(id),
 state text not null default 'pending' check(state in ('pending','generating','sending','sent','rejected','unknown')),
 lease_id uuid,lease_until timestamptz,
 ciphertext text check(ciphertext is null or length(ciphertext) between 32 and 16384),
 first_attempt_at timestamptz,attempt_count integer not null default 0 check(attempt_count between 0 and 5),
 provider_id text check(provider_id is null or (length(provider_id) between 1 and 256 and provider_id !~ '[[:cntrl:]]')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check((lease_id is null)=(lease_until is null)),check((first_attempt_at is null)=(attempt_count=0))
);
alter table private.application_invitation_deliveries enable row level security;
revoke all on private.application_invitation_deliveries from public,anon,authenticated,service_role;
-- Lock and revalidate the original approver and case before touching delivery.
create function private.application_invitation_delivery_context(p_invitation_id uuid,p_actor_user_id uuid) returns private.application_account_invitations
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
 if item.actor_user_id<>p_actor_user_id or app.legacy or app.status='closed' or app.version<>item.application_version
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
revoke all on function private.application_invitation_delivery_context(uuid,uuid) from public,anon,authenticated,service_role;
create function private.application_invitation_delivery_json(p_invitation private.application_account_invitations,p_delivery private.application_invitation_deliveries,p_status text) returns jsonb
 language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('invitationId',p_invitation.id,'actorUserId',p_delivery.actor_user_id,'leaseId',p_delivery.lease_id,
 'status',p_status,'email',p_invitation.email,'userId',p_invitation.user_id,'firstAttemptAt',p_delivery.first_attempt_at);
$$;
revoke all on function private.application_invitation_delivery_json(private.application_account_invitations,private.application_invitation_deliveries,text) from public,anon,authenticated,service_role;
commit;
