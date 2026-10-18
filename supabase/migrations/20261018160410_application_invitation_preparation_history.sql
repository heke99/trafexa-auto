begin;
create table private.application_invitation_preparation_history(
 id uuid primary key default gen_random_uuid(),
 invitation_id uuid not null references private.application_account_invitations(id) on delete cascade,
 actor_user_id uuid not null references auth.users(id),
 previous_request_id uuid not null,request_id uuid not null,
 previous_approval jsonb not null,previous_delivery_id uuid,
 request_payload jsonb not null,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(actor_user_id,request_id),unique(actor_user_id,previous_request_id)
);
create index application_invitation_preparation_history_case on private.application_invitation_preparation_history(invitation_id);
alter table private.application_invitation_preparation_history enable row level security;
revoke all on private.application_invitation_preparation_history from public,anon,authenticated,service_role;
commit;
