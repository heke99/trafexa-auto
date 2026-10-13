-- Rollback-only local permissions/introspection; no credentials or provider sends.
begin;
do $$declare f text;t text;r text;begin
 foreach f in array array['list_vehicle_photos(uuid,uuid,uuid,integer)','get_vehicle_photo(uuid,uuid)',
  'list_advertising_stock(uuid,uuid,integer)','list_company_advertising(uuid,uuid,uuid,integer)','get_stock_advertising(uuid,uuid)',
  'register_vehicle_photo(uuid,uuid,uuid,text,text,bigint,uuid)','archive_vehicle_photo(uuid,uuid,integer,uuid)',
  'save_vehicle_advertisement(uuid,uuid,uuid,integer,text,text,uuid[],boolean,uuid)','mark_vehicle_advertisement_ready(uuid,uuid,integer,uuid)',
  'send_vehicle_advertisement(uuid,uuid,integer,text[],uuid)','request_advertising_connection(uuid,text,text,uuid)'] loop
  assert not(select prosecdef from pg_proc where oid=('public.'||f)::regprocedure),'Public definer forbidden';
  assert has_function_privilege('authenticated','public.'||f,'EXECUTE'),'Auth grant missing';
  assert not has_function_privilege('anon','public.'||f,'EXECUTE'),'Anon RPC forbidden';
  assert not has_function_privilege('service_role','public.'||f,'EXECUTE'),'Service cannot impersonate user';
 end loop;
 foreach f in array array['get_advertising_job(uuid)','claim_advertising_job(uuid,integer,uuid)','expire_advertising_dispatch(uuid,integer)',
  'save_advertising_job(uuid,integer,uuid,text,text,text,text)','refresh_advertising_dispatcher(text,text,timestamptz)'] loop
  assert not(select prosecdef from pg_proc where oid=('public.'||f)::regprocedure),'Public worker definer forbidden';
  assert has_function_privilege('service_role','public.'||f,'EXECUTE'),'Worker grant missing';
  assert not has_function_privilege('authenticated','public.'||f,'EXECUTE'),'User cannot impersonate worker';
  assert not has_function_privilege('anon','public.'||f,'EXECUTE'),'Anon worker forbidden';
 end loop;
 foreach t in array array['vehicle_photos','advertising_listings','advertising_versions','advertising_connections','advertising_dispatchers','advertising_jobs','advertising_job_events','advertising_audit'] loop
  assert(select relrowsecurity from pg_class where oid=('private.'||t)::regclass),'RLS required';
  foreach r in array array['anon','authenticated','service_role'] loop
   assert not has_table_privilege(r,'private.'||t,'SELECT'),'Private direct read forbidden';
   assert not has_table_privilege(r,'private.'||t,'INSERT'),'Private direct insert forbidden';
   assert not has_table_privilege(r,'private.'||t,'UPDATE'),'Private direct update forbidden';
  end loop;
 end loop;
 assert(select bool_and(proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in ('advertising_read','advertising_mutate','advertising_worker','vehicle_photo_storage_access')),'Locked search paths required';
 assert not has_function_privilege('service_role','private.company_team_identity(boolean)','EXECUTE'),'Old helper widened';
 assert not has_table_privilege('authenticated','public.memberships','UPDATE'),'Membership direct writes widened';
 -- Hosted Supabase grants object-table DML globally; bucket authorization is RLS.
 -- This release has only scoped SELECT/INSERT policies. A future client policy
 -- for UPDATE/DELETE/ALL requires review against both advertising buckets.
 assert(select relrowsecurity from pg_class where oid='storage.objects'::regclass),'Storage object RLS required';
 assert not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
  and cmd in ('UPDATE','DELETE','ALL') and roles && array['public','anon','authenticated']::name[]),'Advertising images must have no client overwrite/delete policy';
 assert not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
  and roles && array['public','anon','authenticated']::name[] and (coalesce(qual,'')||coalesce(with_check,'')) like '%ads-export-media%'),'Export bucket must have no client policy';
 assert(select public=false and file_size_limit=10485760 from storage.buckets where id='ads-vehicle-photos'),'Photo bucket must be private';
end $$;
rollback;
