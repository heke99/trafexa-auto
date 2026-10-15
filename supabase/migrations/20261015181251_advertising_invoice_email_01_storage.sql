begin;
create table private.advertising_invoice_emails (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),document_kind text not null check(document_kind in ('invoice','credit')),document_id uuid not null references private.advertising_document_numbers(document_id),document_source_hash text not null,
 snapshot jsonb not null,canonical_snapshot text not null,source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),created_at timestamptz not null default clock_timestamp(),created_by uuid not null references auth.users(id),
 status text not null default 'pending' check(status in ('pending','processing','accepted','rejected','unknown','cancelled')),attempts integer not null default 0 check(attempts between 0 and 5),next_attempt_at timestamptz,first_attempt_at timestamptz,lease_id uuid,lease_until timestamptz,lease_actor uuid references auth.users(id),payload_hash text check(payload_hash ~ '^[0-9a-f]{64}$'),pdf_sha256 text check(pdf_sha256 ~ '^[0-9a-f]{64}$'),provider_id text unique,accepted_at timestamptz,delivered_at timestamptz,bounced_at timestamptz,complained_at timestamptz,
 unique(company_id,document_kind,document_id),check(canonical_snapshot::jsonb=snapshot and encode(sha256(convert_to(canonical_snapshot,'UTF8')),'hex')=source_hash)
);
create index advertising_invoice_email_suppressed_recipient on private.advertising_invoice_emails(lower(snapshot->>'recipient')) where bounced_at is not null or complained_at is not null;
create table private.advertising_invoice_email_requests(actor_user_id uuid not null references auth.users(id),request_id uuid not null,company_id uuid not null references public.companies(id),email_id uuid not null references private.advertising_invoice_emails(id),payload jsonb not null,primary key(actor_user_id,request_id));
create table private.advertising_invoice_email_events(event_id text primary key,email_id uuid references private.advertising_invoice_emails(id),provider_id text not null,event_type text not null check(event_type in ('delivered','bounced','complained')),event_at timestamptz not null,recipient_hash text not null check(recipient_hash ~ '^[0-9a-f]{64}$'),received_at timestamptz not null default clock_timestamp());
create index advertising_invoice_email_event_provider on private.advertising_invoice_email_events(provider_id);
alter table private.advertising_invoice_emails enable row level security;
alter table private.advertising_invoice_email_requests enable row level security;
alter table private.advertising_invoice_email_events enable row level security;
revoke all on private.advertising_invoice_emails,private.advertising_invoice_email_requests,private.advertising_invoice_email_events from public,anon,authenticated,service_role;
create function private.advertising_invoice_email_immutable() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' or new.id<>old.id or new.company_id<>old.company_id or new.document_kind<>old.document_kind or new.document_id<>old.document_id or new.document_source_hash<>old.document_source_hash or new.snapshot<>old.snapshot or new.canonical_snapshot<>old.canonical_snapshot or new.source_hash<>old.source_hash or new.created_at<>old.created_at or new.created_by<>old.created_by or (old.payload_hash is not null and new.payload_hash is distinct from old.payload_hash) or (old.pdf_sha256 is not null and new.pdf_sha256 is distinct from old.pdf_sha256) or (old.provider_id is not null and new.provider_id is distinct from old.provider_id) then raise exception 'Immutable invoice email' using errcode='55000';end if;return new;end $$;
revoke all on function private.advertising_invoice_email_immutable() from public,anon,authenticated,service_role;
create trigger immutable_advertising_invoice_email before update or delete on private.advertising_invoice_emails for each row execute function private.advertising_invoice_email_immutable();
create trigger immutable_advertising_invoice_email_request before update or delete on private.advertising_invoice_email_requests for each row execute function private.advertising_immutable();
commit;
