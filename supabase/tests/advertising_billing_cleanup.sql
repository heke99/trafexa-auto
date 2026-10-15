select
 (select count(*) from auth.users where id in('ee360000-0000-4000-8000-000000000001','ee360000-0000-4000-8000-000000000002')) users,
 (select count(*) from private.platform_admins where user_id='ee360000-0000-4000-8000-000000000001') admins,
 (select count(*) from public.companies where id='ee360000-0000-4000-8000-000000000003') companies,
 (select count(*) from private.advertising_channel_rates where company_id='ee360000-0000-4000-8000-000000000003') rates,
 (select count(*) from private.advertising_publication_prices pp join private.advertising_publications p on p.id=pp.publication_id where p.company_id='ee360000-0000-4000-8000-000000000003') prices,
 (select count(*) from private.advertising_billing_reviews where company_id='ee360000-0000-4000-8000-000000000003') reviews,
 (select count(*) from private.advertising_billing_periods where company_id='ee360000-0000-4000-8000-000000000003') periods,
 (select count(*) from private.advertising_jobs where company_id='ee360000-0000-4000-8000-000000000003') jobs,
 (select count(*) from private.advertising_publications where company_id='ee360000-0000-4000-8000-000000000003') publications,
 (select count(*) from private.advertising_dispatchers where id like 'ee360000_%') dispatchers;
