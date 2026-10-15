select
 (select count(*) from auth.users where id in('ee550000-0000-4000-8000-000000000001','ee550000-0000-4000-8000-000000000002')) users,
 (select count(*) from private.account_approvals where user_id in('ee550000-0000-4000-8000-000000000001','ee550000-0000-4000-8000-000000000002')) approvals,
 (select count(*) from private.platform_admins where user_id='ee550000-0000-4000-8000-000000000001') admins,
 (select count(*) from public.companies where id='ee550000-0000-4000-8000-000000000003') companies,
 (select count(*) from public.memberships where company_id='ee550000-0000-4000-8000-000000000003') memberships,
 (select count(*) from private.advertising_invoice_series where company_id='ee550000-0000-4000-8000-000000000003') series,
 (select count(*) from private.advertising_invoice_counters where series_id='ee550000-0000-4000-8000-000000000005') counters,
 (select count(*) from private.advertising_issued_invoices where company_id='ee550000-0000-4000-8000-000000000003') invoices,
 (select count(*) from private.advertising_invoice_issue_requests where company_id='ee550000-0000-4000-8000-000000000003') issue_requests,
 (select count(*) from private.advertising_credit_invoices where company_id='ee550000-0000-4000-8000-000000000003') credits,
 (select count(*) from private.advertising_credit_requests where company_id='ee550000-0000-4000-8000-000000000003') credit_requests,
 (select count(*) from private.advertising_document_numbers where document_id in('ee550000-0000-4000-8000-000000000004','ee550000-0000-4000-8000-000000000005')) numbers;
