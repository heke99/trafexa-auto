select
 (select count(*) from auth.users where id in('ee380000-0000-4000-8000-000000000001','ee380000-0000-4000-8000-000000000002')) users,
 (select count(*) from private.account_approvals where user_id in('ee380000-0000-4000-8000-000000000001','ee380000-0000-4000-8000-000000000002')) approvals,
 (select count(*) from private.platform_admins where user_id='ee380000-0000-4000-8000-000000000001') admins,
 (select count(*) from public.companies where id='ee380000-0000-4000-8000-000000000003') companies,
 (select count(*) from public.memberships where company_id='ee380000-0000-4000-8000-000000000003') memberships,
 (select count(*) from private.advertising_billing_periods where company_id='ee380000-0000-4000-8000-000000000003') periods,
 (select count(*) from private.advertising_billing_reductions where company_id='ee380000-0000-4000-8000-000000000003') reductions;
