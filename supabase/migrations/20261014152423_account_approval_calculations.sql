begin;
create or replace function private.vehicle_calculation_authorize(p_company_id uuid,p_write boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); account auth.users; company_status text; member_role text;
begin
 if actor is null or current_setting('role',true)<>'authenticated' then raise exception 'Financial source unavailable' using errcode='42501'; end if;
 perform private.company_team_account(actor,p_write);
 if not private.has_account_access() then raise exception 'Superadmin account approval required' using errcode='42501';end if;
 if p_write then
  -- Match the team/advertising order. Revocation cannot pass a waiting metadata
  -- write: each actual account/company/member proof stays locked until commit.
  select * into account from auth.users u where u.id=actor for share;
  select c.status into company_status from public.companies c where c.id=p_company_id for update;
  select m.role into member_role from public.memberships m where m.company_id=p_company_id and m.user_id=actor and m.status='active' for share;
 else
  select * into account from auth.users u where u.id=actor;
  select c.status into company_status from public.companies c where c.id=p_company_id;
  select m.role into member_role from public.memberships m where m.company_id=p_company_id and m.user_id=actor and m.status='active';
 end if;
 if account.id is null or coalesce(account.is_anonymous,false) or account.email is null or account.email_confirmed_at is null
  or (account.banned_until is not null and account.banned_until>clock_timestamp())
  or company_status is distinct from 'active' or member_role is null
  or not member_role=any(case when p_write then array['owner','admin','sales'] else array['owner','admin','sales','finance','viewer'] end)
 then raise exception 'Financial source unavailable' using errcode='42501'; end if;
 return actor;
end $$;
commit;
