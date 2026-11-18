begin;

-- Page families, so a heavily edited template cannot displace other choices.
-- Search the version that the selector can use, then page by stable family ID.
create function public.list_pdf_template_selection(
 p_company_id uuid,p_search text,p_before_template_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; rows jsonb; next_family uuid;
begin
 actor:=private.uploaded_pdf_actor(p_company_id);
 if p_search is null or length(p_search)>160 or p_search<>btrim(p_search) or p_search~'[[:cntrl:]]' then
  raise exception 'Invalid template search' using errcode='22023';
 end if;
 with latest as (
  select distinct on (v.template_id) v as item
  from private.pdf_template_versions v
  where v.company_id=p_company_id and (p_before_template_id is null or v.template_id<p_before_template_id)
  order by v.template_id desc,v.version desc
 ), matches as (
  select item,row_number() over(order by (item).template_id desc) as position
  from latest where strpos(lower((item).title),lower(p_search))>0 or p_search=''
  order by (item).template_id desc limit 51
 )
 select coalesce(jsonb_agg(private.pdf_template_version_json(item) order by position) filter(where position<=50),'[]'),
  case when count(*)>50 then (array_agg((item).template_id order by position))[50] end
 into rows,next_family from matches;
 return jsonb_build_object('companyId',p_company_id,'actorId',actor,'templates',rows,'nextBeforeTemplateId',next_family);
end $$;
revoke all on function public.list_pdf_template_selection(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_pdf_template_selection(uuid,text,uuid) to authenticated;

create function private.direct_deal_template_selection(
 p_company_id uuid,p_search text,p_before_template_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; next_family uuid;
begin
 if p_search is null or length(p_search)>160 or p_search<>btrim(p_search) or p_search~'[[:cntrl:]]' then
  raise exception 'Invalid template search' using errcode='22023';
 end if;
 with latest as (
  select distinct on (v.template_id) v as item
  from private.sale_contract_template_versions v
  where v.company_id=p_company_id and v.status='approved' and (p_before_template_id is null or v.template_id<p_before_template_id)
  order by v.template_id desc,v.version desc
 ), matches as (
  select item,row_number() over(order by (item).template_id desc) as position
  from latest where strpos(lower((item).title),lower(p_search))>0 or p_search=''
  order by (item).template_id desc limit 51
 )
 select coalesce(jsonb_agg(private.sale_contract_template_json(item) order by position) filter(where position<=50),'[]'),
  case when count(*)>50 then (array_agg((item).template_id order by position))[50] end
 into rows,next_family from matches;
 return jsonb_build_object('templates',rows,'nextBeforeTemplateId',next_family);
end $$;
revoke all on function private.direct_deal_template_selection(uuid,text,uuid) from public,anon,authenticated,service_role;

create function public.list_direct_deal_template_selection(
 p_company_id uuid,p_search text,p_before_template_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid; role text;
begin
 select actor,actor_role into actor_id,role from private.direct_deal_access(p_company_id,false);
 return jsonb_build_object('companyId',p_company_id,'actorUserId',actor_id,'actorRole',role)
  || private.direct_deal_template_selection(p_company_id,p_search,p_before_template_id);
end $$;
revoke all on function public.list_direct_deal_template_selection(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_direct_deal_template_selection(uuid,text,uuid) to authenticated;

create or replace function private.get_direct_deal_options(p_company_id uuid,p_deal_id uuid default null,p_customer_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;d public.deals;c public.customers;templates jsonb;pending private.direct_deal_reviews;s private.contract_signings;
begin
 select actor,actor_role into a,r from private.direct_deal_access(p_company_id,false);
 if p_deal_id is not null then select * into d from public.deals where company_id=p_company_id and id=p_deal_id;if not found then raise exception 'Deal denied' using errcode='42501';end if;p_customer_id:=d.customer_id;end if;
 if p_customer_id is not null then select * into c from public.customers where company_id=p_company_id and id=p_customer_id;if not found then raise exception 'Customer denied' using errcode='42501';end if;end if;
 templates:=private.direct_deal_template_selection(p_company_id,'',null);
 if d.id is not null then select * into pending from private.direct_deal_reviews where company_id=p_company_id and deal_id=d.id order by created_at desc,draft_id desc limit 1;select * into s from private.contract_signings where company_id=p_company_id and deal_id=d.id;end if;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'tradeIns',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'version',x.version,'registration',x.registration,'make',x.make,'model',x.model,'valueOre',x.value_ore::text,'debtKnown',x.debt_known,'debtOre',x.debt_ore::text,'salePriceOre',x.sale_price_ore::text) order by x.version desc) from(select * from private.trade_in_versions where company_id=p_company_id and deal_id=d.id order by version desc limit 50)x),'[]'::jsonb),'customer',case when c.id is not null then private.direct_customer_context(c) end,'deal',case when d.id is not null then jsonb_build_object('id',d.id,'stockItemId',d.stock_item_id,'customerId',d.customer_id,'agreedPriceOre',d.sale_price_ore::text,'customer',private.direct_customer_context(c)) end,'pendingReview',case when pending.draft_id is not null and s.id is null and(r<>'sales' or pending.actor_id=a) then private.direct_deal_review_json(pending) end,'agreementExists',s.id is not null,'signing',case when s.id is not null and r in('owner','admin') then private.contract_signing_json(s,a,r) end)||templates;
end$$;

commit;
