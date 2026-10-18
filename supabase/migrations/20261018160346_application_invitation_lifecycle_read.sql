begin;
create or replace function private.get_platform_application_invitation(p_application_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid;app private.demo_requests;item private.application_account_invitations;delivery private.application_invitation_deliveries;
 u auth.users;approval text;delivery_state text:='not_started';authorized boolean:=false;retry boolean:=false;renew boolean:=false;
begin
 actor:=private.account_approval_admin_identity();
 if p_application_id is null then raise exception 'Invalid application' using errcode='22023';end if;
 select * into app from private.demo_requests where id=p_application_id;
 if not found then raise exception 'Application unavailable' using errcode='P0002';end if;
 select * into item from private.application_account_invitations where application_id=p_application_id;
 if found then
  if item.user_id is not null then
   select * into u from auth.users where id=item.user_id;
   select status into approval from private.account_approvals where user_id=item.user_id;
  end if;
  authorized:=item.actor_user_id=actor and not app.legacy and app.status<>'closed' and lower(btrim(app.email))=item.email
   and ((item.user_id is null and not exists(select 1 from auth.users where lower(btrim(email))=item.email))
   or (u.id=item.user_id and lower(btrim(u.email))=item.email and u.email_confirmed_at is null and approval='approved'
   and not coalesce(u.is_anonymous,false) and not coalesce(u.is_sso_user,false) and (u.banned_until is null or u.banned_until<=clock_timestamp())));
  select * into delivery from private.application_invitation_deliveries where invitation_id=item.id;
  if found then
   delivery_state:=case
    when delivery.state='sending' and delivery.lease_until<=clock_timestamp() then 'unknown'
    when delivery.state='pending' and delivery.ciphertext is not null and (delivery.attempt_count>=5 or delivery.first_attempt_at<=clock_timestamp()-interval '23 hours') then 'unknown'
    when delivery.state='pending' and delivery.attempt_count>0 then 'retryable'
    when delivery.state='pending' then 'not_started' else delivery.state end;
   retry:=coalesce(authorized and (delivery.state='pending' and delivery_state<>'unknown'
    or delivery.state='generating' and delivery.lease_until<=clock_timestamp()),false);
   renew:=coalesce(authorized and item.user_id is not null and delivery_state in ('sent','rejected','unknown'),false);
  if item.user_id is null and item.application_version<>app.version then
    retry:=retry and delivery.ciphertext is null and delivery.attempt_count=0 and delivery.state in ('pending','generating');
   end if;
  else retry:=coalesce(authorized,false);
  end if;
 end if;
 return jsonb_build_object('applicationId',app.id,'invitation',case when item.id is not null then private.application_account_invitation_json(item) else null end,
 'lifecycle',jsonb_build_object('applicationVersion',app.version,
  'delivery',jsonb_build_object('id',delivery.delivery_id,'state',delivery_state,'attemptCount',coalesce(delivery.attempt_count,0),
   'firstAttemptAt',delivery.first_attempt_at,'updatedAt',delivery.updated_at,'canRetry',retry),
  'account',jsonb_build_object('emailVerified',case when u.id is not null then u.email_confirmed_at is not null else null end,'approvalStatus',approval),'canRenew',renew));
end$$;
commit;
