select
 (select count(*) from auth.users where id in('ee400000-0000-4000-8000-000000000001','ee400000-0000-4000-8000-000000000002')) users,
 (select count(*) from private.account_approvals where user_id in('ee400000-0000-4000-8000-000000000001','ee400000-0000-4000-8000-000000000002')) approvals,
 (select count(*) from private.platform_admins where user_id='ee400000-0000-4000-8000-000000000001') admins,
 (select count(*) from public.companies where id='ee400000-0000-4000-8000-000000000003') companies,
 (select count(*) from public.memberships where company_id='ee400000-0000-4000-8000-000000000003') memberships,
 (select count(*) from private.advertising_invoice_profiles where company_id='ee400000-0000-4000-8000-000000000003') profiles,
 (select count(*) from private.advertising_invoice_drafts where company_id='ee400000-0000-4000-8000-000000000003') drafts,
 (select count(*) from private.advertising_invoice_requests where company_id='ee400000-0000-4000-8000-000000000003') requests;
