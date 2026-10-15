-- Read-only counters after rollback. Every value must be zero; never delete real rows.
select jsonb_build_object(
 'users',(select count(*)from auth.users where id::text like 'fd260000-0000-4000-8000-%'or email like 'account-search-fd260000-%@fixture.invalid'),
 'platform_registry',(select count(*)from private.platform_admins where user_id::text like 'fd260000-0000-4000-8000-%'or created_by::text like 'fd260000-0000-4000-8000-%'),
 'account_approvals',(select count(*)from private.account_approvals where user_id::text like 'fd260000-0000-4000-8000-%'or updated_by::text like 'fd260000-0000-4000-8000-%'),
 'account_audit',(select count(*)from private.account_approval_audit where actor_user_id::text like 'fd260000-0000-4000-8000-%'or user_id::text like 'fd260000-0000-4000-8000-%'),
 'platform_audit',(select count(*)from private.platform_company_status_audit where actor_user_id::text like 'fd260000-0000-4000-8000-%'),
 'membership_audit',(select count(*)from private.platform_membership_audit where actor_user_id::text like 'fd260000-0000-4000-8000-%'),
 'companies',(select count(*)from public.companies where created_by::text like 'fd260000-0000-4000-8000-%'),
 'memberships',(select count(*)from public.memberships where user_id::text like 'fd260000-0000-4000-8000-%'),
 'outbox',(select count(*)from private.transactional_email_outbox where recipient_user_id::text like 'fd260000-0000-4000-8000-%'or recipient like 'account-search-fd260000-%@fixture.invalid'))as cleanup;
