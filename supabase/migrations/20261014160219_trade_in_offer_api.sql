begin;
create or replace function private.create_offer_version(company uuid,deal uuid,submission uuid,terms text,valid_until date,gross_confirmed boolean) returns uuid language plpgsql security definer set search_path='' as $$begin return private.create_offer_version_with_trade_in(company,deal,submission,terms,valid_until,gross_confirmed,null,null,null,null);end$$;
-- Invoker entrypoints preserve both account gates and fresh company/member locks.
create function public.create_offer_version_with_trade_in(company uuid,deal uuid,submission uuid,terms text,valid_until date,gross_confirmed boolean,trade_in_id uuid,expected_trade_in_version integer,expected_offer_version integer,expected_sale_price_ore bigint) returns uuid language plpgsql security invoker set search_path='' as $$begin
 if current_user<>'authenticated' then raise exception 'Authenticated user required' using errcode='42501';end if;
 if expected_offer_version is null or expected_sale_price_ore is null then raise exception 'Offer expectations required' using errcode='22023';end if;
 return private.create_offer_version_with_trade_in(company,deal,submission,terms,valid_until,gross_confirmed,trade_in_id,expected_trade_in_version,expected_offer_version,expected_sale_price_ore);
end$$;
revoke all on function private.create_offer_version(uuid,uuid,uuid,text,date,boolean),private.create_offer_version_with_trade_in(uuid,uuid,uuid,text,date,boolean,uuid,integer,integer,bigint),public.create_offer_version_with_trade_in(uuid,uuid,uuid,text,date,boolean,uuid,integer,integer,bigint) from public,anon,authenticated,service_role;
grant execute on function private.create_offer_version(uuid,uuid,uuid,text,date,boolean),private.create_offer_version_with_trade_in(uuid,uuid,uuid,text,date,boolean,uuid,integer,integer,bigint),public.create_offer_version_with_trade_in(uuid,uuid,uuid,text,date,boolean,uuid,integer,integer,bigint) to authenticated;
-- Customer payload projection includes only whitelisted attachment identity and totals.
alter function private.offer_review_snapshot(jsonb) rename to offer_review_snapshot_base;
revoke all on function private.offer_review_snapshot_base(jsonb) from public,anon,authenticated,service_role;
create function private.offer_review_snapshot(s jsonb) returns jsonb language sql immutable set search_path='' as $$select private.offer_review_snapshot_base(s)||case when s?'trade_in' then jsonb_build_object('trade_in',(select jsonb_object_agg(k,s->'trade_in'->k) from unnest(array['id','version','registration','make','model','model_year','mileage_km','value_ore','debt_known','debt_ore','net_trade_in_ore','amount_to_pay_ore'])k)) else '{}'::jsonb end;$$;
revoke all on function private.offer_review_snapshot(jsonb) from public,anon,authenticated,service_role;
commit;
