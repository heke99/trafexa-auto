-- Read-only proof that rollback left no synthetic applicant, mail or tombstone.
select not exists(select 1 from private.demo_requests where request_id in ('ec181800-0000-4000-8000-000000000901','ec181800-0000-4000-8000-000000000902') or email='policy-hosted-fixture@example.invalid')
 and not exists(select 1 from private.transactional_email_outbox where reference_id in ('ec181800-0000-4000-8000-000000000901','ec181800-0000-4000-8000-000000000902'))
 and not exists(select 1 from private.web_application_erasure_tombstones where submission_request_id in ('ec181800-0000-4000-8000-000000000901','ec181800-0000-4000-8000-000000000902'))
 as privacy_revision_cleanup_pass;
