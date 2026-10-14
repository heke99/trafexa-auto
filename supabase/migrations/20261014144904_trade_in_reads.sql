begin;
create function private.list_deal_trade_ins(p_company_id uuid,p_deal_id uuid,p_before_version integer,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;d public.deals;v jsonb;n integer;latest integer;customer text;
begin
 select actor,actor_role into a,r from private.customer_contact_access(p_company_id,false);
 select * into d from public.deals where company_id=p_company_id and id=p_deal_id for share;
 if not found then raise exception 'Deal access denied' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid page' using errcode='22023';end if;
 if p_before_version is not null and not exists(select 1 from private.trade_in_versions where company_id=p_company_id and deal_id=p_deal_id and version=p_before_version) then raise exception 'Cursor conflict' using errcode='40001';end if;
 select coalesce(max(version),0) into latest from private.trade_in_versions where company_id=p_company_id and deal_id=p_deal_id;
 select name into customer from public.customers where company_id=p_company_id and id=d.customer_id;
 select coalesce(jsonb_agg(private.trade_in_json(t) order by version desc),'[]') into v from(select * from private.trade_in_versions where company_id=p_company_id and deal_id=p_deal_id and (p_before_version is null or version<p_before_version) order by version desc limit p_limit)t;
 if jsonb_array_length(v)=p_limit and exists(select 1 from private.trade_in_versions where company_id=p_company_id and deal_id=p_deal_id and version<(v->(p_limit-1)->>'version')::integer) then n:=(v->(p_limit-1)->>'version')::integer;end if;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'dealId',p_deal_id,'salePriceOre',d.sale_price_ore::text,'customerName',customer,'versions',v,'nextBeforeVersion',n,'latestVersion',latest,'canCreate',d.status in ('draft','reserved') and not exists(select 1 from private.offer_reviews where company_id=p_company_id and deal_id=p_deal_id and status='accepted'));
end$$;
create function public.list_deal_trade_ins(p_company_id uuid,p_deal_id uuid,p_before_version integer default null,p_limit integer default 50) returns jsonb language sql security invoker set search_path='' as $$select private.list_deal_trade_ins(p_company_id,p_deal_id,p_before_version,p_limit);$$;
revoke all on function private.list_deal_trade_ins(uuid,uuid,integer,integer),public.list_deal_trade_ins(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function private.list_deal_trade_ins(uuid,uuid,integer,integer),public.list_deal_trade_ins(uuid,uuid,integer,integer) to authenticated;
commit;
