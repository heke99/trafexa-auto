-- Read-only evidence: the synthetic hosted-safe proof was rolled back completely.
select jsonb_build_object(
 'users',(select count(*)from auth.users where id::text like 'fd200000-0000-4000-8000-%'),
 'companies',(select count(*)from public.companies where id::text like 'fd200000-0000-4000-8000-%'),
 'memberships',(select count(*)from public.memberships where company_id::text like 'fd200000-0000-4000-8000-%'),
 'stores',(select count(*)from private.public_dealer_stores where company_id::text like 'fd200000-0000-4000-8000-%'),
 'versions',(select count(*)from private.public_dealer_store_versions where company_id::text like 'fd200000-0000-4000-8000-%'),
 'audit',(select count(*)from private.public_dealer_store_audit where actor_user_id::text like 'fd200000-0000-4000-8000-%'),
 'objects',(select count(*)from storage.objects where name like 'fd200000-0000-4000-8000-%'),
 'photos',(select count(*)from private.vehicle_photos where id::text like 'fd200000-0000-4000-8000-%'),
 'listings',(select count(*)from private.advertising_listings where id::text like 'fd200000-0000-4000-8000-%'));
