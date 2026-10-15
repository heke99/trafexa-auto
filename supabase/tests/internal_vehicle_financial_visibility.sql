-- Synthetic rollback proof only; no real company, provider, Auth API or email.
begin;
-- BEGIN INTERNAL FINANCE FIXTURES
do $$begin
 if exists(select 1 from auth.users where id::text like 'fd210000-0000-4000-8000-%')or exists(select 1 from public.companies where id::text like 'fd210000-0000-4000-8000-%')then raise exception 'Internal finance fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at)select ('fd210000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,case when n=13 then null else 'internal-finance-'||n||'@fixture.invalid'end,case when n in(9,13)then null else now()end from generate_series(1,13)n;
insert into private.platform_admins(user_id,status,created_by)values
 ('fd210000-0000-4000-8000-000000000001','active','fd210000-0000-4000-8000-000000000001'),
 ('fd210000-0000-4000-8000-000000000011','suspended','fd210000-0000-4000-8000-000000000001'),
 ('fd210000-0000-4000-8000-000000000012','active','fd210000-0000-4000-8000-000000000001');
insert into private.account_approvals(user_id,status,updated_by)select id,case when id='fd210000-0000-4000-8000-000000000010'then 'pending'else 'approved'end,'fd210000-0000-4000-8000-000000000001'from auth.users where id::text like 'fd210000-0000-4000-8000-%';
insert into public.companies(id,name,organisation_number,created_by)values
 ('fd210000-0000-4000-8000-000000000101','Internal finance A','5568554884','fd210000-0000-4000-8000-000000000002'),
 ('fd210000-0000-4000-8000-000000000102','Internal finance B','5568554884','fd210000-0000-4000-8000-000000000007');
insert into public.memberships(id,company_id,user_id,role,status)
select ('fd210000-0000-4000-8000-'||lpad((200+n)::text,12,'0'))::uuid,'fd210000-0000-4000-8000-000000000101',('fd210000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case n when 2 then 'owner'when 4 then 'sales'when 5 then 'finance'when 6 then 'viewer'when 9 then 'sales'when 10 then 'sales'when 13 then 'sales'else 'admin'end,
 case when n=10 then 'suspended'else 'active'end from generate_series(1,13)n where n not in(7,8);
insert into public.memberships(id,company_id,user_id,role)values
 ('fd210000-0000-4000-8000-000000000207','fd210000-0000-4000-8000-000000000102','fd210000-0000-4000-8000-000000000007','owner'),
 ('fd210000-0000-4000-8000-000000000223','fd210000-0000-4000-8000-000000000102','fd210000-0000-4000-8000-000000000003','viewer');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('fd210000-0000-4000-8000-000000000301','fd210000-0000-4000-8000-000000000101','ABC123','Volvo','V60',2022);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('fd210000-0000-4000-8000-000000000302','fd210000-0000-4000-8000-000000000101','fd210000-0000-4000-8000-000000000301',13700000,25000000,'standard');
update public.stock_items set purchase_vat_ore=2740000 where id='fd210000-0000-4000-8000-000000000302';
insert into public.vehicle_costs(id,company_id,stock_item_id,category,description,amount_ore,deductible_vat_ore)values('fd210000-0000-4000-8000-000000000401','fd210000-0000-4000-8000-000000000101','fd210000-0000-4000-8000-000000000302','repair','Confidential repair cost',32700,6540);
insert into public.customers(id,company_id,name,kind)values('fd210000-0000-4000-8000-000000000501','fd210000-0000-4000-8000-000000000101','Sales customer','person');
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)values('fd210000-0000-4000-8000-000000000601','fd210000-0000-4000-8000-000000000101','fd210000-0000-4000-8000-000000000302','fd210000-0000-4000-8000-000000000501',25000000,'fd210000-0000-4000-8000-000000000004');
-- END INTERNAL FINANCE FIXTURES
set local role authenticated;set local request.jwt.claim.sub='fd210000-0000-4000-8000-000000000004';
do $$declare p jsonb;begin
 p:=public.get_workspace_inventory('fd210000-0000-4000-8000-000000000101');
 if p->'rows'->0->'purchase_price_ore'<>'null'::jsonb then raise exception 'Sales purchase leak';end if;
 if public.inventory_dashboard_totals('fd210000-0000-4000-8000-000000000101')->'purchaseValueOre'<>'null'::jsonb then raise exception 'Sales purchase aggregate leak';end if;
 if exists(select 1 from public.vehicle_costs where company_id='fd210000-0000-4000-8000-000000000101')then raise exception 'Sales internal costs leak';end if;
 begin perform purchase_price_ore from public.stock_items;raise exception 'Hidden stock column readable';exception when insufficient_privilege then null;end;
 begin perform public.get_vehicle_calculation('fd210000-0000-4000-8000-000000000101','fd210000-0000-4000-8000-000000000302');raise exception 'Sales calculation readable';exception when insufficient_privilege then null;end;
end$$;
set local request.jwt.claim.sub='fd210000-0000-4000-8000-000000000005';
do $$begin
 if(public.get_workspace_inventory('fd210000-0000-4000-8000-000000000101')->'rows'->0->>'purchase_price_ore')::bigint<>13700000 then raise exception 'Finance purchase missing';end if;
 if not exists(select 1 from public.vehicle_costs where company_id='fd210000-0000-4000-8000-000000000101')then raise exception 'Finance costs missing';end if;
end$$;
rollback;
