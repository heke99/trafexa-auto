begin;
create function private.get_account_access() returns jsonb language plpgsql security definer set search_path='' as $$
declare u auth.users%rowtype; a private.account_approvals%rowtype; admin boolean; begin
 if current_setting('role',true)<>'authenticated' or auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into u from auth.users where id=auth.uid();
 if not found or coalesce(u.is_anonymous,false) or coalesce(u.is_sso_user,false) or u.email is null or (u.banned_until is not null and u.banned_until>clock_timestamp()) then raise exception 'Account denied' using errcode='42501'; end if;
 select * into a from private.account_approvals where user_id=u.id;
 admin:=private.has_platform_admin();
 return jsonb_build_object('userId',u.id,'email',u.email,'emailVerified',u.email_confirmed_at is not null,'status',case when admin then 'approved' else coalesce(a.status,'pending') end,'version',coalesce(a.version,0),'isPlatformAdmin',admin);
end $$;
create function private.list_platform_accounts(p_filter text,p_page_key uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
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
 'status',private.account_effective_status(u.id),'version',coalesce(a.version,0),'isPlatformAdmin',exists(select 1 from private.platform_admins pa where pa.user_id=u.id and pa.status='active')) j
 from auth.users u left join private.account_approvals a on a.user_id=u.id
 where u.email is not null and not coalesce(u.is_anonymous,false) and not coalesce(u.is_sso_user,false)
 and (p_filter='all' or private.account_effective_status(u.id)=p_filter)
 and (p_page_key is null or (u.created_at,u.id)<(cursor_date,p_page_key))
 order by u.created_at desc,u.id desc limit p_limit+1) page;
 if jsonb_array_length(items)>p_limit then next_key:=(items->(p_limit-1)->>'userId')::uuid;items:=items-p_limit;end if;
 if private.account_approval_admin_identity()<>actor then raise exception 'Admin changed' using errcode='42501';end if;
 return jsonb_build_object('actorUserId',actor,'accounts',items,'nextPageKey',next_key);
end $$;
revoke all on function private.get_account_access() from public,anon,service_role;
grant execute on function private.get_account_access() to authenticated;
create function public.get_account_access() returns jsonb language sql security invoker set search_path='' as $$select private.get_account_access();$$;
revoke all on function public.get_account_access() from public,anon,service_role;
grant execute on function public.get_account_access() to authenticated;
revoke all on function private.list_platform_accounts(text,uuid,integer) from public,anon,service_role;
grant execute on function private.list_platform_accounts(text,uuid,integer) to authenticated;
create function public.list_platform_accounts(p_filter text default 'pending',p_page_key uuid default null,p_limit integer default 50) returns jsonb language sql security invoker set search_path='' as $$select private.list_platform_accounts(p_filter,p_page_key,p_limit);$$;
revoke all on function public.list_platform_accounts(text,uuid,integer) from public,anon,service_role;
grant execute on function public.list_platform_accounts(text,uuid,integer) to authenticated;
commit;
