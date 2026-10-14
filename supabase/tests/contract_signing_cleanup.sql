select
 (select count(*) from auth.users where id in('ee280000-0000-4000-8000-000000000001','ee280000-0000-4000-8000-000000000007')) as users,
 (select count(*) from public.companies where id='ee280000-0000-4000-8000-000000000002') as companies,
 (select count(*) from public.customers where company_id='ee280000-0000-4000-8000-000000000002') as customers,
 (select count(*) from public.deals where company_id='ee280000-0000-4000-8000-000000000002') as deals,
 (select count(*) from public.offers where company_id='ee280000-0000-4000-8000-000000000002') as offers,
 (select count(*) from private.account_approvals where user_id in('ee280000-0000-4000-8000-000000000001','ee280000-0000-4000-8000-000000000007')) as approvals,
 (select count(*) from private.offer_reviews where company_id='ee280000-0000-4000-8000-000000000002') as reviews,
 (select count(*) from private.sale_contract_template_versions where company_id='ee280000-0000-4000-8000-000000000002') as templates,
 (select count(*) from private.sale_contract_drafts where company_id='ee280000-0000-4000-8000-000000000002') as drafts,
 (select count(*) from private.contract_signings where company_id='ee280000-0000-4000-8000-000000000002') as signings,
 (select count(*) from private.contract_signatures where actor_user_id in('ee280000-0000-4000-8000-000000000001','ee280000-0000-4000-8000-000000000007')) as signatures,
 (select count(*) from private.contract_signing_audit where actor_user_id in('ee280000-0000-4000-8000-000000000001','ee280000-0000-4000-8000-000000000007')) as signing_audit,
 (select count(*) from private.transactional_email_outbox where recipient in('signing-owner-ee280000@example.invalid','signing-customer-ee280000@example.invalid')) as email_outbox;
