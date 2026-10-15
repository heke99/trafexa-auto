-- Synthetic current-month proof only. No provider calls, clock overrides or trigger disabling.
begin;
do $$declare
 a uuid:='ee360000-0000-4000-8000-000000000001';u uuid:='ee360000-0000-4000-8000-000000000002';c uuid:='ee360000-0000-4000-8000-000000000003';v uuid:='ee360000-0000-4000-8000-000000000004';s uuid:='ee360000-0000-4000-8000-000000000005';l uuid:='ee360000-0000-4000-8000-000000000006';ch text;con uuid;j uuid;
begin
 if exists(select 1 from auth.users where id in(a,u)) or exists(select 1 from public.companies where id=c) or exists(select 1 from private.advertising_dispatchers where id like 'ee360000_%') then raise exception 'Billing fixture collision';end if;
 insert into auth.users(id,email,email_confirmed_at)values(a,'billing-admin-ee360000@example.invalid',now()),(u,'billing-owner-ee360000@example.invalid',now());
 insert into private.account_approvals(user_id,status,updated_by)values(a,'approved',a),(u,'approved',u) on conflict(user_id) do nothing;
 insert into private.platform_admins(user_id,created_by)values(a,a);
 insert into public.companies(id,name,organisation_number,created_by)values(c,'Billing Rollback Fixture','9936000001',u);
 insert into public.memberships(company_id,user_id,role)values(c,u,'owner');
 insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values(v,c,'EE36000','Fixture','Rollback',2020);
 insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values(s,c,v,100,200,'standard');
 insert into private.advertising_listings(id,company_id,stock_id,status,created_by)values(l,c,s,'draft',u);
 insert into private.advertising_versions(company_id,listing_id,version,snapshot,created_by)values(c,l,1,'{}',u);
 foreach ch in array array['blocket','wayke'] loop
  con:=case ch when 'blocket' then 'ee360000-0000-4000-8000-000000000007'::uuid else 'ee360000-0000-4000-8000-000000000008'::uuid end;
  j:=case ch when 'blocket' then 'ee360000-0000-4000-8000-000000000009'::uuid else 'ee360000-0000-4000-8000-000000000010'::uuid end;
  insert into private.advertising_dispatchers(id,channel)values('ee360000_'||ch,ch);
  insert into private.advertising_connections(id,company_id,channel,account_reference,status,dispatcher_id,created_by)values(con,c,ch,'ee360000_fixture','verified','ee360000_'||ch,u);
  insert into private.advertising_jobs(id,company_id,stock_id,listing_id,listing_version,channel,connection_id,connection_version,account_reference,dispatcher_id,created_by,snapshot,status)values(j,c,s,l,1,ch,con,1,'ee360000_fixture','ee360000_'||ch,u,'{}','submitted');
 end loop;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ee360000-0000-4000-8000-000000000001',true);
do $$declare r jsonb;begin
 r:=public.save_advertising_channel_rate('ee360000-0000-4000-8000-000000000003','blocket','9007199254740993',0,'ee360000-0000-4000-8000-000000000020');
 if r->>'actorUserId'<>auth.uid()::text or r->>'unitPriceOre'<>'9007199254740993' then raise exception 'Rate receipt mismatch';end if;
end $$;
set local role service_role;
select public.save_advertising_job('ee360000-0000-4000-8000-000000000009',1,null,'published','ee360000_blocket',null,null);
select public.save_advertising_job('ee360000-0000-4000-8000-000000000010',1,null,'published','ee360000_wayke',null,null);
set local role authenticated;
select set_config('request.jwt.claim.sub','ee360000-0000-4000-8000-000000000001',true);
do $$declare c uuid:='ee360000-0000-4000-8000-000000000003';m text:=to_char(clock_timestamp() at time zone 'Europe/Stockholm','YYYY-MM');p jsonb;r jsonb;token text;begin
 p:=public.get_platform_advertising_billing(c,m);
 if p->>'count'<>'2' or p->>'unpricedCount'<>'1' or p->'totalOre'<>'null'::jsonb then raise exception 'Prospective price proof failed';end if;
 perform public.save_advertising_channel_rate(c,'wayke','99',0,'ee360000-0000-4000-8000-000000000021');
 p:=public.get_platform_advertising_billing(c,m);
 if p->>'unpricedCount'<>'1' then raise exception 'Historical publication was repriced';end if;
 token:=p->>'reviewToken';
 p:=public.reconcile_advertising_billing(c,m,'wayke','0',token,'Rollback reviewed zero price',true,'ee360000-0000-4000-8000-000000000022');
 r:=public.reconcile_advertising_billing(c,m,'wayke','0',token,'Rollback reviewed zero price',true,'ee360000-0000-4000-8000-000000000022');
 if p<>r or p->>'totalOre'<>'9007199254740993' or p->>'unpricedCount'<>'0' then raise exception 'Reviewed exact amount or replay mismatch';end if;
 begin
  perform public.lock_advertising_billing_period(c,m,p->>'reviewToken',true,true,'ee360000-0000-4000-8000-000000000023');
  raise exception 'Current month closed unexpectedly';
 exception when sqlstate '22023' then null;end;
 if public.get_platform_advertising_billing(c,m)->'locked'<>'null'::jsonb then raise exception 'Current period was created';end if;
end $$;
select set_config('request.jwt.claim.sub','ee360000-0000-4000-8000-000000000002',true);
do $$declare p jsonb;begin
 p:=public.list_advertising_billing('ee360000-0000-4000-8000-000000000003',to_char(clock_timestamp() at time zone 'Europe/Stockholm','YYYY-MM'));
 if p->>'actorRole'<>'owner' or p->>'totalOre'<>'9007199254740993' then raise exception 'Dealer read scope failed';end if;
end $$;
select 'PASS: prospective rate, historical unknown preserved, explicit reviewed zero, exact replay, private dealer/admin reads, current-month close denied' result;
rollback;
