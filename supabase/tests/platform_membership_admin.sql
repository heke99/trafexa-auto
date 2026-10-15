-- Collision-checked synthetic rollback proof. No account, company or email is activated.
begin;
-- BEGIN PLATFORM MEMBERSHIP FIXTURES
do $$begin
 if exists(select 1 from auth.users where id::text like 'fd200000-0000-4000-8000-%')or exists(select 1 from public.companies where id::text like 'fd200000-0000-4000-8000-%')then raise exception 'Platform membership fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at)select ('fd200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,case when n=13 then null else 'platform-member-'||n||'@fixture.invalid'end,case when n in(9,13)then null else now()end from generate_series(1,13)n;
insert into private.platform_admins(user_id,status,created_by)values
 ('fd200000-0000-4000-8000-000000000001','active','fd200000-0000-4000-8000-000000000001'),
 ('fd200000-0000-4000-8000-000000000011','suspended','fd200000-0000-4000-8000-000000000001'),
 ('fd200000-0000-4000-8000-000000000012','active','fd200000-0000-4000-8000-000000000001');
insert into private.account_approvals(user_id,status,updated_by)select id,case when id='fd200000-0000-4000-8000-000000000010'then 'pending'else 'approved'end,'fd200000-0000-4000-8000-000000000001'from auth.users where id::text like 'fd200000-0000-4000-8000-%';
insert into public.companies(id,name,organisation_number,created_by)values
 ('fd200000-0000-4000-8000-000000000101','Platform member A','5568554884','fd200000-0000-4000-8000-000000000002'),
 ('fd200000-0000-4000-8000-000000000102','Platform member B','5568554884','fd200000-0000-4000-8000-000000000007');
insert into public.memberships(id,company_id,user_id,role,status)
select ('fd200000-0000-4000-8000-'||lpad((200+n)::text,12,'0'))::uuid,'fd200000-0000-4000-8000-000000000101',('fd200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case n when 2 then 'owner'when 4 then 'sales'when 5 then 'finance'when 6 then 'viewer'when 9 then 'sales'when 10 then 'sales'when 13 then 'sales'else 'admin'end,
 case when n=10 then 'suspended'else 'active'end from generate_series(1,13)n where n not in(7,8);
insert into public.memberships(id,company_id,user_id,role)values
 ('fd200000-0000-4000-8000-000000000207','fd200000-0000-4000-8000-000000000102','fd200000-0000-4000-8000-000000000007','owner'),
 ('fd200000-0000-4000-8000-000000000223','fd200000-0000-4000-8000-000000000102','fd200000-0000-4000-8000-000000000003','viewer');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('fd200000-0000-4000-8000-000000000301','fd200000-0000-4000-8000-000000000101','ABC123','Volvo','V60',2022);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('fd200000-0000-4000-8000-000000000302','fd200000-0000-4000-8000-000000000101','fd200000-0000-4000-8000-000000000301',10000000,25000000,'standard');
-- END PLATFORM MEMBERSHIP FIXTURES
create temporary table platform_membership_proof(k text primary key,v jsonb);grant select,insert on platform_membership_proof to authenticated;
set local role authenticated;set local request.jwt.claim.sub='fd200000-0000-4000-8000-000000000001';
insert into platform_membership_proof values('updated',public.update_platform_company_member('fd200000-0000-4000-8000-000000000101','fd200000-0000-4000-8000-000000000203',1,'finance','active','Granskad rolländring', 'fd200000-0000-4000-8000-000000000901'));
do $$declare r jsonb;begin
 r:=public.update_platform_company_member('fd200000-0000-4000-8000-000000000101','fd200000-0000-4000-8000-000000000203',1,'finance','active','Granskad rolländring','fd200000-0000-4000-8000-000000000901');
 if r is distinct from(select v from platform_membership_proof where k='updated')then raise exception 'Historical membership receipt changed';end if;
 if(r->'member'->>'version')::integer<>2 or(r->>'teamVersion')::integer<>2 then raise exception 'Wrong membership versions';end if;
 if jsonb_array_length(public.list_platform_account_memberships('fd200000-0000-4000-8000-000000000008')->'memberships')<>0 then raise exception 'Empty account has memberships';end if;
end$$;
insert into platform_membership_proof values('suspended',public.update_platform_company_member('fd200000-0000-4000-8000-000000000101','fd200000-0000-4000-8000-000000000204',1,'sales','suspended','Granskad avstängning','fd200000-0000-4000-8000-000000000902'));
set local request.jwt.claim.sub='fd200000-0000-4000-8000-000000000004';
do $$begin if exists(select 1 from public.stock_items where company_id='fd200000-0000-4000-8000-000000000101')then raise exception 'Suspended member retained tenant RLS';end if;end$$;
reset role;
do $$begin
 if(select count(*)from private.platform_membership_audit where company_id='fd200000-0000-4000-8000-000000000101')<>2 then raise exception 'Wrong membership audit count';end if;
 if(select role from public.memberships where id='fd200000-0000-4000-8000-000000000202')<>'owner'then raise exception 'Owner role changed';end if;
end$$;
rollback;
