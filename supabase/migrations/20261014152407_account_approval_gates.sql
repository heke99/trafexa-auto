begin;
-- All tenant RLS and legacy tenant RPCs use this central guard.
create or replace function private.has_company_role(target uuid,allowed_roles text[] default array['owner','admin','sales','finance','viewer']) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_account_access() and exists(select 1 from public.memberships m join public.companies c on c.id=m.company_id
 where m.company_id=target and m.user_id=auth.uid() and m.status='active' and c.status='active' and m.role=any(allowed_roles));
$$;
-- All modern team, CRM, ads, offer-review and trade-in RPCs use this identity.
-- The Auth SHARE lock serializes approval absent-row decisions against review;
-- the approval SHARE lock serializes existing status against suspension.
create or replace function private.company_team_account(p_user_id uuid,p_lock boolean) returns text language plpgsql security invoker set search_path='' as $$
declare u auth.users%rowtype; approval_status text; platform_status text; begin
 if p_lock then select * into u from auth.users where id=p_user_id for share;
 else select * into u from auth.users where id=p_user_id;end if;
 if not found or u.email_confirmed_at is null or coalesce(u.is_anonymous,false) or coalesce(u.is_sso_user,false)
 or (u.banned_until is not null and u.banned_until>clock_timestamp()) or u.email is null
 or (select count(*) from auth.users x where lower(btrim(x.email))=lower(btrim(u.email)) and not coalesce(x.is_sso_user,false) and not coalesce(x.is_anonymous,false))<>1 then raise exception 'Verified unique account required' using errcode='42501';end if;
 if p_lock then select status into approval_status from private.account_approvals where user_id=p_user_id for share;
 else select status into approval_status from private.account_approvals where user_id=p_user_id;end if;
 if p_lock then select status into platform_status from private.platform_admins where user_id=p_user_id for share;
 else select status into platform_status from private.platform_admins where user_id=p_user_id;end if;
 if approval_status is distinct from 'approved' and platform_status is distinct from 'active' then raise exception 'Superadmin account approval required' using errcode='42501';end if;
 return lower(btrim(u.email));
end $$;
create or replace function private.create_company(company_name text,org_number text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;actor uuid;begin
 select user_id into actor from private.company_team_identity(true);
 if not private.has_account_access() then raise exception 'Superadmin account approval required' using errcode='42501';end if;
 insert into public.companies(name,organisation_number,created_by) values(trim(company_name),org_number,actor) returning id into result;
 insert into public.memberships(company_id,user_id,role) values(result,actor,'owner');return result;
end $$;
-- Finance-provider catalogs also require approved account access.
alter policy partners_read on public.finance_partners using(private.has_account_access() and exists(select 1 from public.memberships m where m.user_id=auth.uid() and m.status='active'));
-- Close both public and directly callable private activation entrypoints.
alter function private.claim_platform_admin_access() rename to claim_platform_admin_access_approved_impl;
revoke all on function private.claim_platform_admin_access_approved_impl() from public,anon,authenticated,service_role;
create function private.claim_platform_admin_access() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform 1 from private.company_team_identity(true);
 if not private.has_account_access() then raise exception 'Superadmin approval required before reserved activation' using errcode='42501';end if;
 return private.claim_platform_admin_access_approved_impl();
end $$;
revoke all on function private.claim_platform_admin_access() from public,anon,service_role;
grant execute on function private.claim_platform_admin_access() to authenticated;
-- Recreate SQL-facing wrapper to ensure its dependency resolves the new guard.
create or replace function public.claim_platform_admin_access() returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'authenticated' then raise exception 'Authenticated user required' using errcode='42501';end if;
 return private.claim_platform_admin_access();
end $$;
commit;
