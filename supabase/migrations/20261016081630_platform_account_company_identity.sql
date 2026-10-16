begin;
-- Privileged helpers remain private and cannot be called with arbitrary account ids.
create function private.platform_account_identity(p_user_id uuid,p_query text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('identityVersion',1,'companies',coalesce((
  select jsonb_agg(j order by matched desc,name,id) from (
   select c.id,c.name, (strpos(lower(c.name),p_query)>0 or (p_query ~ '^[0-9 -]+$' and strpos(c.organisation_number,(case when regexp_replace(p_query,'[^0-9]','','g') ~ '^16[0-9]{10}$' then substr(regexp_replace(p_query,'[^0-9]','','g'),3) else regexp_replace(p_query,'[^0-9]','','g') end))>0)) matched,
    jsonb_build_object('id',c.id,'name',c.name,'organisationNumber',c.organisation_number,'status',c.status,'membershipStatus',m.status) j
   from public.memberships m join public.companies c on c.id=m.company_id where m.user_id=p_user_id
   order by matched desc,c.name,c.id limit 5
  ) companies),'[]'::jsonb),
 'companyCount',(select count(*) from public.memberships where user_id=p_user_id),
 'requestedCompany',(select jsonb_build_object('name',d.company,'organisationNumber',d.organisation_number)
   from private.application_account_invitations i join private.demo_requests d on d.id=i.application_id
   where i.user_id=p_user_id and not d.legacy))
$$;
revoke all on function private.platform_account_identity(uuid,text)from public,anon,authenticated,service_role;
create function private.platform_account_matches(p_user_id uuid,p_query text)returns boolean
language sql stable security invoker set search_path=''as $$
 select exists(select 1 from auth.users u where u.id=p_user_id and
  (strpos(lower(u.email),p_query)>0 or (jsonb_typeof(u.raw_user_meta_data->'name')='string' and strpos(lower(left(btrim(regexp_replace(u.raw_user_meta_data->>'name','[[:cntrl:]]','','g')),160)),p_query)>0)
  or exists(select 1 from public.memberships m join public.companies c on c.id=m.company_id where m.user_id=u.id and
    (strpos(lower(c.name),p_query)>0 or (p_query ~ '^[0-9 -]+$' and (case when regexp_replace(p_query,'[^0-9]','','g') ~ '^16[0-9]{10}$' then substr(regexp_replace(p_query,'[^0-9]','','g'),3) else regexp_replace(p_query,'[^0-9]','','g') end)<>'' and strpos(c.organisation_number,(case when regexp_replace(p_query,'[^0-9]','','g') ~ '^16[0-9]{10}$' then substr(regexp_replace(p_query,'[^0-9]','','g'),3) else regexp_replace(p_query,'[^0-9]','','g') end))>0)))
  or exists(select 1 from private.application_account_invitations i join private.demo_requests d on d.id=i.application_id where i.user_id=u.id and not d.legacy and
    (strpos(lower(d.company),p_query)>0 or (p_query ~ '^[0-9 -]+$' and (case when regexp_replace(p_query,'[^0-9]','','g') ~ '^16[0-9]{10}$' then substr(regexp_replace(p_query,'[^0-9]','','g'),3) else regexp_replace(p_query,'[^0-9]','','g') end)<>'' and strpos(d.organisation_number,(case when regexp_replace(p_query,'[^0-9]','','g') ~ '^16[0-9]{10}$' then substr(regexp_replace(p_query,'[^0-9]','','g'),3) else regexp_replace(p_query,'[^0-9]','','g') end))>0)))))
$$;
revoke all on function private.platform_account_matches(uuid,text)from public,anon,authenticated,service_role;
create or replace function private.search_platform_accounts(p_filter text,p_query text,p_cursor jsonb,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; cursor_date timestamptz; items jsonb; next_key uuid; p_page_key uuid; begin
 actor:=private.account_approval_admin_identity();
 if p_filter is null or p_filter not in ('all','pending','approved','rejected','suspended') or p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid account page' using errcode='22023'; end if;
 if p_query is null or length(p_query)>254 or p_query<>lower(btrim(p_query)) or p_query ~ '[[:cntrl:]]' or p_query ~ '[[:space:]]' and p_query !~ '^[^[:space:]]+( [^[:space:]]+)*$' or p_query ~ ('['||chr(128)||'-'||chr(159)||']') then raise exception 'Invalid account search' using errcode='22023';end if;
 if p_cursor is not null then
  if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>2048 or jsonb_typeof(p_cursor->'createdAt')is distinct from 'string' or (select count(*)from jsonb_object_keys(p_cursor))<>5 or not(p_cursor?&array['actorId','filter','query','id','createdAt']) or p_cursor->>'actorId' is distinct from actor::text or p_cursor->>'filter' is distinct from p_filter or p_cursor->>'query' is distinct from p_query or jsonb_typeof(p_cursor->'id')is distinct from 'string' or p_cursor->>'id'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Account search cursor changed'using errcode='40001';end if;
  p_page_key:=(p_cursor->>'id')::uuid;
 end if;
 if p_page_key is not null then
  select u.created_at into cursor_date from auth.users u left join private.account_approvals a on a.user_id=u.id
  where u.id=p_page_key and u.email is not null and not coalesce(u.is_anonymous,false) and not coalesce(u.is_sso_user,false)
   and (p_filter='all' or private.account_effective_status(u.id)=p_filter) and private.platform_account_matches(u.id,p_query);
  if found and p_cursor->>'createdAt' is distinct from to_jsonb(cursor_date)#>>'{}' then raise exception 'Account search cursor changed'using errcode='40001';end if;
  if not found then raise exception 'Account cursor changed' using errcode='40001'; end if;
 end if;
 select coalesce(jsonb_agg(j order by created_at desc,id desc),'[]') into items from(
 select u.id,u.created_at,jsonb_build_object('userId',u.id,'name',case when jsonb_typeof(u.raw_user_meta_data->'name')='string' then nullif(left(btrim(regexp_replace(u.raw_user_meta_data->>'name','[[:cntrl:]]','','g')),160),'') else null end,
 'email',u.email,'emailVerified',u.email_confirmed_at is not null,'createdAt',u.created_at,
 'status',private.account_effective_status(u.id),'version',coalesce(a.version,0),'isPlatformAdmin',exists(select 1 from private.platform_admins pa where pa.user_id=u.id)) || private.platform_account_identity(u.id,p_query) j
 from auth.users u left join private.account_approvals a on a.user_id=u.id
 where u.email is not null and not coalesce(u.is_anonymous,false) and not coalesce(u.is_sso_user,false)
 and (p_filter='all' or private.account_effective_status(u.id)=p_filter)
 and private.platform_account_matches(u.id,p_query)
 and (p_page_key is null or (u.created_at,u.id)<(cursor_date,p_page_key))
 order by u.created_at desc,u.id desc limit p_limit+1) page;
 if jsonb_array_length(items)>p_limit then next_key:=(items->(p_limit-1)->>'userId')::uuid;items:=items-p_limit;end if;
 if private.account_approval_admin_identity()<>actor then raise exception 'Admin changed' using errcode='42501';end if;
 return jsonb_build_object('actorUserId',actor,'accounts',items,'filter',p_filter,'query',p_query,'nextCursor',case when next_key is not null then jsonb_build_object('actorId',actor,'filter',p_filter,'query',p_query,'id',next_key,'createdAt',items->(p_limit-1)->>'createdAt') else null end);
end $$;
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
 'status',private.account_effective_status(u.id),'version',coalesce(a.version,0),'isPlatformAdmin',exists(select 1 from private.platform_admins pa where pa.user_id=u.id)) || private.platform_account_identity(u.id,'') j
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
