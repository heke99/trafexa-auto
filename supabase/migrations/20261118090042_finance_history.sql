begin;
create index if not exists finance_application_history_page on public.finance_applications(company_id,created_at desc,id desc);
create function private.list_finance_history(p_company uuid,p_before uuid default null,p_limit integer default 50) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;mr text;cursor_time timestamptz;rows jsonb;next_id uuid;begin
 select x.actor,x.actor_role into actor,mr from private.customer_contact_access(p_company,false) x;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid page size' using errcode='22023';end if;
 if p_before is not null then
  select created_at into cursor_time from public.finance_applications where id=p_before and company_id=p_company and (mr in ('owner','admin','finance') or mr='sales' and created_by=actor);
  if not found then raise exception 'History cursor changed' using errcode='40001';end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]') into rows from (
  select id,company_id,product,requested_amount_ore::text,deposit_ore::text,term_months,status,note,deal_id,created_at
  from public.finance_applications where company_id=p_company and (mr in ('owner','admin','finance') or mr='sales' and created_by=actor)
   and (p_before is null or (created_at,id)<(cursor_time,p_before)) order by created_at desc,id desc limit p_limit
 )r;
 if jsonb_array_length(rows)>0 then
  next_id:=(rows->-1->>'id')::uuid;
  if not exists(select 1 from public.finance_applications where company_id=p_company and (mr in ('owner','admin','finance') or mr='sales' and created_by=actor) and (created_at,id)<((select created_at from public.finance_applications where id=next_id),next_id)) then next_id:=null;end if;
 end if;
 return jsonb_build_object('companyId',p_company,'actorUserId',actor,'actorRole',mr,'applications',rows,'nextCursor',next_id,
  'totalCount',(select count(*)::text from public.finance_applications where company_id=p_company and (mr in ('owner','admin','finance') or mr='sales' and created_by=actor)));
end $$;
revoke all on function private.list_finance_history(uuid,uuid,integer) from public,anon,service_role;
grant execute on function private.list_finance_history(uuid,uuid,integer) to authenticated;
create function public.list_finance_history(p_company_id uuid,p_before uuid default null,p_limit integer default 50) returns jsonb language sql security invoker set search_path='' as $$select private.list_finance_history(p_company_id,p_before,p_limit)$$;
revoke all on function public.list_finance_history(uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.list_finance_history(uuid,uuid,integer) to authenticated;
commit;
