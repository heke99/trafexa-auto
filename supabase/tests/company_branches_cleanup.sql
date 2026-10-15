-- Read-only post-rollback counts. Expected all zero. Never deletes any row.
select jsonb_build_object(
 'users',(select count(*)from auth.users where id::text like 'fd180000-0000-4000-8000-%'),
 'companies',(select count(*)from public.companies where id::text like 'fd180000-0000-4000-8000-%'or created_by::text like 'fd180000-0000-4000-8000-%'),
 'memberships',(select count(*)from public.memberships where company_id::text like 'fd180000-0000-4000-8000-%'or user_id::text like 'fd180000-0000-4000-8000-%'),
 'approvals',(select count(*)from private.account_approvals where user_id::text like 'fd180000-0000-4000-8000-%'),
 'branches',(select count(*)from private.company_branches where company_id::text like 'fd180000-0000-4000-8000-%'),
 'branch_audit',(select count(*)from private.company_branch_audit where company_id::text like 'fd180000-0000-4000-8000-%'or actor_user_id::text like 'fd180000-0000-4000-8000-%'),
 'inventory',(select count(*)from public.stock_items where company_id::text like 'fd180000-0000-4000-8000-%'),
 'connections',(select count(*)from private.advertising_connections where company_id::text like 'fd180000-0000-4000-8000-%'),
 'outbox',(select count(*)from private.transactional_email_outbox where recipient_user_id::text like 'fd180000-0000-4000-8000-%'or recipient like 'branches-%@fixture.invalid'));
