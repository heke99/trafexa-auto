begin;
do $$begin
 if exists(select 1 from auth.users where id in ('ee350000-0000-4000-8000-000000000001','ee350000-0000-4000-8000-000000000009')) or exists(select 1 from public.companies where id='ee350000-0000-4000-8000-000000000002') or exists(select 1 from public.vehicles where id='ee350000-0000-4000-8000-000000000003') or exists(select 1 from public.stock_items where id='ee350000-0000-4000-8000-000000000004') or exists(select 1 from private.advertising_listings where id='ee350000-0000-4000-8000-000000000005') or exists(select 1 from private.vehicle_photos where id='ee350000-0000-4000-8000-000000000006') or exists(select 1 from private.advertising_jobs where id='ee350000-0000-4000-8000-000000000008') or exists(select 1 from private.advertising_connections where id='ee350000-0000-4000-8000-000000000007') or exists(select 1 from private.advertising_dispatchers where id='ee350000_fixture') then raise exception 'Advertising usage fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at) values('ee350000-0000-4000-8000-000000000001','usage-ee350000@example.invalid',now()),('ee350000-0000-4000-8000-000000000009','usage-admin-ee350000@example.invalid',now());
insert into private.account_approvals(user_id,status,updated_by) values('ee350000-0000-4000-8000-000000000001','approved','ee350000-0000-4000-8000-000000000001'),('ee350000-0000-4000-8000-000000000009','approved','ee350000-0000-4000-8000-000000000009') on conflict(user_id) do nothing;
insert into private.platform_admins(user_id,status,created_by)values('ee350000-0000-4000-8000-000000000009','active','ee350000-0000-4000-8000-000000000009');
insert into public.companies(id,name,organisation_number,created_by)values('ee350000-0000-4000-8000-000000000002','Usage Rollback Fixture','9935000001','ee350000-0000-4000-8000-000000000001');
insert into public.memberships(company_id,user_id,role)values('ee350000-0000-4000-8000-000000000002','ee350000-0000-4000-8000-000000000001','owner');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('ee350000-0000-4000-8000-000000000003','ee350000-0000-4000-8000-000000000002','EE35000','Fixture','Rollback',2020);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('ee350000-0000-4000-8000-000000000004','ee350000-0000-4000-8000-000000000002','ee350000-0000-4000-8000-000000000003',100,200,'standard');
insert into storage.objects(bucket_id,name,metadata)values('ads-vehicle-photos','ee350000-0000-4000-8000-000000000002/ee350000-0000-4000-8000-000000000004/ee350000-0000-4000-8000-000000000006.jpg','{"size":1,"mimetype":"image/jpeg"}');
insert into private.vehicle_photos(id,company_id,stock_id,object_path,content_type,size_bytes,created_by)values('ee350000-0000-4000-8000-000000000006','ee350000-0000-4000-8000-000000000002','ee350000-0000-4000-8000-000000000004','ee350000-0000-4000-8000-000000000002/ee350000-0000-4000-8000-000000000004/ee350000-0000-4000-8000-000000000006.jpg','image/jpeg',1,'ee350000-0000-4000-8000-000000000001');
insert into private.advertising_listings(id,company_id,stock_id,status,created_by)values('ee350000-0000-4000-8000-000000000005','ee350000-0000-4000-8000-000000000002','ee350000-0000-4000-8000-000000000004','ready','ee350000-0000-4000-8000-000000000001');
insert into private.advertising_versions(company_id,listing_id,version,snapshot,created_by)select 'ee350000-0000-4000-8000-000000000002','ee350000-0000-4000-8000-000000000005',1,private.advertising_snapshot('ee350000-0000-4000-8000-000000000002','ee350000-0000-4000-8000-000000000004','Fixture listing','Rollback only',array['ee350000-0000-4000-8000-000000000006'::uuid],false),'ee350000-0000-4000-8000-000000000001';
insert into private.advertising_dispatchers(id,channel,available_until)values('ee350000_fixture','blocket',clock_timestamp()+interval '4 minutes');
insert into private.advertising_connections(id,company_id,channel,account_reference,status,dispatcher_id,created_by)values('ee350000-0000-4000-8000-000000000007','ee350000-0000-4000-8000-000000000002','blocket','ee350000_fixture','verified','ee350000_fixture','ee350000-0000-4000-8000-000000000001');
insert into private.advertising_jobs(id,company_id,stock_id,listing_id,listing_version,channel,connection_id,connection_version,account_reference,dispatcher_id,created_by,snapshot)select 'ee350000-0000-4000-8000-000000000008','ee350000-0000-4000-8000-000000000002','ee350000-0000-4000-8000-000000000004','ee350000-0000-4000-8000-000000000005',1,'blocket','ee350000-0000-4000-8000-000000000007',1,'ee350000_fixture','ee350000_fixture','ee350000-0000-4000-8000-000000000001',snapshot from private.advertising_versions where listing_id='ee350000-0000-4000-8000-000000000005' and version=1;
set local role service_role;
select public.claim_advertising_job('ee350000-0000-4000-8000-000000000008',1,'ee350000-0000-4000-8000-000000000010');
select public.save_advertising_job('ee350000-0000-4000-8000-000000000008',2,'ee350000-0000-4000-8000-000000000010','submitted','ee350000_mock_ad',null,null);
set local role authenticated;
select set_config('request.jwt.claim.sub','ee350000-0000-4000-8000-000000000001',true);
do $$declare r jsonb;begin
 r:=public.list_advertising_usage('ee350000-0000-4000-8000-000000000002',to_char(clock_timestamp() at time zone 'Europe/Stockholm','YYYY-MM'));
 if r->'totals'->>'newPublications'<>'0' or r->'totals'->>'submitted'<>'1' then raise exception 'Submitted must not count';end if;
end$$;
set local role service_role;
select public.save_advertising_job('ee350000-0000-4000-8000-000000000008',3,null,'published','ee350000_mock_ad',null,null);
-- Exact terminal retry keeps the same version and one immutable unit.
select public.save_advertising_job('ee350000-0000-4000-8000-000000000008',4,null,'published','ee350000_mock_ad',null,null);
set local role authenticated;
select set_config('request.jwt.claim.sub','ee350000-0000-4000-8000-000000000001',true);
do $$declare r jsonb;begin
 r:=public.list_advertising_usage('ee350000-0000-4000-8000-000000000002',to_char(clock_timestamp() at time zone 'Europe/Stockholm','YYYY-MM'));
 if r->'totals'->>'newPublications'<>'1' or r->'billing'->>'unpricedPublications'<>'1' or r->'billing'->'totalOre'<>'null'::jsonb then raise exception 'Publication billing basis failed';end if;
end$$;
select set_config('request.jwt.claim.sub','ee350000-0000-4000-8000-000000000009',true);
do $$declare r jsonb;begin
 r:=public.get_platform_advertising_usage('ee350000-0000-4000-8000-000000000002',to_char(clock_timestamp() at time zone 'Europe/Stockholm','YYYY-MM'));
 if r->>'actorRole'<>'platform_admin' or r->'totals'->>'newPublications'<>'1' then raise exception 'Superadmin billing scope failed';end if;
end$$;
select 'PASS: submitted excluded, verified publication counted once, exact retry deduplicated, superadmin private basis, unknown amounts null' as result;
rollback;
