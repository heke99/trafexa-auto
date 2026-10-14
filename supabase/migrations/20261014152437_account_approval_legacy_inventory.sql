begin;
-- Acquire actual Auth/approval proof before waiting on legacy business locks.
alter function private.import_stock_batch(uuid,uuid,jsonb) rename to import_stock_batch_approved_impl;
revoke all on function private.import_stock_batch_approved_impl(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function private.import_stock_batch(company uuid,submission uuid,payload jsonb) returns integer language plpgsql security definer set search_path='' as $$
begin perform 1 from private.company_team_identity(true);return private.import_stock_batch_approved_impl(company,submission,payload);end $$;
revoke all on function private.import_stock_batch(uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function private.import_stock_batch(uuid,uuid,jsonb) to authenticated;
create or replace function public.import_stock_batch(company uuid,submission uuid,payload jsonb)
returns integer language sql security invoker set search_path='' as $$
 select private.import_stock_batch(company,submission,payload);
$$;
alter function private.create_stock(uuid,text,text,text,integer,integer,text,text,bigint,bigint,text) rename to create_stock_approved_impl;
revoke all on function private.create_stock_approved_impl(uuid,text,text,text,integer,integer,text,text,bigint,bigint,text) from public,anon,authenticated,service_role;
create function private.create_stock(company uuid, registration text, make_name text, model_name text, year integer, mileage integer, fuel_type text, gearbox_type text, purchase_ore bigint, asking_ore bigint, vat text) returns uuid language plpgsql security definer set search_path='' as $$
begin perform 1 from private.company_team_identity(true);return private.create_stock_approved_impl(company,registration,make_name,model_name,year,mileage,fuel_type,gearbox_type,purchase_ore,asking_ore,vat);end $$;
revoke all on function private.create_stock(uuid,text,text,text,integer,integer,text,text,bigint,bigint,text) from public,anon,service_role;
grant execute on function private.create_stock(uuid,text,text,text,integer,integer,text,text,bigint,bigint,text) to authenticated;
create or replace function public.create_stock(company uuid,registration text,make_name text,model_name text,year integer,mileage integer,fuel_type text,gearbox_type text,purchase_ore bigint,asking_ore bigint,vat text) returns uuid language sql security invoker set search_path='' as $$ select private.create_stock(company,registration,make_name,model_name,year,mileage,fuel_type,gearbox_type,purchase_ore,asking_ore,vat); $$;
alter function private.create_customer_lead(uuid,uuid,text,text,text,text) rename to create_customer_lead_approved_impl;
revoke all on function private.create_customer_lead_approved_impl(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
create function private.create_customer_lead(company uuid,submission uuid,contact_name text,contact_email text,contact_phone text,lead_subject text) returns uuid language plpgsql security definer set search_path='' as $$
begin perform 1 from private.company_team_identity(true);return private.create_customer_lead_approved_impl(company,submission,contact_name,contact_email,contact_phone,lead_subject);end $$;
revoke all on function private.create_customer_lead(uuid,uuid,text,text,text,text) from public,anon,service_role;
grant execute on function private.create_customer_lead(uuid,uuid,text,text,text,text) to authenticated;
create or replace function public.create_customer_lead(company uuid,submission uuid,contact_name text,contact_email text,contact_phone text,lead_subject text)
returns uuid language sql security invoker set search_path='' as $$
 select private.create_customer_lead(company,submission,contact_name,contact_email,contact_phone,lead_subject);
$$;
commit;
