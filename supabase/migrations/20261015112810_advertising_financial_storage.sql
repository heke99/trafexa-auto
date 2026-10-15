begin;
create table private.advertising_financial_settings (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),version integer not null check(version>0),fields jsonb not null,
 canonical_snapshot text not null,review_token text not null check(review_token ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null references auth.users(id),request_id uuid not null,payload jsonb not null,
 check(canonical_snapshot::jsonb=jsonb_build_object('companyId',company_id,'version',version,'fields',fields) and encode(sha256(convert_to(canonical_snapshot,'UTF8')),'hex')=review_token),
 unique(company_id,version),unique(created_by,request_id)
);
create table private.advertising_financial_assessments (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),month text not null,version integer not null check(version>0),
 draft_id uuid not null references private.advertising_invoice_drafts(id),settings_id uuid not null references private.advertising_financial_settings(id),calculation_version integer not null default 1 check(calculation_version=1),
 snapshot jsonb not null,canonical_snapshot text not null,source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),source_token text not null check(source_token ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null references auth.users(id),
 check(canonical_snapshot::jsonb=snapshot and encode(sha256(convert_to(canonical_snapshot,'UTF8')),'hex')=source_hash),
 unique(company_id,month,version),unique(company_id,draft_id,settings_id,calculation_version)
);
create table private.advertising_financial_requests (
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,company_id uuid not null references public.companies(id),assessment_id uuid not null references private.advertising_financial_assessments(id),payload jsonb not null,primary key(actor_user_id,request_id)
);
create index advertising_financial_request_assessment on private.advertising_financial_requests(assessment_id);
alter table private.advertising_financial_settings enable row level security;
alter table private.advertising_financial_assessments enable row level security;
alter table private.advertising_financial_requests enable row level security;
revoke all on private.advertising_financial_settings,private.advertising_financial_assessments,private.advertising_financial_requests from public,anon,authenticated,service_role;
create trigger immutable_advertising_financial_settings before update or delete on private.advertising_financial_settings for each row execute function private.advertising_immutable();
create trigger immutable_advertising_financial_assessment before update or delete on private.advertising_financial_assessments for each row execute function private.advertising_immutable();
create trigger immutable_advertising_financial_request before update or delete on private.advertising_financial_requests for each row execute function private.advertising_immutable();
commit;
