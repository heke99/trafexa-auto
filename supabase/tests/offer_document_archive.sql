-- Local/approved-environment rollback test. No fixtures are retained.
begin;
create temporary table offer_archive_fixtures(key text primary key,id uuid not null default gen_random_uuid(),payload jsonb);
grant select,insert,update on offer_archive_fixtures to authenticated,anon,service_role;
insert into offer_archive_fixtures(key) select unnest(array['owner','admin','finance','sales','viewer','owner_b','company','company_b','customer','customer_b','vehicle','vehicle_b','stock','stock_b','deal','deal_b','submission','ordinary_document']);
insert into auth.users(id,email,email_confirmed_at)
 select id,key||'-offer-archive@example.test',now() from offer_archive_fixtures where key in('owner','admin','finance','sales','viewer','owner_b');
insert into public.companies(id,name,organisation_number,created_by) values
 ((select id from offer_archive_fixtures where key='company'),'Archive A','5560000001',(select id from offer_archive_fixtures where key='owner')),
 ((select id from offer_archive_fixtures where key='company_b'),'Archive B','5560000002',(select id from offer_archive_fixtures where key='owner_b'));
insert into public.memberships(company_id,user_id,role)
 select (select id from offer_archive_fixtures where key='company'),id,key from offer_archive_fixtures where key in('owner','admin','finance','sales','viewer');
insert into public.memberships(company_id,user_id,role) values
 ((select id from offer_archive_fixtures where key='company_b'),(select id from offer_archive_fixtures where key='owner_b'),'owner');
insert into public.customers(id,company_id,name) values
 ((select id from offer_archive_fixtures where key='customer'),(select id from offer_archive_fixtures where key='company'),'Zoë Åström'),
 ((select id from offer_archive_fixtures where key='customer_b'),(select id from offer_archive_fixtures where key='company_b'),'Customer B');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year) values
 ((select id from offer_archive_fixtures where key='vehicle'),(select id from offer_archive_fixtures where key='company'),'OAR001','Volvo','V60',2025),
 ((select id from offer_archive_fixtures where key='vehicle_b'),(select id from offer_archive_fixtures where key='company_b'),'OAR002','Volvo','V90',2025);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme) values
 ((select id from offer_archive_fixtures where key='stock'),(select id from offer_archive_fixtures where key='company'),(select id from offer_archive_fixtures where key='vehicle'),100000,230000,'unknown'),
 ((select id from offer_archive_fixtures where key='stock_b'),(select id from offer_archive_fixtures where key='company_b'),(select id from offer_archive_fixtures where key='vehicle_b'),100000,330000,'standard');
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by) values
 ((select id from offer_archive_fixtures where key='deal'),(select id from offer_archive_fixtures where key='company'),(select id from offer_archive_fixtures where key='stock'),(select id from offer_archive_fixtures where key='customer'),230000,(select id from offer_archive_fixtures where key='owner')),
 ((select id from offer_archive_fixtures where key='deal_b'),(select id from offer_archive_fixtures where key='company_b'),(select id from offer_archive_fixtures where key='stock_b'),(select id from offer_archive_fixtures where key='customer_b'),330000,(select id from offer_archive_fixtures where key='owner_b'));

select set_config('request.jwt.claim.sub',(select id::text from offer_archive_fixtures where key='owner'),true);
set local role authenticated;
insert into offer_archive_fixtures(key,id) values('offer',public.create_offer_version(
 (select id from offer_archive_fixtures where key='company'),(select id from offer_archive_fixtures where key='deal'),
 (select id from offer_archive_fixtures where key='submission'),'Immutable offer',(now() at time zone 'Europe/Stockholm')::date+30,true));
do $$ declare source jsonb; c uuid; o uuid; blocked boolean:=false; begin
 select id into c from offer_archive_fixtures where key='company';select id into o from offer_archive_fixtures where key='offer';
 source:=public.get_offer_archive_source(c,o);
 if source->>'document_kind'<>'other' or source->>'document_name'<>'Offert v1 – OAR001'
  or source->>'storage_bucket'<>'dealer-documents' or source->>'storage_visibility'<>'private'
  or source#>>'{snapshot,stock,vat_scheme}'<>'unknown'
  or source->>'snapshot_sha256'<>(select encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') from public.offers where id=o) then
  raise exception 'FAIL offer source identity/actual private bucket/snapshot hash/unknown VAT'; end if;
 if public.get_offer_document_archive(c,o) is not null then raise exception 'FAIL archive exists before registration'; end if;
 begin perform 1 from storage.buckets;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL broadened bucket catalog grants'; end if;
 update offer_archive_fixtures set payload=source where key='offer';
end $$;
reset role;
-- Ordinary authenticated users cannot poison immutable archive metadata, even
-- with an actual object, correct snapshot digest and their own verified user ID.
set local role authenticated;
do $$ declare c uuid; o uuid; source jsonb; blocked boolean:=false;begin
 select id,payload into o,source from offer_archive_fixtures where key='offer';select id into c from offer_archive_fixtures where key='company';
 begin perform public.register_offer_document_archive(c,o,1,repeat('a',64),source->>'snapshot_sha256',c::text||'/offers/'||o::text||'/v1/'||repeat('a',64)||'.pdf',gen_random_uuid(),auth.uid());exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL direct authenticated render/archive poisoning'; end if;
end $$;
reset role;
update storage.buckets set public=true where id='dealer-documents';
set local role authenticated;
do $$ declare blocked boolean:=false;begin
 begin perform public.get_offer_archive_source((select id from offer_archive_fixtures where key='company'),(select id from offer_archive_fixtures where key='offer'));exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL public bucket accepted by source RPC'; end if;
end $$;
reset role;
update storage.buckets set public=false where id='dealer-documents';
-- The privileged server uses a verified actor parameter, never service auth.uid.
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
do $$ declare c uuid; o uuid; actor uuid; source jsonb; path text; archive jsonb; blocked boolean; before_docs integer;begin
 select id,payload into o,source from offer_archive_fixtures where key='offer';select id into c from offer_archive_fixtures where key='company';select id into actor from offer_archive_fixtures where key='owner';
 path:=c::text||'/offers/'||o::text||'/v1/'||repeat('a',64)||'.pdf';select count(*) into before_docs from public.documents;
 if auth.uid() is not null then raise exception 'FAIL service fixture has user identity'; end if;
 blocked:=false;begin perform public.register_offer_document_archive(c,o,1,repeat('a',64),source->>'snapshot_sha256',path,gen_random_uuid(),actor);exception when no_data_found then blocked:=true;end;
 if not blocked then raise exception 'FAIL missing storage object accepted'; end if;
 insert into storage.objects(bucket_id,name,metadata) values('dealer-documents',path,'{"mimetype":"image/png"}');
 blocked:=false;begin perform public.register_offer_document_archive(c,o,1,repeat('a',64),source->>'snapshot_sha256',path,gen_random_uuid(),actor);exception when check_violation then blocked:=true;end;
 if not blocked then raise exception 'FAIL non-PDF catalog metadata accepted'; end if;
 if (select count(*) from public.documents)<>before_docs then raise exception 'FAIL failed registration inserted document'; end if;
 update storage.objects set metadata='{"mimetype":"application/pdf","size":1000}' where bucket_id='dealer-documents' and name=path;
 blocked:=false;begin perform public.register_offer_document_archive(c,o,2,repeat('a',64),source->>'snapshot_sha256',path,gen_random_uuid(),actor);exception when serialization_failure then blocked:=true;end;
 if not blocked then raise exception 'FAIL wrong offer version'; end if;
 blocked:=false;begin perform public.register_offer_document_archive(c,o,1,repeat('a',64),repeat('b',64),path,gen_random_uuid(),actor);exception when serialization_failure then blocked:=true;end;
 if not blocked then raise exception 'FAIL wrong snapshot hash'; end if;
 blocked:=false;begin perform public.register_offer_document_archive(c,o,1,repeat('a',64),source->>'snapshot_sha256',c::text||'/../offer.pdf',gen_random_uuid(),actor);exception when serialization_failure then blocked:=true;end;
 if not blocked then raise exception 'FAIL forged path'; end if;
 blocked:=false;begin perform public.register_offer_document_archive(c,o,1,'bad',source->>'snapshot_sha256',path,gen_random_uuid(),actor);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL malformed hash'; end if;
 blocked:=false;begin perform public.register_offer_document_archive(c,o,1,repeat('a',64),source->>'snapshot_sha256',path,null,actor);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL missing nonce'; end if;
 for actor in select id from offer_archive_fixtures where key in('viewer','sales','owner_b') loop
  blocked:=false;begin perform public.register_offer_document_archive(c,o,1,repeat('a',64),source->>'snapshot_sha256',path,gen_random_uuid(),actor);exception when insufficient_privilege then blocked:=true;end;
  if not blocked then raise exception 'FAIL unqualified/cross-company verified actor'; end if;
 end loop;
 select id into actor from offer_archive_fixtures where key='owner';
 archive:=public.register_offer_document_archive(c,o,1,repeat('a',64),source->>'snapshot_sha256',path,(select id from offer_archive_fixtures where key='submission'),actor);
 if archive->>'document_kind'<>'other' or archive->>'document_name'<>source->>'document_name' or archive->>'archived_by'<>actor::text
   or archive->>'company_id'<>c::text or archive->>'offer_id'<>o::text or archive->>'deal_id'<>(select id::text from offer_archive_fixtures where key='deal')
   or archive->>'storage_visibility'<>'private' then raise exception 'FAIL derived metadata or verified actor'; end if;
 if not exists(select 1 from public.documents d where d.id=(archive->>'document_id')::uuid and d.company_id=c and d.deal_id=(archive->>'deal_id')::uuid
   and d.kind='other' and d.name=source->>'document_name' and d.object_path=path) then raise exception 'FAIL document link'; end if;
 if public.register_offer_document_archive(c,o,1,repeat('a',64),source->>'snapshot_sha256',path,gen_random_uuid(),actor)<>archive
  or (select count(*) from public.documents where object_path=path)<>1 then raise exception 'FAIL nonce retry duplicates or mutates receipt'; end if;
 for actor in select id from offer_archive_fixtures where key in('finance','admin') loop
  if public.register_offer_document_archive(c,o,1,repeat('a',64),source->>'snapshot_sha256',path,gen_random_uuid(),actor)<>archive then
   raise exception 'FAIL authorized finance/admin actor exact retry'; end if;
 end loop;
 insert into offer_archive_fixtures(key,id,payload) values('archive',(archive->>'document_id')::uuid,archive);
 insert into storage.objects(bucket_id,name,metadata) values('dealer-documents',c::text||'/offers/'||o::text||'/v1/'||repeat('b',64)||'.pdf','{"mimetype":"application/pdf"}');
 blocked:=false;begin perform public.register_offer_document_archive(c,o,1,repeat('b',64),archive->>'snapshot_sha256',c::text||'/offers/'||o::text||'/v1/'||repeat('b',64)||'.pdf',gen_random_uuid(),actor);exception when serialization_failure then blocked:=true;end;
 if not blocked then raise exception 'FAIL second artifact for same offer'; end if;
end $$;
reset role;
-- Recheck active verified actor and company even for an existing receipt.
update public.memberships set status='suspended' where user_id=(select id from offer_archive_fixtures where key='owner');
set local role service_role;
do $$ declare a jsonb; blocked boolean:=false;begin
 select payload into a from offer_archive_fixtures where key='archive';
 begin perform public.register_offer_document_archive((a->>'company_id')::uuid,(a->>'offer_id')::uuid,1,a->>'pdf_sha256',a->>'snapshot_sha256',a->>'object_path',gen_random_uuid(),(select id from offer_archive_fixtures where key='owner'));exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL revoked server actor replay'; end if;
end $$;
reset role;
update public.memberships set status='active' where user_id=(select id from offer_archive_fixtures where key='owner');
update public.companies set status='suspended' where id=(select id from offer_archive_fixtures where key='company');
set local role service_role;
do $$ declare a jsonb; blocked boolean:=false;begin
 select payload into a from offer_archive_fixtures where key='archive';
 begin perform public.register_offer_document_archive((a->>'company_id')::uuid,(a->>'offer_id')::uuid,1,a->>'pdf_sha256',a->>'snapshot_sha256',a->>'object_path',gen_random_uuid(),(select id from offer_archive_fixtures where key='owner'));exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL suspended company server replay'; end if;
end $$;
reset role;
update public.companies set status='active' where id=(select id from offer_archive_fixtures where key='company');
-- These files remain offers, so unknown VAT never creates signing approval.
insert into public.documents(id,company_id,deal_id,name,object_path,kind) values
 ((select id from offer_archive_fixtures where key='ordinary_document'),(select id from offer_archive_fixtures where key='company'),(select id from offer_archive_fixtures where key='deal'),'Ordinary document',(select id::text from offer_archive_fixtures where key='company')||'/ordinary.pdf','other');
set local role service_role;
do $$ declare blocked boolean:=false;begin
 update public.documents set name='Ordinary service update' where id=(select id from offer_archive_fixtures where key='ordinary_document');
 if not found then raise exception 'FAIL ordinary service document update'; end if;
 begin update public.documents set kind='contract' where id=(select id from offer_archive_fixtures where key='archive');exception when object_not_in_prerequisite_state then blocked:=true;end;
 if not blocked then raise exception 'FAIL linked document promoted to contract'; end if;
 blocked:=false;begin perform public.register_signing_document_version((select id from offer_archive_fixtures where key='company'),(select id from offer_archive_fixtures where key='archive'),1,repeat('a',64),(select payload->>'object_path' from offer_archive_fixtures where key='archive'),(select id from offer_archive_fixtures where key='owner'),'[]',1,1,repeat('a',64));exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL other offer document approved for signing'; end if;
end $$;
reset role;
do $$ declare blocked boolean:=false;begin
 if (select count(*) from public.offer_document_archives where offer_id=(select id from offer_archive_fixtures where key='offer'))<>1 then raise exception 'FAIL multiple archive links'; end if;
 if (select count(*) from public.audit_events where entity_table='documents' and entity_id=(select id from offer_archive_fixtures where key='archive') and action='INSERT')<>1 then raise exception 'FAIL document audit/duplicate audit'; end if;
 begin update public.offer_document_archives set pdf_sha256=repeat('c',64);exception when object_not_in_prerequisite_state then blocked:=true;end;
 if not blocked then raise exception 'FAIL privileged archive mutation'; end if;
 if has_function_privilege('authenticated','private.protect_offer_archive_document()','EXECUTE')
  or has_function_privilege('service_role','private.protect_offer_archive_document()','EXECUTE')
  or has_function_privilege('service_role','private.has_company_role(uuid,text[])','EXECUTE')
  or has_function_privilege('authenticated','public.register_offer_document_archive(uuid,uuid,integer,text,text,text,uuid,uuid)','EXECUTE')
  or has_function_privilege('authenticated','private.register_offer_document_archive(uuid,uuid,integer,text,text,text,uuid,uuid)','EXECUTE')
  or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('get_offer_archive_source','get_offer_document_archive','get_offer_archive_by_document','register_offer_document_archive') and p.prosecdef)
  or not exists(select 1 from pg_class where oid='public.offer_document_archives'::regclass and relrowsecurity) then
  raise exception 'FAIL archive function security/RLS/old helper escalation'; end if;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from offer_archive_fixtures where key='owner'),true);
set local role authenticated;
do $$ declare a jsonb; blocked boolean;begin
 select payload into a from offer_archive_fixtures where key='archive';
 if public.get_offer_document_archive((a->>'company_id')::uuid,(a->>'offer_id')::uuid)<>a
  or public.get_offer_archive_by_document((a->>'company_id')::uuid,(a->>'document_id')::uuid)<>a then raise exception 'FAIL owner reads/by-document receipt'; end if;
 blocked:=false;begin insert into public.offer_document_archives(company_id,offer_id,deal_id,offer_version,pdf_sha256,snapshot_sha256,object_path,document_id,document_name,submission_id,archived_by)
   values((a->>'company_id')::uuid,(a->>'offer_id')::uuid,(a->>'deal_id')::uuid,1,a->>'pdf_sha256',a->>'snapshot_sha256',a->>'object_path',(a->>'document_id')::uuid,'Forged contract',gen_random_uuid(),auth.uid());exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL direct archive insert'; end if;
 blocked:=false;begin update public.offer_document_archives set document_kind='contract';exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL direct approval/kind mutation'; end if;
 blocked:=false;begin delete from public.offer_document_archives;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL direct archive delete'; end if;
end $$;
reset role;
-- Finance/admin reads are permitted; viewer/sales and tenant B remain excluded.
select set_config('request.jwt.claim.sub',(select id::text from offer_archive_fixtures where key='finance'),true);
set local role authenticated;
do $$begin
 if public.get_offer_document_archive((select id from offer_archive_fixtures where key='company'),(select id from offer_archive_fixtures where key='offer')) is null then raise exception 'FAIL finance archive read'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from offer_archive_fixtures where key='admin'),true);
set local role authenticated;
do $$begin
 if public.get_offer_document_archive((select id from offer_archive_fixtures where key='company'),(select id from offer_archive_fixtures where key='offer')) is null then raise exception 'FAIL admin archive read'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from offer_archive_fixtures where key='sales'),true);
set local role authenticated;
do $$declare blocked boolean:=false;begin
 if exists(select 1 from public.offer_document_archives) then raise exception 'FAIL sales archive visibility'; end if;
 begin perform public.get_offer_archive_source((select id from offer_archive_fixtures where key='company'),(select id from offer_archive_fixtures where key='offer'));exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL sales archive source'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from offer_archive_fixtures where key='viewer'),true);
set local role authenticated;
do $$declare blocked boolean:=false;begin
 if exists(select 1 from public.offer_document_archives) then raise exception 'FAIL viewer archive visibility'; end if;
 begin perform public.get_offer_document_archive((select id from offer_archive_fixtures where key='company'),(select id from offer_archive_fixtures where key='offer'));exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL viewer archive read'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from offer_archive_fixtures where key='owner_b'),true);
set local role authenticated;
do $$declare blocked boolean:=false;begin
 if exists(select 1 from public.offer_document_archives) then raise exception 'FAIL B saw A archive'; end if;
 begin perform public.get_offer_archive_source((select id from offer_archive_fixtures where key='company'),(select id from offer_archive_fixtures where key='offer'));exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL cross-company archive source'; end if;
 blocked:=false;begin perform public.get_offer_archive_source((select id from offer_archive_fixtures where key='company_b'),(select id from offer_archive_fixtures where key='offer'));exception when no_data_found then blocked:=true;end;
 if not blocked then raise exception 'FAIL foreign offer mapped to B'; end if;
end $$;
reset role;
update public.memberships set status='suspended' where user_id=(select id from offer_archive_fixtures where key='owner');
select set_config('request.jwt.claim.sub',(select id::text from offer_archive_fixtures where key='owner'),true);
set local role authenticated;
do $$declare blocked boolean:=false;begin
 if exists(select 1 from public.offer_document_archives) then raise exception 'FAIL suspended archive read'; end if;
 begin perform public.get_offer_archive_source((select id from offer_archive_fixtures where key='company'),(select id from offer_archive_fixtures where key='offer'));exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL suspended archive source'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$declare blocked boolean:=false;begin
 begin perform public.get_offer_archive_source((select id from offer_archive_fixtures where key='company'),(select id from offer_archive_fixtures where key='offer'));exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL anonymous archive RPC'; end if;
end $$;
reset role;
select 'PASS: all real migrations, private catalog receipts without public grants, service-only render registration with active verified actor, snapshot SHA/offer-version/path binding, ordinary other-document registration, unknown VAT offer-only handling, exact nonce retries, one source artifact, atomic metadata/audit, immutability, ordinary service UPDATE preserved, no offer signing approval, finance/admin reads allowed, sales/viewer/suspended/anonymous/cross-company denied' as result;
rollback;
