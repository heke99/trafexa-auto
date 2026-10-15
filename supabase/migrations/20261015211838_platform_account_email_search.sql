begin;
create function private.search_platform_accounts(p_filter text,p_query text,p_cursor jsonb,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; cursor_date timestamptz; items jsonb; next_key uuid; p_page_key uuid; begin
 actor:=private.account_approval_admin_identity();
 if p_filter is null or p_filter not in ('all','pending','approved','rejected','suspended') or p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid account page' using errcode='22023'; end if;
 if p_query is null or length(p_query)>254 or p_query<>lower(btrim(p_query)) or p_query ~ '[[:space:][:cntrl:]]' or p_query ~ ('['||chr(128)||'-'||chr(159)||']') then raise exception 'Invalid account search' using errcode='22023';end if;
 if p_cursor is not null then
  if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>2048 or jsonb_typeof(p_cursor->'createdAt')is distinct from 'string' or (select count(*)from jsonb_object_keys(p_cursor))<>5 or not(p_cursor?&array['actorId','filter','query','id','createdAt']) or p_cursor->>'actorId' is distinct from actor::text or p_cursor->>'filter' is distinct from p_filter or p_cursor->>'query' is distinct from p_query or jsonb_typeof(p_cursor->'id')is distinct from 'string' or p_cursor->>'id'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Account search cursor changed'using errcode='40001';end if;
  p_page_key:=(p_cursor->>'id')::uuid;
 end if;
 if p_page_key is not null then
  select u.created_at into cursor_date from auth.users u left join private.account_approvals a on a.user_id=u.id
  where u.id=p_page_key and u.email is not null and not coalesce(u.is_anonymous,false) and not coalesce(u.is_sso_user,false)
   and (p_filter='all' or private.account_effective_status(u.id)=p_filter) and strpos(lower(u.email),p_query)>0;
  if found and p_cursor->>'createdAt' is distinct from to_jsonb(cursor_date)#>>'{}' then raise exception 'Account search cursor changed'using errcode='40001';end if;
  if not found then raise exception 'Account cursor changed' using errcode='40001'; end if;
 end if;
 select coalesce(jsonb_agg(j order by created_at desc,id desc),'[]') into items from(
 select u.id,u.created_at,jsonb_build_object('userId',u.id,'name',case when jsonb_typeof(u.raw_user_meta_data->'name')='string' then nullif(left(btrim(regexp_replace(u.raw_user_meta_data->>'name','[[:cntrl:]]','','g')),160),'') else null end,
 'email',u.email,'emailVerified',u.email_confirmed_at is not null,'createdAt',u.created_at,
 'status',private.account_effective_status(u.id),'version',coalesce(a.version,0),'isPlatformAdmin',exists(select 1 from private.platform_admins pa where pa.user_id=u.id)) j
 from auth.users u left join private.account_approvals a on a.user_id=u.id
 where u.email is not null and not coalesce(u.is_anonymous,false) and not coalesce(u.is_sso_user,false)
 and (p_filter='all' or private.account_effective_status(u.id)=p_filter)
 and strpos(lower(u.email),p_query)>0
 and (p_page_key is null or (u.created_at,u.id)<(cursor_date,p_page_key))
 order by u.created_at desc,u.id desc limit p_limit+1) page;
 if jsonb_array_length(items)>p_limit then next_key:=(items->(p_limit-1)->>'userId')::uuid;items:=items-p_limit;end if;
 if private.account_approval_admin_identity()<>actor then raise exception 'Admin changed' using errcode='42501';end if;
 return jsonb_build_object('actorUserId',actor,'accounts',items,'filter',p_filter,'query',p_query,'nextCursor',case when next_key is not null then jsonb_build_object('actorId',actor,'filter',p_filter,'query',p_query,'id',next_key,'createdAt',items->(p_limit-1)->>'createdAt') else null end);
end $$;
revoke all on function private.search_platform_accounts(text,text,jsonb,integer)from public,anon,authenticated,service_role;
grant execute on function private.search_platform_accounts(text,text,jsonb,integer)to authenticated;
create function public.search_platform_accounts(p_filter text default 'pending',p_query text default '',p_cursor jsonb default null,p_limit integer default 50)returns jsonb language sql security invoker set search_path=''as $$select private.search_platform_accounts(p_filter,p_query,p_cursor,p_limit)$$;
revoke all on function public.search_platform_accounts(text,text,jsonb,integer)from public,anon,authenticated,service_role;
grant execute on function public.search_platform_accounts(text,text,jsonb,integer)to authenticated;
commit;
