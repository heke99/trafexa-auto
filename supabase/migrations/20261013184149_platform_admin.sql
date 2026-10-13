-- Trafexa platform administration is distinct from every dealer membership role.
-- The allowlist starts EMPTY. Only trusted postgres bootstrap can populate it
-- after an independently verified auth.users UUID has been approved.
begin;

create table private.platform_admins (
 user_id uuid primary key references auth.users(id),
 status text not null default 'active' check(status in ('active','suspended')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index platform_admins_creator_idx on private.platform_admins(created_by);
alter table private.platform_admins enable row level security;
revoke all on private.platform_admins from public,anon,authenticated,service_role;

create function private.touch_platform_admin() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 new.updated_at:=clock_timestamp();
 return new;
end $$;
revoke all on function private.touch_platform_admin() from public,anon,authenticated,service_role;
create trigger platform_admin_updated_at before update on private.platform_admins
 for each row execute function private.touch_platform_admin();

-- Trust the actual authenticated UUID, registry row and Auth catalog only.
-- Dealer owner status, email/domain strings and user-editable JWT metadata are
-- deliberately absent from this authorization decision.
create function private.has_platform_admin() returns boolean
 language sql stable security definer set search_path='' as $$
 select current_setting('role',true)='authenticated' and auth.uid() is not null and exists (
  select 1 from private.platform_admins a join auth.users u on u.id=a.user_id
  where a.user_id=(select auth.uid()) and a.status='active' and u.email_confirmed_at is not null
    and coalesce(u.is_anonymous,false)=false and coalesce(u.is_sso_user,false)=false and (u.banned_until is null or u.banned_until<=now())
 );
$$;
revoke all on function private.has_platform_admin() from public,anon,service_role;
grant execute on function private.has_platform_admin() to authenticated;

create table private.platform_company_status_audit (
 id uuid primary key default gen_random_uuid(),
 actor_user_id uuid not null references auth.users(id),
 company_id uuid not null references public.companies(id),
 request_id uuid not null,
 request_payload jsonb not null,
 expected_status text not null check(expected_status in ('active','suspended')),
 previous_status text not null check(previous_status in ('active','suspended')),
 status text not null check(status in ('active','suspended')),
 changed boolean not null,
 reason text not null check(length(reason) between 1 and 500 and reason=btrim(reason) and reason !~ '[[:cntrl:]]'),
 created_at timestamptz not null default clock_timestamp(),
 unique(actor_user_id,request_id)
);
create index platform_company_status_audit_company_idx on private.platform_company_status_audit(company_id,created_at desc);
alter table private.platform_company_status_audit enable row level security;
revoke all on private.platform_company_status_audit from public,anon,authenticated,service_role;
create function private.reject_platform_audit_mutation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 raise exception 'Platform status audit is immutable' using errcode='55000';
end $$;
revoke all on function private.reject_platform_audit_mutation() from public,anon,authenticated,service_role;
create trigger immutable_platform_status_audit before update or delete on private.platform_company_status_audit
 for each row execute function private.reject_platform_audit_mutation();

create function public.get_platform_admin_session() returns jsonb
 language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'authenticated' or auth.uid() is null then raise exception 'Authenticated user required' using errcode='42501'; end if;
 return jsonb_build_object('is_platform_admin',private.has_platform_admin(),'user_id',auth.uid());
end $$;
revoke all on function public.get_platform_admin_session() from public,anon,service_role;
grant execute on function public.get_platform_admin_session() to authenticated;

create function private.list_platform_companies(p_search text,p_page_key uuid,p_limit integer) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare query text:=btrim(coalesce(p_search,'')); items jsonb:='[]'; item record; count integer:=0; last_id uuid; more boolean:=false;
begin
 if not private.has_platform_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
 if p_limit is null or p_limit not between 1 and 50 or length(query)>160 or query ~ '[[:cntrl:]]' then
  raise exception 'Invalid company page' using errcode='22023'; end if;
 for item in select c.id,c.name,c.organisation_number,c.status,c.created_at,
   (select count(*) from public.memberships m where m.company_id=c.id) as membership_count,
   (select count(*) from public.stock_items s where s.company_id=c.id) as stock_count
  from public.companies c
  where (p_page_key is null or c.id>p_page_key)
    and (query='' or position(lower(query) in lower(c.name))>0 or position(query in c.organisation_number)>0)
  order by c.id limit p_limit+1
 loop
  if count=p_limit then more:=true;exit;end if;
  items:=items||jsonb_build_array(to_jsonb(item)); last_id:=item.id; count:=count+1;
 end loop;
 return jsonb_build_object('companies',items,'next_page_key',case when more then last_id else null end);
end $$;
revoke all on function private.list_platform_companies(text,uuid,integer) from public,anon,service_role;
grant execute on function private.list_platform_companies(text,uuid,integer) to authenticated;
create function public.list_platform_companies(p_search text default '',p_page_key uuid default null,p_limit integer default 50) returns jsonb
 language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'authenticated' then raise exception 'Authenticated user required' using errcode='42501'; end if;
 return private.list_platform_companies(p_search,p_page_key,p_limit);
end $$;
revoke all on function public.list_platform_companies(text,uuid,integer) from public,anon,service_role;
grant execute on function public.list_platform_companies(text,uuid,integer) to authenticated;

create function private.list_platform_contact_requests(p_page_key uuid,p_limit integer) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare items jsonb:='[]'; item record; count integer:=0; last_id uuid; cursor_time timestamptz; more boolean:=false;
begin
 if not private.has_platform_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid contact page' using errcode='22023';end if;
 if p_page_key is not null then
  select created_at into cursor_time from private.demo_requests where id=p_page_key;
  if not found then raise exception 'Contact cursor unavailable' using errcode='22023';end if;
 end if;
 for item in select d.id,d.name,d.email,d.company,d.phone,d.message,d.created_at from private.demo_requests d
  where p_page_key is null or (d.created_at,d.id)<(cursor_time,p_page_key)
  order by d.created_at desc,d.id desc limit p_limit+1
 loop
  if count=p_limit then more:=true;exit;end if;
  items:=items||jsonb_build_array(to_jsonb(item)); last_id:=item.id; count:=count+1;
 end loop;
 return jsonb_build_object('requests',items,'next_page_key',case when more then last_id else null end);
end $$;
revoke all on function private.list_platform_contact_requests(uuid,integer) from public,anon,service_role;
grant execute on function private.list_platform_contact_requests(uuid,integer) to authenticated;
create function public.list_platform_contact_requests(p_page_key uuid default null,p_limit integer default 50) returns jsonb
 language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'authenticated' then raise exception 'Authenticated user required' using errcode='42501'; end if;
 return private.list_platform_contact_requests(p_page_key,p_limit);
end $$;
revoke all on function public.list_platform_contact_requests(uuid,integer) from public,anon,service_role;
grant execute on function public.list_platform_contact_requests(uuid,integer) to authenticated;

create function private.set_platform_company_status(p_company_id uuid,p_expected_status text,p_status text,p_reason text,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c public.companies; receipt private.platform_company_status_audit;
 request jsonb; reason text:=btrim(p_reason); changed boolean;
begin
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
revoke all on function private.set_platform_company_status(uuid,text,text,text,uuid) from public,anon,service_role;
grant execute on function private.set_platform_company_status(uuid,text,text,text,uuid) to authenticated;
create function public.set_platform_company_status(p_company_id uuid,p_expected_status text,p_status text,p_reason text,p_request_id uuid) returns jsonb
 language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'authenticated' then raise exception 'Authenticated user required' using errcode='42501';end if;
 return private.set_platform_company_status(p_company_id,p_expected_status,p_status,p_reason,p_request_id);
end $$;
revoke all on function public.set_platform_company_status(uuid,text,text,text,uuid) from public,anon,service_role;
grant execute on function public.set_platform_company_status(uuid,text,text,text,uuid) to authenticated;

-- Optional one-time bootstrap reservations are also EMPTY in this migration.
-- Trusted postgres can reserve an explicitly approved exact email. Activation
-- converts that reservation to a permanent UUID allowlist entry after Auth has
-- verified that unique non-SSO user; subsequent operations never grant by email.
create table private.platform_admin_bootstrap_reservations (
 id uuid primary key default gen_random_uuid(),
 email text not null unique check(email=lower(btrim(email)) and length(email) between 3 and 254
   and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
 status text not null default 'active' check(status in ('active','suspended')),
 approval_reference text not null check(length(approval_reference) between 1 and 500 and approval_reference !~ '[[:cntrl:]]'),
 approved_by text not null default session_user,
 created_at timestamptz not null default now(),
 claimed_by uuid unique references auth.users(id),
 claimed_at timestamptz,
 check((claimed_by is null and claimed_at is null) or (claimed_by is not null and claimed_at is not null))
);
alter table private.platform_admin_bootstrap_reservations enable row level security;
revoke all on private.platform_admin_bootstrap_reservations from public,anon,authenticated,service_role;
create table private.platform_admin_bootstrap_audit (
 id uuid primary key default gen_random_uuid(),
 reservation_id uuid not null unique references private.platform_admin_bootstrap_reservations(id),
 user_id uuid not null references auth.users(id),
 email text not null,
 action text not null default 'claimed' check(action='claimed'),
 created_at timestamptz not null default clock_timestamp()
);
create index platform_admin_bootstrap_audit_user_idx on private.platform_admin_bootstrap_audit(user_id);
alter table private.platform_admin_bootstrap_audit enable row level security;
revoke all on private.platform_admin_bootstrap_audit from public,anon,authenticated,service_role;
create trigger immutable_platform_bootstrap_audit before update or delete on private.platform_admin_bootstrap_audit
 for each row execute function private.reject_platform_audit_mutation();

create function private.claim_platform_admin_access() returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); u auth.users; reservation private.platform_admin_bootstrap_reservations; normalized_email text;
begin
 if current_setting('role',true) is distinct from 'authenticated' or actor is null then
  raise exception 'Platform activation unavailable' using errcode='42501';end if;
 select * into u from auth.users where id=actor for share;
 if not found or u.email_confirmed_at is null or coalesce(u.is_anonymous,false) or coalesce(u.is_sso_user,false)
  or (u.banned_until is not null and u.banned_until>now()) or u.email is null then
  raise exception 'Platform activation unavailable' using errcode='42501';end if;
 if private.has_platform_admin() then return jsonb_build_object('is_platform_admin',true,'user_id',actor,'claimed',false);end if;
 -- A suspended/deleted allowlist entry is never restored through email bootstrap.
 if exists(select 1 from private.platform_admins where user_id=actor) then raise exception 'Platform activation unavailable' using errcode='42501';end if;
 normalized_email:=lower(btrim(u.email));
 select * into reservation from private.platform_admin_bootstrap_reservations where email=normalized_email for update;
 if not found or reservation.status<>'active' then raise exception 'Platform activation unavailable' using errcode='42501';end if;
 if reservation.claimed_by is not null then
  -- Another simultaneous call from this UUID may have committed while this
  -- transaction waited for the reservation row. Recheck the fixed allowlist.
  if reservation.claimed_by=actor and private.has_platform_admin() then
   return jsonb_build_object('is_platform_admin',true,'user_id',actor,'claimed',false);
  end if;
  raise exception 'Platform activation unavailable' using errcode='42501';
 end if;
 if (select count(*) from auth.users candidate where lower(btrim(candidate.email))=normalized_email
   and candidate.email_confirmed_at is not null and coalesce(candidate.is_anonymous,false)=false and coalesce(candidate.is_sso_user,false)=false)<>1 then
  raise exception 'Platform activation unavailable' using errcode='42501';end if;
 insert into private.platform_admins(user_id,status,created_by) values(actor,'active',actor);
 update private.platform_admin_bootstrap_reservations set claimed_by=actor,claimed_at=clock_timestamp() where id=reservation.id;
 insert into private.platform_admin_bootstrap_audit(reservation_id,user_id,email) values(reservation.id,actor,reservation.email);
 return jsonb_build_object('is_platform_admin',true,'user_id',actor,'claimed',true);
end $$;
revoke all on function private.claim_platform_admin_access() from public,anon,service_role;
grant execute on function private.claim_platform_admin_access() to authenticated;
create function public.claim_platform_admin_access() returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'authenticated' then raise exception 'Authenticated user required' using errcode='42501';end if;
 return private.claim_platform_admin_access();
end $$;
revoke all on function public.claim_platform_admin_access() from public,anon,service_role;
grant execute on function public.claim_platform_admin_access() to authenticated;

-- No bootstrap INSERT is shipped here. No unapproved email address confers authority.
commit;
