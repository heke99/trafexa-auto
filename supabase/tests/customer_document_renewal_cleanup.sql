-- Separate read after rollback-only negative proof: every count must be zero.
select
 (select count(*)from public.companies where id='cd180000-0000-4000-8000-000000009901')companies,
 (select count(*)from public.deals where id='cd180000-0000-4000-8000-000000009902')deals,
 (select count(*)from private.transactional_email_outbox where id='cd180000-0000-4000-8000-000000009904'or reference_id='cd180000-0000-4000-8000-000000009903')emails,
 (select count(*)from private.guest_document_invitations where id='cd180000-0000-4000-8000-000000009905'or reference_id='cd180000-0000-4000-8000-000000009903')invitations,
 (select count(*)from private.customer_document_renewals where request_id='cd180000-0000-4000-8000-000000009906'or company_id='cd180000-0000-4000-8000-000000009901')renewals;
