-- Current-month synthetic permission proof. No locked original is forged.
begin;
do $$declare a uuid:='ee380000-0000-4000-8000-000000000001';u uuid:='ee380000-0000-4000-8000-000000000002';c uuid:='ee380000-0000-4000-8000-000000000003';begin
 if exists(select 1 from auth.users where id in(a,u)) or exists(select 1 from public.companies where id=c) then raise exception 'Corrections fixture collision';end if;
 insert into auth.users(id,email,email_confirmed_at)values(a,'corrections-admin-ee380000@example.invalid',now()),(u,'corrections-owner-ee380000@example.invalid',now());
 insert into private.account_approvals(user_id,status,updated_by)values(a,'approved',a),(u,'approved',u) on conflict(user_id) do nothing;
 insert into private.platform_admins(user_id,created_by)values(a,a);
 insert into public.companies(id,name,organisation_number,created_by)values(c,'Corrections Rollback Fixture','9938000001',u);
 insert into public.memberships(company_id,user_id,role)values(c,u,'owner');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ee380000-0000-4000-8000-000000000001',true);
do $$declare c uuid:='ee380000-0000-4000-8000-000000000003';m text:=to_char(clock_timestamp() at time zone 'Europe/Stockholm','YYYY-MM');p jsonb;begin
 p:=public.get_platform_advertising_corrections(c,m);
 if p->>'actorRole'<>'platform_admin' or p->'original'<>'null'::jsonb or p->'netTotalOre'<>'null'::jsonb or p->>'reductionTotalOre'<>'0' or p->'adjustments'<>'[]'::jsonb then raise exception 'Unlocked page mismatch';end if;
 begin
  perform public.create_advertising_reduction(c,m,'ee380000-0000-4000-8000-000000000004','1','Rollback permission proof',p->>'reviewToken',true,'ee380000-0000-4000-8000-000000000005');
  raise exception 'Unlocked reduction unexpectedly allowed';
 exception when sqlstate '22023' then null;end;
end $$;
select set_config('request.jwt.claim.sub','ee380000-0000-4000-8000-000000000002',true);
do $$declare c uuid:='ee380000-0000-4000-8000-000000000003';m text:=to_char(clock_timestamp() at time zone 'Europe/Stockholm','YYYY-MM');p jsonb;begin
 p:=public.list_advertising_corrections(c,m);
 if p->>'actorRole'<>'owner' or p->>'actorUserId'<>auth.uid()::text or p->'original'<>'null'::jsonb then raise exception 'Dealer read scope mismatch';end if;
 begin perform public.get_platform_advertising_corrections(c,m);raise exception 'Dealer admin read unexpectedly allowed';exception when sqlstate '42501' then null;end;
 begin perform public.create_advertising_reduction(c,m,'ee380000-0000-4000-8000-000000000004','1','Rollback owner denial',p->>'reviewToken',true,'ee380000-0000-4000-8000-000000000006');raise exception 'Dealer write unexpectedly allowed';exception when sqlstate '42501' then null;end;
 begin perform 1 from private.advertising_billing_reductions;raise exception 'Direct private read unexpectedly allowed';exception when sqlstate '42501' then null;end;
end $$;
set local role service_role;
do $$begin
 begin perform public.get_platform_advertising_corrections('ee380000-0000-4000-8000-000000000003','2026-10');raise exception 'Service read unexpectedly allowed';exception when sqlstate '42501' then null;end;
end $$;
reset role;
do $$begin
 if exists(select 1 from private.advertising_billing_reductions where company_id='ee380000-0000-4000-8000-000000000003') then raise exception 'Reduction created unexpectedly';end if;
end $$;
select 'PASS: private superadmin/dealer reads, unlocked original denied, dealer mutation and direct private/service access denied' result;
rollback;
