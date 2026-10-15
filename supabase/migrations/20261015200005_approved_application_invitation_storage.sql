begin;
-- Approval precedes Auth creation. Browser metadata never grants an invitation.
create table private.application_account_invitations(
 id uuid primary key default gen_random_uuid(),
 application_id uuid not null unique references private.demo_requests(id) on delete cascade,
 application_version integer not null check(application_version>0),
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,
 email text not null unique check(email=lower(btrim(email)) and length(email) between 3 and 254),
 name text not null check(length(name) between 2 and 160),
 reason text not null check(reason=btrim(reason) and length(reason) between 2 and 500 and reason !~ '[[:cntrl:]]'),
 request_payload jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '15 minutes',
 user_id uuid unique references auth.users(id),consumed_at timestamptz,
 unique(actor_user_id,request_id),
 check((user_id is null and consumed_at is null) or (user_id is not null and consumed_at is not null))
);
alter table private.application_account_invitations enable row level security;
revoke all on private.application_account_invitations from public,anon,authenticated,service_role;
create function private.application_account_invitation_json(p_row private.application_account_invitations) returns jsonb
 language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'applicationId',p_row.application_id,'applicationVersion',p_row.application_version,
 'actorUserId',p_row.actor_user_id,'requestId',p_row.request_id,'email',p_row.email,'name',p_row.name,'reason',p_row.reason,
 'status',case when p_row.user_id is not null then 'created' when p_row.expires_at<=clock_timestamp() then 'expired' else 'prepared' end,
 'userId',p_row.user_id,'createdAt',p_row.created_at,'expiresAt',p_row.expires_at,'consumedAt',p_row.consumed_at);
$$;
revoke all on function private.application_account_invitation_json(private.application_account_invitations) from public,anon,authenticated,service_role;
commit;
