select
 (select count(*) from auth.users where id in('ee440000-0000-4000-8000-000000000001','ee440000-0000-4000-8000-000000000002')) users,
 (select count(*) from private.account_approvals where user_id in('ee440000-0000-4000-8000-000000000001','ee440000-0000-4000-8000-000000000002')) approvals,
 (select count(*) from private.platform_admins where user_id='ee440000-0000-4000-8000-000000000001') admins,
 (select count(*) from public.companies where id='ee440000-0000-4000-8000-000000000003') companies,
 (select count(*) from public.memberships where company_id='ee440000-0000-4000-8000-000000000003') memberships,
 (select count(*) from private.advertising_invoice_series where company_id='ee440000-0000-4000-8000-000000000003') series,
 (select count(*) from private.advertising_invoice_counters where series_id='ee440000-0000-4000-8000-000000000005') counters,
 (select count(*) from private.advertising_issued_invoices where company_id='ee440000-0000-4000-8000-000000000003') invoices,
 (select count(*) from private.advertising_invoice_issue_requests where company_id='ee440000-0000-4000-8000-000000000003') requests;
