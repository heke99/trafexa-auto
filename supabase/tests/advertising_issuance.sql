-- Negative-only synthetic proof. It configures no real series and creates no invoice.
begin;
do $$declare a uuid:='ee440000-0000-4000-8000-000000000001';u uuid:='ee440000-0000-4000-8000-000000000002';c uuid:='ee440000-0000-4000-8000-000000000003';begin
 if exists(select 1 from auth.users where id in(a,u)) or exists(select 1 from public.companies where id=c) or exists(select 1 from private.advertising_invoice_series where id='ee440000-0000-4000-8000-000000000005') then raise exception 'Issuance fixture collision';end if;
 insert into auth.users(id,email,email_confirmed_at)values(a,'issuance-admin-ee440000@example.invalid',now()),(u,'issuance-owner-ee440000@example.invalid',now());
 insert into private.account_approvals(user_id,status,updated_by)values(a,'approved',a),(u,'approved',u) on conflict(user_id) do nothing;
 insert into private.platform_admins(user_id,created_by)values(a,a);
 insert into public.companies(id,name,organisation_number,created_by)values(c,'Issuance Rollback Fixture','9944000001',u);
 insert into public.memberships(company_id,user_id,role)values(c,u,'owner');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ee440000-0000-4000-8000-000000000001',true);
do $$declare c uuid:='ee440000-0000-4000-8000-000000000003';a uuid:='ee440000-0000-4000-8000-000000000004';s uuid:='ee440000-0000-4000-8000-000000000005';m text:=to_char(clock_timestamp() at time zone 'Europe/Stockholm','YYYY-MM');yr integer:=extract(year from clock_timestamp() at time zone 'Europe/Stockholm')::integer;begin
 begin perform public.get_platform_advertising_issuance_page(c,m,a);raise exception 'Missing assessment accepted';exception when sqlstate '42501' then null;end;
 begin perform public.configure_advertising_invoice_series(c,a,repeat('a',64),yr,'ROLLBACK','1','Fixture Municipality','Negative rollback proof',true,'ee440000-0000-4000-8000-000000000006');raise exception 'Series configured without reviewed assessment';exception when sqlstate '42501' then null;end;
 begin perform public.issue_advertising_invoice(c,m,a,repeat('a',64),s,repeat('b',64),repeat('c',64),true,false,'ee440000-0000-4000-8000-000000000007');raise exception 'Missing service acknowledgement accepted';exception when sqlstate '22023' then null;end;
 begin perform public.issue_advertising_invoice(c,m,a,repeat('a',64),s,repeat('b',64),repeat('c',64),true,true,'ee440000-0000-4000-8000-000000000007');raise exception 'Invoice issued with missing series';exception when sqlstate '40001' then null;end;
 begin perform 1 from private.advertising_invoice_counters;raise exception 'Direct global counter read allowed';exception when sqlstate '42501' then null;end;
end $$;
select set_config('request.jwt.claim.sub','ee440000-0000-4000-8000-000000000002',true);
do $$declare c uuid:='ee440000-0000-4000-8000-000000000003';a uuid:='ee440000-0000-4000-8000-000000000004';begin
 begin perform public.configure_advertising_invoice_series(c,a,repeat('a',64),2026,'ROLLBACK','1','Fixture Municipality','Owner denial proof',true,'ee440000-0000-4000-8000-000000000008');raise exception 'Owner configured series';exception when sqlstate '42501' then null;end;
 begin perform public.get_advertising_issued_invoice(c,a);raise exception 'Missing invoice leaked';exception when sqlstate '42501' then null;end;
end $$;
reset role;
do $$begin
 if exists(select 1 from private.advertising_invoice_series where company_id='ee440000-0000-4000-8000-000000000003') or exists(select 1 from private.advertising_issued_invoices where company_id='ee440000-0000-4000-8000-000000000003') then raise exception 'Unexpected series or invoice';end if;
end $$;
select 'PASS: missing source/series and service attestation denied, global counters private, owner configuration denied; no series or invoice created' result;
rollback;
