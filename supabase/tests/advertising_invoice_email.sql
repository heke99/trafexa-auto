-- Negative-only rollback proof. No real invoice, credit, series, legal number or email is created.
begin;
do $$declare a uuid:='ee660000-0000-4000-8000-000000000001';u uuid:='ee660000-0000-4000-8000-000000000002';c uuid:='ee660000-0000-4000-8000-000000000003';begin
 if exists(select 1 from auth.users where id in(a,u)) or exists(select 1 from public.companies where id=c) then raise exception 'Invoice email fixture collision';end if;
 insert into auth.users(id,email,email_confirmed_at)values(a,'invoice-email-admin-ee660000@example.invalid',now()),(u,'invoice-email-owner-ee660000@example.invalid',now());
 insert into private.account_approvals(user_id,status,updated_by)values(a,'approved',a),(u,'approved',u) on conflict(user_id) do nothing;
 insert into private.platform_admins(user_id,created_by)values(a,a);
 insert into public.companies(id,name,organisation_number,created_by)values(c,'Invoice Email Rollback Fixture','9945000001',u);
 insert into public.memberships(company_id,user_id,role)values(c,u,'owner');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ee660000-0000-4000-8000-000000000001',true);
do $$declare c uuid:='ee660000-0000-4000-8000-000000000003';d uuid:='ee660000-0000-4000-8000-000000000004';req uuid:='ee660000-0000-4000-8000-000000000005';begin
 begin perform public.get_platform_advertising_invoice_email_page(c,'invoice',d);raise exception 'Missing invoice accepted';exception when sqlstate '42501' then null;end;
 begin perform public.get_platform_advertising_invoice_email_page(c,'credit',d);raise exception 'Missing credit accepted';exception when sqlstate '42501' then null;end;
 begin perform public.queue_advertising_invoice_email(c,'invoice',d,repeat('a',64),repeat('b',64),true,req);raise exception 'Missing document queued';exception when sqlstate '42501' then null;end;
 begin perform public.queue_advertising_invoice_email(c,'invoice',d,repeat('a',64),repeat('b',64),false,req);raise exception 'Unreviewed email queued';exception when sqlstate '22023' then null;end;
 begin perform public.claim_advertising_invoice_email(c,d);raise exception 'Missing email claimed';exception when sqlstate '42501' then null;end;
 begin perform public.finish_advertising_invoice_email(c,d,req,'ee660000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64),'accepted','fixture-provider-ee660000');raise exception 'Browser marked provider acceptance';exception when sqlstate '42501' then null;end;
 begin perform public.apply_advertising_invoice_email_event('fixture-event-ee660000','fixture-provider-ee660000','delivered',clock_timestamp(),repeat('c',64));raise exception 'Browser marked delivered';exception when sqlstate '42501' then null;end;
 begin perform 1 from private.advertising_invoice_emails;raise exception 'Private email table exposed';exception when sqlstate '42501' then null;end;
end $$;
select set_config('request.jwt.claim.sub','ee660000-0000-4000-8000-000000000002',true);
do $$declare c uuid:='ee660000-0000-4000-8000-000000000003';d uuid:='ee660000-0000-4000-8000-000000000004';req uuid:='ee660000-0000-4000-8000-000000000005';begin
 begin perform public.queue_advertising_invoice_email(c,'invoice',d,repeat('a',64),repeat('b',64),true,req);raise exception 'Owner queued email';exception when sqlstate '42501' then null;end;
 begin perform public.claim_advertising_invoice_email(c,d);raise exception 'Owner claimed email';exception when sqlstate '42501' then null;end;
end $$;
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$begin
 begin perform public.apply_advertising_invoice_email_event('fixture-event-ee660000','fixture-provider-ee660000','delivered',clock_timestamp()+interval '1 day',repeat('c',64));raise exception 'Future delivery accepted';exception when sqlstate '22023' then null;end;
end $$;
reset role;
select 'PASS: no original documents, unreviewed queues, browser provider facts, direct tables, owner dispatch and future delivery facts all denied; no emails or legal documents created' result;
rollback;
