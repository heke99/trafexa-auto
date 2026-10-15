-- Read-only namespace counters after rollback, expected all zero.
select jsonb_build_object(
 'users',(select count(*)from auth.users where id::text like 'fd210000-0000-4000-8000-%'),
 'companies',(select count(*)from public.companies where id::text like 'fd210000-0000-4000-8000-%'or created_by::text like 'fd210000-0000-4000-8000-%'),
 'memberships',(select count(*)from public.memberships where company_id::text like 'fd210000-0000-4000-8000-%'),
 'stock',(select count(*)from public.stock_items where company_id::text like 'fd210000-0000-4000-8000-%'),
 'costs',(select count(*)from public.vehicle_costs where company_id::text like 'fd210000-0000-4000-8000-%'),
 'audit',(select count(*)from public.audit_events where company_id::text like 'fd210000-0000-4000-8000-%'),
 'outbox',(select count(*)from private.transactional_email_outbox where recipient_user_id::text like 'fd210000-0000-4000-8000-%'or recipient like 'internal-finance-%@fixture.invalid'));
