-- Run as migration administrator after the scheduler migration. All fixtures roll back.
-- Keep this integration test away from unrelated overdue reservations.
begin;
do $$begin
 if exists(select 1 from public.reservations where status='active' and expires_at<=now()) then
  raise exception 'Run expiry rollback tests without unrelated overdue reservations';
 end if;
end$$;
create temporary table scheduled_expiry_ids(key text primary key,id uuid default gen_random_uuid());
insert into scheduled_expiry_ids(key) values('owner_a'),('owner_b'),('company_a'),('company_b'),('customer_a'),('customer_b');
create temporary table scheduled_expiry_stock(
 key text primary key,company_id uuid,owner_id uuid,customer_id uuid,
 vehicle_id uuid default gen_random_uuid(),stock_id uuid default gen_random_uuid(),
 deal_id uuid default gen_random_uuid(),reservation_id uuid default gen_random_uuid()
);
grant select on scheduled_expiry_ids,scheduled_expiry_stock to authenticated;
insert into auth.users(id,email,email_confirmed_at)
select id,id::text||'@fixture.invalid',now() from scheduled_expiry_ids where key in ('owner_a','owner_b');
insert into private.account_approvals(user_id,status,updated_by)
select id,'approved',id from scheduled_expiry_ids where key in ('owner_a','owner_b');
insert into public.companies(id,name,organisation_number,created_by) values
((select id from scheduled_expiry_ids where key='company_a'),'Scheduled Expiry A','5560000091',(select id from scheduled_expiry_ids where key='owner_a')),
((select id from scheduled_expiry_ids where key='company_b'),'Scheduled Expiry B','5560000092',(select id from scheduled_expiry_ids where key='owner_b'));
insert into public.memberships(company_id,user_id,role) values
((select id from scheduled_expiry_ids where key='company_a'),(select id from scheduled_expiry_ids where key='owner_a'),'owner'),
((select id from scheduled_expiry_ids where key='company_b'),(select id from scheduled_expiry_ids where key='owner_b'),'owner');
insert into public.customers(id,company_id,name) values
((select id from scheduled_expiry_ids where key='customer_a'),(select id from scheduled_expiry_ids where key='company_a'),'Expiry Contact A'),
((select id from scheduled_expiry_ids where key='customer_b'),(select id from scheduled_expiry_ids where key='company_b'),'Expiry Contact B');
insert into scheduled_expiry_stock(key,company_id,owner_id,customer_id)
select input.key,c.id,u.id,cu.id from (values
 ('ordinary','company_a','owner_a','customer_a'),('accepted','company_a','owner_a','customer_a'),('future','company_b','owner_b','customer_b')
)input(key,company_key,owner_key,customer_key)
join scheduled_expiry_ids c on c.key=input.company_key
join scheduled_expiry_ids u on u.key=input.owner_key
join scheduled_expiry_ids cu on cu.key=input.customer_key;
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)
select vehicle_id,company_id,'S'||substr(replace(vehicle_id::text,'-',''),1,12),'Volvo','V60',2022 from scheduled_expiry_stock;
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme,status)
select stock_id,company_id,vehicle_id,10000000,12000000,'standard','reserved' from scheduled_expiry_stock;
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by,status)
select deal_id,company_id,stock_id,customer_id,12000000,owner_id,'reserved' from scheduled_expiry_stock;
insert into public.reservations(id,company_id,stock_item_id,deal_id,expires_at,created_by)
select reservation_id,company_id,stock_id,deal_id,case when key='future' then now()+interval '1 hour' else now() end,owner_id from scheduled_expiry_stock;
with offer as (
 insert into public.offers(company_id,deal_id,version,snapshot)
 select company_id,deal_id,1,jsonb_build_object('valid_until',current_date+1) from scheduled_expiry_stock where key='accepted'
 returning id,company_id,deal_id
)
insert into private.offer_reviews(company_id,deal_id,offer_id,offer_version,recipient_email,status,version,decided_at,responder_name)
select company_id,deal_id,id,1,'expiry-buyer@fixture.invalid','accepted',2,now(),'Expiry Buyer' from offer;

select set_config('request.jwt.claim.sub','',true);
select private.expire_reservations();
do $$declare item record;begin
 for item in select * from scheduled_expiry_stock loop
  if item.key='ordinary' then
   if (select status from public.stock_items where id=item.stock_id)<>'available'
   or (select status from public.deals where id=item.deal_id)<>'draft'
   or (select status from public.reservations where id=item.reservation_id)<>'expired' then raise exception 'FAIL ordinary expiry';end if;
  else
   if (select status from public.stock_items where id=item.stock_id)<>'reserved'
   or (select status from public.deals where id=item.deal_id)<>'reserved'
   or (select status from public.reservations where id=item.reservation_id)<>'active' then raise exception 'FAIL accepted/future reservation changed';end if;
  end if;
 end loop;
 perform private.expire_stock_reservations((select stock_id from scheduled_expiry_stock where key='accepted'));
 if (select status from public.reservations where id=(select reservation_id from scheduled_expiry_stock where key='accepted'))<>'active' then raise exception 'FAIL lazy helper acceptance guard';end if;
 if (select count(*) from public.reservations where id in(select reservation_id from scheduled_expiry_stock))<>3 then raise exception 'FAIL reservation history loss';end if;
end$$;

select set_config('request.jwt.claim.sub',(select id::text from scheduled_expiry_ids where key='owner_a'),true);
set local role authenticated;
do $$declare blocked boolean:=false;item record;begin
 select * into item from scheduled_expiry_stock where key='accepted';
 begin perform public.create_deal(item.company_id,item.stock_id,item.customer_id,12000000);
 exception when raise_exception then blocked:=true;end;
 if not blocked then raise exception 'FAIL accepted vehicle reused';end if;
 blocked:=false;
 begin perform private.expire_reservations();exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL ordinary user worker execution';end if;
 blocked:=false;
 begin perform private.expire_stock_reservations(item.stock_id);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL ordinary user helper execution';end if;
 blocked:=false;
 begin perform 1 from cron.job;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL ordinary user cron access';end if;
end$$;
reset role;
do $$declare r text;begin
 foreach r in array array['anon','authenticated','service_role'] loop
  if has_function_privilege(r,'private.expire_reservations()','execute')
  or has_function_privilege(r,'private.expire_stock_reservations(uuid)','execute')
  or has_schema_privilege(r,'cron','usage') then raise exception 'FAIL worker privilege for %',r;end if;
 end loop;
 if (select count(*) from cron.job where jobname='trafexa-expire-reservations' and username='postgres' and active and schedule='* * * * *'
  and command='set statement_timeout=''30s''; select private.expire_reservations();')<>1 then raise exception 'FAIL cron registration';end if;
end$$;
select 'PASS: atomic expiry, exact deadline, accepted/future protection, preserved history, lazy expiry guard, restricted worker/cron privileges and minute job command' as result;
rollback;
