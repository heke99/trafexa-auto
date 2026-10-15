-- Synthetic rollback-only review/send/publication proof. No external provider, auth token or account activation.
begin;
do $$begin
 if exists(select 1 from auth.users where id in('af190000-0000-4000-8000-000000000001','af190000-0000-4000-8000-000000000002','af190000-0000-4000-8000-000000000008','af190000-0000-4000-8000-000000000009')) or exists(select 1 from public.companies where id='af190000-0000-4000-8000-000000000003') or exists(select 1 from private.advertising_dispatchers where id in('priced_bl','priced_wa')) then raise exception 'Reviewed send fixture collision';end if;
end $$;

insert into auth.users(id,email,email_confirmed_at) values('af190000-0000-4000-8000-000000000001','priced-admin@example.invalid',now()),('af190000-0000-4000-8000-000000000002','priced-owner@example.invalid',now()),('af190000-0000-4000-8000-000000000008','priced-sales@example.invalid',now()),('af190000-0000-4000-8000-000000000009','priced-other@example.invalid',now());
insert into private.account_approvals(user_id,status,updated_by) select id,'approved',id from auth.users where id in('af190000-0000-4000-8000-000000000001','af190000-0000-4000-8000-000000000002','af190000-0000-4000-8000-000000000008','af190000-0000-4000-8000-000000000009') on conflict(user_id) do nothing;
insert into private.platform_admins(user_id,created_by) values('af190000-0000-4000-8000-000000000001','af190000-0000-4000-8000-000000000001');
insert into public.companies(id,name,organisation_number,created_by) values('af190000-0000-4000-8000-000000000003','Reviewed send fixture','5568554884','af190000-0000-4000-8000-000000000002');
insert into public.memberships(company_id,user_id,role) values('af190000-0000-4000-8000-000000000003','af190000-0000-4000-8000-000000000002','owner'),('af190000-0000-4000-8000-000000000003','af190000-0000-4000-8000-000000000008','sales');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year) values('af190000-0000-4000-8000-000000000004','af190000-0000-4000-8000-000000000003','AF19001','Volvo','V60',2022);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme) values('af190000-0000-4000-8000-000000000005','af190000-0000-4000-8000-000000000003','af190000-0000-4000-8000-000000000004',100,25000000,'standard');
insert into private.vehicle_photos(id,company_id,stock_id,object_path,content_type,size_bytes,created_by) values('af190000-0000-4000-8000-000000000007','af190000-0000-4000-8000-000000000003','af190000-0000-4000-8000-000000000005','af190000-0000-4000-8000-000000000003/af190000-0000-4000-8000-000000000005/af190000-0000-4000-8000-000000000007.jpg','image/jpeg',100,'af190000-0000-4000-8000-000000000002');
insert into private.advertising_listings(id,company_id,stock_id,version,status,created_by) values('af190000-0000-4000-8000-000000000006','af190000-0000-4000-8000-000000000003','af190000-0000-4000-8000-000000000005',2,'ready','af190000-0000-4000-8000-000000000002');
insert into private.advertising_versions(company_id,listing_id,version,snapshot,created_by) select 'af190000-0000-4000-8000-000000000003','af190000-0000-4000-8000-000000000006',2,private.advertising_snapshot('af190000-0000-4000-8000-000000000003','af190000-0000-4000-8000-000000000005','Volvo V60','Fixture',array['af190000-0000-4000-8000-000000000007']::uuid[],false),'af190000-0000-4000-8000-000000000002';
insert into private.advertising_dispatchers(id,channel,available_until) values('priced_bl','blocket',clock_timestamp()+interval '5 minutes'),('priced_wa','wayke',clock_timestamp()+interval '5 minutes');
insert into private.advertising_connections(company_id,channel,account_reference,status,dispatcher_id,created_by) values('af190000-0000-4000-8000-000000000003','blocket','fixture','verified','priced_bl','af190000-0000-4000-8000-000000000002'),('af190000-0000-4000-8000-000000000003','wayke','fixture','verified','priced_wa','af190000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub','af190000-0000-4000-8000-000000000001',true);
select public.save_advertising_channel_rate('af190000-0000-4000-8000-000000000003','blocket','12500',0,'af190000-0000-4000-8000-000000000020');
select public.save_advertising_channel_rate('af190000-0000-4000-8000-000000000003','wayke','0',0,'af190000-0000-4000-8000-000000000021');
select set_config('request.jwt.claim.sub','af190000-0000-4000-8000-000000000002',true);
do $$declare q jsonb;r jsonb;again jsonb;begin
 q:=public.get_advertising_send_quote('af190000-0000-4000-8000-000000000003','af190000-0000-4000-8000-000000000006',2,array['wayke','blocket']);
 if q->>'totalOre'<>'12500' or q->'channels'<>jsonb_build_array('blocket','wayke') then raise exception 'Quote mismatch';end if;
 r:=public.send_vehicle_advertisement_priced('af190000-0000-4000-8000-000000000003','af190000-0000-4000-8000-000000000006',2,array['wayke','blocket'],'af190000-0000-4000-8000-000000000030',q->>'reviewToken');
 if r->>'status'<>'queued' or jsonb_array_length(r->'jobs')<>2 or r->'quote'<>q then raise exception 'Accepted price receipt mismatch';end if;
 again:=public.send_vehicle_advertisement_priced('af190000-0000-4000-8000-000000000003','af190000-0000-4000-8000-000000000006',2,array['blocket','wayke'],'af190000-0000-4000-8000-000000000030',q->>'reviewToken');
 if again<>r then raise exception 'Exact replay mismatch';end if;
 begin perform public.send_vehicle_advertisement('af190000-0000-4000-8000-000000000003','af190000-0000-4000-8000-000000000006',2,array['blocket'],'af190000-0000-4000-8000-000000000031');raise exception 'Legacy bypass accepted';exception when sqlstate '22023' then null;end;
end $$;
select set_config('request.jwt.claim.sub','af190000-0000-4000-8000-000000000001',true);
select public.save_advertising_channel_rate('af190000-0000-4000-8000-000000000003','blocket','99999',1,'af190000-0000-4000-8000-000000000022');
select set_config('request.jwt.claim.sub','af190000-0000-4000-8000-000000000002',true);
do $$declare q jsonb;begin q:=public.get_advertising_send_quote('af190000-0000-4000-8000-000000000003','af190000-0000-4000-8000-000000000006',2,array['blocket']);if q->'items'->0->>'unitPriceOre'<>'12500' then raise exception 'Accepted quote repriced';end if;end $$;
reset role;
do $$declare j private.advertising_jobs%rowtype;r jsonb;begin
 select * into j from private.advertising_jobs where company_id='af190000-0000-4000-8000-000000000003' and channel='blocket';
 set local role service_role;
 r:=public.claim_advertising_job(j.id,j.version,'af190000-0000-4000-8000-000000000080');
 perform public.save_advertising_job(j.id,(r->>'version')::integer,'af190000-0000-4000-8000-000000000080','published','reviewed-send-fixture',null,null);
 reset role;
 if not exists(select 1 from private.advertising_publication_prices pp join private.advertising_publications p on p.id=pp.publication_id where p.company_id='af190000-0000-4000-8000-000000000003' and pp.unit_price_ore=12500) then raise exception 'Frozen published price mismatch';end if;
 if (select count(*) from private.advertising_charge_commitments where company_id='af190000-0000-4000-8000-000000000003')<>2 or (select count(*) from private.advertising_job_price_commitments where company_id='af190000-0000-4000-8000-000000000003')<>2 then raise exception 'Accepted price bindings missing';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','af190000-0000-4000-8000-000000000002',true);
do $$declare b jsonb;u jsonb;m text:=to_char(clock_timestamp() at time zone 'Europe/Stockholm','YYYY-MM');begin
 b:=public.list_advertising_billing('af190000-0000-4000-8000-000000000003',m);
 u:=public.list_advertising_quantities('af190000-0000-4000-8000-000000000003',m);
 if b->>'count' is distinct from '1' or b->>'totalOre' is distinct from '12500' or b->>'unpricedCount' is distinct from '0'
  or u->'totals'->>'newPublications' is distinct from '1' or u->'totals'->>'queued' is distinct from '1'
  or u->'billing'->>'unpricedPublications' is distinct from '0' then raise exception 'Dealer billing and usage mismatch';end if;
end $$;
reset role;
select 'PASS: atomic selected channels, frozen reviewed price, exact retry, old bypass denied, unique verified publication billing and dealer statistics' result;
rollback;
