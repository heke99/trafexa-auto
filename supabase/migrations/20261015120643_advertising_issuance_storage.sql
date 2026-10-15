begin;
create table private.advertising_invoice_series (
 id uuid primary key,seller_organisation_number text not null check(seller_organisation_number ~ '^[0-9]{10}$'),year integer not null check(year between 2000 and 2100),prefix text not null check(prefix ~ '^[A-Z0-9]{2,12}$'),first_number integer not null check(first_number between 1 and 999999999),
 seller_registered_seat text not null check(length(seller_registered_seat) between 1 and 160),reason text not null check(length(reason) between 1 and 500),
 configuration jsonb not null,canonical_configuration text not null,configuration_hash text not null,
 configured_at timestamptz not null default clock_timestamp(),configured_by uuid not null references auth.users(id),company_id uuid not null references public.companies(id),request_id uuid not null,payload jsonb not null,
 check(configuration=jsonb_build_object('id',id,'sellerOrganisationNumber',seller_organisation_number,'year',year,'prefix',prefix,'firstNumber',first_number::text,'sellerRegisteredSeat',seller_registered_seat)),
 check(canonical_configuration::jsonb=configuration and encode(sha256(convert_to(canonical_configuration,'UTF8')),'hex')=configuration_hash),
 unique(seller_organisation_number,year),unique(prefix,year),unique(configured_by,request_id)
);
create table private.advertising_invoice_counters (
 series_id uuid primary key references private.advertising_invoice_series(id),next_number integer not null check(next_number between 1 and 1000000000)
);
create table private.advertising_issued_invoices (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),month text not null,assessment_id uuid not null references private.advertising_financial_assessments(id),series_id uuid not null references private.advertising_invoice_series(id),sequence integer not null check(sequence between 1 and 999999999),
 invoice_number text not null unique,invoice_date date not null,due_date date not null check(due_date>=invoice_date),
 snapshot jsonb not null,canonical_snapshot text not null,source_hash text not null,review_token text not null check(review_token ~ '^[0-9a-f]{64}$'),created_at timestamptz not null,created_by uuid not null references auth.users(id),
 check(canonical_snapshot::jsonb=snapshot and encode(sha256(convert_to(canonical_snapshot,'UTF8')),'hex')=source_hash),unique(company_id,month),unique(series_id,sequence)
);
create table private.advertising_invoice_issue_requests (
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,company_id uuid not null references public.companies(id),invoice_id uuid not null references private.advertising_issued_invoices(id),payload jsonb not null,primary key(actor_user_id,request_id)
);
create index advertising_invoice_issue_request_invoice on private.advertising_invoice_issue_requests(invoice_id);
create index advertising_issued_invoice_assessment on private.advertising_issued_invoices(assessment_id);
alter table private.advertising_invoice_series enable row level security;
alter table private.advertising_invoice_counters enable row level security;
alter table private.advertising_issued_invoices enable row level security;
alter table private.advertising_invoice_issue_requests enable row level security;
revoke all on private.advertising_invoice_series,private.advertising_invoice_counters,private.advertising_issued_invoices,private.advertising_invoice_issue_requests from public,anon,authenticated,service_role;
create trigger immutable_advertising_invoice_series before update or delete on private.advertising_invoice_series for each row execute function private.advertising_immutable();
create trigger immutable_advertising_issued_invoice before update or delete on private.advertising_issued_invoices for each row execute function private.advertising_immutable();
create trigger immutable_advertising_invoice_issue_request before update or delete on private.advertising_invoice_issue_requests for each row execute function private.advertising_immutable();
commit;
