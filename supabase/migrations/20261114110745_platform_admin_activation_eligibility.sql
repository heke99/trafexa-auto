begin;
-- Read only, actor-bound bootstrap eligibility. This never claims a reservation
-- and never exposes its email, reference, identifier or other applicants.
create function private.get_platform_admin_activation_access()returns jsonb language plpgsql volatile security definer set search_path=''as $$
declare actor uuid:=auth.uid();u auth.users;approved text;eligible boolean:=false;
begin
 if current_setting('role',true)is distinct from'authenticated' or actor is null then raise exception 'Authenticated account required'using errcode='42501';end if;
 select *into u from auth.users where id=actor for share;
 if found and u.email is not null and btrim(u.email)<>'' and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and not coalesce(u.is_sso_user,false) and(u.banned_until is null or u.banned_until<=clock_timestamp())then
  select status into approved from private.account_approvals where user_id=actor for share;
  -- Any registry row is independently managed; bootstrap cannot repair a
  -- suspended administrator or grant an existing administrator again.
  perform 1 from private.platform_admins where user_id=actor for share;
  if not found and approved='approved' and(select count(*)from auth.users x where lower(btrim(x.email))=lower(btrim(u.email)) and not coalesce(x.is_anonymous,false) and not coalesce(x.is_sso_user,false))=1 then
   perform 1 from private.platform_admin_bootstrap_reservations r where r.email=lower(btrim(u.email)) and r.status='active' and r.claimed_by is null and r.claimed_at is null for share;
   eligible:=found;
  end if;
 end if;
 return jsonb_build_object('user_id',actor,'can_activate',eligible);
end$$;
revoke all on function private.get_platform_admin_activation_access()from public,anon,authenticated,service_role;
grant execute on function private.get_platform_admin_activation_access()to authenticated;
create function public.get_platform_admin_activation_access()returns jsonb language sql volatile security invoker set search_path=''as $$select private.get_platform_admin_activation_access();$$;
revoke all on function public.get_platform_admin_activation_access()from public,anon,authenticated,service_role;
grant execute on function public.get_platform_admin_activation_access()to authenticated;

-- Keep legacy direct RPC authorization aligned with the modern account guard.
-- A stale verification timestamp without an actual unique email is insufficient.
create or replace function private.has_platform_admin()returns boolean language sql stable security definer set search_path=''as $$
 select current_setting('role',true)='authenticated' and auth.uid()is not null and exists(
  select 1 from private.platform_admins a join auth.users u on u.id=a.user_id
  where a.user_id=auth.uid() and a.status='active' and u.email is not null and btrim(u.email)<>'' and u.email_confirmed_at is not null
   and not coalesce(u.is_anonymous,false) and not coalesce(u.is_sso_user,false) and(u.banned_until is null or u.banned_until<=clock_timestamp())
   and(select count(*)from auth.users x where lower(btrim(x.email))=lower(btrim(u.email)) and not coalesce(x.is_anonymous,false) and not coalesce(x.is_sso_user,false))=1
 );
$$;
create or replace function private.account_approval_admin_identity()returns uuid language plpgsql security invoker set search_path=''as $$
declare actor uuid:=auth.uid();begin
 if current_setting('role',true)is distinct from'authenticated' or actor is null then raise exception 'Platform admin required'using errcode='42501';end if;
 perform private.company_team_account(actor,true);
 perform 1 from private.platform_admins where user_id=actor and status='active'for share;
 if not found then raise exception 'Platform admin required'using errcode='42501';end if;
 return actor;
end$$;

create or replace function private.set_platform_company_status(p_company_id uuid,p_expected_status text,p_status text,p_reason text,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c public.companies; receipt private.platform_company_status_audit;
 request jsonb; reason text:=btrim(p_reason); changed boolean;
begin
 perform private.company_team_account(actor,true);
 if not private.has_platform_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
 -- Hold the actual administrator/Auth rows through commit so a revocation or
 -- verification change serializes with an already-authorized operation.
 perform 1 from private.platform_admins a join auth.users u on u.id=a.user_id
  where a.user_id=actor and a.status='active' and u.email_confirmed_at is not null and coalesce(u.is_anonymous,false)=false and coalesce(u.is_sso_user,false)=false
   and (u.banned_until is null or u.banned_until<=now()) for share of a,u;
 if not found then raise exception 'Platform administrator revoked' using errcode='42501'; end if;
 if p_company_id is null or p_request_id is null or p_expected_status is null or p_expected_status not in ('active','suspended')
  or p_status is null or p_status not in ('active','suspended') or reason is null or length(reason) not between 1 and 500 or reason ~ '[[:cntrl:]]' then
  raise exception 'Invalid platform company status request' using errcode='22023'; end if;
 request:=jsonb_build_object('company_id',p_company_id,'expected_status',p_expected_status,'status',p_status,'reason',reason);
 -- Serialize identical actor/nonces before inspecting mutable company status.
 perform pg_advisory_xact_lock(hashtextextended('trafexa-platform-status:'||actor::text||':'||p_request_id::text,0));
 select * into receipt from private.platform_company_status_audit where actor_user_id=actor and request_id=p_request_id;
 if found then
  if receipt.request_payload is distinct from request then raise exception 'Platform request payload conflict' using errcode='40001'; end if;
 else
  select * into c from public.companies where id=p_company_id for update;
  if not found then raise exception 'Company unavailable' using errcode='P0002';end if;
  if c.status is distinct from p_expected_status then raise exception 'Company status conflict' using errcode='40001';end if;
  changed:=c.status is distinct from p_status;
  if changed then update public.companies set status=p_status where id=c.id;end if;
  insert into private.platform_company_status_audit(actor_user_id,company_id,request_id,request_payload,expected_status,previous_status,status,changed,reason)
   values(actor,c.id,p_request_id,request,p_expected_status,c.status,p_status,changed,reason) returning * into receipt;
 end if;
 return jsonb_build_object('company_id',receipt.company_id,'status',receipt.status,'previous_status',receipt.previous_status,
  'changed',receipt.changed,'request_id',receipt.request_id,'actor_user_id',receipt.actor_user_id,'reason',receipt.reason,'created_at',receipt.created_at);
end $$;

create or replace function private.set_platform_web_application_status(p_application_id uuid,p_expected_version integer,p_status text,p_reason text,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();item private.demo_requests;receipt private.web_application_status_audit;payload jsonb;reason text:=btrim(p_reason);changed boolean; previous text;
begin
 perform private.company_team_account(actor,true);
 -- Lock Auth before registry, then the case row, matching revocation-safe order.
 perform 1 from auth.users u where u.id=actor and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
 and not coalesce(u.is_sso_user,false) and (u.banned_until is null or u.banned_until<=now()) for share;
 if not found or current_setting('role',true)<>'authenticated' then raise exception 'Platform administrator required' using errcode='42501';end if;
 perform 1 from private.platform_admins a where a.user_id=actor and a.status='active' for share;
 if not found then raise exception 'Platform administrator required' using errcode='42501';end if;
 if p_application_id is null or p_request_id is null or p_expected_version is null or p_expected_version<1
 or p_status is null or p_status not in ('new','in_review','contacted','closed') or reason is null or length(reason) not between 2 and 500
 or reason ~ '[[:cntrl:]]' then raise exception 'Invalid status request' using errcode='22023';end if;
 payload:=jsonb_build_object('application_id',p_application_id,'expected_version',p_expected_version,'status',p_status,'reason',reason);
 perform pg_advisory_xact_lock(hashtextextended('trafexa-web-application:'||actor::text||':'||p_request_id::text,0));
 select * into receipt from private.web_application_status_audit where actor_user_id=actor and request_id=p_request_id;
 if found then
 if receipt.request_payload is distinct from payload then raise exception 'Application status conflict' using errcode='40001';end if;
 else
 select * into item from private.demo_requests where id=p_application_id for update;
 if not found then raise exception 'Application unavailable' using errcode='P0002';end if;
 if item.version<>p_expected_version then raise exception 'Application status conflict' using errcode='40001';end if;
 previous:=item.status;changed:=item.status<>p_status;
 if changed then update private.demo_requests set status=p_status,version=version+1 where id=item.id returning * into item;end if;
 insert into private.web_application_status_audit(application_id,actor_user_id,request_id,request_payload,previous_status,status,version,reason,changed)
 values(item.id,actor,p_request_id,payload,previous,item.status,item.version,reason,changed) returning * into receipt;
 end if;
 return jsonb_build_object('application_id',receipt.application_id,'actor_user_id',receipt.actor_user_id,'request_id',receipt.request_id,
 'previous_status',receipt.previous_status,'status',receipt.status,'version',receipt.version,'changed',receipt.changed,'reason',receipt.reason,'created_at',receipt.created_at);
end $$;

create or replace function private.erase_platform_web_application(p_application_id uuid,p_expected_version integer,p_reason text,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();item private.demo_requests;receipt private.web_application_erasure_tombstones;
begin
 perform private.company_team_account(actor,true);
 perform 1 from auth.users u where u.id=actor and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
 and not coalesce(u.is_sso_user,false) and (u.banned_until is null or u.banned_until<=now()) for share;
 if not found or current_setting('role',true)<>'authenticated' then raise exception 'Platform administrator required' using errcode='42501';end if;
 perform 1 from private.platform_admins a where a.user_id=actor and a.status='active' for share;
 if not found then raise exception 'Platform administrator required' using errcode='42501';end if;
 if p_application_id is null or p_request_id is null or p_expected_version is null or p_expected_version<1
 or p_reason is null or p_reason not in ('rights_request','no_longer_needed') then raise exception 'Invalid erasure request' using errcode='22023';end if;
 -- Shares intake's ordering lock so an old anonymous nonce cannot resurrect PII.
 perform pg_advisory_xact_lock(97261013);
 select * into receipt from private.web_application_erasure_tombstones where actor_user_id=actor and request_id=p_request_id;
 if found then
  if receipt.application_id<>p_application_id or receipt.expected_version<>p_expected_version or receipt.reason<>p_reason then
   raise exception 'Application erasure conflict' using errcode='40001';end if;
 else
  select * into item from private.demo_requests where id=p_application_id for update;
  if not found then raise exception 'Application unavailable' using errcode='P0002';end if;
  if item.version<>p_expected_version then raise exception 'Application erasure conflict' using errcode='40001';end if;
  insert into private.web_application_erasure_tombstones(application_id,submission_request_id,actor_user_id,request_id,expected_version,reason)
   values(item.id,item.request_id,actor,p_request_id,p_expected_version,p_reason) returning * into receipt;
  delete from private.web_application_status_audit where application_id=item.id;
  delete from private.demo_requests where id=item.id;
 end if;
 return jsonb_build_object('application_id',receipt.application_id,'actor_user_id',receipt.actor_user_id,'request_id',receipt.request_id,
 'expected_version',receipt.expected_version,'erased',true,'reason',receipt.reason,'created_at',receipt.created_at);
end $$;

-- Blank email identities are never verified email accounts. Apply the same
-- condition to modern identities and tenant RLS as to platform entrypoints.
create or replace function private.company_team_account(p_user_id uuid,p_lock boolean) returns text language plpgsql security invoker set search_path='' as $$
declare u auth.users%rowtype; approval_status text; platform_status text; begin
 if p_lock then select * into u from auth.users where id=p_user_id for share;
 else select * into u from auth.users where id=p_user_id;end if;
 if not found or u.email_confirmed_at is null or coalesce(u.is_anonymous,false) or coalesce(u.is_sso_user,false)
 or (u.banned_until is not null and u.banned_until>clock_timestamp()) or u.email is null or btrim(u.email)=''
 or (select count(*) from auth.users x where lower(btrim(x.email))=lower(btrim(u.email)) and not coalesce(x.is_sso_user,false) and not coalesce(x.is_anonymous,false))<>1 then raise exception 'Verified unique account required' using errcode='42501';end if;
 if p_lock then select status into approval_status from private.account_approvals where user_id=p_user_id for share;
 else select status into approval_status from private.account_approvals where user_id=p_user_id;end if;
 if p_lock then select status into platform_status from private.platform_admins where user_id=p_user_id for share;
 else select status into platform_status from private.platform_admins where user_id=p_user_id;end if;
 if approval_status is distinct from 'approved' and platform_status is distinct from 'active' then raise exception 'Superadmin account approval required' using errcode='42501';end if;
 return lower(btrim(u.email));
end $$;
create or replace function private.has_account_access() returns boolean language sql stable security definer set search_path='' as $$
 select current_setting('role',true)='authenticated' and exists(
 select 1 from auth.users u where u.id=auth.uid() and u.email is not null and btrim(u.email)<>'' and u.email_confirmed_at is not null
 and not coalesce(u.is_anonymous,false) and not coalesce(u.is_sso_user,false)
 and (u.banned_until is null or u.banned_until<=now())
 and (select count(*) from auth.users x where lower(btrim(x.email))=lower(btrim(u.email)) and not coalesce(x.is_anonymous,false) and not coalesce(x.is_sso_user,false))=1
 and (private.has_platform_admin() or exists(select 1 from private.account_approvals a where a.user_id=u.id and a.status='approved')));
$$;
commit;
