begin;
create table private.advertising_channel_rates (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 channel text not null check(channel in ('blocket','wayke')),version integer not null check(version>0),
 unit_price_ore bigint not null check(unit_price_ore between 0 and 9223372036854775807),
 effective_at timestamptz not null default clock_timestamp(),created_by uuid not null references auth.users(id),
 request_id uuid not null,payload jsonb not null,unique(company_id,channel,version),unique(created_by,request_id)
);
create table private.advertising_publication_prices (
 publication_id uuid primary key references private.advertising_publications(id),
 unit_price_ore bigint not null check(unit_price_ore between 0 and 9223372036854775807),
 source text not null check(source in ('rate','review')),rate_id uuid references private.advertising_channel_rates(id),
 created_by uuid references auth.users(id),reason text,created_at timestamptz not null default clock_timestamp(),
 check((source='rate' and rate_id is not null and created_by is null and reason is null) or
 (source='review' and rate_id is null and created_by is not null and length(reason) between 1 and 500 and reason=btrim(reason) and reason !~ '[[:cntrl:]]'))
);
create table private.advertising_billing_periods (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),month text not null,
 snapshot jsonb not null,canonical_snapshot text not null,review_token text not null check(review_token ~ '^[0-9a-f]{64}$'),
 partial_coverage_acknowledged boolean not null,locked_at timestamptz not null default clock_timestamp(),
 locked_by uuid not null references auth.users(id),request_id uuid not null,payload jsonb not null,
 unique(company_id,month),unique(locked_by,request_id),
 check(canonical_snapshot::jsonb=snapshot and encode(sha256(convert_to(canonical_snapshot,'UTF8')),'hex')=review_token)
);
create table private.advertising_billing_reviews (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),month text not null,
 channel text not null check(channel in ('blocket','wayke')),actor_user_id uuid not null references auth.users(id),
 request_id uuid not null,payload jsonb not null,publication_ids uuid[] not null,created_at timestamptz not null default clock_timestamp(),
 unique(actor_user_id,request_id)
);
alter table private.advertising_channel_rates enable row level security;
alter table private.advertising_publication_prices enable row level security;
alter table private.advertising_billing_periods enable row level security;
alter table private.advertising_billing_reviews enable row level security;
revoke all on private.advertising_channel_rates,private.advertising_publication_prices,private.advertising_billing_periods,private.advertising_billing_reviews from public,anon,authenticated,service_role;
create trigger immutable_advertising_rate before update or delete on private.advertising_channel_rates for each row execute function private.advertising_immutable();
create trigger immutable_advertising_price before update or delete on private.advertising_publication_prices for each row execute function private.advertising_immutable();
create trigger immutable_advertising_period before update or delete on private.advertising_billing_periods for each row execute function private.advertising_immutable();
create trigger immutable_advertising_review before update or delete on private.advertising_billing_reviews for each row execute function private.advertising_immutable();
create function private.lock_advertising_publication() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('advertising-billing:'||new.company_id::text,0));
 new.first_published_at:=clock_timestamp();
 return new;
end $$;
create trigger advertising_publication_billing_lock before insert on private.advertising_publications for each row execute function private.lock_advertising_publication();
revoke all on function private.lock_advertising_publication() from public,anon,authenticated,service_role;
create function private.price_advertising_publication() returns trigger language plpgsql security invoker set search_path='' as $$
declare r private.advertising_channel_rates;
begin
 -- The same company lock serializes price activation, publication, reconciliation and closing.
 perform pg_advisory_xact_lock(hashtextextended('advertising-billing:'||new.company_id::text,0));
 select * into r from private.advertising_channel_rates where company_id=new.company_id and channel=new.channel and effective_at<=new.first_published_at order by version desc limit 1;
 if found then insert into private.advertising_publication_prices(publication_id,unit_price_ore,source,rate_id) values(new.id,r.unit_price_ore,'rate',r.id);end if;
 return new;
end $$;
create trigger advertising_publication_price after insert on private.advertising_publications for each row execute function private.price_advertising_publication();
revoke all on function private.price_advertising_publication() from public,anon,authenticated,service_role;
commit;
