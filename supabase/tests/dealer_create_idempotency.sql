-- Synthetic rollback-only proof. No Auth API, email or external provider calls.
begin;
-- BEGIN DEALER CREATE FIXTURES
do $$begin
 if exists(select 1 from auth.users where id::text like 'fd230000-0000-4000-8000-%')or exists(select 1 from public.companies where id::text like 'fd230000-0000-4000-8000-%')then raise exception 'Dealer create fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at)select('fd230000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'dealer-create-'||n||'@fixture.invalid',case when n=8 then null else now()end from generate_series(1,10)n;
insert into private.platform_admins(user_id,created_by)values('fd230000-0000-4000-8000-000000000010','fd230000-0000-4000-8000-000000000010');
insert into private.account_approvals(user_id,status,updated_by)select id,case when id='fd230000-0000-4000-8000-000000000007'then 'pending'else 'approved'end,'fd230000-0000-4000-8000-000000000010'from auth.users where id::text like 'fd230000-0000-4000-8000-%';
insert into public.companies(id,name,organisation_number,created_by)values
 ('fd230000-0000-4000-8000-000000000101','Dealer create A','5568554884','fd230000-0000-4000-8000-000000000001'),
 ('fd230000-0000-4000-8000-000000000102','Dealer create B','5568554884','fd230000-0000-4000-8000-000000000006');
insert into public.memberships(company_id,user_id,role)select'fd230000-0000-4000-8000-000000000101',('fd230000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,case n when 1 then 'owner'when 2 then 'admin'when 3 then 'sales'when 4 then 'finance'when 5 then 'viewer'else 'sales'end from generate_series(1,8)n where n<>6;
insert into public.memberships(company_id,user_id,role)values('fd230000-0000-4000-8000-000000000102','fd230000-0000-4000-8000-000000000006','owner'),('fd230000-0000-4000-8000-000000000102','fd230000-0000-4000-8000-000000000003','viewer');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values
 ('fd230000-0000-4000-8000-000000000301','fd230000-0000-4000-8000-000000000101','REQ-A1','Volvo','V60',2024),
 ('fd230000-0000-4000-8000-000000000302','fd230000-0000-4000-8000-000000000102','REQ-B1','Volvo','V60',2024);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values
 ('fd230000-0000-4000-8000-000000000401','fd230000-0000-4000-8000-000000000101','fd230000-0000-4000-8000-000000000301',10000000,15000000,'unknown'),
 ('fd230000-0000-4000-8000-000000000402','fd230000-0000-4000-8000-000000000102','fd230000-0000-4000-8000-000000000302',10000000,15000000,'unknown');
insert into public.customers(id,company_id,name)values('fd230000-0000-4000-8000-000000000501','fd230000-0000-4000-8000-000000000101','Source customer A'),('fd230000-0000-4000-8000-000000000502','fd230000-0000-4000-8000-000000000102','Source customer B');
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)values
 ('fd230000-0000-4000-8000-000000000601','fd230000-0000-4000-8000-000000000101','fd230000-0000-4000-8000-000000000401','fd230000-0000-4000-8000-000000000501',15000000,'fd230000-0000-4000-8000-000000000003'),
 ('fd230000-0000-4000-8000-000000000602','fd230000-0000-4000-8000-000000000102','fd230000-0000-4000-8000-000000000402','fd230000-0000-4000-8000-000000000502',15000000,'fd230000-0000-4000-8000-000000000006');
-- END DEALER CREATE FIXTURES
set local role authenticated;set local request.jwt.claim.sub='fd230000-0000-4000-8000-000000000003';
do $$declare a jsonb;b jsonb;begin
 begin insert into public.customers(company_id,name)values('fd230000-0000-4000-8000-000000000101','Direct insert bypass');raise exception 'Direct customer insert accepted';exception when insufficient_privilege then null;end;
 begin insert into public.finance_applications(company_id,created_by,product,requested_amount_ore)values('fd230000-0000-4000-8000-000000000101','fd230000-0000-4000-8000-000000000003','stock',100);raise exception 'Direct finance insert accepted';exception when insufficient_privilege then null;end;
 a:=public.create_customer_request('fd230000-0000-4000-8000-000000000101','fd230000-0000-4000-8000-000000000901','Retry Customer','person','buyer@fixture.invalid','','','');
 b:=public.create_customer_request('fd230000-0000-4000-8000-000000000101','fd230000-0000-4000-8000-000000000901','Retry Customer','person','buyer@fixture.invalid',null,null,null);
 if a<>b or(select count(*)from public.customers where company_id='fd230000-0000-4000-8000-000000000101'and name='Retry Customer')<>1 then raise exception 'Customer retry duplicated';end if;
 begin perform public.create_customer_request('fd230000-0000-4000-8000-000000000101','fd230000-0000-4000-8000-000000000901','Changed Customer','person','buyer@fixture.invalid','','','');raise exception 'Changed payload accepted';exception when serialization_failure then null;end;
 a:=public.create_finance_intake_request('fd230000-0000-4000-8000-000000000101','fd230000-0000-4000-8000-000000000902','purchase','fd230000-0000-4000-8000-000000000601',12500029,100009,36,'Retry intake');
 b:=public.create_finance_intake_request('fd230000-0000-4000-8000-000000000101','fd230000-0000-4000-8000-000000000902','purchase','fd230000-0000-4000-8000-000000000601',12500029,100009,36,'Retry intake');
 if a<>b or(select count(*)from public.finance_applications where company_id='fd230000-0000-4000-8000-000000000101')<>1 then raise exception 'Finance retry duplicated';end if;
 begin perform public.create_finance_intake_request('fd230000-0000-4000-8000-000000000101','fd230000-0000-4000-8000-000000000903','purchase','fd230000-0000-4000-8000-000000000602',12500029,0,null,'Foreign deal');raise exception 'Foreign finance deal accepted';exception when foreign_key_violation then null;end;
 begin perform public.create_finance_intake_request('fd230000-0000-4000-8000-000000000102','fd230000-0000-4000-8000-000000000904','stock',null,12500029,0,null,'Viewer company');raise exception 'Cross company viewer write accepted';exception when insufficient_privilege then null;end;
 begin perform 1 from private.dealer_create_receipts;raise exception 'Private receipts exposed';exception when insufficient_privilege then null;end;
end$$;
reset role;
update public.finance_applications set status='withdrawn'where company_id='fd230000-0000-4000-8000-000000000101';
set local role authenticated;
do $$declare a jsonb;begin
 a:=public.create_finance_intake_request('fd230000-0000-4000-8000-000000000101','fd230000-0000-4000-8000-000000000902','purchase','fd230000-0000-4000-8000-000000000601',12500029,100009,36,'Retry intake');
 if a?'status'or(select status from public.finance_applications where id=(a->>'recordId')::uuid)<>'withdrawn' then raise exception 'Historical replay changed finance lifecycle';end if;
end$$;
reset role;
update public.memberships set status='suspended'where company_id='fd230000-0000-4000-8000-000000000101'and user_id='fd230000-0000-4000-8000-000000000003';
set local role authenticated;
do $$begin
 begin perform public.create_customer_request('fd230000-0000-4000-8000-000000000101','fd230000-0000-4000-8000-000000000901','Retry Customer','person','buyer@fixture.invalid','','','');raise exception 'Revoked historical replay accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$begin
 if(select count(*)from private.dealer_create_receipts where company_id='fd230000-0000-4000-8000-000000000101')<>2 then raise exception 'Unexpected receipt count';end if;
end$$;
rollback;
