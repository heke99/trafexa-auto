-- Internal vehicle economics: owner/admin/finance read, existing writes narrowed
-- to owner/admin. Sales/viewer retain public inventory and selling workflows.
begin;
revoke select on public.stock_items from authenticated;
revoke select(purchase_price_ore,purchase_vat_ore,vat_basis_confirmed,calculation_version)on public.stock_items from authenticated;
grant select(id,company_id,vehicle_id,asking_price_ore,currency,vat_scheme,acquired_on,status,created_at)on public.stock_items to authenticated;
create policy internal_cost_read on public.vehicle_costs as restrictive for select to authenticated using(private.has_company_role(company_id,array['owner','admin','finance']));
create policy internal_cost_insert on public.vehicle_costs as restrictive for insert to authenticated with check(private.has_company_role(company_id,array['owner','admin']));
create policy internal_cost_update on public.vehicle_costs as restrictive for update to authenticated using(private.has_company_role(company_id,array['owner','admin']))with check(private.has_company_role(company_id,array['owner','admin']));
-- Audit rows contain event metadata, not before/after amounts. Cost events are
-- nevertheless internal; historical inventory/customer/sales audit stays usable.
create policy internal_cost_audit_read on public.audit_events as restrictive for select to authenticated using(entity_table<>'vehicle_costs'or private.has_company_role(company_id,array['owner','admin','finance']));

create function private.internal_inventory_scope(p_company_id uuid,p_write boolean default false)returns table(actor uuid,actor_role text)language plpgsql security invoker set search_path=''as $$
declare a uuid;r text;s text;begin
 if p_write is null then raise exception 'Inventory access denied'using errcode='42501';end if;
 select x.user_id into a from private.company_team_identity(true)x;
 if p_write then select status into s from public.companies where id=p_company_id for update;
 else select status into s from public.companies where id=p_company_id for share;end if;
 select role into r from public.memberships where company_id=p_company_id and user_id=a and status='active'for share;
 if s is distinct from 'active'or r is null or not(r=any(case when p_write then array['owner','admin']else array['owner','admin','sales','finance','viewer']end))then raise exception 'Inventory access denied'using errcode='42501';end if;
 return query select a,r;
end$$;
revoke all on function private.internal_inventory_scope(uuid,boolean)from public,anon,authenticated,service_role;

create function private.get_workspace_inventory(p_company_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid;r text;items jsonb;begin
 select x.actor,x.actor_role into a,r from private.internal_inventory_scope(p_company_id,false)x;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'company_id',s.company_id,'status',s.status,'created_at',s.created_at,'acquired_on',s.acquired_on,
 'purchase_price_ore',case when r in('owner','admin','finance')then to_jsonb(s.purchase_price_ore)else 'null'::jsonb end,'asking_price_ore',s.asking_price_ore,'vat_scheme',s.vat_scheme,
 'vehicles',jsonb_build_object('id',v.id,'company_id',v.company_id,'registration_number',v.registration_number,'make',v.make,'model',v.model,'model_year',v.model_year,'mileage_km',v.mileage_km,'fuel',v.fuel,'gearbox',v.gearbox))order by s.created_at desc,s.id desc),'[]')into items
 from(select *from public.stock_items where company_id=p_company_id order by created_at desc,id desc limit 500)s join public.vehicles v on v.company_id=s.company_id and v.id=s.vehicle_id;
 return jsonb_build_object('companyId',p_company_id,'actorId',a,'role',r,'rows',items);
end$$;
revoke all on function private.get_workspace_inventory(uuid)from public,anon,authenticated,service_role;
grant execute on function private.get_workspace_inventory(uuid)to authenticated;
create function public.get_workspace_inventory(p_company_id uuid)returns jsonb language sql security invoker set search_path=''as $$select private.get_workspace_inventory(p_company_id)$$;
revoke all on function public.get_workspace_inventory(uuid)from public,anon,authenticated,service_role;
grant execute on function public.get_workspace_inventory(uuid)to authenticated;

create or replace function private.vehicle_calculation_authorize(p_company_id uuid,p_write boolean)returns uuid language plpgsql security definer set search_path=''as $$
declare a uuid;r text;begin
 select x.actor,x.actor_role into a,r from private.internal_inventory_scope(p_company_id,p_write)x;
 if r not in('owner','admin','finance')or(p_write and r='finance')then raise exception 'Financial source unavailable'using errcode='42501';end if;return a;
end$$;
create or replace function private.inventory_dashboard_totals(p_company_id uuid)returns jsonb language plpgsql volatile security definer set search_path=''as $$
declare a uuid;r text;begin
 select x.actor,x.actor_role into a,r from private.internal_inventory_scope(p_company_id,false)x;
 return jsonb_build_object('companyId',p_company_id,
 'activeStockCount',(select count(*)::text from public.stock_items where company_id=p_company_id and status not in('sold','archived')),
 'availableStockCount',(select count(*)::text from public.stock_items where company_id=p_company_id and status='available'),
 'purchaseValueOre',case when r in('owner','admin','finance')then(select coalesce(sum(purchase_price_ore),0)::text from public.stock_items where company_id=p_company_id and status not in('sold','archived'))else null end,
 'activeDealCount',(select count(*)::text from public.deals where company_id=p_company_id and status in('draft','reserved')),
 'reservedDealCount',(select count(*)::text from public.deals where company_id=p_company_id and status='reserved'),
 'customerCount',(select count(*)::text from public.customers where company_id=p_company_id));
end$$;
alter function public.inventory_dashboard_totals(uuid)volatile;

create or replace function private.create_stock(company uuid,registration text,make_name text,model_name text,year integer,mileage integer,fuel_type text,gearbox_type text,purchase_ore bigint,asking_ore bigint,vat text)returns uuid language plpgsql security definer set search_path=''as $$
begin perform 1 from private.internal_inventory_scope(company,true);return private.create_stock_approved_impl(company,registration,make_name,model_name,year,mileage,fuel_type,gearbox_type,purchase_ore,asking_ore,vat);end$$;
create or replace function private.import_stock_batch(company uuid,submission uuid,payload jsonb)returns integer language plpgsql security definer set search_path=''as $$
begin perform 1 from private.internal_inventory_scope(company,true);return private.import_stock_batch_approved_impl(company,submission,payload);end$$;

-- Guard before existing VAT/constraint triggers so denied callers cannot probe
-- hidden amounts by submitting candidate VAT values. Asking/VAT selling edits
-- still let the established basis trigger invalidate its dependent metadata.
create function private.guard_internal_stock_write()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if current_setting('role',true)='authenticated'and(tg_op='INSERT'or(new.purchase_price_ore,new.purchase_vat_ore,new.vat_basis_confirmed,new.calculation_version)is distinct from(old.purchase_price_ore,old.purchase_vat_ore,old.vat_basis_confirmed,old.calculation_version))then
 perform 1 from private.internal_inventory_scope(new.company_id,true);end if;return new;
end$$;
revoke all on function private.guard_internal_stock_write()from public,anon,authenticated,service_role;
create trigger a_internal_stock_write before insert or update on public.stock_items for each row execute function private.guard_internal_stock_write();
create function private.guard_internal_cost_write()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if current_setting('role',true)='authenticated'then
 perform 1 from private.internal_inventory_scope(case when tg_op='DELETE'then old.company_id else new.company_id end,true);
 if tg_op='UPDATE'and old.company_id<>new.company_id then perform 1 from private.internal_inventory_scope(old.company_id,true);end if;end if;
 if tg_op='DELETE'then return old;end if;return new;
end$$;
revoke all on function private.guard_internal_cost_write()from public,anon,authenticated,service_role;
create trigger a_internal_cost_write before insert or update or delete on public.vehicle_costs for each row execute function private.guard_internal_cost_write();

-- Purchase-condition finance rights and acquisition rights keep their existing
-- role matrix; hold fresh membership proof while reading their private snapshots.
create or replace function private.purchase_condition_access(p_company uuid)returns table(actor uuid,actor_role text)language plpgsql security invoker set search_path=''as $$
declare a uuid;r text;begin select x.actor,x.actor_role into a,r from private.internal_inventory_scope(p_company,false)x;
 if r not in('owner','admin','finance')then raise exception 'Private purchase access denied'using errcode='42501';end if;return query select a,r;end$$;
create or replace function private.trade_in_acquisition_access(p_company_id uuid,p_write boolean)returns table(actor uuid,actor_role text)language plpgsql security invoker set search_path=''as $$
declare a uuid;r text;begin
 if p_write is null then raise exception 'Private acquisition access denied'using errcode='42501';end if;
 select x.actor,x.actor_role into a,r from private.internal_inventory_scope(p_company_id,p_write)x;
 if r not in('owner','admin','finance')or(p_write and r='finance')then raise exception 'Private acquisition access denied'using errcode='42501';end if;return query select a,r;
end$$;

-- All register branches, including independent selected options and nested deals.
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
 or p_kind='deals' and p_status not in ('all','draft','reserved','cancelled')
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
  select s.id,s.created_at,s.asking_price_ore as price_ore,s.status,
   lower(regexp_replace(concat_ws(' ',v.make,v.model,v.registration_number),'[[:space:]]+',' ','g')) as search_text
  from public.stock_items s join public.vehicles v on v.company_id=s.company_id and v.id=s.vehicle_id
  where p_kind='inventory' and s.company_id=p_company_id and (not p_options or s.status='available')
  union all
  select c.id,c.created_at,0::bigint,c.kind,lower(regexp_replace(concat_ws(' ',c.name,c.email,c.phone),'[[:space:]]+',' ','g'))
  from public.customers c where p_kind='customers' and c.company_id=p_company_id
  union all
  select d.id,d.created_at,d.sale_price_ore,d.status,
   lower(regexp_replace(concat_ws(' ',c.name,c.email,c.phone,v.make,v.model,v.registration_number),'[[:space:]]+',' ','g'))
  from public.deals d join public.customers c on c.company_id=d.company_id and c.id=d.customer_id
  join public.stock_items s on s.company_id=d.company_id and s.id=d.stock_item_id
  join public.vehicles v on v.company_id=s.company_id and v.id=s.vehicle_id
  where p_kind='deals' and d.company_id=p_company_id
 ), filtered as materialized (
  select * from source where (p_status='all' or status=p_status) and strpos(search_text,lower(p_query))>0
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
  select r.ordinal,jsonb_build_object('id',d.id,'company_id',d.company_id,'status',d.status,'sale_price_ore',d.sale_price_ore::text,'customer_id',d.customer_id,'stock_item_id',d.stock_item_id,'created_at',d.created_at,
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
    else jsonb_build_object('draft',count(*) filter(where status='draft')::text,'reserved',count(*) filter(where status='reserved')::text,'cancelled',count(*) filter(where status='cancelled')::text) end as category_counts
  from source
 ) select jsonb_build_object('kind',p_kind,'companyId',p_company_id,'actorId',actor,'role',actor_role,'options',p_options,
  'rows',coalesce((select jsonb_agg(row_data order by ordinal) from payloads where ordinal>0),'[]'::jsonb),
  'selected',(select row_data from payloads where ordinal=0),
  'totalCount',t.all_count::text,'filteredCount',(select count(*)::text from filtered),
  'counts',jsonb_build_object('all',t.all_count::text)||t.category_counts,
  'nextCursor',case when exists(select 1 from numbered where ordinal=51) then
   (select jsonb_build_object('version',1,'companyId',p_company_id,'actorId',actor,'role',actor_role,'kind',p_kind,'query',p_query,'status',p_status,'sort',p_sort,'options',p_options,
    'id',id,'createdAt',created_at,'priceOre',price_ore::text) from numbered where ordinal=50) else null end)
 into result from totals t;
 return result;
end $$;
alter function public.dealer_register_page(uuid,text,text,text,text,jsonb,boolean,uuid)volatile;
commit;
