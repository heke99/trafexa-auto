-- Read-only operator check. No customer/user rows, credentials or document bytes.
begin transaction read only;
select json_build_object(
 'functions',(select json_agg(json_build_object('name',r.name,'available',exists(
   select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'and p.proname=r.name and has_function_privilege('authenticated',p.oid,'execute'))))
   from(values('get_platform_admin_session'),('get_account_access'),('dealer_document_hub_page_v2'),('list_pdf_template_versions'),('get_customer_document_renewal'))r(name)),
 'scheduler',(select coalesce(json_agg(json_build_object('active',active,'schedule',schedule,'command',command)),'[]')from cron.job where jobname='trafexa-expire-reservations')
);
rollback;
