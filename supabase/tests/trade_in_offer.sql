begin;
do $$begin
 if exists(select 1 from auth.users where id='ee200000-0000-4000-8000-000000000001') or exists(select 1 from public.companies where id='ee200000-0000-4000-8000-000000000002') or exists(select 1 from public.customers where id='ee200000-0000-4000-8000-000000000003') or exists(select 1 from public.vehicles where id='ee200000-0000-4000-8000-000000000004') or exists(select 1 from public.stock_items where id='ee200000-0000-4000-8000-000000000005') or exists(select 1 from public.deals where id='ee200000-0000-4000-8000-000000000006') then raise exception 'Trade-in smoke fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at)values('ee200000-0000-4000-8000-000000000001','trade-in-ee200000@example.invalid',now());
insert into public.companies(id,name,organisation_number,created_by)values('ee200000-0000-4000-8000-000000000002','Trade-in Rollback Fixture','9920000001','ee200000-0000-4000-8000-000000000001');
insert into public.memberships(company_id,user_id,role)values('ee200000-0000-4000-8000-000000000002','ee200000-0000-4000-8000-000000000001','owner');
insert into public.customers(id,company_id,name)values('ee200000-0000-4000-8000-000000000003','ee200000-0000-4000-8000-000000000002','Rollback Customer');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('ee200000-0000-4000-8000-000000000004','ee200000-0000-4000-8000-000000000002','EE160000','Fixture','Rollback',2020);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('ee200000-0000-4000-8000-000000000005','ee200000-0000-4000-8000-000000000002','ee200000-0000-4000-8000-000000000004',100,200,'standard');
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)values('ee200000-0000-4000-8000-000000000006','ee200000-0000-4000-8000-000000000002','ee200000-0000-4000-8000-000000000005','ee200000-0000-4000-8000-000000000003',200,'ee200000-0000-4000-8000-000000000001');
-- Explicit synthetic approval; this fixture is rolled back and never grants a real user access.
do $$begin
 if to_regclass('private.account_approvals') is not null then
  insert into private.account_approvals(user_id,status,updated_by) values('ee200000-0000-4000-8000-000000000001','approved','ee200000-0000-4000-8000-000000000001') on conflict(user_id) do nothing;
 end if;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ee200000-0000-4000-8000-000000000001',true);
do $$declare v jsonb;offer uuid;again uuid;s jsonb;begin
 v:=public.create_trade_in_version('ee200000-0000-4000-8000-000000000002','ee200000-0000-4000-8000-000000000006',0,200,'ABC123','Volvo','V60',2020,50000,'PRIVATE BODY NOTE','PRIVATE EQUIPMENT',300,true,0,'PRIVATE LENDER','ee200000-0000-4000-8000-000000000007');
 offer:=public.create_offer_version_with_trade_in('ee200000-0000-4000-8000-000000000002','ee200000-0000-4000-8000-000000000006','ee200000-0000-4000-8000-000000000008','Reviewed offer',(clock_timestamp() at time zone 'Europe/Stockholm')::date,true,(v->'tradeIn'->>'id')::uuid,1,0,200);
 again:=public.create_offer_version_with_trade_in('ee200000-0000-4000-8000-000000000002','ee200000-0000-4000-8000-000000000006','ee200000-0000-4000-8000-000000000008','Reviewed offer',(clock_timestamp() at time zone 'Europe/Stockholm')::date,true,(v->'tradeIn'->>'id')::uuid,1,0,200);
 select snapshot into s from public.offers where id=offer;
 if offer<>again or s->'trade_in'->>'amount_to_pay_ore'<>'-100' or s::text like '%PRIVATE%' or s->'trade_in'->>'value_ore'<>'300' then raise exception 'Trade-in offer snapshot failed';end if;
end$$;
select 'PASS: immutable trade-in offer snapshot, exact retry, negative totals, no internal notes or lender' as result;
rollback;
