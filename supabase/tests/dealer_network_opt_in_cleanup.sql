-- Read-only cleanup proof after the rollback; all eleven counters must be zero.
select jsonb_build_object(
 'users',(select count(*)from auth.users where id::text like 'fd250000-0000-4000-8000-%'),
 'companies',(select count(*)from public.companies where id::text like 'fd250000-0000-4000-8000-%'),
 'memberships',(select count(*)from public.memberships where company_id::text like 'fd250000-0000-4000-8000-%'),
 'vehicles',(select count(*)from public.vehicles where company_id::text like 'fd250000-0000-4000-8000-%'),
 'stock',(select count(*)from public.stock_items where company_id::text like 'fd250000-0000-4000-8000-%'),
 'listings',(select count(*)from private.dealer_network_listings where company_id::text like 'fd250000-0000-4000-8000-%'),
 'inquiries',(select count(*)from private.dealer_network_inquiries where buyer_company_id::text like 'fd250000-0000-4000-8000-%'or seller_company_id::text like 'fd250000-0000-4000-8000-%'),
 'messages',(select count(*)from private.dealer_network_messages where company_id::text like 'fd250000-0000-4000-8000-%'),
 'requests',(select count(*)from private.dealer_network_requests where company_id::text like 'fd250000-0000-4000-8000-%'),
 'audit',(select count(*)from public.audit_events where company_id::text like 'fd250000-0000-4000-8000-%'),
 'outbox',(select count(*)from private.transactional_email_outbox where recipient_user_id::text like 'fd250000-0000-4000-8000-%'or recipient like 'network-proof-%@fixture.invalid'));
