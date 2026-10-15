begin;
-- Versioned quantity boundary preserves older deployed readers while financial prices
-- are now owned by the separate, immutable billing domain.
create function private.advertising_quantities(p_company uuid,p_month text,p_platform boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; missing bigint;begin
 perform private.advertising_billing_context(p_company,p_platform);
 result:=private.advertising_usage_read(p_company,p_month,p_platform);
 select count(*) into missing from private.advertising_publications p
 left join private.advertising_publication_prices v on v.publication_id=p.id
 where p.company_id=p_company and p.first_published_at>=(result->>'periodStart')::timestamptz
 and p.first_published_at<(result->>'periodEnd')::timestamptz and v.publication_id is null;
 return jsonb_set(result,'{billing}',jsonb_build_object('status','quantity_only','unitPriceOre',null,'totalOre',null,'unpricedPublications',missing));
end$$;
create function public.list_advertising_quantities(p_company_id uuid,p_month text) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_quantities(p_company_id,p_month,false);$$;
create function public.get_platform_advertising_quantities(p_company_id uuid,p_month text) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_quantities(p_company_id,p_month,true);$$;
revoke all on function private.advertising_quantities(uuid,text,boolean),public.list_advertising_quantities(uuid,text),public.get_platform_advertising_quantities(uuid,text) from public,anon,service_role;
grant execute on function private.advertising_quantities(uuid,text,boolean),public.list_advertising_quantities(uuid,text),public.get_platform_advertising_quantities(uuid,text) to authenticated;
commit;
