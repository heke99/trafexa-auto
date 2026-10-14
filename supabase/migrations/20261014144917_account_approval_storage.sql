begin;
-- Absence is pending. Registration, verified email and dealer roles confer no approval.
create table private.account_approvals(
 user_id uuid primary key references auth.users(id),
 status text not null check(status in ('pending','approved','rejected','suspended')),
 version integer not null default 1 check(version>0),
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default clock_timestamp()
);
create table private.account_approval_audit(
 id uuid primary key default gen_random_uuid(),actor_user_id uuid not null references auth.users(id),
 user_id uuid not null references auth.users(id),request_id uuid not null,
 payload jsonb not null,receipt jsonb not null,reason text not null check(length(reason) between 2 and 500 and reason=btrim(reason) and reason !~ '[[:cntrl:]]'),
 created_at timestamptz not null default clock_timestamp(),unique(actor_user_id,request_id)
);
create index account_approval_audit_user on private.account_approval_audit(user_id,created_at desc);
alter table private.account_approvals enable row level security;
alter table private.account_approval_audit enable row level security;
revoke all on private.account_approvals,private.account_approval_audit from public,anon,authenticated,service_role;
create function private.reject_account_approval_audit_mutation() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Immutable account approval audit' using errcode='42501'; end $$;
revoke all on function private.reject_account_approval_audit_mutation() from public,anon,authenticated,service_role;
create trigger immutable_account_approval_audit before update or delete on private.account_approval_audit for each row execute function private.reject_account_approval_audit_mutation();
-- The actual private UUID registry grants only the established platform-admin bypass.
-- Approval by itself never grants an administrator role or a company membership.
create function private.has_account_access() returns boolean language sql stable security definer set search_path='' as $$
 select current_setting('role',true)='authenticated' and exists(
 select 1 from auth.users u where u.id=auth.uid() and u.email is not null and u.email_confirmed_at is not null
 and not coalesce(u.is_anonymous,false) and not coalesce(u.is_sso_user,false)
 and (u.banned_until is null or u.banned_until<=now())
 and (select count(*) from auth.users x where lower(btrim(x.email))=lower(btrim(u.email)) and not coalesce(x.is_anonymous,false) and not coalesce(x.is_sso_user,false))=1
 and (private.has_platform_admin() or exists(select 1 from private.account_approvals a where a.user_id=u.id and a.status='approved')));
$$;
revoke all on function private.has_account_access() from public,anon,service_role;
grant execute on function private.has_account_access() to authenticated;
-- Auth first, then private registry, then target Auth, then approval. Approval rows
-- are locked in business mutation identity checks to serialize suspension.
create function private.account_approval_admin_identity() returns uuid language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); begin
 if current_setting('role',true)<>'authenticated' or actor is null then raise exception 'Platform admin required' using errcode='42501'; end if;
 perform 1 from auth.users where id=actor for share;
 perform 1 from private.platform_admins where user_id=actor and status='active' for share;
 if not private.has_platform_admin() then raise exception 'Platform admin required' using errcode='42501'; end if;
 return actor;
end $$;
revoke all on function private.account_approval_admin_identity() from public,anon,authenticated,service_role;
create function private.account_effective_status(p_user_id uuid) returns text language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from private.platform_admins pa join auth.users u on u.id=pa.user_id where pa.user_id=p_user_id and pa.status='active' and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and not coalesce(u.is_sso_user,false) and (u.banned_until is null or u.banned_until<=now())) then 'approved' else coalesce((select a.status from private.account_approvals a where a.user_id=p_user_id),'pending') end;
$$;
revoke all on function private.account_effective_status(uuid) from public,anon,authenticated,service_role;
commit;
