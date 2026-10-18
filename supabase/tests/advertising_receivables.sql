begin;
-- Negative-only permission proof: no Auth identities, invoices, credits, payments or emails are written.
do $$begin
 if has_function_privilege('anon','public.get_platform_advertising_receivables(text,jsonb)','execute') or has_function_privilege('service_role','public.get_platform_advertising_receivables(text,jsonb)','execute') then raise exception 'Unexpected receivables public privilege';end if;
 if has_function_privilege('authenticated','private.advertising_receivables_context()','execute') or has_function_privilege('authenticated','private.advertising_receivables_item(jsonb,numeric,date)','execute') then raise exception 'Unexpected internal helper privilege';end if;
 if (select prosecdef from pg_proc where oid='public.get_platform_advertising_receivables(text,jsonb)'::regprocedure) then raise exception 'Public receivables wrapper must be invoker';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
do $$begin
 begin perform public.get_platform_advertising_receivables('all',null);raise exception 'Unauthenticated receivables read unexpectedly accepted';exception when insufficient_privilege then null;end;
end $$;
rollback;
