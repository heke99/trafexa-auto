-- Negative, rollback-only deployment proof. No fixture inserts, customer/Auth
-- records, capabilities, provider calls or real message dispatch.
begin;
do $$declare signature text;begin
 foreach signature in array array[
  'public.get_customer_document_renewal(uuid,uuid,uuid,text)',
  'public.renew_customer_document_link(uuid,uuid,uuid,text,uuid,uuid,integer,text,integer,text,text,text,uuid,boolean)'
 ]loop
  if has_function_privilege('anon',signature,'execute')or has_function_privilege('service_role',signature,'execute')or not has_function_privilege('authenticated',signature,'execute')then raise exception 'Unexpected dealer RPC privilege';end if;
 end loop;
 if has_function_privilege('authenticated','public.claim_transactional_email_exact(text,uuid,uuid)','execute')or has_function_privilege('anon','public.claim_transactional_email_exact(text,uuid,uuid)','execute')or not has_function_privilege('service_role','public.claim_transactional_email_exact(text,uuid,uuid)','execute')then raise exception 'Unexpected exact worker privilege';end if;
 if not(select relrowsecurity from pg_class where oid='private.customer_document_renewals'::regclass)
 or has_table_privilege('authenticated','private.customer_document_renewals','select')
 or has_table_privilege('authenticated','private.customer_document_renewals','insert')
 or has_table_privilege('service_role','private.customer_document_renewals','select')then raise exception 'Private review boundary failed';end if;
 if not exists(select 1 from pg_constraint where conrelid='private.transactional_email_outbox'::regclass and contype='u'
 and pg_get_constraintdef(oid)='UNIQUE (kind, reference_id, recipient, generation)')then raise exception 'Missing generation deduplication';end if;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
do $$begin
 begin
  perform public.get_customer_document_renewal('cd180000-0000-4000-8000-000000009901','cd180000-0000-4000-8000-000000009902','cd180000-0000-4000-8000-000000009903','contract_invitation');
  raise exception 'Unauthenticated dealer lifecycle read accepted';
 exception when insufficient_privilege then null;end;
 begin
  perform public.renew_customer_document_link('cd180000-0000-4000-8000-000000009901','cd180000-0000-4000-8000-000000009902','cd180000-0000-4000-8000-000000009903','contract_invitation','cd180000-0000-4000-8000-000000009904','cd180000-0000-4000-8000-000000009905',0,repeat('a',64),1,'synthetic-proof@example.invalid',repeat('b',64),'Negative deployment proof','cd180000-0000-4000-8000-000000009906',false);
  raise exception 'Unauthenticated renewal replay accepted';
 exception when insufficient_privilege then null;end;
end$$;
set local role service_role;
do $$begin
 begin
  perform public.claim_transactional_email_exact('contract_invitation','cd180000-0000-4000-8000-000000009903','cd180000-0000-4000-8000-000000009904');
  raise exception 'Missing reviewed queue job accepted';
 exception when serialization_failure then null;end;
 if public.check_transactional_email_lease('cd180000-0000-4000-8000-000000009904','cd180000-0000-4000-8000-000000009907')is distinct from false then raise exception 'Missing lease was accepted';end if;
end$$;
set local role postgres;
select jsonb_build_object('proof','PASS','negativeOnly',true,'providerCalled',false,'customerRecordsCreated',false)result;
rollback;
