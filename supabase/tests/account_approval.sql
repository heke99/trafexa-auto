begin;
-- Synthetic Auth fixtures are rolled back. No production account is auto-approved.
do $$begin
 if exists(select 1 from auth.users where id::text like 'ee190000-%' or email in ('approval-admin@fixture.invalid','approval-user@fixture.invalid')) or exists(select 1 from public.companies where id::text like 'ee190000-%') then raise exception 'Fixture collision';end if;
end $$;
insert into auth.users(id,email,email_confirmed_at,created_at)values
 ('ee190000-0000-0000-0000-000000000001','approval-admin@fixture.invalid',clock_timestamp(),clock_timestamp()),
 ('ee190000-0000-0000-0000-000000000002','approval-user@fixture.invalid',clock_timestamp(),clock_timestamp());
insert into private.platform_admins(user_id,created_by)values('ee190000-0000-0000-0000-000000000001','ee190000-0000-0000-0000-000000000001');
insert into public.companies(id,name,organisation_number,created_by)values('ee190000-0000-0000-0000-000000000004','Approval rollback fixture','1111111111','ee190000-0000-0000-0000-000000000001');
insert into public.memberships(company_id,user_id,role)values('ee190000-0000-0000-0000-000000000004','ee190000-0000-0000-0000-000000000002','owner');
insert into public.customers(id,company_id,name)values('ee190000-0000-0000-0000-000000000005','ee190000-0000-0000-0000-000000000004','Synthetic private customer');
set local role authenticated;
select set_config('request.jwt.claim.sub','ee190000-0000-0000-0000-000000000002',true);
do $$declare denied boolean:=false;begin
 if (public.get_account_access()->>'status')<>'pending' then raise exception 'Absent approval must be pending';end if;
 if exists(select 1 from public.customers) then raise exception 'Pending account read leaked';end if;
 begin perform public.create_company('Denied fixture','1111111111');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Pending company creation allowed';end if;
 denied:=false;begin perform public.inventory_dashboard_totals('ee190000-0000-0000-0000-000000000004');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Pending financial access allowed';end if;
end $$;
select set_config('request.jwt.claim.sub','ee190000-0000-0000-0000-000000000001',true);
do $$declare receipt jsonb;replay jsonb;begin
 receipt:=public.set_platform_account_access('ee190000-0000-0000-0000-000000000002',0,'approved','Fixture explicit approval','ee190000-0000-0000-0000-000000000010');
 replay:=public.set_platform_account_access('ee190000-0000-0000-0000-000000000002',0,'approved','Fixture explicit approval','ee190000-0000-0000-0000-000000000010');
 if receipt is distinct from replay or receipt->>'version'<>'1' then raise exception 'Approval replay/version mismatch';end if;
end $$;
select set_config('request.jwt.claim.sub','ee190000-0000-0000-0000-000000000002',true);
do $$begin if not exists(select 1 from public.customers where id='ee190000-0000-0000-0000-000000000005') then raise exception 'Approved member read denied';end if;end $$;
select set_config('request.jwt.claim.sub','ee190000-0000-0000-0000-000000000001',true);
select public.set_platform_account_access('ee190000-0000-0000-0000-000000000002',1,'suspended','Fixture account suspension','ee190000-0000-0000-0000-000000000011');
select set_config('request.jwt.claim.sub','ee190000-0000-0000-0000-000000000002',true);
do $$begin if exists(select 1 from public.customers) then raise exception 'Suspended account read leaked';end if;if (public.get_account_access()->>'status')<>'suspended' then raise exception 'Suspension not reflected';end if;end $$;
select 'PASS: pending denies owner reads/company/calculations; explicit approval exact retry; suspension revokes current session' as result;
rollback;
