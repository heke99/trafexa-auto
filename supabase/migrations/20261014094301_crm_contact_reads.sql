begin;
create function private.list_customer_contacts(p_company_id uuid,p_customer_id uuid,p_page_key uuid,p_limit integer)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid; r text; rows jsonb; next_id uuid; cursor_date date;
begin
 select actor,actor_role into a,r from private.customer_contact_access(p_company_id,false);
 perform 1 from public.customers where company_id=p_company_id and id=p_customer_id for share;
 if not found then raise exception 'Customer access denied' using errcode='42501'; end if;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid page size' using errcode='22023'; end if;
 if p_page_key is not null then
 select contact_on into cursor_date from private.customer_contacts where company_id=p_company_id and customer_id=p_customer_id and id=p_page_key;
 if not found then raise exception 'Cursor conflict' using errcode='40001'; end if;
 end if;
 select coalesce(jsonb_agg(private.customer_contact_json(c) order by c.contact_on desc,c.id desc),'[]') into rows from
 (select * from private.customer_contacts where company_id=p_company_id and customer_id=p_customer_id and (p_page_key is null or (contact_on,id)<(cursor_date,p_page_key)) order by contact_on desc,id desc limit p_limit) c;
 if jsonb_array_length(rows)=p_limit and exists(select 1 from private.customer_contacts where company_id=p_company_id and customer_id=p_customer_id and (contact_on,id)<((rows->(p_limit-1)->>'contactOn')::date,(rows->(p_limit-1)->>'id')::uuid)) then next_id:=(rows->(p_limit-1)->>'id')::uuid; end if;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'businessDate',(clock_timestamp() at time zone 'Europe/Stockholm')::date,'contacts',rows,'nextPageKey',next_id);
end $$;
create function private.list_customer_follow_ups(p_company_id uuid,p_filter text,p_page_key uuid,p_limit integer)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid; r text; rows jsonb; next_id uuid; cursor_date date; today date:=(clock_timestamp() at time zone 'Europe/Stockholm')::date;
begin
 select actor,actor_role into a,r from private.customer_contact_access(p_company_id,false);
 if p_limit is null or p_limit not between 1 and 50 or p_filter is null or p_filter not in ('due','upcoming','all') then raise exception 'Invalid filter/page' using errcode='22023'; end if;
 if p_page_key is not null then
  select follow_up_on into cursor_date from private.customer_contacts where company_id=p_company_id and id=p_page_key and follow_up_status='pending'
   and (p_filter='all' or (p_filter='due' and follow_up_on<=today) or (p_filter='upcoming' and follow_up_on>today));
  if not found then raise exception 'Cursor conflict' using errcode='40001'; end if;
 end if;
 select coalesce(jsonb_agg(private.customer_contact_json(c)||jsonb_build_object('customerName',u.name) order by c.follow_up_on,c.id),'[]') into rows
 from (select * from private.customer_contacts where company_id=p_company_id and follow_up_status='pending'
 and (p_filter='all' or (p_filter='due' and follow_up_on<=today) or (p_filter='upcoming' and follow_up_on>today))
 and (p_page_key is null or (follow_up_on,id)>(cursor_date,p_page_key)) order by follow_up_on,id limit p_limit) c
 join public.customers u on u.company_id=c.company_id and u.id=c.customer_id;
 if jsonb_array_length(rows)=p_limit and exists(select 1 from private.customer_contacts where company_id=p_company_id and follow_up_status='pending'
 and (p_filter='all' or (p_filter='due' and follow_up_on<=today) or (p_filter='upcoming' and follow_up_on>today))
 and (follow_up_on,id)>((rows->(p_limit-1)->>'followUpOn')::date,(rows->(p_limit-1)->>'id')::uuid)) then next_id:=(rows->(p_limit-1)->>'id')::uuid; end if;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'businessDate',today,'contacts',rows,'nextPageKey',next_id);
end $$;
create function public.list_customer_contacts(p_company_id uuid,p_customer_id uuid,p_page_key uuid default null,p_limit integer default 50) returns jsonb language sql security invoker set search_path='' as $$ select private.list_customer_contacts(p_company_id,p_customer_id,p_page_key,p_limit); $$;
create function public.list_customer_follow_ups(p_company_id uuid,p_filter text default 'due',p_page_key uuid default null,p_limit integer default 50) returns jsonb language sql security invoker set search_path='' as $$ select private.list_customer_follow_ups(p_company_id,p_filter,p_page_key,p_limit); $$;
revoke all on function private.list_customer_contacts(uuid,uuid,uuid,integer),private.list_customer_follow_ups(uuid,text,uuid,integer),public.list_customer_contacts(uuid,uuid,uuid,integer),public.list_customer_follow_ups(uuid,text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.list_customer_contacts(uuid,uuid,uuid,integer),private.list_customer_follow_ups(uuid,text,uuid,integer),public.list_customer_contacts(uuid,uuid,uuid,integer),public.list_customer_follow_ups(uuid,text,uuid,integer) to authenticated;
commit;
