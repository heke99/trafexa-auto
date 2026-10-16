select jsonb_build_object(
 'users',(select count(*)from auth.users where id::text like 'fd310000-0000-4000-8000-%'or email like 'account-identity-fd310000-%@fixture.invalid'),
 'companies',(select count(*)from public.companies where id::text like 'fd310000-0000-4000-8000-%'),
 'memberships',(select count(*)from public.memberships where id::text like 'fd310000-0000-4000-8000-%'or user_id::text like 'fd310000-0000-4000-8000-%'),
 'admins',(select count(*)from private.platform_admins where user_id::text like 'fd310000-0000-4000-8000-%'),
 'approvals',(select count(*)from private.account_approvals where user_id::text like 'fd310000-0000-4000-8000-%'),
 'applications',(select count(*)from private.demo_requests where id::text like 'fd310000-0000-4000-8000-%'),
 'invitations',(select count(*)from private.application_account_invitations where id::text like 'fd310000-0000-4000-8000-%'or user_id::text like 'fd310000-0000-4000-8000-%'),
 'outbox',(select count(*)from private.transactional_email_outbox where recipient_user_id::text like 'fd310000-0000-4000-8000-%'or recipient like 'account-identity-fd310000-%@fixture.invalid')
)as cleanup;
