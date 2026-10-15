-- Read-only counts after rollback; all must be zero. No row is deleted.
select jsonb_build_object(
 'users',(select count(*)from auth.users where id::text like 'fd190000-0000-4000-8000-%'),
 'companies',(select count(*)from public.companies where id::text like 'fd190000-0000-4000-8000-%'or created_by::text like 'fd190000-0000-4000-8000-%'),
 'memberships',(select count(*)from public.memberships where company_id::text like 'fd190000-0000-4000-8000-%'or user_id::text like 'fd190000-0000-4000-8000-%'),
 'groups',(select count(*)from private.blocket_groups where id::text like 'fd190000-0000-4000-8000-%'),
 'bindings',(select count(*)from private.blocket_company_bindings where company_id::text like 'fd190000-0000-4000-8000-%'),
 'provision_audit',(select count(*)from private.blocket_provision_audit where actor_user_id::text like 'fd190000-0000-4000-8000-%'),
 'delivery_identities',(select count(*)from private.blocket_delivery_identities where company_id::text like 'fd190000-0000-4000-8000-%'),
 'delivery_revisions',(select count(*)from private.blocket_delivery_revisions where job_id::text like 'fd190000-0000-4000-8000-%'),
 'delivery_events',(select count(*)from private.blocket_delivery_events e join private.blocket_delivery_revisions r on r.id=e.delivery_id where r.job_id::text like 'fd190000-0000-4000-8000-%'),
 'jobs',(select count(*)from private.advertising_jobs where company_id::text like 'fd190000-0000-4000-8000-%'),
 'dispatchers',(select count(*)from private.advertising_dispatchers where id like 'blocket_fd190000%'),
 'outbox',(select count(*)from private.transactional_email_outbox where recipient_user_id::text like 'fd190000-0000-4000-8000-%'or recipient like 'blocket-%@fixture.invalid'));
