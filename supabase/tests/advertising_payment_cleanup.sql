select
 (select count(*) from private.advertising_payment_entries where company_id='75000000-0000-4000-8000-000000009901'::uuid or id='75000000-0000-4000-8000-000000009902'::uuid) as payment_entries,
 (select count(*) from private.advertising_payment_requests where company_id='75000000-0000-4000-8000-000000009901'::uuid) as payment_requests,
 (select count(*) from public.companies where id='75000000-0000-4000-8000-000000009901'::uuid) as companies,
 (select count(*) from private.advertising_issued_invoices where id='75000000-0000-4000-8000-000000009902'::uuid) as invoices;
