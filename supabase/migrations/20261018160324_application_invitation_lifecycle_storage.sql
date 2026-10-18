begin;
alter table private.application_invitation_deliveries add column delivery_id uuid;
update private.application_invitation_deliveries set delivery_id=invitation_id;
alter table private.application_invitation_deliveries alter column delivery_id set not null;
create unique index application_invitation_delivery_generation on private.application_invitation_deliveries(delivery_id);
-- Old rows retain the original invitation identifier for crypto AAD and provider
-- idempotency. Each explicitly reviewed renewal receives a new generation.
create function private.initial_application_invitation_delivery_id() returns trigger
 language plpgsql set search_path='' as $$begin new.delivery_id:=coalesce(new.delivery_id,new.invitation_id);return new;end$$;
revoke all on function private.initial_application_invitation_delivery_id() from public,anon,authenticated,service_role;
create trigger application_invitation_delivery_initial_id before insert on private.application_invitation_deliveries
 for each row execute function private.initial_application_invitation_delivery_id();
create table private.application_invitation_delivery_history(
 delivery_id uuid primary key,
 invitation_id uuid not null references private.application_account_invitations(id) on delete cascade,
 actor_user_id uuid not null references auth.users(id),
 state text not null check(state in ('pending','generating','sending','sent','rejected','unknown')),
 lease_id uuid,lease_until timestamptz,
 first_attempt_at timestamptz,attempt_count integer not null check(attempt_count between 0 and 5),
 provider_id text check(provider_id is null or (length(provider_id) between 1 and 256 and provider_id !~ '[[:cntrl:]]')),
 created_at timestamptz not null,updated_at timestamptz not null,archived_at timestamptz not null default clock_timestamp(),
 check((lease_id is null)=(lease_until is null)),check((first_attempt_at is null)=(attempt_count=0))
);
create index application_invitation_history_case on private.application_invitation_delivery_history(invitation_id);
create table private.application_invitation_renewals(
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,
 invitation_id uuid not null references private.application_account_invitations(id) on delete cascade,
 previous_delivery_id uuid not null references private.application_invitation_delivery_history(delivery_id) on delete cascade,
 delivery_id uuid not null unique,application_version integer not null check(application_version>0),
 reason text not null check(reason=btrim(reason) and length(reason) between 2 and 500 and reason !~ '[[:cntrl:]]'),
 request_payload jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(actor_user_id,request_id)
);
create index application_invitation_renewals_case on private.application_invitation_renewals(invitation_id);
alter table private.application_invitation_delivery_history enable row level security;
alter table private.application_invitation_renewals enable row level security;
revoke all on private.application_invitation_delivery_history,private.application_invitation_renewals from public,anon,authenticated,service_role;
commit;
