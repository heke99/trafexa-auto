begin;
-- Contract signing and physical delivery are independent. A signed agreement
-- must not mark stock sold or fabricate completion of an undelivered deal.
create function private.deal_contract_progress(p_company uuid,p_deal uuid)returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare candidate record;j jsonb;summary jsonb;best jsonb;best_rank integer:=-1;rank integer;best_at timestamptz;company_signed boolean;customer_signed boolean;invalid_hash boolean;st text;inv text;i private.guest_document_invitations;email_status text;
begin
 for candidate in
  select 'native'::text kind,s.created_at,private.contract_signing_json(s,null,'owner') doc from private.contract_signings s where s.company_id=p_company and s.deal_id=p_deal
  union all
  select 'uploaded_pdf',s.created_at,private.uploaded_pdf_json(s) from private.uploaded_pdf_sources s where s.company_id=p_company and s.deal_id=p_deal
 loop
  j:=candidate.doc;
  company_signed:=coalesce(jsonb_typeof(j->'companySignature')='object' and j#>>'{companySignature,documentHash}'=j->>'documentHash',false);
  customer_signed:=coalesce(jsonb_typeof(j->'customerSignature')='object' and j#>>'{customerSignature,documentHash}'=j->>'documentHash',false);
  invalid_hash:=coalesce(jsonb_typeof(j->'companySignature')='object' and not company_signed,false) or coalesce(jsonb_typeof(j->'customerSignature')='object' and not customer_signed,false);
  st:=case when invalid_hash then 'unavailable' when company_signed and customer_signed then 'completed' when j->>'status' in('draft','pending') then j->>'status' else 'unavailable' end;
  inv:='none';
  if customer_signed then inv:='completed';
  elsif candidate.kind='native' then
   select *into i from private.guest_document_invitations where company_id=p_company and reference_id=(j->>'id')::uuid and kind='contract_invitation' order by created_at desc,id desc limit 1;
   if found then
    inv:=case when i.revoked_at is not null then 'revoked' when i.expires_at<=clock_timestamp() then 'expired' when private.guest_document_source_current(i,false) is distinct from true then 'unavailable' when i.token_hash is not null then 'active' else 'queued' end;
   else
    select status into email_status from private.transactional_email_outbox where kind='contract_invitation' and reference_id=(j->>'id')::uuid order by created_at desc,id desc limit 1;
    if found then inv:=case when email_status in('pending','processing') then 'queued' else 'unavailable' end;end if;
   end if;
  else
   inv:=case when coalesce((j->>'linkRevoked')::boolean,false) then 'revoked' when(j->>'expiresAt')::timestamptz<=clock_timestamp() then 'expired' when st='unavailable' then 'unavailable' when company_signed then 'active' else 'none' end;
  end if;
  if st='pending' and inv in('expired','revoked','unavailable') then st:='unavailable';end if;
  summary:=jsonb_build_object('status',st,'source',candidate.kind,'companySigned',company_signed,'customerSigned',customer_signed,'signedAt',case when st='completed' then case when candidate.kind='native' then j->>'completedAt' else greatest(j#>>'{companySignature,signedAt}',j#>>'{customerSignature,signedAt}') end else null end,'invitationStatus',inv);
  rank:=case st when 'completed' then 4 when 'pending' then 3 when 'unavailable' then 2 else 1 end;
  if rank>best_rank or(rank=best_rank and candidate.created_at>best_at) then best:=summary;best_rank:=rank;best_at:=candidate.created_at;end if;
 end loop;
 return coalesce(best,jsonb_build_object('status','none','source',null,'companySigned',false,'customerSigned',false,'signedAt',null,'invitationStatus','none'));
end$$;
revoke all on function private.deal_contract_progress(uuid,uuid)from public,anon,authenticated,service_role;

create function private.get_deal_contract_progress(p_company_id uuid,p_deal_ids uuid[])returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a uuid;r text;rows jsonb;
begin
 select x.actor,x.actor_role into a,r from private.internal_inventory_scope(p_company_id,false)x;
 if p_deal_ids is null or coalesce(array_length(p_deal_ids,1),0)>500 or array_ndims(p_deal_ids)>1 or array_position(p_deal_ids,null) is not null or(select count(*)from unnest(p_deal_ids))<>(select count(distinct x)from unnest(p_deal_ids)x)then raise exception 'Invalid contract progress request'using errcode='22023';end if;
 if exists(select 1 from unnest(p_deal_ids)x where not exists(select 1 from public.deals d where d.company_id=p_company_id and d.id=x))then raise exception 'Contract progress scope denied'using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('dealId',d.id,'archived',private.deal_is_archived(d.company_id,d.id),'contractProgress',private.deal_contract_progress(d.company_id,d.id))order by d.id),'[]')into rows from public.deals d where d.company_id=p_company_id and d.id=any(p_deal_ids);
 return jsonb_build_object('companyId',p_company_id,'actorId',a,'role',r,'rows',rows);
end$$;
revoke all on function private.get_deal_contract_progress(uuid,uuid[])from public,anon,authenticated,service_role;
grant execute on function private.get_deal_contract_progress(uuid,uuid[])to authenticated;
create function public.get_deal_contract_progress(p_company_id uuid,p_deal_ids uuid[])returns jsonb language sql volatile security invoker set search_path=''as $$select private.get_deal_contract_progress(p_company_id,p_deal_ids);$$;
revoke all on function public.get_deal_contract_progress(uuid,uuid[])from public,anon,service_role;
grant execute on function public.get_deal_contract_progress(uuid,uuid[])to authenticated;

create or replace function private.dealer_register_page(
 p_company_id uuid,p_kind text,p_query text default '',p_status text default 'all',
 p_sort text default 'recent',p_cursor jsonb default null,p_options boolean default false,p_selected_id uuid default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); actor_role text; result jsonb;
 before_id uuid; before_date timestamptz; before_price bigint;
begin
 select x.actor,x.actor_role into actor,actor_role from private.internal_inventory_scope(p_company_id,false)x;
 if p_kind is null or p_kind not in ('inventory','customers','deals') or p_options is null
 or p_query is null or length(p_query)>120 or p_query ~ '[[:cntrl:]]'
 or p_query<>regexp_replace(btrim(p_query),'[[:space:]]+',' ','g')
 or p_sort is null or p_sort not in ('recent','price_asc','price_desc')
 or p_kind='customers' and p_sort<>'recent'
 or p_status is null
 or p_kind='inventory' and p_status not in ('all','available','reserved','sold','archived')
 or p_kind='customers' and p_status not in ('all','person','business')
 or p_kind='deals' and p_status not in ('all','draft','reserved','cancelled','completed','archived')
 or p_options and (p_kind='deals' or p_sort<>'recent' or p_status<>case when p_kind='inventory' then 'available' else 'all' end)
 or not p_options and p_selected_id is not null then
  raise exception 'Invalid dealer register input' using errcode='22023';
 end if;
 if p_cursor is not null then
  if jsonb_typeof(p_cursor) is distinct from 'object' or octet_length(p_cursor::text)>4096 then raise exception 'Invalid register cursor' using errcode='22023';end if;
  if (select count(*) from jsonb_object_keys(p_cursor))<>12
   or not p_cursor ?& array['version','companyId','actorId','role','kind','query','status','sort','options','id','createdAt','priceOre']
   or p_cursor->'version' is distinct from '1'::jsonb
   or p_cursor->>'companyId' is distinct from p_company_id::text
   or p_cursor->>'actorId' is distinct from actor::text
   or p_cursor->>'role' is distinct from actor_role
   or p_cursor->>'kind' is distinct from p_kind or p_cursor->>'query' is distinct from p_query
   or p_cursor->>'status' is distinct from p_status or p_cursor->>'sort' is distinct from p_sort
   or p_cursor->'options' is distinct from to_jsonb(p_options)
   or jsonb_typeof(p_cursor->'id') is distinct from 'string'
   or (p_cursor->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(p_cursor->'createdAt') is distinct from 'string'
   or (p_cursor->>'createdAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
   or jsonb_typeof(p_cursor->'priceOre') is distinct from 'string'
   or (p_cursor->>'priceOre') !~ '^[0-9]{1,19}$'
   or (p_cursor->>'priceOre')::numeric>9223372036854775807 then
   raise exception 'Invalid register cursor scope' using errcode='22023';
  end if;
  begin
   before_id:=(p_cursor->>'id')::uuid;before_date:=(p_cursor->>'createdAt')::timestamptz;before_price:=(p_cursor->>'priceOre')::bigint;
   if not isfinite(before_date) or extract(year from before_date) not between 1 and 9999 then raise exception 'Invalid register date';end if;
  exception when others then raise exception 'Invalid register cursor anchor' using errcode='22023';end;
 end if;
 with source as materialized (
  select s.id,s.created_at,s.asking_price_ore as price_ore,s.status,false as archived,
   lower(regexp_replace(concat_ws(' ',v.make,v.model,v.registration_number),'[[:space:]]+',' ','g')) as search_text
  from public.stock_items s join public.vehicles v on v.company_id=s.company_id and v.id=s.vehicle_id
  where p_kind='inventory' and s.company_id=p_company_id and (not p_options or s.status='available')
  union all
  select c.id,c.created_at,0::bigint,c.kind,false,lower(regexp_replace(concat_ws(' ',c.name,c.email,c.phone),'[[:space:]]+',' ','g'))
  from public.customers c where p_kind='customers' and c.company_id=p_company_id
  union all
  select d.id,d.created_at,d.sale_price_ore,d.status,private.deal_is_archived(d.company_id,d.id),
   lower(regexp_replace(concat_ws(' ',c.name,c.email,c.phone,v.make,v.model,v.registration_number),'[[:space:]]+',' ','g'))
  from public.deals d join public.customers c on c.company_id=d.company_id and c.id=d.customer_id
  join public.stock_items s on s.company_id=d.company_id and s.id=d.stock_item_id
  join public.vehicles v on v.company_id=s.company_id and v.id=s.vehicle_id
  where p_kind='deals' and d.company_id=p_company_id
 ), filtered as materialized (
  select * from source where (case when p_kind='deals' then (p_status='archived' and archived) or(p_status<>'archived' and not archived and(p_status='all' or status=p_status)) else p_status='all' or status=p_status end) and strpos(search_text,lower(p_query))>0
 ), bounded as materialized (
  select * from filtered where p_cursor is null
   or p_sort='recent' and (created_at,id)<(before_date,before_id)
   or p_sort='price_asc' and (price_ore,created_at,id)>(before_price,before_date,before_id)
   or p_sort='price_desc' and (price_ore,created_at,id)<(before_price,before_date,before_id)
  order by case when p_sort='price_asc' then price_ore end asc,
   case when p_sort='price_desc' then price_ore end desc,
   case when p_sort='price_asc' then created_at end asc,
   case when p_sort<>'price_asc' then created_at end desc,
   case when p_sort='price_asc' then id end asc,
   case when p_sort<>'price_asc' then id end desc limit 51
 ), numbered as materialized (
  select *,row_number() over(order by case when p_sort='price_asc' then price_ore end asc,
   case when p_sort='price_desc' then price_ore end desc,
   case when p_sort='price_asc' then created_at end asc,
   case when p_sort<>'price_asc' then created_at end desc,
   case when p_sort='price_asc' then id end asc,
   case when p_sort<>'price_asc' then id end desc) as ordinal from bounded
 ), requested as (
  select id,ordinal from numbered where ordinal<=50
  union all select id,0::bigint from source where p_options and id=p_selected_id
 ), payloads as (
  select r.ordinal,jsonb_build_object('id',s.id,'company_id',s.company_id,'status',s.status,'created_at',s.created_at,
   'acquired_on',s.acquired_on,'purchase_price_ore',case when actor_role in('owner','admin','finance')then s.purchase_price_ore::text else null end,'asking_price_ore',s.asking_price_ore::text,'vat_scheme',s.vat_scheme,
   'vehicles',jsonb_build_object('id',v.id,'company_id',v.company_id,'registration_number',v.registration_number,'make',v.make,'model',v.model,'model_year',v.model_year,'mileage_km',v.mileage_km,'fuel',v.fuel,'gearbox',v.gearbox)) as row_data
  from requested r join public.stock_items s on s.id=r.id and s.company_id=p_company_id
  join public.vehicles v on v.id=s.vehicle_id and v.company_id=s.company_id where p_kind='inventory'
  union all
  select r.ordinal,jsonb_build_object('id',c.id,'company_id',c.company_id,'name',c.name,'kind',c.kind,'email',c.email,'phone',c.phone,'address',c.address,'notes',c.notes,'created_at',c.created_at)
  from requested r join public.customers c on c.id=r.id and c.company_id=p_company_id where p_kind='customers'
  union all
  select r.ordinal,jsonb_build_object('id',d.id,'company_id',d.company_id,'status',d.status,'sale_price_ore',d.sale_price_ore::text,'customer_id',d.customer_id,'stock_item_id',d.stock_item_id,'created_at',d.created_at,'archived',private.deal_is_archived(d.company_id,d.id),'contractProgress',private.deal_contract_progress(d.company_id,d.id),
   'createdBy',jsonb_build_object('id',d.created_by,'name',private.deal_creator_name(d.company_id,d.id,d.created_by)),
   'customer',jsonb_build_object('id',c.id,'company_id',c.company_id,'name',c.name,'kind',c.kind,'email',c.email,'phone',c.phone,'address',c.address,'notes',c.notes,'created_at',c.created_at),
   'stockItem',jsonb_build_object('id',s.id,'company_id',s.company_id,'status',s.status,'created_at',s.created_at,'acquired_on',s.acquired_on,'purchase_price_ore',case when actor_role in('owner','admin','finance')then s.purchase_price_ore::text else null end,'asking_price_ore',s.asking_price_ore::text,'vat_scheme',s.vat_scheme,
    'vehicles',jsonb_build_object('id',v.id,'company_id',v.company_id,'registration_number',v.registration_number,'make',v.make,'model',v.model,'model_year',v.model_year,'mileage_km',v.mileage_km,'fuel',v.fuel,'gearbox',v.gearbox)))
  from requested r join public.deals d on d.id=r.id and d.company_id=p_company_id
  join public.customers c on c.id=d.customer_id and c.company_id=d.company_id
  join public.stock_items s on s.id=d.stock_item_id and s.company_id=d.company_id
  join public.vehicles v on v.id=s.vehicle_id and v.company_id=s.company_id where p_kind='deals'
 ), totals as (
  select count(*) as all_count,
   case p_kind when 'inventory' then jsonb_build_object('available',count(*) filter(where status='available')::text,'reserved',count(*) filter(where status='reserved')::text,'sold',count(*) filter(where status='sold')::text,'archived',count(*) filter(where status='archived')::text)
    when 'customers' then jsonb_build_object('person',count(*) filter(where status='person')::text,'business',count(*) filter(where status='business')::text)
    else jsonb_build_object('draft',count(*) filter(where status='draft' and not archived)::text,'reserved',count(*) filter(where status='reserved' and not archived)::text,'cancelled',count(*) filter(where status='cancelled' and not archived)::text,'completed',count(*) filter(where status='completed' and not archived)::text,'archived',count(*) filter(where archived)::text) end as category_counts
  from source
 ) select jsonb_build_object('kind',p_kind,'companyId',p_company_id,'actorId',actor,'role',actor_role,'options',p_options,
  'rows',coalesce((select jsonb_agg(row_data order by ordinal) from payloads where ordinal>0),'[]'::jsonb),
  'selected',(select row_data from payloads where ordinal=0),
  'totalCount',t.all_count::text,'filteredCount',(select count(*)::text from filtered),
  'counts',jsonb_build_object('all',case when p_kind='deals' then (t.all_count-(t.category_counts->>'archived')::bigint)::text else t.all_count::text end)||t.category_counts,
  'nextCursor',case when exists(select 1 from numbered where ordinal=51) then
   (select jsonb_build_object('version',1,'companyId',p_company_id,'actorId',actor,'role',actor_role,'kind',p_kind,'query',p_query,'status',p_status,'sort',p_sort,'options',p_options,
    'id',id,'createdAt',created_at,'priceOre',price_ore::text) from numbered where ordinal=50) else null end)
 into result from totals t;
 return result;
end $$;
create or replace function private.inventory_dashboard_totals(p_company_id uuid)returns jsonb language plpgsql volatile security definer set search_path=''as $$
declare a uuid;r text;begin
 select x.actor,x.actor_role into a,r from private.internal_inventory_scope(p_company_id,false)x;
 return jsonb_build_object('companyId',p_company_id,
 'activeStockCount',(select count(*)::text from public.stock_items where company_id=p_company_id and status not in('sold','archived')),
 'availableStockCount',(select count(*)::text from public.stock_items where company_id=p_company_id and status='available'),
 'purchaseValueOre',case when r in('owner','admin','finance')then(select coalesce(sum(purchase_price_ore),0)::text from public.stock_items where company_id=p_company_id and status not in('sold','archived'))else null end,
 'activeDealCount',(select count(*)::text from public.deals where company_id=p_company_id and status in('draft','reserved') and not private.deal_is_archived(company_id,id)),
 'reservedDealCount',(select count(*)::text from public.deals where company_id=p_company_id and status='reserved' and not private.deal_is_archived(company_id,id)),
 'customerCount',(select count(*)::text from public.customers where company_id=p_company_id));
end$$;
commit;
