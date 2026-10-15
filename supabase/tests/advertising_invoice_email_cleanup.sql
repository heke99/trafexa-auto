select
 (select count(*) from auth.users where id in('ee660000-0000-4000-8000-000000000001','ee660000-0000-4000-8000-000000000002')) users,
 (select count(*) from public.companies where id='ee660000-0000-4000-8000-000000000003') companies,
 (select count(*) from private.platform_admins where user_id='ee660000-0000-4000-8000-000000000001') admins,
 (select count(*) from private.account_approvals where user_id in('ee660000-0000-4000-8000-000000000001','ee660000-0000-4000-8000-000000000002')) approvals,
 (select count(*) from private.advertising_invoice_emails where company_id='ee660000-0000-4000-8000-000000000003') emails,
 (select count(*) from private.advertising_invoice_email_requests where company_id='ee660000-0000-4000-8000-000000000003') requests,
 (select count(*) from private.advertising_invoice_email_events where event_id='fixture-event-ee660000') events,
 (select count(*) from private.advertising_issued_invoices where company_id='ee660000-0000-4000-8000-000000000003') invoices,
 (select count(*) from private.advertising_credit_invoices where company_id='ee660000-0000-4000-8000-000000000003') credits;
