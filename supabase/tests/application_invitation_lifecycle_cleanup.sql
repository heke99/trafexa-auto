-- Read only after application_invitation_lifecycle.sql rolled back: all zero.
select jsonb_build_object(
 'authUsers',(select count(*) from auth.users where id='ee180000-0000-4000-8000-000000009901' or email in ('lifecycle-proof-admin@example.invalid','lifecycle-proof-recipient@example.invalid')),
 'platformAdmins',(select count(*) from private.platform_admins where user_id='ee180000-0000-4000-8000-000000009901'),
 'applications',(select count(*) from private.demo_requests where id='ee180000-0000-4000-8000-000000009910'),
 'invitations',(select count(*) from private.application_account_invitations where application_id='ee180000-0000-4000-8000-000000009910'),
 'deliveries',(select count(*) from private.application_invitation_deliveries where actor_user_id='ee180000-0000-4000-8000-000000009901'),
 'deliveryHistory',(select count(*) from private.application_invitation_delivery_history where actor_user_id='ee180000-0000-4000-8000-000000009901'),
 'preparationHistory',(select count(*) from private.application_invitation_preparation_history where actor_user_id='ee180000-0000-4000-8000-000000009901'),
 'renewals',(select count(*) from private.application_invitation_renewals where actor_user_id='ee180000-0000-4000-8000-000000009901'),
 'approvalAudits',(select count(*) from private.account_approval_audit where actor_user_id='ee180000-0000-4000-8000-000000009901')
) result;
