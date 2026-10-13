begin;
do $$
begin
 if has_column_privilege('authenticated','public.stock_items','purchase_vat_ore','UPDATE')
  or has_column_privilege('authenticated','public.stock_items','vat_basis_confirmed','UPDATE')
  or has_column_privilege('authenticated','public.stock_items','calculation_version','UPDATE')
  or has_column_privilege('authenticated','public.vehicle_costs','deductible_vat_ore','UPDATE')
  or has_column_privilege('authenticated','public.vehicle_costs','deductible_vat_ore','INSERT')
 then raise exception 'Financial evidence can bypass its scoped RPC'; end if;
 if not has_column_privilege('authenticated','public.vehicle_costs','amount_ore','UPDATE') then raise exception 'Existing cost edits regressed'; end if;
 if has_function_privilege('anon','public.get_vehicle_calculation(uuid,uuid)','EXECUTE')
  or has_function_privilege('service_role','public.inventory_dashboard_totals(uuid)','EXECUTE')
  or has_function_privilege('anon','public.save_vehicle_calculation_metadata(uuid,uuid,text,text,boolean,jsonb)','EXECUTE')
 then raise exception 'Non-user financial execution grant'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_vehicle_calculation','save_vehicle_calculation_metadata','inventory_dashboard_totals') and p.prosecdef)
 then raise exception 'Exposed security definer'; end if;
end $$;
select 'PASS: financial metadata has explicit scoped grants and private privileged functions' as result;
rollback;
