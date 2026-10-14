begin;
do $$begin
 if exists(select 1 from auth.users where id='ee220000-0000-4000-8000-000000000001') or exists(select 1 from public.companies where id='ee220000-0000-4000-8000-000000000002') or exists(select 1 from public.customers where id='ee220000-0000-4000-8000-000000000003') or exists(select 1 from public.vehicles where id='ee220000-0000-4000-8000-000000000004') or exists(select 1 from public.stock_items where id='ee220000-0000-4000-8000-000000000005') or exists(select 1 from public.deals where id='ee220000-0000-4000-8000-000000000006') then raise exception 'Purchase/condition smoke fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at)values('ee220000-0000-4000-8000-000000000001','trade-in-ee220000@example.invalid',now());
insert into public.companies(id,name,organisation_number,created_by)values('ee220000-0000-4000-8000-000000000002','Purchase/condition Rollback Fixture','9922000001','ee220000-0000-4000-8000-000000000001');
insert into public.memberships(company_id,user_id,role)values('ee220000-0000-4000-8000-000000000002','ee220000-0000-4000-8000-000000000001','owner');
insert into public.customers(id,company_id,name)values('ee220000-0000-4000-8000-000000000003','ee220000-0000-4000-8000-000000000002','Rollback Customer');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('ee220000-0000-4000-8000-000000000004','ee220000-0000-4000-8000-000000000002','EE160000','Fixture','Rollback',2020);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('ee220000-0000-4000-8000-000000000005','ee220000-0000-4000-8000-000000000002','ee220000-0000-4000-8000-000000000004',100,200,'standard');
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)values('ee220000-0000-4000-8000-000000000006','ee220000-0000-4000-8000-000000000002','ee220000-0000-4000-8000-000000000005','ee220000-0000-4000-8000-000000000003',200,'ee220000-0000-4000-8000-000000000001');
-- Explicit synthetic approval; this fixture is rolled back and never grants a real user access.
do $$begin
 if to_regclass('private.account_approvals') is not null then
  insert into private.account_approvals(user_id,status,updated_by) values('ee220000-0000-4000-8000-000000000001','approved','ee220000-0000-4000-8000-000000000001') on conflict(user_id) do nothing;
 end if;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ee220000-0000-4000-8000-000000000001',true);
do $$declare v jsonb;r jsonb;p jsonb;checks jsonb;begin
 checks:='{"body":{"status":"issues","notes":"Minor scratch"},"interior":{"status":"good","notes":""},"engine":{"status":"unassessed","notes":""},"transmission":{"status":"unassessed","notes":""},"tyres":{"status":"good","notes":""},"service":{"status":"unassessed","notes":""}}';
 v:=public.create_purchase_condition_version('ee220000-0000-4000-8000-000000000002','ee220000-0000-4000-8000-000000000005',0,100,1,'ee220000-0000-4000-8000-000000000004','business','Fixture supplier','5568554884',date '2020-01-02','INV TEST',date '2020-01-01',50000,checks,null,'ee220000-0000-4000-8000-000000000007');
 r:=public.create_purchase_condition_version('ee220000-0000-4000-8000-000000000002','ee220000-0000-4000-8000-000000000005',0,100,1,'ee220000-0000-4000-8000-000000000004','business','Fixture supplier','5568554884',date '2020-01-02','INV TEST',date '2020-01-01',50000,checks,null,'ee220000-0000-4000-8000-000000000007');
 p:=public.get_purchase_condition_version('ee220000-0000-4000-8000-000000000002','ee220000-0000-4000-8000-000000000005',1);
 if v is distinct from r or p->'purchaseCondition' is distinct from v->'purchaseCondition' or p->'purchaseCondition'->'repairEstimateOre'<>'null'::jsonb or p->'purchaseCondition'->'basis'->>'purchasePriceOre'<>'100' then raise exception 'Purchase/condition snapshot failed';end if;
 if(select status from public.stock_items where id='ee220000-0000-4000-8000-000000000005')<>'available' then raise exception 'Stock mutated';end if;
end$$;
select 'PASS: private immutable purchase/condition snapshot, exact replay, unknown repair and unchanged stock' as result;
rollback;
