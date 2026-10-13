-- Exact financial source and explicit deduction evidence. No VAT is inferred on purchase/costs.
alter table public.stock_items
 add column purchase_vat_ore bigint check(purchase_vat_ore between 0 and round(purchase_price_ore::numeric/5)::bigint),
 add column vat_basis_confirmed boolean not null default false,
 add column calculation_version bigint not null default 1 check(calculation_version>0),
 add constraint stock_vmb_purchase_vat_check check(vat_scheme<>'vmb' or purchase_vat_ore is null or purchase_vat_ore=0),
 add constraint stock_vmb_confirmation_check check(not vat_basis_confirmed or vat_scheme='vmb');
alter table public.vehicle_costs add column deductible_vat_ore bigint check(deductible_vat_ore between 0 and round(amount_ore::numeric/5)::bigint);

-- Existing blanket cost grants must not implicitly expose the new evidence column.
revoke insert,update on public.vehicle_costs from authenticated;
grant insert(id,company_id,stock_item_id,category,description,amount_ore,incurred_on,created_at) on public.vehicle_costs to authenticated;
grant update(id,company_id,stock_item_id,category,description,amount_ore,incurred_on,created_at) on public.vehicle_costs to authenticated;

create function private.vehicle_calculation_stock_basis() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (new.purchase_price_ore,new.asking_price_ore,new.vat_scheme) is distinct from (old.purchase_price_ore,old.asking_price_ore,old.vat_scheme) then
  new.purchase_vat_ore:=null;
  new.vat_basis_confirmed:=false;
  new.calculation_version:=old.calculation_version+1;
 elsif (new.purchase_vat_ore,new.vat_basis_confirmed) is distinct from (old.purchase_vat_ore,old.vat_basis_confirmed) then
  new.calculation_version:=old.calculation_version+1;
 end if;
 return new;
end $$;
create trigger calculation_stock_basis before update on public.stock_items
for each row execute function private.vehicle_calculation_stock_basis();

create function private.vehicle_calculation_cost_basis() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Share-lock reads and metadata writes serialize on the parent financial version.
 if tg_op='INSERT' then
  perform 1 from public.stock_items s where s.id=new.stock_item_id and s.company_id=new.company_id for update;
  return new;
 elsif tg_op='DELETE' then
  perform 1 from public.stock_items s where s.id=old.stock_item_id and s.company_id=old.company_id for update;
  return old;
 end if;
 perform 1 from public.stock_items s where (s.id,s.company_id) in ((old.stock_item_id,old.company_id),(new.stock_item_id,new.company_id)) order by s.id for update;
 if (new.amount_ore,new.category,new.description,new.incurred_on,new.stock_item_id,new.company_id)
  is distinct from (old.amount_ore,old.category,old.description,old.incurred_on,old.stock_item_id,old.company_id) then
  new.deductible_vat_ore:=null;
 end if;
 return new;
end $$;
create trigger calculation_cost_basis before insert or update or delete on public.vehicle_costs
for each row execute function private.vehicle_calculation_cost_basis();

create function private.vehicle_calculation_cost_version() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new is not distinct from old then return new; end if;
 if tg_op='INSERT' then
  update public.stock_items set calculation_version=calculation_version+1 where id=new.stock_item_id and company_id=new.company_id;
 elsif tg_op='DELETE' then
  update public.stock_items set calculation_version=calculation_version+1 where id=old.stock_item_id and company_id=old.company_id;
 else
  update public.stock_items set calculation_version=calculation_version+1 where (id,company_id) in ((old.stock_item_id,old.company_id),(new.stock_item_id,new.company_id));
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger calculation_cost_version after insert or update or delete on public.vehicle_costs
for each row execute function private.vehicle_calculation_cost_version();

create function private.vehicle_calculation_authorize(p_company_id uuid,p_write boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); account auth.users; company_status text; member_role text;
begin
 if actor is null or current_setting('role',true)<>'authenticated' then raise exception 'Financial source unavailable' using errcode='42501'; end if;
 if p_write then
  -- Match the team/advertising order. Revocation cannot pass a waiting metadata
  -- write: each actual account/company/member proof stays locked until commit.
  select * into account from auth.users u where u.id=actor for share;
  select c.status into company_status from public.companies c where c.id=p_company_id for update;
  select m.role into member_role from public.memberships m where m.company_id=p_company_id and m.user_id=actor and m.status='active' for share;
 else
  select * into account from auth.users u where u.id=actor;
  select c.status into company_status from public.companies c where c.id=p_company_id;
  select m.role into member_role from public.memberships m where m.company_id=p_company_id and m.user_id=actor and m.status='active';
 end if;
 if account.id is null or coalesce(account.is_anonymous,false) or account.email is null or account.email_confirmed_at is null
  or (account.banned_until is not null and account.banned_until>clock_timestamp())
  or company_status is distinct from 'active' or member_role is null
  or not member_role=any(case when p_write then array['owner','admin','sales'] else array['owner','admin','sales','finance','viewer'] end)
 then raise exception 'Financial source unavailable' using errcode='42501'; end if;
 return actor;
end $$;

create function private.get_vehicle_calculation(p_company_id uuid,p_stock_item_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare stock public.stock_items; cost_data jsonb;
begin
 perform private.vehicle_calculation_authorize(p_company_id,false);
 select * into stock from public.stock_items s where s.company_id=p_company_id and s.id=p_stock_item_id for share;
 if not found then raise exception 'Financial source unavailable' using errcode='P0002'; end if;
 if (select count(*) from public.vehicle_costs c where c.company_id=p_company_id and c.stock_item_id=p_stock_item_id)>10000 then
  raise exception 'Financial source exceeds supported size' using errcode='54000'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'description',c.description,'grossOre',c.amount_ore::text,'deductibleVatOre',c.deductible_vat_ore::text) order by c.id),'[]'::jsonb)
 into cost_data from public.vehicle_costs c where c.company_id=p_company_id and c.stock_item_id=p_stock_item_id;
 return jsonb_build_object('companyId',stock.company_id,'stockItemId',stock.id,'version',stock.calculation_version::text,
  'purchaseGrossOre',stock.purchase_price_ore::text,'saleGrossOre',stock.asking_price_ore::text,'vatScheme',stock.vat_scheme,
  'purchaseVatOre',stock.purchase_vat_ore::text,'vatBasisConfirmed',stock.vat_basis_confirmed,'costs',cost_data);
end $$;

create function private.save_vehicle_calculation_metadata(p_company_id uuid,p_stock_item_id uuid,p_expected_version text,p_purchase_vat_ore text,p_vat_basis_confirmed boolean,p_cost_vat jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare stock public.stock_items; item jsonb; cost uuid; deductible bigint; purchase bigint; expected bigint;
begin
 perform private.vehicle_calculation_authorize(p_company_id,true);
 if p_expected_version is null or p_expected_version!~'^[1-9][0-9]{0,18}$' or p_expected_version::numeric>9223372036854775807
  or p_vat_basis_confirmed is null or p_cost_vat is null or jsonb_typeof(p_cost_vat)<>'array' or jsonb_array_length(p_cost_vat)>10000
  or (p_purchase_vat_ore is not null and (p_purchase_vat_ore!~'^(0|[1-9][0-9]{0,18})$' or p_purchase_vat_ore::numeric>9223372036854775807))
 then raise exception 'Invalid financial evidence' using errcode='22023'; end if;
 expected:=p_expected_version::bigint; purchase:=p_purchase_vat_ore::bigint;
 select * into stock from public.stock_items s where s.company_id=p_company_id and s.id=p_stock_item_id for update;
 if not found then raise exception 'Financial source unavailable' using errcode='P0002'; end if;
 if stock.calculation_version<>expected then raise exception 'Financial basis changed' using errcode='40001'; end if;
 if purchase>round(stock.purchase_price_ore::numeric/5)::bigint or (stock.vat_scheme='vmb' and coalesce(purchase,0)<>0) or (p_vat_basis_confirmed and stock.vat_scheme<>'vmb') then
  raise exception 'Invalid financial evidence' using errcode='22023'; end if;
 if jsonb_array_length(p_cost_vat)<>(select count(*) from public.vehicle_costs c where c.company_id=p_company_id and c.stock_item_id=p_stock_item_id)
  or (select count(distinct lower(x->>'costId')) from jsonb_array_elements(p_cost_vat) x)<>jsonb_array_length(p_cost_vat)
 then raise exception 'Cost basis changed' using errcode='40001'; end if;
 for item in select value from jsonb_array_elements(p_cost_vat) loop
  if jsonb_typeof(item)<>'object' or not item ?& array['costId','deductibleVatOre'] or (select count(*) from jsonb_object_keys(item))<>2
   or jsonb_typeof(item->'costId')<>'string' or item->>'costId'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or jsonb_typeof(item->'deductibleVatOre') not in ('null','string')
   or (jsonb_typeof(item->'deductibleVatOre')='string' and (item->>'deductibleVatOre'!~'^(0|[1-9][0-9]{0,18})$' or (item->>'deductibleVatOre')::numeric>9223372036854775807))
  then raise exception 'Invalid cost evidence' using errcode='22023'; end if;
  cost:=(item->>'costId')::uuid; deductible:=(item->>'deductibleVatOre')::bigint;
  if not exists(select 1 from public.vehicle_costs c where c.id=cost and c.company_id=p_company_id and c.stock_item_id=p_stock_item_id and (deductible is null or deductible<=round(c.amount_ore::numeric/5)::bigint)) then
   raise exception 'Invalid cost evidence' using errcode='22023'; end if;
 end loop;
 for item in select value from jsonb_array_elements(p_cost_vat) loop
  update public.vehicle_costs set deductible_vat_ore=(item->>'deductibleVatOre')::bigint
   where id=(item->>'costId')::uuid and company_id=p_company_id and stock_item_id=p_stock_item_id and deductible_vat_ore is distinct from (item->>'deductibleVatOre')::bigint;
 end loop;
 update public.stock_items set purchase_vat_ore=purchase,vat_basis_confirmed=p_vat_basis_confirmed
  where id=p_stock_item_id and company_id=p_company_id and (purchase_vat_ore,vat_basis_confirmed) is distinct from (purchase,p_vat_basis_confirmed);
 return private.get_vehicle_calculation(p_company_id,p_stock_item_id);
end $$;

create function private.inventory_dashboard_totals(p_company_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.vehicle_calculation_authorize(p_company_id,false);
 return jsonb_build_object('companyId',p_company_id,
  'activeStockCount',(select count(*)::text from public.stock_items s where s.company_id=p_company_id and s.status not in ('sold','archived')),
  'availableStockCount',(select count(*)::text from public.stock_items s where s.company_id=p_company_id and s.status='available'),
  'purchaseValueOre',(select coalesce(sum(s.purchase_price_ore),0)::text from public.stock_items s where s.company_id=p_company_id and s.status not in ('sold','archived')),
  'activeDealCount',(select count(*)::text from public.deals d where d.company_id=p_company_id and d.status in ('draft','reserved')),
  'reservedDealCount',(select count(*)::text from public.deals d where d.company_id=p_company_id and d.status='reserved'),
  'customerCount',(select count(*)::text from public.customers c where c.company_id=p_company_id));
end $$;

create function public.get_vehicle_calculation(p_company_id uuid,p_stock_item_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.get_vehicle_calculation(p_company_id,p_stock_item_id)$$;
create function public.save_vehicle_calculation_metadata(p_company_id uuid,p_stock_item_id uuid,p_expected_version text,p_purchase_vat_ore text,p_vat_basis_confirmed boolean,p_cost_vat jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.save_vehicle_calculation_metadata(p_company_id,p_stock_item_id,p_expected_version,p_purchase_vat_ore,p_vat_basis_confirmed,p_cost_vat)$$;
create function public.inventory_dashboard_totals(p_company_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.inventory_dashboard_totals(p_company_id)$$;

revoke all on function private.vehicle_calculation_stock_basis(),private.vehicle_calculation_cost_basis(),private.vehicle_calculation_cost_version(),private.vehicle_calculation_authorize(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function private.get_vehicle_calculation(uuid,uuid),private.save_vehicle_calculation_metadata(uuid,uuid,text,text,boolean,jsonb),private.inventory_dashboard_totals(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_vehicle_calculation(uuid,uuid),public.save_vehicle_calculation_metadata(uuid,uuid,text,text,boolean,jsonb),public.inventory_dashboard_totals(uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_vehicle_calculation(uuid,uuid),private.save_vehicle_calculation_metadata(uuid,uuid,text,text,boolean,jsonb),private.inventory_dashboard_totals(uuid) to authenticated;
grant execute on function public.get_vehicle_calculation(uuid,uuid),public.save_vehicle_calculation_metadata(uuid,uuid,text,text,boolean,jsonb),public.inventory_dashboard_totals(uuid) to authenticated;
