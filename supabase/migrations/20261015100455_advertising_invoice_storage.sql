begin;
create table private.advertising_invoice_profiles (
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('buyer','seller')),
 company_id uuid references public.companies(id),scope_key text not null,version integer not null check(version>0),fields jsonb not null,
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null references auth.users(id),request_id uuid not null,payload jsonb not null,
 check((kind='seller' and company_id is null and scope_key='seller') or (kind='buyer' and company_id is not null and scope_key=company_id::text)),
 unique(scope_key,version),unique(created_by,request_id)
);
create table private.advertising_invoice_drafts (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),month text not null,
 version integer not null check(version>0),snapshot jsonb not null,canonical_snapshot text not null,source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null references auth.users(id),
 check(canonical_snapshot::jsonb=snapshot and encode(sha256(convert_to(canonical_snapshot,'UTF8')),'hex')=source_hash),
 unique(company_id,month,version),unique(company_id,month,source_hash)
);
create table private.advertising_invoice_requests (
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,company_id uuid not null references public.companies(id),
 draft_id uuid not null references private.advertising_invoice_drafts(id),payload jsonb not null,primary key(actor_user_id,request_id)
);
alter table private.advertising_invoice_profiles enable row level security;
alter table private.advertising_invoice_drafts enable row level security;
alter table private.advertising_invoice_requests enable row level security;
revoke all on private.advertising_invoice_profiles,private.advertising_invoice_drafts,private.advertising_invoice_requests from public,anon,authenticated,service_role;
create trigger immutable_advertising_invoice_profile before update or delete on private.advertising_invoice_profiles for each row execute function private.advertising_immutable();
create trigger immutable_advertising_invoice_draft before update or delete on private.advertising_invoice_drafts for each row execute function private.advertising_immutable();
create trigger immutable_advertising_invoice_request before update or delete on private.advertising_invoice_requests for each row execute function private.advertising_immutable();
commit;
