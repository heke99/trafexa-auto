-- Hosted-safe rollback proof. Synthetic Auth records only; no Auth API/email,
-- Storage, provider API, credential, payment or real company data is used.
begin;
-- BEGIN COMPANY STORE PROFILE FIXTURES
do $$begin
 if exists(select 1 from auth.users where id::text like 'fd150000-0000-4000-8000-%')
  or exists(select 1 from public.companies where id::text like 'fd150000-0000-4000-8000-%') then
  raise exception 'Company store fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
 ('fd150000-0000-4000-8000-000000000001','store-owner-a@fixture.invalid',now(),false),
 ('fd150000-0000-4000-8000-000000000002','store-owner-b@fixture.invalid',now(),false),
 ('fd150000-0000-4000-8000-000000000003','store-admin@fixture.invalid',now(),false),
 ('fd150000-0000-4000-8000-000000000004','store-finance@fixture.invalid',now(),false),
 ('fd150000-0000-4000-8000-000000000005','store-sales@fixture.invalid',now(),false),
 ('fd150000-0000-4000-8000-000000000006','store-viewer@fixture.invalid',now(),false),
 ('fd150000-0000-4000-8000-000000000007','store-new-owner@fixture.invalid',now(),false),
 ('fd150000-0000-4000-8000-000000000008','store-pending@fixture.invalid',now(),false),
 ('fd150000-0000-4000-8000-000000000009','store-unverified@fixture.invalid',null,false),
 ('fd150000-0000-4000-8000-000000000010','store-revoked@fixture.invalid',now(),false),
 ('fd150000-0000-4000-8000-000000000011','store-customer@fixture.invalid',now(),false),
 ('fd150000-0000-4000-8000-000000000012','store-anonymous@fixture.invalid',now(),true);
insert into private.account_approvals(user_id,status,updated_by)
 select id,case when id='fd150000-0000-4000-8000-000000000008' then 'pending' else 'approved' end,'fd150000-0000-4000-8000-000000000001'
 from auth.users where id::text like 'fd150000-0000-4000-8000-%';
insert into public.companies(id,name,organisation_number,created_by) values
 ('fd150000-0000-4000-8000-000000000101','Butik Åäö A','5568554884','fd150000-0000-4000-8000-000000000001'),
 ('fd150000-0000-4000-8000-000000000102','Butik B','5568554884','fd150000-0000-4000-8000-000000000002'),
 ('fd150000-0000-4000-8000-000000000103','Legacy invalid identity','0000000000','fd150000-0000-4000-8000-000000000001');
insert into public.memberships(company_id,user_id,role,status)
 select 'fd150000-0000-4000-8000-000000000101',id,
  case right(id::text,3) when '003' then 'admin' when '004' then 'finance' when '005' then 'sales' when '006' then 'viewer' else 'owner' end,
  case when id='fd150000-0000-4000-8000-000000000010' then 'suspended' else 'active' end
 from auth.users where id::text like 'fd150000-0000-4000-8000-%' and right(id::text,3) not in('002','007','011');
insert into public.memberships(company_id,user_id,role) values
 ('fd150000-0000-4000-8000-000000000102','fd150000-0000-4000-8000-000000000002','owner'),
 ('fd150000-0000-4000-8000-000000000103','fd150000-0000-4000-8000-000000000001','owner');
-- END COMPANY STORE PROFILE FIXTURES
create temporary table store_profile_proof(key text primary key,value jsonb);
grant select,insert,update on store_profile_proof to authenticated;
create function pg_temp.store_fields() returns jsonb language sql immutable as $$select jsonb_build_object(
 'displayName','Trafexa Åäö bilbutik','addressLine1','Bilvägen 1','addressLine2',null,'postalCode','11122','city','Stockholm','countryCode','SE',
 'publicEmail','butik@trafexa.se','publicPhone','+46 8 123 45 67','websiteUrl','https://trafexa.se/','logoUrl',null,'description','Öppet för alla.','openingHoursText',E'Måndag–fredag 09–18\nLördag 10–14')$$;
create function pg_temp.store_expect(p_sql text,p_code text) returns void language plpgsql as $$begin
 begin execute p_sql;exception when others then if sqlstate=p_code then return;end if;raise;end;
 raise exception 'Expected SQLSTATE %, query %',p_code,p_sql;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','fd150000-0000-4000-8000-000000000001',true);
do $$declare c uuid:='fd150000-0000-4000-8000-000000000101';r jsonb;e jsonb;b jsonb;again jsonb;f jsonb:=pg_temp.store_fields();begin
 b:=public.get_company_store_profile(c);
 if b->>'reason'<>'profile_missing' or b->'profile'<>'null'::jsonb or b->'source'<>'null'::jsonb or (b->>'canExport')::boolean then raise exception 'Missing profile falsely ready';end if;
 r:=public.save_company_store_profile(c,0,f,true,'fd150000-0000-4000-8000-000000000901');
 if r->'profile'->>'version'<>'1' or r->'source'->>'legalName'<>'Butik Åäö A' or r->'source'->'shop'<>f then raise exception 'Profile source mismatch';end if;
 insert into store_profile_proof values('save',r);
 e:=public.prepare_company_store_export(c,1,r->>'sourceSha256','blocket','new_store',true,'2026-10-15','fd150000-0000-4000-8000-000000000902');
 insert into store_profile_proof values('export',e);
 if e->'export'->>'status'<>'prepared' or e->'export'->'snapshot'<>r->'source'
  or e->'export'->>'exportSha256'<>encode(sha256(convert_to(e->'export'->>'canonicalContent','UTF8')),'hex')
  or (e->'export'->>'canonicalContent')::jsonb<>jsonb_build_object('schemaVersion',1,'kind','trafexa_store_profile','channel','blocket','purpose','new_store','profile',r->'source') then raise exception 'Export canonical binding mismatch';end if;
 again:=public.prepare_company_store_export(c,1,r->>'sourceSha256','blocket','new_store',true,'2026-10-15','fd150000-0000-4000-8000-000000000902');
 if again<>e then raise exception 'Export replay changed';end if;
 perform pg_temp.store_expect(format('select public.save_company_store_profile(%L,0,%L,true,%L)',c,f,'fd150000-0000-4000-8000-000000000903'),'40001');
 perform pg_temp.store_expect(format('select public.save_company_store_profile(%L,1,%L,false,%L)',c,f,'fd150000-0000-4000-8000-000000000903'),'22023');
 perform pg_temp.store_expect(format('select public.save_company_store_profile(%L,1,%L,true,%L)',c,f||'{"secret":"never allowed"}'::jsonb,'fd150000-0000-4000-8000-000000000903'),'22023');
 perform pg_temp.store_expect(format('select public.save_company_store_profile(%L,1,%L,true,%L)',c,f||'{"websiteUrl":"https://localhost/"}'::jsonb,'fd150000-0000-4000-8000-000000000903'),'22023');
 perform pg_temp.store_expect(format('select public.prepare_company_store_export(%L,1,%L,''blocket'',''new_store'',true,''2026-10-15'',%L)',c,repeat('0',64),'fd150000-0000-4000-8000-000000000903'),'40001');
end$$;
select set_config('request.jwt.claim.sub','fd150000-0000-4000-8000-000000000003',true);
do $$declare r jsonb;begin
 r:=public.save_company_store_profile('fd150000-0000-4000-8000-000000000101',1,pg_temp.store_fields()||'{"displayName":"Ny version"}',true,'fd150000-0000-4000-8000-000000000904');
 if r->'profile'->>'actorLabel'<>'Du' or r->>'role'<>'admin' then raise exception 'Wrong actor DTO';end if;
end$$;
select set_config('request.jwt.claim.sub','fd150000-0000-4000-8000-000000000001',true);
do $$declare b jsonb;r jsonb;e jsonb;begin
 b:=public.get_company_store_profile('fd150000-0000-4000-8000-000000000101');
 if b->'profile'->>'version'<>'2' or b->'profile'->>'actorLabel'<>'Kollega' or jsonb_array_length(b->'exports')<>1 then raise exception 'Current/historical profile mismatch';end if;
 r:=public.save_company_store_profile('fd150000-0000-4000-8000-000000000101',0,pg_temp.store_fields(),true,'fd150000-0000-4000-8000-000000000901');
 if r<>(select value from store_profile_proof where key='save') then raise exception 'Historical save lost exact receipt';end if;
 e:=public.get_company_store_export('fd150000-0000-4000-8000-000000000101',((select value from store_profile_proof where key='export')->'export'->>'id')::uuid);
 if e->'export'<>(select value->'export' from store_profile_proof where key='export') then raise exception 'Historical export was rewritten';end if;
 r:=public.save_company_store_profile('fd150000-0000-4000-8000-000000000103',0,pg_temp.store_fields(),true,'fd150000-0000-4000-8000-000000000905');
 b:=public.get_company_store_profile('fd150000-0000-4000-8000-000000000103');
 if b->>'reason'<>'invalid_organisation_number' or b->'source'='null'::jsonb or (b->>'identityValid')::boolean or (b->>'canExport')::boolean then raise exception 'Legacy invalid org falsely ready';end if;
 perform pg_temp.store_expect(format('select public.prepare_company_store_export(%L,1,%L,''wayke'',''existing_store'',true,''2026-10-15'',%L)','fd150000-0000-4000-8000-000000000103',r->>'sourceSha256','fd150000-0000-4000-8000-000000000906'),'22023');
 -- Existing owners may create another company, including the same legal org.
 r:=public.create_company_with_profile('Another store','556855-4884',pg_temp.store_fields(),true,'fd150000-0000-4000-8000-000000000907');
 if r->>'role'<>'owner' or r->'source'->>'organisationNumber'<>'5568554884' then raise exception 'Additional company failed';end if;
end$$;
select set_config('request.jwt.claim.sub','fd150000-0000-4000-8000-000000000007',true);
do $$declare r jsonb;again jsonb;begin
 r:=public.create_company_with_profile('New verified dealer','5568554884',pg_temp.store_fields(),true,'fd150000-0000-4000-8000-000000000908');
 again:=public.create_company_with_profile('New verified dealer','5568554884',pg_temp.store_fields(),true,'fd150000-0000-4000-8000-000000000908');
 if r<>again or r->'profile'->>'version'<>'1' then raise exception 'Atomic company retry mismatch';end if;
 insert into store_profile_proof values('create',r);
 perform pg_temp.store_expect(format('select public.create_company_with_profile(''Changed payload'',''5568554884'',%L,true,%L)',pg_temp.store_fields(),'fd150000-0000-4000-8000-000000000908'),'40001');
 perform pg_temp.store_expect(format('select public.create_company_with_profile(''Invalid org'',''5568554885'',%L,true,%L)',pg_temp.store_fields(),'fd150000-0000-4000-8000-000000000909'),'22023');
 perform pg_temp.store_expect(format('select public.create_company_with_profile(''Missing acknowledgment'',''5568554884'',%L,false,%L)',pg_temp.store_fields(),'fd150000-0000-4000-8000-000000000909'),'22023');
end$$;
do $$declare u uuid;begin
 foreach u in array array['fd150000-0000-4000-8000-000000000002','fd150000-0000-4000-8000-000000000004','fd150000-0000-4000-8000-000000000005','fd150000-0000-4000-8000-000000000006','fd150000-0000-4000-8000-000000000008','fd150000-0000-4000-8000-000000000009','fd150000-0000-4000-8000-000000000010','fd150000-0000-4000-8000-000000000011','fd150000-0000-4000-8000-000000000012']::uuid[] loop
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform pg_temp.store_expect('select public.get_company_store_profile(''fd150000-0000-4000-8000-000000000101'')','42501');
  perform pg_temp.store_expect(format('select public.save_company_store_profile(''fd150000-0000-4000-8000-000000000101'',2,%L,true,%L)',pg_temp.store_fields(),gen_random_uuid()),'42501');
  perform pg_temp.store_expect(format('select public.get_company_store_export(''fd150000-0000-4000-8000-000000000101'',%L)',(select value->'export'->>'id' from store_profile_proof where key='export')),'42501');
  perform pg_temp.store_expect('select * from private.company_store_profile_versions','42501');
 end loop;
end$$;
reset role;
-- Legal identity can only change outside this module. Its bytes are nevertheless CAS-bound.
update public.companies set name='Legal identity changed by privileged maintenance' where id='fd150000-0000-4000-8000-000000000101';
set local role authenticated;
select set_config('request.jwt.claim.sub','fd150000-0000-4000-8000-000000000003',true);
do $$declare r jsonb;b jsonb;begin
 r:=public.save_company_store_profile('fd150000-0000-4000-8000-000000000101',1,pg_temp.store_fields()||'{"displayName":"Ny version"}',true,'fd150000-0000-4000-8000-000000000904');
 b:=public.get_company_store_profile('fd150000-0000-4000-8000-000000000101');
 if b->>'sourceSha256'=r->>'sourceSha256' or b->'profile'->>'version'<>'2' then raise exception 'Legal identity not included in source hash';end if;
 perform pg_temp.store_expect(format('select public.prepare_company_store_export(%L,2,%L,''blocket'',''new_store'',true,''2026-10-15'',%L)','fd150000-0000-4000-8000-000000000101',r->>'sourceSha256','fd150000-0000-4000-8000-000000000910'),'40001');
end$$;
reset role;
update public.memberships set status='suspended' where user_id='fd150000-0000-4000-8000-000000000007';
set local role authenticated;
select set_config('request.jwt.claim.sub','fd150000-0000-4000-8000-000000000007',true);
select pg_temp.store_expect(format('select public.create_company_with_profile(''New verified dealer'',''5568554884'',%L,true,%L)',pg_temp.store_fields(),'fd150000-0000-4000-8000-000000000908'),'42501');
reset role;
do $$begin
 perform pg_temp.store_expect('update private.company_store_profile_versions set fields=fields','55000');
 perform pg_temp.store_expect('delete from private.company_store_exports','55000');
 perform pg_temp.store_expect('delete from private.company_store_requests','55000');
 if exists(select 1 from public.memberships m join private.company_store_profile_heads h on h.company_id=m.company_id where m.user_id='fd150000-0000-4000-8000-000000000007' and m.role<>'owner') then raise exception 'New dealer not owner';end if;
 raise notice 'PASS: atomic dealer company/profile, private immutable versions, exact reviewed hashes, CAS, role/tenant/replay boundaries';
end$$;
rollback;
-- Cleanup verification after this transaction: all counts MUST be zero.
-- select 'users',count(*) from auth.users where id::text like 'fd150000-0000-4000-8000-%'
-- union all select 'companies',count(*) from public.companies where id::text like 'fd150000-0000-4000-8000-%' or created_by::text like 'fd150000-0000-4000-8000-%'
-- union all select 'versions',count(*) from private.company_store_profile_versions where created_by::text like 'fd150000-0000-4000-8000-%'
-- union all select 'exports',count(*) from private.company_store_exports where created_by::text like 'fd150000-0000-4000-8000-%'
-- union all select 'requests',count(*) from private.company_store_requests where actor_user_id::text like 'fd150000-0000-4000-8000-%';
