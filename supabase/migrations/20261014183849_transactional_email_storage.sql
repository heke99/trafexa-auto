begin;
create table private.transactional_email_outbox (
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('application_received','application_admin','account_approved','contract_invitation','contract_completed','contract_completed_company')),
 reference_id uuid not null,recipient text not null check(length(recipient)<=254 and recipient !~ '[[:space:][:cntrl:]]' and recipient ~ '^[^@]+@[^@]+\.[^@]+$'),recipient_user_id uuid,
 status text not null default 'pending' check(status in ('pending','processing','accepted','rejected','unknown','cancelled')),
 first_attempt_at timestamptz,attempts integer not null default 0 check(attempts between 0 and 5),lease_id uuid,lease_until timestamptz,provider_id text,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(kind,reference_id,recipient),check((status='processing')=(lease_id is not null and lease_until is not null))
);
alter table private.transactional_email_outbox enable row level security;
revoke all on private.transactional_email_outbox from public,anon,authenticated,service_role;
create index transactional_email_pending_idx on private.transactional_email_outbox(created_at,id) where status='pending';
create function private.enqueue_transactional_email(p_kind text,p_reference uuid,p_recipient text,p_user_id uuid default null) returns void
 language plpgsql security definer set search_path='' as $$
begin
 insert into private.transactional_email_outbox(kind,reference_id,recipient,recipient_user_id)
 values(p_kind,p_reference,lower(btrim(p_recipient)),p_user_id) on conflict(kind,reference_id,recipient) do nothing;
end $$;
revoke all on function private.enqueue_transactional_email(text,uuid,text,uuid) from public,anon,authenticated,service_role;
commit;
