-- Explicit platform-only management of existing non-owner dealer memberships.
-- Account approval, company status and the platform registry remain separate.
begin;
create table private.platform_membership_audit(
 id uuid primary key default gen_random_uuid(),actor_user_id uuid not null references auth.users(id),
 company_id uuid not null references public.companies(id),membership_id uuid not null references public.memberships(id),
 target_user_id uuid not null references auth.users(id),request_id uuid not null,
 payload jsonb not null,receipt jsonb not null,previous_value jsonb not null,current_value jsonb not null,
 reason text not null check(private.company_store_text_valid(reason,1,500,false)),
 created_at timestamptz not null default clock_timestamp(),unique(actor_user_id,request_id)
);
create index platform_membership_audit_company on private.platform_membership_audit(company_id,created_at desc);
create index platform_membership_audit_membership on private.platform_membership_audit(membership_id,created_at desc);
create index platform_membership_audit_target on private.platform_membership_audit(target_user_id,created_at desc);
alter table private.platform_membership_audit enable row level security;
revoke all on private.platform_membership_audit from public,anon,authenticated,service_role;
create trigger immutable_platform_membership_audit before update or delete on private.platform_membership_audit for each row execute function private.reject_company_team_audit_mutation();

create function private.platform_members_admin_identity()returns uuid language plpgsql security invoker set search_path=''as $$
declare a uuid:=auth.uid();s text;begin
 if current_setting('role',true)<>'authenticated'or a is null then raise exception 'Platform admin required'using errcode='42501';end if;
 perform private.company_team_account(a,true);
 select status into s from private.platform_admins where user_id=a for share;
 if s is distinct from 'active'then raise exception 'Platform admin required'using errcode='42501';end if;return a;
end$$;
create function private.platform_member_json(m public.memberships)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('membershipId',m.id,'userId',m.user_id,'email',u.email,'role',m.role,'status',m.status,'version',m.version,
 'companyId',m.company_id,'companyName',c.name,'companyStatus',c.status,'accountStatus',private.account_effective_status(m.user_id),'emailVerified',u.email_confirmed_at is not null,
 'isPlatformAdmin',exists(select 1 from private.platform_admins p where p.user_id=m.user_id))from public.companies c join auth.users u on u.id=m.user_id where c.id=m.company_id;
$$;
create function private.list_platform_company_members(p_company_id uuid,p_page_key uuid,p_limit integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid;c public.companies%rowtype;items jsonb;next_key uuid;begin
 a:=private.platform_members_admin_identity();select *into c from public.companies where id=p_company_id for share;
 if c.id is null then raise exception 'Company unavailable'using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid membership page'using errcode='22023';end if;
 if p_page_key is not null and not exists(select 1 from public.memberships where company_id=p_company_id and id=p_page_key)then raise exception 'Membership cursor conflict'using errcode='40001';end if;
 select coalesce(jsonb_agg(private.platform_member_json(m)order by m.id),'[]')into items from(select *from public.memberships where company_id=p_company_id and(p_page_key is null or id>p_page_key)order by id limit p_limit)m;
 if jsonb_array_length(items)=p_limit and exists(select 1 from public.memberships where company_id=p_company_id and id>(items->(p_limit-1)->>'membershipId')::uuid)then next_key:=(items->(p_limit-1)->>'membershipId')::uuid;end if;
 return jsonb_build_object('companyId',p_company_id,'companyName',c.name,'companyStatus',c.status,'actorUserId',a,'teamVersion',c.team_version,'members',items,'nextPageKey',next_key);
end$$;
create function private.list_platform_account_memberships(p_user_id uuid,p_page_key uuid,p_limit integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid;u auth.users%rowtype;items jsonb;next_key uuid;begin
 a:=private.platform_members_admin_identity();select *into u from auth.users where id=p_user_id for share;
 if u.id is null then raise exception 'Account unavailable'using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid membership page'using errcode='22023';end if;
 if p_page_key is not null and not exists(select 1 from public.memberships where user_id=p_user_id and id=p_page_key)then raise exception 'Membership cursor conflict'using errcode='40001';end if;
 select coalesce(jsonb_agg(private.platform_member_json(m)order by m.id),'[]')into items from(select *from public.memberships where user_id=p_user_id and(p_page_key is null or id>p_page_key)order by id limit p_limit)m;
 if jsonb_array_length(items)=p_limit and exists(select 1 from public.memberships where user_id=p_user_id and id>(items->(p_limit-1)->>'membershipId')::uuid)then next_key:=(items->(p_limit-1)->>'membershipId')::uuid;end if;
 return jsonb_build_object('userId',p_user_id,'actorUserId',a,'email',u.email,'accountStatus',private.account_effective_status(u.id),'emailVerified',u.email_confirmed_at is not null,'memberships',items,'nextPageKey',next_key);
end$$;
create function private.update_platform_company_member(p_company_id uuid,p_membership_id uuid,p_expected_version integer,p_role text,p_status text,p_reason text,p_request_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid;target_user uuid;target_auth auth.users%rowtype;m public.memberships%rowtype;company_status text;tv integer;payload jsonb;receipt jsonb;prior private.platform_membership_audit%rowtype;old_m jsonb;begin
 a:=private.platform_members_admin_identity();
 if p_company_id is null or p_membership_id is null or p_request_id is null or p_expected_version is null or p_expected_version not between 1 and 2147483646 or p_role is null or p_role not in('admin','sales','finance','viewer')or p_status is null or p_status not in('active','suspended')or not private.company_store_text_valid(p_reason,1,500,false)then raise exception 'Invalid platform membership review'using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company_id,'membershipId',p_membership_id,'expectedVersion',p_expected_version,'role',p_role,'status',p_status,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended('platform-membership:'||a::text||':'||p_request_id::text,0));
 select *into prior from private.platform_membership_audit where actor_user_id=a and request_id=p_request_id;
 if found then if prior.payload is distinct from payload then raise exception 'Platform membership payload conflict'using errcode='40001';end if;return prior.receipt;end if;
 select user_id into target_user from public.memberships where id=p_membership_id and company_id=p_company_id;
 if target_user is null then raise exception 'Membership unavailable'using errcode='42501';end if;
 -- Reject known protected identities before exclusive cross-user Auth locks.
 -- Recheck under the target Auth lock; FK KEY SHARE locks serialize new registry
 -- or absent approval inserts against activation and protection decisions.
 if target_user=a or exists(select 1 from private.platform_admins where user_id=target_user)then raise exception 'Protected platform membership'using errcode='42501';end if;
 select *into target_auth from auth.users where id=target_user for update;
 perform 1 from private.account_approvals where user_id=target_user for share;
 perform 1 from private.platform_admins where user_id=target_user for share;
 if found then raise exception 'Protected platform membership'using errcode='42501';end if;
 if private.platform_members_admin_identity()<>a then raise exception 'Platform admin changed'using errcode='42501';end if;
 select status into company_status from public.companies where id=p_company_id for update;
 if company_status is null then raise exception 'Company unavailable'using errcode='42501';end if;
 perform 1 from public.memberships where company_id=p_company_id order by id for update;
 select *into m from public.memberships where id=p_membership_id and company_id=p_company_id;
 if m.id is null or m.user_id is distinct from target_user then raise exception 'Membership identity conflict'using errcode='40001';end if;
 if m.role='owner'then raise exception 'Owner membership is protected'using errcode='42501';end if;
 if m.version<>p_expected_version then raise exception 'Membership version conflict'using errcode='40001';end if;
 if m.role=p_role and m.status=p_status then raise exception 'Membership change required'using errcode='22023';end if;
 if p_status='active'then
 if company_status<>'active'then raise exception 'Active company required'using errcode='42501';end if;
 perform private.company_team_account(target_user,true);
 end if;
 old_m:=to_jsonb(m);update public.memberships set role=p_role,status=p_status,version=version+1 where id=m.id returning *into m;
 update public.companies set team_version=team_version+1 where id=p_company_id returning team_version into tv;
 receipt:=jsonb_build_object('companyId',p_company_id,'actorUserId',a,'requestId',p_request_id,'teamVersion',tv,'member',private.platform_member_json(m));
 insert into private.platform_membership_audit(actor_user_id,company_id,membership_id,target_user_id,request_id,payload,receipt,previous_value,current_value,reason)values(a,p_company_id,m.id,target_user,p_request_id,payload,receipt,old_m,to_jsonb(m),p_reason);return receipt;
end$$;
revoke all on function private.platform_members_admin_identity(),private.platform_member_json(public.memberships)from public,anon,authenticated,service_role;
revoke all on function private.list_platform_company_members(uuid,uuid,integer),private.list_platform_account_memberships(uuid,uuid,integer),private.update_platform_company_member(uuid,uuid,integer,text,text,text,uuid)from public,anon,authenticated,service_role;
grant execute on function private.list_platform_company_members(uuid,uuid,integer),private.list_platform_account_memberships(uuid,uuid,integer),private.update_platform_company_member(uuid,uuid,integer,text,text,text,uuid)to authenticated;
create function public.list_platform_company_members(p_company_id uuid,p_page_key uuid default null,p_limit integer default 50)returns jsonb language sql security invoker set search_path=''as $$select private.list_platform_company_members(p_company_id,p_page_key,p_limit)$$;
create function public.list_platform_account_memberships(p_user_id uuid,p_page_key uuid default null,p_limit integer default 50)returns jsonb language sql security invoker set search_path=''as $$select private.list_platform_account_memberships(p_user_id,p_page_key,p_limit)$$;
create function public.update_platform_company_member(p_company_id uuid,p_membership_id uuid,p_expected_version integer,p_role text,p_status text,p_reason text,p_request_id uuid)returns jsonb language sql security invoker set search_path=''as $$select private.update_platform_company_member(p_company_id,p_membership_id,p_expected_version,p_role,p_status,p_reason,p_request_id)$$;
revoke all on function public.list_platform_company_members(uuid,uuid,integer),public.list_platform_account_memberships(uuid,uuid,integer),public.update_platform_company_member(uuid,uuid,integer,text,text,text,uuid)from public,anon,authenticated,service_role;
grant execute on function public.list_platform_company_members(uuid,uuid,integer),public.list_platform_account_memberships(uuid,uuid,integer),public.update_platform_company_member(uuid,uuid,integer,text,text,text,uuid)to authenticated;

-- Align the existing account page protection flag with its existing mutation guard.
create or replace function private.list_platform_accounts(p_filter text,p_page_key uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; cursor_date timestamptz; items jsonb; next_key uuid; begin
 actor:=private.account_approval_admin_identity();
 if p_filter is null or p_filter not in ('all','pending','approved','rejected','suspended') or p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid account page' using errcode='22023'; end if;
 if p_page_key is not null then
  select u.created_at into cursor_date from auth.users u left join private.account_approvals a on a.user_id=u.id
  where u.id=p_page_key and u.email is not null and not coalesce(u.is_anonymous,false) and not coalesce(u.is_sso_user,false)
   and (p_filter='all' or private.account_effective_status(u.id)=p_filter);
  if not found then raise exception 'Account cursor changed' using errcode='40001'; end if;
 end if;
 select coalesce(jsonb_agg(j order by created_at desc,id desc),'[]') into items from(
 select u.id,u.created_at,jsonb_build_object('userId',u.id,'name',case when jsonb_typeof(u.raw_user_meta_data->'name')='string' then nullif(left(btrim(regexp_replace(u.raw_user_meta_data->>'name','[[:cntrl:]]','','g')),160),'') else null end,
 'email',u.email,'emailVerified',u.email_confirmed_at is not null,'createdAt',u.created_at,
 'status',private.account_effective_status(u.id),'version',coalesce(a.version,0),'isPlatformAdmin',exists(select 1 from private.platform_admins pa where pa.user_id=u.id)) j
 from auth.users u left join private.account_approvals a on a.user_id=u.id
 where u.email is not null and not coalesce(u.is_anonymous,false) and not coalesce(u.is_sso_user,false)
 and (p_filter='all' or private.account_effective_status(u.id)=p_filter)
 and (p_page_key is null or (u.created_at,u.id)<(cursor_date,p_page_key))
 order by u.created_at desc,u.id desc limit p_limit+1) page;
 if jsonb_array_length(items)>p_limit then next_key:=(items->(p_limit-1)->>'userId')::uuid;items:=items-p_limit;end if;
 if private.account_approval_admin_identity()<>actor then raise exception 'Admin changed' using errcode='42501';end if;
 return jsonb_build_object('actorUserId',actor,'accounts',items,'nextPageKey',next_key);
end $$;
commit;
