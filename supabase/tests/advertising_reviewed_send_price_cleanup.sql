select (select count(*) from auth.users where id in('af190000-0000-4000-8000-000000000001','af190000-0000-4000-8000-000000000002','af190000-0000-4000-8000-000000000008','af190000-0000-4000-8000-000000000009')) users,
 (select count(*) from public.companies where id='af190000-0000-4000-8000-000000000003' or created_by in('af190000-0000-4000-8000-000000000001','af190000-0000-4000-8000-000000000002','af190000-0000-4000-8000-000000000008','af190000-0000-4000-8000-000000000009')) companies,
 (select count(*) from private.advertising_jobs where company_id='af190000-0000-4000-8000-000000000003') jobs,
 (select count(*) from private.advertising_charge_commitments where company_id='af190000-0000-4000-8000-000000000003') commitments,
 (select count(*) from private.advertising_job_price_commitments where company_id='af190000-0000-4000-8000-000000000003') bindings,
 (select count(*) from private.advertising_publications where company_id='af190000-0000-4000-8000-000000000003') publications,
 (select count(*) from private.advertising_channel_rates where company_id='af190000-0000-4000-8000-000000000003') rates,
 (select count(*) from private.advertising_audit where company_id='af190000-0000-4000-8000-000000000003') audits,
 (select count(*) from private.advertising_dispatchers where id in('priced_bl','priced_wa')) dispatchers;
