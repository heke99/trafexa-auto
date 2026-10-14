begin;
do $$begin
 if exists(select 1 from auth.users where id='ee160000-0000-4000-8000-000000000001') or exists(select 1 from public.companies where id='ee160000-0000-4000-8000-000000000002') or exists(select 1 from public.customers where id='ee160000-0000-4000-8000-000000000003') or exists(select 1 from public.vehicles where id='ee160000-0000-4000-8000-000000000004') or exists(select 1 from public.stock_items where id='ee160000-0000-4000-8000-000000000005') or exists(select 1 from public.deals where id='ee160000-0000-4000-8000-000000000006') then raise exception 'Cancellation smoke fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at)values('ee160000-0000-4000-8000-000000000001','cancellation-ee160000@example.invalid',now());
insert into public.companies(id,name,organisation_number,created_by)values('ee160000-0000-4000-8000-000000000002','Cancellation Rollback Fixture','9916000001','ee160000-0000-4000-8000-000000000001');
insert into public.memberships(company_id,user_id,role)values('ee160000-0000-4000-8000-000000000002','ee160000-0000-4000-8000-000000000001','owner');
insert into public.customers(id,company_id,name)values('ee160000-0000-4000-8000-000000000003','ee160000-0000-4000-8000-000000000002','Rollback Customer');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('ee160000-0000-4000-8000-000000000004','ee160000-0000-4000-8000-000000000002','EE160000','Fixture','Rollback',2020);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('ee160000-0000-4000-8000-000000000005','ee160000-0000-4000-8000-000000000002','ee160000-0000-4000-8000-000000000004',100,200,'standard');
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)values('ee160000-0000-4000-8000-000000000006','ee160000-0000-4000-8000-000000000002','ee160000-0000-4000-8000-000000000005','ee160000-0000-4000-8000-000000000003',200,'ee160000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','ee160000-0000-4000-8000-000000000001',true);
do $$declare v jsonb;r jsonb;begin
 perform public.reserve_vehicle('ee160000-0000-4000-8000-000000000002','ee160000-0000-4000-8000-000000000006',48);
 v:=public.cancel_deal('ee160000-0000-4000-8000-000000000002','ee160000-0000-4000-8000-000000000006','reserved','Rollback cancellation','ee160000-0000-4000-8000-000000000007');
 r:=public.cancel_deal('ee160000-0000-4000-8000-000000000002','ee160000-0000-4000-8000-000000000006','reserved','Rollback cancellation','ee160000-0000-4000-8000-000000000007');
 if v is distinct from r or v->>'actorUserId'<>'ee160000-0000-4000-8000-000000000001' or v->>'releasedReservations'<>'1' or v->>'status'<>'cancelled' then raise exception 'Cancellation receipt failed';end if;
 if (select status from public.stock_items where id='ee160000-0000-4000-8000-000000000005')<>'available' then raise exception 'Stock was not released';end if;
 if (select status from public.deals where id='ee160000-0000-4000-8000-000000000006')<>'cancelled' then raise exception 'Deal was not cancelled';end if;
end$$;
select 'PASS: scoped cancellation, actor-bound replay and reservation release' as result;
rollback;
