begin;
create table private.advertising_billing_reductions (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 period_id uuid not null references private.advertising_billing_periods(id),
 publication_id uuid not null references private.advertising_publications(id),
 amount_ore bigint not null check(amount_ore between 1 and 9223372036854775807),
 reason text not null check(length(reason) between 1 and 500 and reason=btrim(reason) and reason !~ '[[:cntrl:]]'),
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null references auth.users(id),
 request_id uuid not null,payload jsonb not null,unique(created_by,request_id)
);
create index advertising_billing_reductions_period on private.advertising_billing_reductions(period_id,created_at,id);
create index advertising_billing_reductions_publication on private.advertising_billing_reductions(publication_id);
alter table private.advertising_billing_reductions enable row level security;
revoke all on private.advertising_billing_reductions from public,anon,authenticated,service_role;
create trigger immutable_advertising_reduction before update or delete on private.advertising_billing_reductions for each row execute function private.advertising_immutable();
commit;
