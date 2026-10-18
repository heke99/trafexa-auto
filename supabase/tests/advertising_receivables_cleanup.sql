select
 (select count(*) from auth.users where id='77000000-0000-4000-8000-000000009901'::uuid) as auth_users,
 (select count(*) from private.platform_admins where user_id='77000000-0000-4000-8000-000000009901'::uuid) as platform_admins,
 (select count(*) from public.companies where id='77000000-0000-4000-8000-000000009902'::uuid) as companies,
 (select count(*) from private.advertising_payment_entries where company_id='77000000-0000-4000-8000-000000009902'::uuid) as payment_entries;
