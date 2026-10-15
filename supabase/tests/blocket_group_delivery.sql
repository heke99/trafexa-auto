-- Synthetic rollback-only provisioning and worker ledger; no credential or network I/O.
begin;
-- BEGIN BLOCKET FIXTURES
do $$begin
 if exists(select 1 from auth.users where id::text like 'fd190000-0000-4000-8000-%')or exists(select 1 from public.companies where id::text like 'fd190000-0000-4000-8000-%')or exists(select 1 from private.blocket_groups where id::text like 'fd190000-0000-4000-8000-%')then raise exception 'Blocket fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at)values
 ('fd190000-0000-4000-8000-000000000001','blocket-platform@fixture.invalid',now()),
 ('fd190000-0000-4000-8000-000000000002','blocket-owner@fixture.invalid',now()),
 ('fd190000-0000-4000-8000-000000000003','blocket-sales@fixture.invalid',now()),
 ('fd190000-0000-4000-8000-000000000004','blocket-foreign@fixture.invalid',now());
insert into private.platform_admins(user_id,created_by)values('fd190000-0000-4000-8000-000000000001','fd190000-0000-4000-8000-000000000001');
insert into private.account_approvals(user_id,status,updated_by)select id,'approved','fd190000-0000-4000-8000-000000000001'from auth.users where id::text like 'fd190000-0000-4000-8000-%';
insert into public.companies(id,name,organisation_number,created_by)values
 ('fd190000-0000-4000-8000-000000000101','Blocket fixture A','5568554884','fd190000-0000-4000-8000-000000000002'),
 ('fd190000-0000-4000-8000-000000000102','Blocket fixture B','5568554884','fd190000-0000-4000-8000-000000000004');
insert into public.memberships(company_id,user_id,role)values
 ('fd190000-0000-4000-8000-000000000101','fd190000-0000-4000-8000-000000000002','owner'),
 ('fd190000-0000-4000-8000-000000000101','fd190000-0000-4000-8000-000000000003','sales'),
 ('fd190000-0000-4000-8000-000000000102','fd190000-0000-4000-8000-000000000004','owner');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year,mileage_km)values('fd190000-0000-4000-8000-000000000302','fd190000-0000-4000-8000-000000000101','ABC123','Volvo','V60',2022,10000);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('fd190000-0000-4000-8000-000000000301','fd190000-0000-4000-8000-000000000101','fd190000-0000-4000-8000-000000000302',10000000,25000000,'standard');
insert into private.vehicle_photos(id,company_id,stock_id,object_path,content_type,size_bytes,created_by)values('fd190000-0000-4000-8000-000000000501','fd190000-0000-4000-8000-000000000101','fd190000-0000-4000-8000-000000000301','fd190000-0000-4000-8000-000000000101/fd190000-0000-4000-8000-000000000301/fd190000-0000-4000-8000-000000000501.jpg','image/jpeg',100,'fd190000-0000-4000-8000-000000000003');
insert into private.advertising_listings(id,company_id,stock_id,version,status,created_by)values('fd190000-0000-4000-8000-000000000401','fd190000-0000-4000-8000-000000000101','fd190000-0000-4000-8000-000000000301',2,'ready','fd190000-0000-4000-8000-000000000003');
insert into private.advertising_versions(company_id,listing_id,version,snapshot,created_by)select 'fd190000-0000-4000-8000-000000000101','fd190000-0000-4000-8000-000000000401',2,private.advertising_snapshot('fd190000-0000-4000-8000-000000000101','fd190000-0000-4000-8000-000000000301','Volvo V60','Fixture',array['fd190000-0000-4000-8000-000000000501']::uuid[],true),'fd190000-0000-4000-8000-000000000003';
-- END BLOCKET FIXTURES
create temporary table blocket_proof(k text primary key,v jsonb);grant select,insert,update on blocket_proof to authenticated,service_role;
set local role authenticated;set local request.jwt.claim.sub='fd190000-0000-4000-8000-000000000001';
insert into blocket_proof values('group',public.configure_blocket_group('fd190000-0000-4000-8000-000000000201',0,'Fixture group','fixture_label','dealer_group','active','Reviewed fixture',true,'fd190000-0000-4000-8000-000000000901'));
insert into blocket_proof values('binding',public.bind_blocket_company('fd190000-0000-4000-8000-000000000101','fd190000-0000-4000-8000-000000000201',1,0,'fixture-dealer','Manual scope evidence',now()+interval '1 day','Reviewed binding',true,'fd190000-0000-4000-8000-000000000902'));
reset role;
do $$begin if exists(select 1 from private.advertising_dispatchers where id='blocket_fd190000000040008000000000000201'and available_until>clock_timestamp())then raise exception 'Provisioning enabled runtime';end if;end$$;
insert into private.advertising_jobs(id,company_id,stock_id,listing_id,listing_version,channel,connection_id,connection_version,account_reference,dispatcher_id,created_by,snapshot)
select 'fd190000-0000-4000-8000-000000000601',c.company_id,'fd190000-0000-4000-8000-000000000301',v.listing_id,2,'blocket',c.id,c.version,c.account_reference,c.dispatcher_id,'fd190000-0000-4000-8000-000000000003',v.snapshot from private.advertising_connections c join private.advertising_versions v on v.company_id=c.company_id and v.version=2 where c.company_id='fd190000-0000-4000-8000-000000000101';
set local role service_role;
select public.refresh_advertising_dispatcher('blocket_fd190000000040008000000000000201','blocket',now()+interval '4 minutes');
insert into blocket_proof values('begun',public.begin_blocket_delivery('fd190000-0000-4000-8000-000000000601',1,'fd190000-0000-4000-8000-000000000801',repeat('a',64)));
insert into blocket_proof select 'ack',public.record_blocket_delivery('fd190000-0000-4000-8000-000000000601',(v->'delivery'->>'id')::uuid,1,'fd190000-0000-4000-8000-000000000801','submitted','fd190000-0000-4000-8000-000000000811',null,null)from blocket_proof where k='begun';
insert into blocket_proof select 'verified',public.record_blocket_delivery('fd190000-0000-4000-8000-000000000601',(v->>'id')::uuid,2,null,'published','fd190000-0000-4000-8000-000000000811','123456',repeat('b',64))from blocket_proof where k='ack';
select public.save_advertising_job('fd190000-0000-4000-8000-000000000601',2,'fd190000-0000-4000-8000-000000000801','published','123456',null,null);
reset role;
do $$begin
 if(select count(*)from private.advertising_publications where company_id='fd190000-0000-4000-8000-000000000101')<>1 then raise exception 'Missing verified publication';end if;
 if(select operation from private.blocket_delivery_revisions where job_id='fd190000-0000-4000-8000-000000000601')<>'create'then raise exception 'First ready version must create';end if;
 if(select count(*)from private.blocket_delivery_events e join private.blocket_delivery_revisions r on r.id=e.delivery_id where r.job_id='fd190000-0000-4000-8000-000000000601')<>3 then raise exception 'Missing immutable events';end if;
end$$;
rollback;
