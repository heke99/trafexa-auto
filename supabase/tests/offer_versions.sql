-- Run as migration administrator in an isolated database. All fixtures roll back.
begin;
create temporary table offer_fixtures(key text primary key,id uuid not null);
grant select,insert,update on offer_fixtures to authenticated;
grant select on offer_fixtures to anon;
insert into offer_fixtures select key,gen_random_uuid() from unnest(array[
 'owner','admin','sales','finance','viewer','other_owner','company','other_company',
 'customer','other_customer','vehicle','other_vehicle','stock','other_stock',
 'deal','second_deal','other_deal','submission'
]) key;
insert into auth.users(id,email,email_confirmed_at)
select id,key||'@offer-version.test.invalid',now() from offer_fixtures where key in ('owner','admin','sales','finance','viewer','other_owner');
insert into public.companies(id,name,organisation_number,created_by) values
 ((select id from offer_fixtures where key='company'),'Åberg Offer Company','5560000061',(select id from offer_fixtures where key='owner')),
 ((select id from offer_fixtures where key='other_company'),'Private Company B','5560000062',(select id from offer_fixtures where key='other_owner'));
insert into public.memberships(company_id,user_id,role)
select (select id from offer_fixtures where key='company'),id,key from offer_fixtures where key in ('owner','admin','sales','finance','viewer');
insert into public.memberships(company_id,user_id,role) values
 ((select id from offer_fixtures where key='other_company'),(select id from offer_fixtures where key='other_owner'),'owner');
insert into public.customers(id,company_id,name,email,address) values
 ((select id from offer_fixtures where key='customer'),(select id from offer_fixtures where key='company'),'Zoë Öström','zoe@offer.test.invalid','Ängsvägen 1'),
 ((select id from offer_fixtures where key='other_customer'),(select id from offer_fixtures where key='other_company'),'Private B',null,null);
insert into public.vehicles(id,company_id,registration_number,make,model,model_year,mileage_km) values
 ((select id from offer_fixtures where key='vehicle'),(select id from offer_fixtures where key='company'),'OFR001','Volvo','V60',2022,50000),
 ((select id from offer_fixtures where key='other_vehicle'),(select id from offer_fixtures where key='other_company'),'OFR002','Saab','9-3',2011,220000);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme) values
 ((select id from offer_fixtures where key='stock'),(select id from offer_fixtures where key='company'),(select id from offer_fixtures where key='vehicle'),10000000,25000000,'standard'),
 ((select id from offer_fixtures where key='other_stock'),(select id from offer_fixtures where key='other_company'),(select id from offer_fixtures where key='other_vehicle'),10000,100000,'unknown');
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by) values
 ((select id from offer_fixtures where key='deal'),(select id from offer_fixtures where key='company'),(select id from offer_fixtures where key='stock'),(select id from offer_fixtures where key='customer'),19900029,(select id from offer_fixtures where key='owner')),
 ((select id from offer_fixtures where key='second_deal'),(select id from offer_fixtures where key='company'),(select id from offer_fixtures where key='stock'),(select id from offer_fixtures where key='customer'),15900000,(select id from offer_fixtures where key='owner')),
 ((select id from offer_fixtures where key='other_deal'),(select id from offer_fixtures where key='other_company'),(select id from offer_fixtures where key='other_stock'),(select id from offer_fixtures where key='other_customer'),100000,(select id from offer_fixtures where key='other_owner'));

select set_config('request.jwt.claim.sub',(select id::text from offer_fixtures where key='owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from offer_fixtures where key='owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare company uuid; deal uuid; submission uuid; first_offer uuid; same_offer uuid; body jsonb; blocked boolean; today date:=(now() at time zone 'Europe/Stockholm')::date; begin
 select id into company from offer_fixtures where key='company';
 select id into deal from offer_fixtures where key='deal';
 select id into submission from offer_fixtures where key='submission';
 first_offer:=public.create_offer_version(company,deal,submission,'Återkoppla före leverans.',today+30,true);
 insert into offer_fixtures values('first_offer',first_offer);
 select snapshot into body from public.offers where id=first_offer;
 if body->>'document_type'!='offer' or body->>'currency'!='SEK' or body->>'price_basis'!='gross' or body->>'sale_price_ore'!='19900029'
  or body#>>'{company,id}'!=company::text or body#>>'{customer,id}'!=(select id::text from offer_fixtures where key='customer')
  or body#>>'{customer,name}'!='Zoë Öström' or body#>>'{vehicle,registration_number}'!='OFR001'
  or body#>>'{stock,id}'!=(select id::text from offer_fixtures where key='stock')
  or body#>>'{vat,amount_ore}'!='3980006' or body#>>'{vat,net_price_ore}'!='15920023' then
  raise exception 'FAIL actual deal snapshot/tenant/SEK/exact VAT';
 end if;
 if body ? 'purchase_price_ore' or body#>'{stock,purchase_price_ore}' is not null then raise exception 'FAIL purchase cost in customer offer'; end if;
 same_offer:=public.create_offer_version(company,deal,submission,'Återkoppla före leverans.',today+30,true);
 if same_offer!=first_offer or (select count(*) from public.offers where deal_id=deal)!=1 then raise exception 'FAIL offer retry duplicates'; end if;
 if (select count(*) from public.audit_events where entity_table='offers' and entity_id=first_offer and actor_user_id=auth.uid() and action='INSERT')!=1 then raise exception 'FAIL offer audit or duplicate retry audit'; end if;
 blocked:=false;begin perform public.create_offer_version(company,deal,gen_random_uuid(),'Unconfirmed gross price',today+30,false);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL unconfirmed gross price accepted'; end if;
 blocked:=false;begin perform public.create_offer_version(company,deal,gen_random_uuid(),'Missing gross confirmation',today+30,null);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL null gross confirmation accepted'; end if;
 blocked:=false;begin perform public.create_offer_version(company,deal,submission,'Återkoppla före leverans.',today+30,false);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL changed gross confirmation on replay'; end if;
 if (select count(*) from public.offers where deal_id=deal)!=1 then raise exception 'FAIL unconfirmed request created offer'; end if;
 blocked:=false;begin perform public.create_offer_version(company,deal,submission,'Changed terms',today+30,true);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL changed submission terms'; end if;
 blocked:=false;begin perform public.create_offer_version(company,deal,submission,'Återkoppla före leverans.',today+31,true);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL changed submission date'; end if;
 blocked:=false;begin perform public.create_offer_version(company,deal,gen_random_uuid(),repeat('x',2001),today+30,true);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL oversized terms'; end if;
 blocked:=false;begin perform public.create_offer_version(company,deal,gen_random_uuid(),'Control'||chr(8),today+30,true);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL term controls'; end if;
 blocked:=false;begin perform public.create_offer_version(company,deal,gen_random_uuid(),'Expired',today-1,true);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL expired date'; end if;
 blocked:=false;begin perform public.create_offer_version(company,deal,gen_random_uuid(),'Too far',today+91,true);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL excessive expiry'; end if;
 blocked:=false;begin perform public.create_offer_version(company,deal,null,'Missing ID',today,true);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL missing idempotency ID'; end if;
 perform public.create_offer_version(company,deal,gen_random_uuid(),repeat('å',2000),today+90,true);
 if (select max(version) from public.offers where deal_id=deal)!=2 then raise exception 'FAIL monotonic offer versions'; end if;
 -- A UUID on another deal is a different idempotency scope.
 perform public.create_offer_version(company,(select id from offer_fixtures where key='second_deal'),submission,'Other deal',today,true);
 blocked:=false;begin perform public.create_offer_version((select id from offer_fixtures where key='other_company'),(select id from offer_fixtures where key='other_deal'),gen_random_uuid(),'Forged company',today,true);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL cross tenant offer RPC'; end if;
 blocked:=false;begin perform public.create_offer_version(company,(select id from offer_fixtures where key='other_deal'),gen_random_uuid(),'Forged deal',today,true);exception when no_data_found then blocked:=true;end;
 if not blocked then raise exception 'FAIL foreign deal identity'; end if;
 blocked:=false;begin insert into public.offers(company_id,deal_id,version,snapshot) values(company,deal,99,'{}');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL direct snapshot creation'; end if;
 blocked:=false;begin update public.offers set snapshot='{}' where id=first_offer;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL direct snapshot mutation'; end if;
 blocked:=false;begin delete from public.offers where id=first_offer;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL direct snapshot deletion'; end if;
 blocked:=false;begin perform 1 from private.offer_submissions;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL exposed offer receipts'; end if;
end $$;
reset role;
-- Even an administrative UPDATE cannot accidentally overwrite an old version.
do $$ declare blocked boolean:=false; begin
 if not exists(select 1 from private.offer_submissions where offer_id=(select id from offer_fixtures where key='first_offer') and payload->>'gross_confirmed'='true') then raise exception 'FAIL gross confirmation omitted from receipt payload'; end if;
 begin update public.offers set snapshot='{}' where id=(select id from offer_fixtures where key='first_offer');exception when object_not_in_prerequisite_state then blocked:=true;end;
 if not blocked then raise exception 'FAIL immutable offer trigger'; end if;
end $$;
-- Simulate legacy/malformed source text without relying on the foundation's
-- name constraints. DDL and fixtures remain inside this rollback transaction.
alter table public.companies drop constraint companies_name_check;
alter table public.companies drop constraint companies_organisation_number_check;
alter table public.customers drop constraint customers_name_check;
do $$ declare source record; blocked boolean; company uuid; deal uuid; before_count integer; begin
 select id into company from offer_fixtures where key='company';select id into deal from offer_fixtures where key='deal';
 select count(*) into before_count from public.offers where deal_id=deal;
 for source in select * from (values
  ('companies','name','company',repeat('x',161)),
  ('companies','name','company','x'),
  ('companies','organisation_number','company','55600000011'),
  ('companies','organisation_number','company','ABCDEFGHIJ'),
  ('customers','name','customer',repeat('x',161)),
  ('customers','name','customer','x'),
  ('vehicles','make','vehicle',repeat('x',161)),
  ('vehicles','model','vehicle',repeat('x',161)),
  ('vehicles','vin','vehicle',repeat('x',101)),
  ('customers','email','customer',repeat('x',255)),
  ('customers','phone','customer',repeat('x',61)),
  ('customers','address','customer',repeat('x',501))
 ) as cases(table_name,column_name,fixture_key,invalid_value) loop
  blocked:=false;
  begin
   execute format('update public.%I set %I=$1 where id=$2',source.table_name,source.column_name)
   using source.invalid_value,(select id from offer_fixtures where key=source.fixture_key);
   perform public.create_offer_version(company,deal,gen_random_uuid(),'Malformed source',(now() at time zone 'Europe/Stockholm')::date,true);
  exception when invalid_parameter_value then blocked:=true;
  end;
  if not blocked then raise exception 'FAIL document source bounds: %.%',source.table_name,source.column_name; end if;
  if (select count(*) from public.offers where deal_id=deal)!=before_count then raise exception 'FAIL malformed source created immutable offer'; end if;
 end loop;
end $$;
alter table public.companies add constraint companies_name_check check(length(name) between 2 and 160);
alter table public.companies add constraint companies_organisation_number_check check(organisation_number ~ '^[0-9]{10}$');
alter table public.customers add constraint customers_name_check check(length(name) between 2 and 160);
update public.customers set name='New customer name' where id=(select id from offer_fixtures where key='customer');
update public.vehicles set model='V90' where id=(select id from offer_fixtures where key='vehicle');
update public.deals set sale_price_ore=20000000 where id=(select id from offer_fixtures where key='deal');
update public.stock_items set asking_price_ore=30000000,vat_scheme='vmb' where id=(select id from offer_fixtures where key='stock');
set local role authenticated;
do $$ declare company uuid; deal uuid; next_offer uuid; previous jsonb; current_snapshot jsonb; begin
 select id into company from offer_fixtures where key='company';select id into deal from offer_fixtures where key='deal';
 next_offer:=public.create_offer_version(company,deal,gen_random_uuid(),'New snapshot',(now() at time zone 'Europe/Stockholm')::date+30,true);
 select snapshot into previous from public.offers where id=(select id from offer_fixtures where key='first_offer');
 select snapshot into current_snapshot from public.offers where id=next_offer;
 if previous#>>'{customer,name}'!='Zoë Öström' or previous#>>'{vehicle,model}'!='V60' or previous->>'sale_price_ore'!='19900029' then raise exception 'FAIL historical snapshot changed'; end if;
 if current_snapshot#>>'{customer,name}'!='New customer name' or current_snapshot#>>'{vehicle,model}'!='V90' or current_snapshot->>'sale_price_ore'!='20000000'
  or current_snapshot#>>'{stock,vat_scheme}'!='vmb' or current_snapshot#>>'{vat,amount_ore}' is not null then raise exception 'FAIL new snapshot/current sale price/VMB'; end if;
end $$;
reset role;
-- Each authorized actor can independently submit the same UUID.
select set_config('request.jwt.claim.sub',(select id::text from offer_fixtures where key='sales'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from offer_fixtures where key='sales'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 perform public.create_offer_version((select id from offer_fixtures where key='company'),(select id from offer_fixtures where key='deal'),(select id from offer_fixtures where key='submission'),'Sales offer',(now() at time zone 'Europe/Stockholm')::date,true);
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from offer_fixtures where key='admin'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from offer_fixtures where key='admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 perform public.create_offer_version((select id from offer_fixtures where key='company'),(select id from offer_fixtures where key='deal'),(select id from offer_fixtures where key='submission'),'Admin offer',(now() at time zone 'Europe/Stockholm')::date,true);
end $$;
reset role;
-- An offer in B is readable in B only, with its actual unknown VAT classification.
select set_config('request.jwt.claim.sub',(select id::text from offer_fixtures where key='other_owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from offer_fixtures where key='other_owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare offer_id uuid; begin
 offer_id:=public.create_offer_version((select id from offer_fixtures where key='other_company'),(select id from offer_fixtures where key='other_deal'),(select id from offer_fixtures where key='submission'),'B offer',(now() at time zone 'Europe/Stockholm')::date,true);
 insert into offer_fixtures values('other_offer',offer_id);
 if (select count(*) from public.offers)!=1 or (select snapshot#>>'{stock,vat_scheme}' from public.offers where id=offer_id)!='unknown' then raise exception 'FAIL company B isolation/classification'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from offer_fixtures where key='viewer'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from offer_fixtures where key='viewer'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare blocked boolean:=false; begin
 if not exists(select 1 from public.offers where id=(select id from offer_fixtures where key='first_offer')) then raise exception 'FAIL viewer offer read'; end if;
 if exists(select 1 from public.offers where id=(select id from offer_fixtures where key='other_offer')) then raise exception 'FAIL cross tenant offer/PDF read'; end if;
 begin perform public.create_offer_version((select id from offer_fixtures where key='company'),(select id from offer_fixtures where key='deal'),gen_random_uuid(),'Viewer',(now() at time zone 'Europe/Stockholm')::date,true);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL viewer offer creation'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from offer_fixtures where key='finance'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from offer_fixtures where key='finance'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare blocked boolean:=false; begin
 begin perform public.create_offer_version((select id from offer_fixtures where key='company'),(select id from offer_fixtures where key='deal'),gen_random_uuid(),'Finance',(now() at time zone 'Europe/Stockholm')::date,true);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL finance role offer creation'; end if;
end $$;
reset role;
update public.deals set status='cancelled' where id=(select id from offer_fixtures where key='deal');
select set_config('request.jwt.claim.sub',(select id::text from offer_fixtures where key='owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from offer_fixtures where key='owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare blocked boolean:=false; begin
 if public.create_offer_version((select id from offer_fixtures where key='company'),(select id from offer_fixtures where key='deal'),(select id from offer_fixtures where key='submission'),'Återkoppla före leverans.',(now() at time zone 'Europe/Stockholm')::date+30,true)!=(select id from offer_fixtures where key='first_offer') then raise exception 'FAIL cancelled deal idempotent replay'; end if;
 begin perform public.create_offer_version((select id from offer_fixtures where key='company'),(select id from offer_fixtures where key='deal'),gen_random_uuid(),'Cancelled',(now() at time zone 'Europe/Stockholm')::date,true);exception when no_data_found then blocked:=true;end;
 if not blocked then raise exception 'FAIL cancelled deal new offer'; end if;
end $$;
reset role;
update public.memberships set status='suspended' where user_id=(select id from offer_fixtures where key='owner');
set local role authenticated;
do $$ declare blocked boolean:=false; begin
 if exists(select 1 from public.offers) then raise exception 'FAIL suspended offer read'; end if;
 begin perform public.create_offer_version((select id from offer_fixtures where key='company'),(select id from offer_fixtures where key='deal'),(select id from offer_fixtures where key='submission'),'Återkoppla före leverans.',(now() at time zone 'Europe/Stockholm')::date+30,true);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL suspended receipt replay'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ declare blocked boolean:=false; begin
 begin perform public.create_offer_version((select id from offer_fixtures where key='company'),(select id from offer_fixtures where key='deal'),gen_random_uuid(),'Anon',(now() at time zone 'Europe/Stockholm')::date,true);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL anonymous offer creation'; end if;
end $$;
reset role;
select 'PASS: immutable actual-deal snapshots, explicit gross-price confirmation, price-basis snapshot, tenant isolation, authorized actors, stable version allocation, scoped idempotence, changed-body rejection, exact SEK/VAT, source bounds, 2000-character terms, 90-day dates, audit, historical data, viewer/finance/suspended/anonymous restrictions' as result;
rollback;
