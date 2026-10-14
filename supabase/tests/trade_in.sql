begin;
do $$begin
 if exists(select 1 from auth.users where id='ee180000-0000-4000-8000-000000000001') or exists(select 1 from public.companies where id='ee180000-0000-4000-8000-000000000002') or exists(select 1 from public.customers where id='ee180000-0000-4000-8000-000000000003') or exists(select 1 from public.vehicles where id='ee180000-0000-4000-8000-000000000004') or exists(select 1 from public.stock_items where id='ee180000-0000-4000-8000-000000000005') or exists(select 1 from public.deals where id='ee180000-0000-4000-8000-000000000006') then raise exception 'Trade-in smoke fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at)values('ee180000-0000-4000-8000-000000000001','trade-in-ee180000@example.invalid',now());
insert into public.companies(id,name,organisation_number,created_by)values('ee180000-0000-4000-8000-000000000002','Trade-in Rollback Fixture','9918000001','ee180000-0000-4000-8000-000000000001');
insert into public.memberships(company_id,user_id,role)values('ee180000-0000-4000-8000-000000000002','ee180000-0000-4000-8000-000000000001','owner');
insert into public.customers(id,company_id,name)values('ee180000-0000-4000-8000-000000000003','ee180000-0000-4000-8000-000000000002','Rollback Customer');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('ee180000-0000-4000-8000-000000000004','ee180000-0000-4000-8000-000000000002','EE160000','Fixture','Rollback',2020);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('ee180000-0000-4000-8000-000000000005','ee180000-0000-4000-8000-000000000002','ee180000-0000-4000-8000-000000000004',100,200,'standard');
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)values('ee180000-0000-4000-8000-000000000006','ee180000-0000-4000-8000-000000000002','ee180000-0000-4000-8000-000000000005','ee180000-0000-4000-8000-000000000003',200,'ee180000-0000-4000-8000-000000000001');
-- Explicit synthetic approval; this fixture is rolled back and never grants a real user access.
do $$begin
 if to_regclass('private.account_approvals') is not null then
  insert into private.account_approvals(user_id,status,updated_by) values('ee180000-0000-4000-8000-000000000001','approved','ee180000-0000-4000-8000-000000000001') on conflict(user_id) do nothing;
 end if;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ee180000-0000-4000-8000-000000000001',true);
do $$declare v jsonb;r jsonb;p jsonb;begin
 v:=public.create_trade_in_version('ee180000-0000-4000-8000-000000000002','ee180000-0000-4000-8000-000000000006',0,200,'ABC123','Volvo','V60',2020,50000,E'Checked\nBody','Towbar',300,true,0,null,'ee180000-0000-4000-8000-000000000007');
 r:=public.create_trade_in_version('ee180000-0000-4000-8000-000000000002','ee180000-0000-4000-8000-000000000006',0,200,'ABC123','Volvo','V60',2020,50000,E'Checked\nBody','Towbar',300,true,0,null,'ee180000-0000-4000-8000-000000000007');
 p:=public.list_deal_trade_ins('ee180000-0000-4000-8000-000000000002','ee180000-0000-4000-8000-000000000006');
 if v is distinct from r or v->'tradeIn'->>'amountToPayOre'<>'-100' or p->>'latestVersion'<>'1' or p->>'customerName'<>'Rollback Customer' then raise exception 'Trade-in receipt failed';end if;
 if (select status from public.stock_items where id='ee180000-0000-4000-8000-000000000005')<>'available' or (select status from public.deals where id='ee180000-0000-4000-8000-000000000006')<>'draft' then raise exception 'Trade-in mutated lifecycle';end if;
end$$;
select 'PASS: scoped immutable trade-in, exact replay, negative payment and unchanged deal/stock' as result;
rollback;
