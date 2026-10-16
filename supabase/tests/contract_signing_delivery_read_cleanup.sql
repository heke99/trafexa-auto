select
 (select count(*) from auth.users where id in('af200000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000002')) users,
 (select count(*) from public.companies where id='af200000-0000-4000-8000-000000000003' or created_by in('af200000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000002')) companies,
 (select count(*) from public.customers where company_id='af200000-0000-4000-8000-000000000003') customers,
 (select count(*) from public.deals where company_id='af200000-0000-4000-8000-000000000003') deals,
 (select count(*) from public.offers where company_id='af200000-0000-4000-8000-000000000003') offers,
 (select count(*) from private.account_approvals where user_id in('af200000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000002')) approvals,
 (select count(*) from private.offer_reviews where company_id='af200000-0000-4000-8000-000000000003') reviews,
 (select count(*) from private.sale_contract_template_versions where company_id='af200000-0000-4000-8000-000000000003') templates,
 (select count(*) from private.sale_contract_drafts where company_id='af200000-0000-4000-8000-000000000003') drafts,
 (select count(*) from private.contract_signings where company_id='af200000-0000-4000-8000-000000000003') signings,
 (select count(*) from private.contract_signatures where actor_user_id in('af200000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000002')) signatures,
 (select count(*) from private.contract_signing_audit where actor_user_id in('af200000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000002')) signing_audit,
 (select count(*) from private.transactional_email_outbox where recipient in('invitation-owner-af200000@example.invalid','invitation-customer-af200000@example.invalid')) email_outbox;
