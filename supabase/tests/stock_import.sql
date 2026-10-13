-- Run as migration administrator in an isolated test database. Every fixture rolls back.
begin;
create temporary table import_fixtures(key text primary key,id uuid not null);
grant select on import_fixtures to authenticated,anon;
insert into import_fixtures values('owner',gen_random_uuid()),('viewer',gen_random_uuid()),('other_owner',gen_random_uuid()),('company',gen_random_uuid()),('other_company',gen_random_uuid()),('submission',gen_random_uuid());
insert into auth.users(id,email,email_confirmed_at) select id,key||'@stock-import.test.invalid',now() from import_fixtures where key in ('owner','viewer','other_owner');
insert into public.companies(id,name,organisation_number,created_by) values
 ((select id from import_fixtures where key='company'),'Import tests A','5560000051',(select id from import_fixtures where key='owner')),
 ((select id from import_fixtures where key='other_company'),'Import tests B','5560000052',(select id from import_fixtures where key='other_owner'));
insert into public.memberships(company_id,user_id,role) values
 ((select id from import_fixtures where key='company'),(select id from import_fixtures where key='owner'),'owner'),
 ((select id from import_fixtures where key='company'),(select id from import_fixtures where key='viewer'),'viewer'),
 ((select id from import_fixtures where key='other_company'),(select id from import_fixtures where key='other_owner'),'owner');
-- Force a write-stage failure on the second record, after a valid first record
-- has already been inserted. This proves actual transactional rollback.
create function pg_temp.reject_second_import_vehicle() returns trigger language plpgsql set search_path='' as $$
begin
 if new.registration_number='ROLLFAIL' then raise exception 'Test write failure' using errcode='23514'; end if;
 return new;
end $$;
create trigger import_write_failure before insert on public.vehicles for each row execute function pg_temp.reject_second_import_vehicle();
select set_config('request.jwt.claim.sub',(select id::text from import_fixtures where key='owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from import_fixtures where key='owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare company uuid; submission uuid; payload jsonb; changed jsonb; blocked boolean; count_before integer; begin
 select id into company from import_fixtures where key='company';
 select id into submission from import_fixtures where key='submission';
 payload:='[{"registration_number":"IMP001","make":"Volvo","model":"V60","model_year":2022,"mileage_km":50000,"fuel":"hybrid","gearbox":"automatic","purchase_price_ore":12500029,"asking_price_ore":15900009,"vat_scheme":"unknown"},{"registration_number":"IMP002","make":"Saab","model":"9-3","model_year":2011,"mileage_km":250000,"fuel":"petrol","gearbox":"manual","purchase_price_ore":0,"asking_price_ore":100,"vat_scheme":"standard"}]'::jsonb;
 if public.import_stock_batch(company,submission,payload)!=2 then raise exception 'FAIL atomic batch count'; end if;
 if (select count(*) from public.stock_items where company_id=company)!=2 then raise exception 'FAIL imported stocks'; end if;
 if not exists(select 1 from public.stock_items where company_id=company and purchase_price_ore=12500029 and asking_price_ore=15900009 and vat_scheme='unknown') then raise exception 'FAIL exact money/VAT'; end if;
 if public.import_stock_batch(company,submission,payload)!=2 then raise exception 'FAIL idempotent count'; end if;
 if (select count(*) from public.stock_items where company_id=company)!=2 then raise exception 'FAIL repeated import duplicates'; end if;
 changed:=jsonb_set(payload,'{0,model}','"V90"'::jsonb);
 blocked:=false;begin perform public.import_stock_batch(company,submission,changed);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL changed submission accepted'; end if;
 if public.stock_import_duplicate_registrations(company,array['IMP001','NEW001'])!=array['IMP001'] then raise exception 'FAIL existing inventory duplicate review'; end if;
 -- A new valid record followed by an existing registration must leave no partial writes.
 changed:=jsonb_set(payload,'{0,registration_number}','"IMP003"'::jsonb);
 blocked:=false;begin perform public.import_stock_batch(company,gen_random_uuid(),changed);exception when unique_violation then blocked:=true;end;
 if not blocked or exists(select 1 from public.vehicles where company_id=company and registration_number='IMP003') then raise exception 'FAIL partial duplicate import'; end if;
 changed:=jsonb_set(jsonb_set(payload,'{0,registration_number}','"IMP003"'::jsonb),'{1,registration_number}','"ROLLFAIL"'::jsonb);
 blocked:=false;begin perform public.import_stock_batch(company,gen_random_uuid(),changed);exception when check_violation then blocked:=true;end;
 if not blocked or exists(select 1 from public.vehicles where company_id=company and registration_number='IMP003')
  or (select count(*) from public.stock_items where company_id=company)!=2 then raise exception 'FAIL write-stage atomic rollback'; end if;
 changed:=jsonb_set(payload,'{1,registration_number}','" i m p001 "'::jsonb);
 blocked:=false;begin perform public.import_stock_batch(company,gen_random_uuid(),changed);exception when unique_violation then blocked:=true;end;
 if not blocked then raise exception 'FAIL normalized file duplicates'; end if;
 changed:=jsonb_set(jsonb_set(payload,'{0,registration_number}','"IMP003"'::jsonb),'{1,vat_scheme}','""'::jsonb);
 blocked:=false;begin perform public.import_stock_batch(company,gen_random_uuid(),changed);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked or exists(select 1 from public.vehicles where registration_number='IMP003') then raise exception 'FAIL missing VAT or partial validation'; end if;
 blocked:=false;begin perform public.import_stock_batch(company,gen_random_uuid(),'[]'::jsonb);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL empty batch'; end if;
 blocked:=false;begin perform public.import_stock_batch(company,gen_random_uuid(),(select jsonb_agg(payload->0) from generate_series(1,501)));exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL oversized batch'; end if;
 blocked:=false;begin perform public.import_stock_batch(company,gen_random_uuid(),jsonb_build_array(jsonb_set(payload->0,'{purchase_price_ore}','1.001'::jsonb)));exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL fractional ore'; end if;
 blocked:=false;begin perform public.import_stock_batch((select id from import_fixtures where key='other_company'),gen_random_uuid(),payload);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL cross tenant import'; end if;
 blocked:=false;begin perform public.stock_import_duplicate_registrations((select id from import_fixtures where key='other_company'),array['IMP001']);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL cross tenant preview'; end if;
 blocked:=false;begin perform 1 from private.stock_import_batches;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL exposed receipt table'; end if;
 -- Direct stock creation or updates with differently formatted registration must
 -- also obey the normalized index; imports cannot create another vehicle identity.
 blocked:=false;begin perform public.create_stock(company,'i m p001','Volvo','V60',2022,50000,'hybrid','automatic',0,100,'unknown');exception when unique_violation then blocked:=true;end;
 if not blocked then raise exception 'FAIL normalized manual stock identity'; end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from private.stock_import_batches where company_id=(select id from import_fixtures where key='company'))!=1 then raise exception 'FAIL failed/retried receipt records'; end if;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from import_fixtures where key='viewer'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from import_fixtures where key='viewer'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare blocked boolean:=false; begin
 if public.stock_import_duplicate_registrations((select id from import_fixtures where key='company'),array['IMP001'])!=array['IMP001'] then raise exception 'FAIL viewer preview'; end if;
 begin perform public.import_stock_batch((select id from import_fixtures where key='company'),gen_random_uuid(),'[]'::jsonb);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL viewer import'; end if;
end $$;
reset role;
update public.memberships set status='suspended' where user_id=(select id from import_fixtures where key='owner');
select set_config('request.jwt.claim.sub',(select id::text from import_fixtures where key='owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from import_fixtures where key='owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare blocked boolean:=false; begin
 begin perform public.import_stock_batch((select id from import_fixtures where key='company'),(select id from import_fixtures where key='submission'),'[]'::jsonb);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL suspended import replay'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ declare blocked boolean:=false; begin
 begin perform public.import_stock_batch((select id from import_fixtures where key='company'),gen_random_uuid(),'[]'::jsonb);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL anonymous import'; end if;
end $$;
reset role;
select 'PASS: stock import atomicity, exact öre, explicit VAT, file/stock duplicates, normalized identity, idempotence and changed-payload rejection, limits, own-tenant preview, viewer/suspended/anonymous restrictions, internal receipts' as result;
rollback;
