begin;
create sequence private.advertising_payment_sequence as bigint;
create table private.advertising_payment_entries (
 id uuid primary key,sequence bigint not null unique default nextval('private.advertising_payment_sequence'),
 company_id uuid not null references public.companies(id),invoice_id uuid not null references private.advertising_issued_invoices(id),
 invoice_number text not null,invoice_source_hash text not null check(invoice_source_hash ~ '^[0-9a-f]{64}$'),seller_organisation_number text not null check(seller_organisation_number ~ '^[0-9]{10}$'),
 kind text not null check(kind in ('receipt','reversal')),amount_ore bigint not null check(amount_ore>0),
 payment_identifier text not null check(payment_identifier ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),bank_reference text not null check(length(bank_reference) between 1 and 200),
 booked_date date not null,reason text not null check(length(reason) between 1 and 500),created_at timestamptz not null,created_by uuid not null references auth.users(id),
 reverses_entry_id uuid unique references private.advertising_payment_entries(id),replaces_entry_id uuid unique references private.advertising_payment_entries(id),
 canonical_snapshot text not null,source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
 check(case when kind='receipt' then reverses_entry_id is null else reverses_entry_id is not null and replaces_entry_id is null end),
 check(id is distinct from reverses_entry_id and id is distinct from replaces_entry_id),
 check(canonical_snapshot::jsonb=jsonb_build_object('id',id,'sequence',sequence::text,'companyId',company_id,'invoiceId',invoice_id,'invoiceNumber',invoice_number,'invoiceSourceHash',invoice_source_hash,'sellerOrganisationNumber',seller_organisation_number,'kind',kind,'amountOre',amount_ore::text,'paymentIdentifier',payment_identifier,'bankReference',bank_reference,'bookedDate',booked_date,'reason',reason,'createdAt',created_at,'createdBy',created_by,'reversesEntryId',reverses_entry_id,'replacesEntryId',replaces_entry_id)),
 check(encode(sha256(convert_to(canonical_snapshot,'UTF8')),'hex')=source_hash)
);
create unique index advertising_payment_identifier_root on private.advertising_payment_entries(seller_organisation_number,payment_identifier) where kind='receipt' and replaces_entry_id is null;
create index advertising_payment_invoice_sequence on private.advertising_payment_entries(company_id,invoice_id,sequence desc);
create index advertising_payment_identifier_chain on private.advertising_payment_entries(seller_organisation_number,payment_identifier,sequence desc) where kind='receipt';
create table private.advertising_payment_requests (
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,company_id uuid not null references public.companies(id),invoice_id uuid not null references private.advertising_issued_invoices(id),entry_id uuid not null references private.advertising_payment_entries(id),payload jsonb not null,
 primary key(actor_user_id,request_id)
);
alter table private.advertising_payment_entries enable row level security;
alter table private.advertising_payment_requests enable row level security;
revoke all on private.advertising_payment_entries,private.advertising_payment_requests from public,anon,authenticated,service_role;
revoke all on sequence private.advertising_payment_sequence from public,anon,authenticated,service_role;
create trigger immutable_advertising_payment_entry before update or delete on private.advertising_payment_entries for each row execute function private.advertising_immutable();
create trigger immutable_advertising_payment_request before update or delete on private.advertising_payment_requests for each row execute function private.advertising_immutable();
commit;
