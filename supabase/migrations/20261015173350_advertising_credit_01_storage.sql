begin;
-- One number namespace for all legal advertising documents, including existing invoices.
create table private.advertising_document_numbers (
 document_id uuid primary key,document_type text not null check(document_type in ('invoice','credit')),
 series_id uuid not null references private.advertising_invoice_series(id),sequence integer not null check(sequence between 1 and 999999999),
 document_number text not null unique,unique(series_id,sequence)
);
insert into private.advertising_document_numbers select id,'invoice',series_id,sequence,invoice_number from private.advertising_issued_invoices;
create table private.advertising_credit_invoices (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 original_invoice_id uuid not null unique references private.advertising_issued_invoices(id),series_id uuid not null references private.advertising_invoice_series(id),sequence integer not null check(sequence between 1 and 999999999),
 credit_number text not null unique,credit_date date not null,snapshot jsonb not null,canonical_snapshot text not null,source_hash text not null,review_token text not null check(review_token ~ '^[0-9a-f]{64}$'),created_at timestamptz not null,created_by uuid not null references auth.users(id),
 check(canonical_snapshot::jsonb=snapshot and encode(sha256(convert_to(canonical_snapshot,'UTF8')),'hex')=source_hash),unique(series_id,sequence)
);
create table private.advertising_credit_requests (
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,company_id uuid not null references public.companies(id),credit_id uuid not null references private.advertising_credit_invoices(id),payload jsonb not null,primary key(actor_user_id,request_id)
);
create index advertising_credit_request_credit on private.advertising_credit_requests(credit_id);
alter table private.advertising_document_numbers enable row level security;
alter table private.advertising_credit_invoices enable row level security;
alter table private.advertising_credit_requests enable row level security;
revoke all on private.advertising_document_numbers,private.advertising_credit_invoices,private.advertising_credit_requests from public,anon,authenticated,service_role;
create trigger immutable_advertising_document_number before update or delete on private.advertising_document_numbers for each row execute function private.advertising_immutable();
create trigger immutable_advertising_credit before update or delete on private.advertising_credit_invoices for each row execute function private.advertising_immutable();
create trigger immutable_advertising_credit_request before update or delete on private.advertising_credit_requests for each row execute function private.advertising_immutable();
create function private.advertising_register_document_number() returns trigger language plpgsql security definer set search_path='' as $$
declare number text;kind text;begin
 if tg_table_name='advertising_issued_invoices' then number:=new.invoice_number;kind:='invoice';else number:=new.credit_number;kind:='credit';end if;
 insert into private.advertising_document_numbers(document_id,document_type,series_id,sequence,document_number) values(new.id,kind,new.series_id,new.sequence,number);
 return new;
end $$;
revoke all on function private.advertising_register_document_number() from public,anon,authenticated,service_role;
create trigger register_advertising_invoice_number before insert on private.advertising_issued_invoices for each row execute function private.advertising_register_document_number();
create trigger register_advertising_credit_number before insert on private.advertising_credit_invoices for each row execute function private.advertising_register_document_number();
commit;
