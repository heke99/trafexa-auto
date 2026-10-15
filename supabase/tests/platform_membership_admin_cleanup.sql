-- Read-only namespace counters after rollback. Expected all zero.
select jsonb_build_object(
 'users',(select count(*)from auth.users where id::text like 'fd200000-0000-4000-8000-%'),
 'companies',(select count(*)from public.companies where id::text like 'fd200000-0000-4000-8000-%'or created_by::text like 'fd200000-0000-4000-8000-%'),
 'memberships',(select count(*)from public.memberships where company_id::text like 'fd200000-0000-4000-8000-%'or user_id::text like 'fd200000-0000-4000-8000-%'),
 'platform_registry',(select count(*)from private.platform_admins where user_id::text like 'fd200000-0000-4000-8000-%'),
 'account_approvals',(select count(*)from private.account_approvals where user_id::text like 'fd200000-0000-4000-8000-%'),
 'membership_audit',(select count(*)from private.platform_membership_audit where company_id::text like 'fd200000-0000-4000-8000-%'or actor_user_id::text like 'fd200000-0000-4000-8000-%'),
 'inventory',(select count(*)from public.stock_items where company_id::text like 'fd200000-0000-4000-8000-%'),
 'outbox',(select count(*)from private.transactional_email_outbox where recipient_user_id::text like 'fd200000-0000-4000-8000-%'or recipient like 'platform-member-%@fixture.invalid'));
