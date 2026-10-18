begin;
-- Negative-only deployment check: no customer, legal invoice, cash entry or mail is created.
do $$
declare name text;begin
 foreach name in array array['get_platform_advertising_payment_page(uuid,uuid,text)','list_advertising_payment_page(uuid,uuid,text)','lookup_advertising_payment(uuid,uuid,text)','register_advertising_payment(uuid,uuid,text,text,text,text,text,date,text,uuid,text,boolean,uuid)','reverse_advertising_payment(uuid,uuid,text,text,uuid,text,boolean,uuid)'] loop
  if has_function_privilege('anon','public.'||name,'execute') or has_function_privilege('service_role','public.'||name,'execute') then raise exception 'Unexpected payment RPC permission';end if;
 end loop;
 if has_table_privilege('authenticated','private.advertising_payment_entries','select') or has_table_privilege('authenticated','private.advertising_payment_entries','insert') or has_table_privilege('service_role','private.advertising_payment_entries','insert') then raise exception 'Unexpected payment table privilege';end if;
 if not (select relrowsecurity from pg_class where oid='private.advertising_payment_entries'::regclass) then raise exception 'Missing payment RLS';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
do $$begin
 begin
  perform public.get_platform_advertising_payment_page('75000000-0000-4000-8000-000000009901','75000000-0000-4000-8000-000000009902',null);
  raise exception 'Unauthenticated payment read unexpectedly accepted';
 exception when insufficient_privilege then null;end;
end $$;
rollback;
