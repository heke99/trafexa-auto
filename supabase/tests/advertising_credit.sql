-- Negative-only rollback proof: no series, invoice, credit, number or email is created.
begin;
do $$declare a uuid:='ee550000-0000-4000-8000-000000000001';u uuid:='ee550000-0000-4000-8000-000000000002';c uuid:='ee550000-0000-4000-8000-000000000003';begin
 if exists(select 1 from auth.users where id in(a,u)) or exists(select 1 from public.companies where id=c) or exists(select 1 from private.advertising_invoice_series where id='ee550000-0000-4000-8000-000000000005') then raise exception 'Credit fixture collision';end if;
 insert into auth.users(id,email,email_confirmed_at)values(a,'credit-admin-ee550000@example.invalid',now()),(u,'credit-owner-ee550000@example.invalid',now());
 insert into private.account_approvals(user_id,status,updated_by)values(a,'approved',a),(u,'approved',u) on conflict(user_id) do nothing;
 insert into private.platform_admins(user_id,created_by)values(a,a);
 insert into public.companies(id,name,organisation_number,created_by)values(c,'Credit Rollback Fixture','9944000001',u);
 insert into public.memberships(company_id,user_id,role)values(c,u,'owner');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ee550000-0000-4000-8000-000000000001',true);
do $$declare c uuid:='ee550000-0000-4000-8000-000000000003';o uuid:='ee550000-0000-4000-8000-000000000004';s uuid:='ee550000-0000-4000-8000-000000000005';req uuid:='ee550000-0000-4000-8000-000000000006';yr integer:=extract(year from clock_timestamp() at time zone 'Europe/Stockholm')::integer;begin
 begin perform public.get_platform_advertising_credit_page(c,o);raise exception 'Missing original accepted';exception when sqlstate '42501' then null;end;
 begin perform public.get_platform_advertising_credit_invoice(c,o);raise exception 'Missing credit accepted';exception when sqlstate '42501' then null;end;
 begin perform public.configure_advertising_credit_series(c,o,repeat('a',64),yr,'ROLLBACK','1','Fixture Municipality','Negative rollback proof',true,req);raise exception 'Series configured without original';exception when sqlstate '42501' then null;end;
 begin perform public.issue_advertising_credit_invoice(c,o,repeat('a',64),s,repeat('b',64),repeat('c',64),'字',true,req);raise exception 'Unsupported reason accepted';exception when sqlstate '22023' then null;end;
 begin perform public.issue_advertising_credit_invoice(c,o,repeat('a',64),s,repeat('b',64),repeat('c',64),'Negative rollback proof',true,req);raise exception 'Credit issued without series';exception when sqlstate '40001' then null;end;
 begin perform 1 from private.advertising_document_numbers;raise exception 'Global numbers leaked';exception when sqlstate '42501' then null;end;
 begin perform 1 from private.advertising_credit_invoices;raise exception 'Direct credit table leaked';exception when sqlstate '42501' then null;end;
end $$;
select set_config('request.jwt.claim.sub','ee550000-0000-4000-8000-000000000002',true);
do $$declare c uuid:='ee550000-0000-4000-8000-000000000003';o uuid:='ee550000-0000-4000-8000-000000000004';s uuid:='ee550000-0000-4000-8000-000000000005';req uuid:='ee550000-0000-4000-8000-000000000006';begin
 begin perform public.issue_advertising_credit_invoice(c,o,repeat('a',64),s,repeat('b',64),repeat('c',64),'Owner denied',true,req);raise exception 'Owner wrote credit';exception when sqlstate '42501' then null;end;
 begin perform public.configure_advertising_credit_series(c,o,repeat('a',64),2026,'ROLLBACK','1','Fixture Municipality','Owner denied',true,req);raise exception 'Owner configured series';exception when sqlstate '42501' then null;end;
 begin perform public.get_advertising_credit_invoice(c,o);raise exception 'Missing credit leaked';exception when sqlstate '42501' then null;end;
end $$;
reset role;
do $$begin
 if exists(select 1 from private.advertising_invoice_series where company_id='ee550000-0000-4000-8000-000000000003') or exists(select 1 from private.advertising_credit_invoices where company_id='ee550000-0000-4000-8000-000000000003') then raise exception 'Unexpected credit or series';end if;
end $$;
select 'PASS: missing originals and series denied, unsupported reason rejected, private number registry and credit tables, owner write denied; no documents or numbers created' result;
rollback;
