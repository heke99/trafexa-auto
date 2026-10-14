begin;
create table private.contract_signings(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,deal_id uuid not null,draft_id uuid not null unique,unique(company_id,deal_id),
 customer_email text not null,canonical_content text not null,document_hash text not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,deal_id) references public.deals(company_id,id),foreign key(draft_id) references private.sale_contract_drafts(id),
 check(customer_email=lower(btrim(customer_email)) and length(customer_email) between 3 and 254 and customer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 check(document_hash=encode(sha256(convert_to(canonical_content,'UTF8')),'hex'))
);
create index contract_signing_company_deal on private.contract_signings(company_id,deal_id,id);
create index contract_signing_customer on private.contract_signings(customer_email,id);
create table private.contract_signatures(
 signing_id uuid not null references private.contract_signings(id),party text not null check(party in('customer','company')),actor_user_id uuid not null references auth.users(id),full_name text not null,document_hash text not null,consent_version text not null check(consent_version='2026-10-14'),strokes jsonb not null,signed_at timestamptz not null default clock_timestamp(),
 primary key(signing_id,party),check(length(full_name) between 2 and 160 and full_name=btrim(full_name) and full_name !~ '[[:cntrl:]]'),check(jsonb_typeof(strokes)='array')
);
create table private.contract_signing_audit(actor_user_id uuid not null references auth.users(id),request_id uuid not null,payload jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(actor_user_id,request_id));
alter table private.contract_signings enable row level security;
alter table private.contract_signatures enable row level security;
alter table private.contract_signing_audit enable row level security;
revoke all on private.contract_signings,private.contract_signatures,private.contract_signing_audit from public,anon,authenticated,service_role;
create trigger contract_signing_immutable before update or delete on private.contract_signings for each row execute function private.sale_contract_immutable();
create trigger contract_signature_immutable before update or delete on private.contract_signatures for each row execute function private.sale_contract_immutable();
create trigger contract_signing_audit_immutable before update or delete on private.contract_signing_audit for each row execute function private.sale_contract_immutable();
commit;
