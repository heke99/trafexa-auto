begin;
create function private.list_stock_purchase_conditions(p_company_id uuid,p_stock_id uuid,p_before_version integer,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;r text;s public.stock_items;v public.vehicles;rows jsonb;latest integer;n integer;begin
 select actor,actor_role into a,r from private.purchase_condition_access(p_company_id);
 select * into s from public.stock_items where company_id=p_company_id and id=p_stock_id for share;
 if not found then raise exception 'Stock access denied' using errcode='42501';end if;
 select * into v from public.vehicles where company_id=p_company_id and id=s.vehicle_id for share;
 if not found then raise exception 'Vehicle access denied' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid page' using errcode='22023';end if;
 if p_before_version is not null and not exists(select 1 from private.purchase_condition_versions where company_id=p_company_id and stock_id=p_stock_id and version=p_before_version) then raise exception 'Cursor conflict' using errcode='40001';end if;
 select coalesce(max(version),0) into latest from private.purchase_condition_versions where company_id=p_company_id and stock_id=p_stock_id;
 select coalesce(jsonb_agg(private.purchase_condition_json(t) order by version desc),'[]') into rows from(select * from private.purchase_condition_versions where company_id=p_company_id and stock_id=p_stock_id and(p_before_version is null or version<p_before_version) order by version desc limit p_limit)t;
 if jsonb_array_length(rows)=p_limit and exists(select 1 from private.purchase_condition_versions where company_id=p_company_id and stock_id=p_stock_id and version<(rows->(p_limit-1)->>'version')::integer) then n:=(rows->(p_limit-1)->>'version')::integer;end if;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'stockId',p_stock_id,'businessDate',(clock_timestamp() at time zone 'Europe/Stockholm')::date,'latestVersion',latest,'nextBeforeVersion',n,'canCreate',s.status in ('available','reserved'),'basis',private.purchase_condition_basis(s,v),'versions',rows);
end$$;
create function private.get_purchase_condition_version(p_company_id uuid,p_stock_id uuid,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;r text;t private.purchase_condition_versions;begin
 select actor,actor_role into a,r from private.purchase_condition_access(p_company_id);
 perform 1 from public.stock_items where company_id=p_company_id and id=p_stock_id for share;
 if not found then raise exception 'Stock access denied' using errcode='42501';end if;
 if p_version is null or p_version<1 then raise exception 'Invalid version' using errcode='22023';end if;
 select * into t from private.purchase_condition_versions where company_id=p_company_id and stock_id=p_stock_id and version=p_version;
 if not found then raise exception 'Version conflict' using errcode='40001';end if;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'purchaseCondition',private.purchase_condition_json(t));end$$;
create function public.list_stock_purchase_conditions(p_company_id uuid,p_stock_id uuid,p_before_version integer default null,p_limit integer default 50) returns jsonb language sql security invoker set search_path='' as $$select private.list_stock_purchase_conditions(p_company_id,p_stock_id,p_before_version,p_limit);$$;
create function public.get_purchase_condition_version(p_company_id uuid,p_stock_id uuid,p_version integer) returns jsonb language sql security invoker set search_path='' as $$select private.get_purchase_condition_version(p_company_id,p_stock_id,p_version);$$;
revoke all on function private.list_stock_purchase_conditions(uuid,uuid,integer,integer),private.get_purchase_condition_version(uuid,uuid,integer),public.list_stock_purchase_conditions(uuid,uuid,integer,integer),public.get_purchase_condition_version(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.list_stock_purchase_conditions(uuid,uuid,integer,integer),private.get_purchase_condition_version(uuid,uuid,integer),public.list_stock_purchase_conditions(uuid,uuid,integer,integer),public.get_purchase_condition_version(uuid,uuid,integer) to authenticated;
commit;
