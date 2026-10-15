-- All counts must be zero after the rollback-only hosted proof.
select jsonb_build_object(
 'authUsers',(select count(*) from auth.users where id='ea160000-0000-0000-0000-000000000901' or email in ('invitation-proof-admin@example.invalid','invitation-proof-recipient@example.invalid')),
 'platformAdmins',(select count(*) from private.platform_admins where user_id='ea160000-0000-0000-0000-000000000901'),
 'applications',(select count(*) from private.demo_requests where id='ea160000-0000-0000-0000-000000000910'),
 'intents',(select count(*) from private.application_account_invitations where application_id='ea160000-0000-0000-0000-000000000910'),
 'deliveries',(select count(*) from private.application_invitation_deliveries where actor_user_id='ea160000-0000-0000-0000-000000000901'),
 'approvalAudits',(select count(*) from private.account_approval_audit where actor_user_id='ea160000-0000-0000-0000-000000000901')
) result;
