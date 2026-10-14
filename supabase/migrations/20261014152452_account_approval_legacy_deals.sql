begin;
-- Acquire actual Auth/approval proof before waiting on legacy business locks.
alter function private.create_deal(uuid,uuid,uuid,bigint) rename to create_deal_approved_impl;
revoke all on function private.create_deal_approved_impl(uuid,uuid,uuid,bigint) from public,anon,authenticated,service_role;
create function private.create_deal(company uuid,stock uuid,customer uuid,price_ore bigint) returns uuid language plpgsql security definer set search_path='' as $$
begin perform 1 from private.company_team_identity(true);return private.create_deal_approved_impl(company,stock,customer,price_ore);end $$;
revoke all on function private.create_deal(uuid,uuid,uuid,bigint) from public,anon,service_role;
grant execute on function private.create_deal(uuid,uuid,uuid,bigint) to authenticated;
create or replace function public.create_deal(company uuid,stock uuid,customer uuid,price_ore bigint) returns uuid language sql security invoker set search_path='' as $$ select private.create_deal(company,stock,customer,price_ore); $$;
alter function private.reserve_vehicle(uuid,uuid,integer) rename to reserve_vehicle_approved_impl;
revoke all on function private.reserve_vehicle_approved_impl(uuid,uuid,integer) from public,anon,authenticated,service_role;
create function private.reserve_vehicle(company uuid,deal uuid,hours integer default 48) returns uuid language plpgsql security definer set search_path='' as $$
begin perform 1 from private.company_team_identity(true);return private.reserve_vehicle_approved_impl(company,deal,hours);end $$;
revoke all on function private.reserve_vehicle(uuid,uuid,integer) from public,anon,service_role;
grant execute on function private.reserve_vehicle(uuid,uuid,integer) to authenticated;
create or replace function public.reserve_vehicle(company uuid,deal uuid,hours integer default 48) returns uuid language sql security invoker set search_path='' as $$ select private.reserve_vehicle(company,deal,hours); $$;
alter function private.create_offer_version(uuid,uuid,uuid,text,date,boolean) rename to create_offer_version_approved_impl;
revoke all on function private.create_offer_version_approved_impl(uuid,uuid,uuid,text,date,boolean) from public,anon,authenticated,service_role;
create function private.create_offer_version(company uuid,deal uuid,submission uuid,terms text,valid_until date,gross_confirmed boolean) returns uuid language plpgsql security definer set search_path='' as $$
begin perform 1 from private.company_team_identity(true);return private.create_offer_version_approved_impl(company,deal,submission,terms,valid_until,gross_confirmed);end $$;
revoke all on function private.create_offer_version(uuid,uuid,uuid,text,date,boolean) from public,anon,service_role;
grant execute on function private.create_offer_version(uuid,uuid,uuid,text,date,boolean) to authenticated;
create or replace function public.create_offer_version(company uuid,deal uuid,submission uuid,terms text,valid_until date,gross_confirmed boolean)
returns uuid language sql security invoker set search_path='' as $$
 select private.create_offer_version(company,deal,submission,terms,valid_until,gross_confirmed);
$$;
commit;
