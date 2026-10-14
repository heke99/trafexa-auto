begin;
lock table private.advertising_jobs in share row exclusive mode;
create table private.advertising_usage_tracking (
 singleton boolean primary key default true check(singleton), started_at timestamptz not null default clock_timestamp()
);
insert into private.advertising_usage_tracking(singleton) values(true);
create table private.advertising_publications (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 listing_id uuid not null, channel text not null check(channel in ('blocket','wayke')),
 provider_ad_id text not null check(length(provider_ad_id) between 1 and 200 and provider_ad_id !~ '[[:cntrl:]]'),
 job_id uuid not null unique references private.advertising_jobs(id), job_version integer not null check(job_version>0),
 first_published_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,listing_id) references private.advertising_listings(company_id,id),
 unique(company_id,listing_id,channel), unique(company_id,channel,provider_ad_id)
);
create table private.advertising_publication_identities (
 company_id uuid not null,channel text not null,provider_ad_id text not null,listing_id uuid not null,
 primary key(company_id,channel,provider_ad_id),foreign key(company_id,listing_id) references private.advertising_listings(company_id,id)
);
alter table private.advertising_publication_identities enable row level security;
revoke all on private.advertising_publication_identities from public,anon,authenticated,service_role;
create trigger immutable_advertising_identity before update or delete on private.advertising_publication_identities for each row execute function private.advertising_immutable();
insert into private.advertising_publication_identities select distinct company_id,channel,provider_ad_id,listing_id from private.advertising_jobs where status='published' and provider_ad_id is not null;
create table private.advertising_legacy_publications (
 company_id uuid not null,listing_id uuid not null,channel text not null,initial_job_count bigint not null check(initial_job_count>0),
 primary key(company_id,listing_id,channel),foreign key(company_id,listing_id) references private.advertising_listings(company_id,id)
);
insert into private.advertising_legacy_publications select company_id,listing_id,channel,count(*) from private.advertising_jobs where status='published' group by company_id,listing_id,channel;
alter table private.advertising_legacy_publications enable row level security;
revoke all on private.advertising_legacy_publications from public,anon,authenticated,service_role;
create trigger immutable_advertising_legacy before update or delete on private.advertising_legacy_publications for each row execute function private.advertising_immutable();
create index advertising_publications_company_period on private.advertising_publications(company_id,first_published_at,channel);
alter table private.advertising_publications enable row level security;
alter table private.advertising_usage_tracking enable row level security;
revoke all on private.advertising_publications,private.advertising_usage_tracking from public,anon,authenticated,service_role;
create trigger immutable_advertising_publication before update or delete on private.advertising_publications for each row execute function private.advertising_immutable();
create trigger immutable_advertising_tracking before update or delete on private.advertising_usage_tracking for each row execute function private.advertising_immutable();
create function private.record_advertising_publication() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status='published' and (tg_op='INSERT' or old.status is distinct from 'published') then
  if tg_op<>'UPDATE' or current_setting('role',true)<>'service_role' or old.status not in ('dispatching','outcome_unknown','submitted') or new.provider_ad_id is null then
   raise exception 'Verified advertising publication required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text||':'||new.channel||':'||new.provider_ad_id,0));
  if exists(select 1 from private.advertising_publication_identities where company_id=new.company_id and channel=new.channel and provider_ad_id=new.provider_ad_id and listing_id<>new.listing_id) then
   raise exception 'Provider advertising identity collision' using errcode='40001';
  end if;
  insert into private.advertising_publication_identities(company_id,channel,provider_ad_id,listing_id)
   values(new.company_id,new.channel,new.provider_ad_id,new.listing_id) on conflict(company_id,channel,provider_ad_id) do nothing;
  if not exists(select 1 from private.advertising_legacy_publications where company_id=new.company_id and listing_id=new.listing_id and channel=new.channel) then
  insert into private.advertising_publications(company_id,listing_id,channel,provider_ad_id,job_id,job_version)
   values(new.company_id,new.listing_id,new.channel,new.provider_ad_id,new.id,new.version)
   on conflict(company_id,listing_id,channel) do nothing;
  end if;
 end if;
 return new;
end $$;
create trigger advertising_publication_receipt after insert or update on private.advertising_jobs for each row execute function private.record_advertising_publication();
revoke all on function private.record_advertising_publication() from public,anon,authenticated,service_role;
commit;
