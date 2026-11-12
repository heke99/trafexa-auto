-- Explicit customer-price provenance. No provider identifiers, prices or active agreements are seeded.
begin;
create table private.advertising_listing_program_stores (
 company_id uuid not null, listing_id uuid primary key,store_id uuid not null references private.advertising_program_stores(id),
 bound_by uuid not null references auth.users(id),bound_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,listing_id) references private.advertising_listings(company_id,id)
);
create table private.advertising_program_binding_receipts (
 actor_id uuid not null references auth.users(id), request_id uuid not null, payload jsonb not null,receipt jsonb not null,primary key(actor_id,request_id)
);
alter table private.advertising_listing_program_stores enable row level security;
alter table private.advertising_program_binding_receipts enable row level security;
revoke all on private.advertising_listing_program_stores,private.advertising_program_binding_receipts from public,anon,authenticated,service_role;
create trigger immutable_advertising_program_binding_receipt before update or delete on private.advertising_program_binding_receipts for each row execute function private.advertising_immutable();

alter table private.advertising_charge_commitments alter column rate_id drop not null;
alter table private.advertising_job_price_commitments alter column rate_id drop not null;
do $$declare t text;begin foreach t in array array['advertising_charge_commitments','advertising_job_price_commitments','advertising_publication_prices'] loop
 execute format('alter table private.%I add column program_store_id uuid, add column program_period_id uuid, add column program_version integer, add foreign key(program_store_id,program_period_id,program_version) references private.advertising_program_revisions(store_id,period_id,version)',t);
 execute format('alter table private.%I add constraint %I check ((program_store_id is null and program_period_id is null and program_version is null) or (program_store_id is not null and program_period_id is not null and program_version is not null and rate_id is null))',t,t||'_program_identity');
end loop;end $$;
alter table private.advertising_charge_commitments add constraint advertising_charge_price_origin check ((rate_id is not null)<>(program_store_id is not null));
alter table private.advertising_job_price_commitments add constraint advertising_job_price_origin check ((rate_id is not null)<>(program_store_id is not null));
-- Preserve old rate/review rows and their exact immutable identities.
alter table private.advertising_publication_prices drop constraint advertising_publication_prices_source_check;
alter table private.advertising_publication_prices drop constraint advertising_publication_prices_check;
alter table private.advertising_publication_prices add constraint advertising_publication_price_origin check (
 (source='rate' and rate_id is not null and program_store_id is null and created_by is null and reason is null) or
 (source='program' and rate_id is null and program_store_id is not null and created_by is null and reason is null) or
 (source='review' and rate_id is null and program_store_id is null and created_by is not null and length(reason) between 1 and 500 and reason=btrim(reason) and reason !~ '[[:cntrl:]]'));

create function private.advertising_program_price_json(p_store uuid,p_period uuid,p_version integer) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('storeId',s.id,'storeName',s.store_name,'periodId',r.period_id,'version',r.version,'agreementReference',r.agreement_reference)
 from private.advertising_program_stores s join private.advertising_program_revisions r on r.store_id=s.id
 where s.id=p_store and r.period_id=p_period and r.version=p_version;
$$;
create function private.advertising_listing_program_price(p_company uuid,p_listing uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare store uuid;r private.advertising_program_revisions;today date:=(clock_timestamp() at time zone 'Europe/Stockholm')::date;n integer;
begin
 select b.store_id into store from private.advertising_listing_program_stores b join private.advertising_program_stores s on s.id=b.store_id and s.company_id=b.company_id where b.company_id=p_company and b.listing_id=p_listing;
 if store is null then return jsonb_build_object('blockedReason','store_required');end if;
 select count(*) into n from (select distinct on(period_id) * from private.advertising_program_revisions where store_id=store order by period_id,version desc) x
 where not cancelled and confirmed_start<=today and (confirmed_end is null or confirmed_end>today) and (contract_end is null or contract_end>today or confirmed_end is not null);
 if n<>1 then return jsonb_build_object('blockedReason',case when n=0 then 'agreement_inactive' else 'agreement_ambiguous' end);end if;
 select * into r from (select distinct on(period_id) * from private.advertising_program_revisions where store_id=store order by period_id,version desc) x
 where not cancelled and confirmed_start<=today and (confirmed_end is null or confirmed_end>today) and (contract_end is null or contract_end>today or confirmed_end is not null);
 return jsonb_build_object('program',private.advertising_program_price_json(store,r.period_id,r.version),'unitPriceOre',r.blocket_price_ore::text)
 ||case when r.blocket_price_ore is null then jsonb_build_object('blockedReason','program_price_missing') else '{}'::jsonb end;
end $$;
create function private.bind_advertising_listing_program(p_company uuid,p_listing uuid,p_expected integer,p_store uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;payload jsonb;prior private.advertising_program_binding_receipts;receipt jsonb;l private.advertising_listings;
begin
 select user_id into actor from private.company_team_identity(true);
 perform private.advertising_context(p_company,null,actor,array['owner','admin','sales'],true);
 if p_request is null or p_listing is null or p_store is null or p_expected is null or p_expected<1 then raise exception 'Invalid store selection' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('advertising-program-binding:'||actor::text||':'||p_request::text,0));
 payload:=jsonb_build_object('companyId',p_company,'listingId',p_listing,'expectedVersion',p_expected,'storeId',p_store);
 select * into prior from private.advertising_program_binding_receipts where actor_id=actor and request_id=p_request;
 if found then if prior.payload<>payload then raise exception 'Store selection request conflict' using errcode='40001';end if;return prior.receipt;end if;
 perform pg_advisory_xact_lock(hashtextextended('advertising-billing:'||p_company::text,0));
 select * into l from private.advertising_listings where company_id=p_company and id=p_listing for share;
 if l.id is null or not exists(select 1 from private.advertising_program_stores where id=p_store and company_id=p_company) then raise exception 'Store selection access denied' using errcode='42501';end if;
 if l.version<>p_expected then raise exception 'Store selection version conflict' using errcode='40001';end if;
 if exists(select 1 from private.advertising_listing_program_stores where listing_id=p_listing and store_id=p_store) then null;
 elsif exists(select 1 from private.advertising_charge_commitments where listing_id=p_listing and channel='blocket') or exists(select 1 from private.advertising_jobs where listing_id=p_listing and channel='blocket') then raise exception 'Accepted advertising store cannot be changed' using errcode='40001';
 else insert into private.advertising_listing_program_stores(company_id,listing_id,store_id,bound_by) values(p_company,p_listing,p_store,actor)
 on conflict(listing_id) do update set store_id=excluded.store_id,bound_by=excluded.bound_by,bound_at=clock_timestamp();end if;
 receipt:=payload||jsonb_build_object('actorUserId',actor,'requestId',p_request);
 insert into private.advertising_program_binding_receipts values(actor,p_request,payload,receipt);return receipt;
end $$;
create function public.bind_advertising_listing_program(p_company_id uuid,p_listing_id uuid,p_expected_version integer,p_store_id uuid,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.bind_advertising_listing_program(p_company_id,p_listing_id,p_expected_version,p_store_id,p_request_id)$$;
revoke all on function private.advertising_program_price_json(uuid,uuid,integer),private.advertising_listing_program_price(uuid,uuid),private.bind_advertising_listing_program(uuid,uuid,integer,uuid,uuid),public.bind_advertising_listing_program(uuid,uuid,integer,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.bind_advertising_listing_program(uuid,uuid,integer,uuid,uuid),public.bind_advertising_listing_program(uuid,uuid,integer,uuid,uuid) to authenticated;
create or replace function private.save_advertising_program(p_company uuid,p_store uuid,p_input jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := private.blocket_admin_identity();
  store private.advertising_program_stores;
  entry private.advertising_program_revisions;
  previous private.advertising_program_revisions;
  expected integer := (p_input->>'version')::integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('advertising-billing:'||p_company::text,0));
  if p_store is null then
    insert into private.advertising_program_stores(company_id,dealer_code,store_name)
      values (p_company,btrim(p_input->>'dealer_code'),btrim(p_input->>'store_name'))
      returning * into store;
    return store.id;
  end if;
  select * into store from private.advertising_program_stores
    where id=p_store and company_id=p_company for update;
  if not found then raise exception 'Store unavailable' using errcode='42501'; end if;
  entry := jsonb_populate_record(null::private.advertising_program_revisions,p_input);
  entry.store_id := store.id;
  entry.period_id := coalesce(entry.period_id,gen_random_uuid());
  select * into previous from private.advertising_program_revisions
    where store_id=store.id and period_id=entry.period_id order by version desc limit 1;
  if expected is distinct from coalesce(previous.version,0) then
    raise exception 'Period changed' using errcode='40001';
  end if;
  if previous.cancelled then
    raise exception 'Cancelled period cannot be changed' using errcode='40001';
  end if;
  if coalesce(entry.cancelled,false) then
    if previous.version is null or previous.confirmed_start is not null then
      raise exception 'Only pending periods can be cancelled' using errcode='23514';
    end if;
    entry := previous;
    entry.cancelled := true;
  else
    if previous.confirmed_start is not null and entry.confirmed_start is null then
      raise exception 'Confirmed start cannot be cleared' using errcode='23514';
    end if;
    entry.cancelled := false;
  end if;
  if not entry.cancelled and exists (
    select 1 from (select distinct on (period_id) * from private.advertising_program_revisions
      where store_id=store.id and period_id<>entry.period_id order by period_id,version desc) r
    where not r.cancelled and least(r.desired_start,r.confirmed_start)<greatest(entry.contract_end,coalesce(entry.confirmed_end,'infinity'::date))
      and least(entry.desired_start,entry.confirmed_start)<greatest(r.contract_end,coalesce(r.confirmed_end,'infinity'::date))
  ) then raise exception 'Overlapping program periods' using errcode='23P01'; end if;
  entry.version := expected+1;
  entry.created_by := actor;
  entry.created_at := clock_timestamp();
  insert into private.advertising_program_revisions select (entry).*;
  return store.id;
end $$;

create or replace function private.advertising_send_quote(p_company uuid,p_listing uuid,p_expected integer,p_channels text[]) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid;l private.advertising_listings%rowtype;channels text[];ch text;r private.advertising_channel_rates%rowtype;
 accepted private.advertising_charge_commitments%rowtype;publication uuid;already boolean;items jsonb:='[]';snapshot jsonb;total numeric:=0;missing boolean:=false;program jsonb;program_state jsonb;stores jsonb;binding uuid;
begin
 select user_id into actor from private.company_team_identity(true);
 -- Every priced send/quote uses the old advertising Auth -> company -> membership lock order.
 -- Rate activation and first publication take this same billing lock after their context locks.
 perform private.advertising_context(p_company,null,actor,array['owner','admin','sales'],true);
 perform pg_advisory_xact_lock(hashtextextended('advertising-billing:'||p_company::text,0));
 if p_listing is null or p_expected is null or p_expected<1 or p_channels is null or cardinality(p_channels) not between 1 and 2
  or array_position(p_channels,null) is not null or cardinality(p_channels)<>(select count(distinct x) from unnest(p_channels)x)
  or exists(select 1 from unnest(p_channels)x where x not in ('blocket','wayke')) then raise exception 'Invalid advertising quote' using errcode='22023';end if;
 select array_agg(x order by x) into channels from unnest(p_channels)x;
 select * into l from private.advertising_listings where company_id=p_company and id=p_listing for share;
 if l.id is null then raise exception 'Advertising quote access denied' using errcode='42501';end if;
 if l.version<>p_expected or l.status<>'ready' then raise exception 'Advertising quote version changed' using errcode='40001';end if;
 select store_id into binding from private.advertising_listing_program_stores where company_id=p_company and listing_id=p_listing;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.store_name) order by s.store_name,s.id),'[]') into stores from private.advertising_program_stores s where s.company_id=p_company;
 foreach ch in array channels loop
  select * into accepted from private.advertising_charge_commitments where company_id=p_company and listing_id=p_listing and channel=ch;
  r:=null; program:=null; program_state:=null;
  if accepted.listing_id is not null then
   if accepted.program_store_id is not null then
    program:=private.advertising_program_price_json(accepted.program_store_id,accepted.program_period_id,accepted.program_version);
    program_state:=private.advertising_listing_program_price(p_company,p_listing);
    if program_state->>'blockedReason'='program_price_missing' then program_state:=program_state-'blockedReason';end if;
   else select * into r from private.advertising_channel_rates where id=accepted.rate_id; end if;
  elsif ch='blocket' and jsonb_array_length(stores)>0 then
   program_state:=private.advertising_listing_program_price(p_company,p_listing);
   program:=program_state->'program';
  else select * into r from private.advertising_channel_rates where company_id=p_company and channel=ch and effective_at<=clock_timestamp() order by version desc limit 1;end if;
  select id into publication from private.advertising_publications where company_id=p_company and listing_id=p_listing and channel=ch;
  already:=publication is not null or exists(select 1 from private.advertising_legacy_publications where company_id=p_company and listing_id=p_listing and channel=ch);
  declare amount bigint; blocked text; begin
   amount:=case when accepted.listing_id is not null then accepted.unit_price_ore when program_state is not null then (program_state->>'unitPriceOre')::bigint else r.unit_price_ore end;
   blocked:=program_state->>'blockedReason';
   if ch='blocket' and program is not null and not exists(select 1 from private.advertising_connections c join private.advertising_program_stores s on s.id=(program->>'storeId')::uuid where c.company_id=p_company and c.channel='blocket' and c.status='verified' and c.account_reference=s.dealer_code) then blocked:='destination_mismatch';end if;
   if amount is null or blocked is not null then missing:=true;else total:=total+case when already then 0 else amount end;end if;
   items:=items||jsonb_build_array(jsonb_build_object('channel',ch,'rateId',r.id,'rateVersion',r.version,'unitPriceOre',amount::text,
     'chargeOre',case when amount is null or blocked is not null then null when already then '0' else amount::text end,'alreadyPublished',already,'publicationId',publication)
     ||case when program is null then '{}'::jsonb else jsonb_build_object('program',program) end
     ||case when blocked is null then '{}'::jsonb else jsonb_build_object('blockedReason',blocked) end);
  end;
 end loop;
 if total>18446744073709551614 then raise exception 'Advertising quote total too large' using errcode='22023';end if;
 snapshot:=jsonb_build_object('companyId',p_company,'actorUserId',actor,'listingId',p_listing,'listingVersion',p_expected,'channels',channels,
  'currency','SEK','taxBasis','exclusive','billingUnit','unique_publication','items',items,'totalOre',case when missing then null else total::text end);
 if jsonb_array_length(stores)>0 then snapshot:=snapshot||jsonb_build_object('programStores',stores,'selectedProgramStoreId',binding);end if;
 return snapshot||jsonb_build_object('reviewToken',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'));
end $$;

create function private.bind_advertising_program_commitment() returns trigger language plpgsql security invoker set search_path='' as $$
declare state jsonb;c private.advertising_charge_commitments;
begin
 if tg_table_name='advertising_charge_commitments' and new.rate_id is null then
  select * into c from private.advertising_charge_commitments where company_id=new.company_id and listing_id=new.listing_id and channel=new.channel;
  if found then new.program_store_id:=c.program_store_id;new.program_period_id:=c.program_period_id;new.program_version:=c.program_version;return new;end if;
  state:=private.advertising_listing_program_price(new.company_id,new.listing_id);
  if new.channel<>'blocket' or state->>'blockedReason' is not null or (state->>'unitPriceOre')::bigint is distinct from new.unit_price_ore then raise exception 'Program price changed' using errcode='40001';end if;
  new.program_store_id:=(state->'program'->>'storeId')::uuid;new.program_period_id:=(state->'program'->>'periodId')::uuid;new.program_version:=(state->'program'->>'version')::integer;
 elsif tg_table_name='advertising_job_price_commitments' and new.rate_id is null then
  select * into c from private.advertising_charge_commitments where company_id=new.company_id and listing_id=new.listing_id and channel=new.channel;
  new.program_store_id:=c.program_store_id;new.program_period_id:=c.program_period_id;new.program_version:=c.program_version;
 end if;
 return new;
end $$;
create trigger advertising_program_charge before insert on private.advertising_charge_commitments for each row execute function private.bind_advertising_program_commitment();
create trigger advertising_program_job_price before insert on private.advertising_job_price_commitments for each row execute function private.bind_advertising_program_commitment();
-- Existing company-level provider connections are not promoted to multi-store connections.
-- A selected internal store must match the independently provisioned destination exactly.
create function private.guard_advertising_program_job() returns trigger language plpgsql security invoker set search_path='' as $$
declare s private.advertising_program_stores;state jsonb;
begin
 if new.channel='blocket' and not exists(select 1 from private.advertising_charge_commitments where company_id=new.company_id and listing_id=new.listing_id and channel='blocket' and program_store_id is null) and exists(select 1 from private.advertising_program_stores where company_id=new.company_id) then
  select s0.* into s from private.advertising_program_stores s0 join private.advertising_listing_program_stores b on b.store_id=s0.id and b.company_id=s0.company_id where b.listing_id=new.listing_id and b.company_id=new.company_id;
  state:=private.advertising_listing_program_price(new.company_id,new.listing_id);
  if state->>'blockedReason' is not null and state->>'blockedReason'<>'program_price_missing' then raise exception 'Selected store agreement is not active' using errcode='40001';end if;
  if s.id is null or s.dealer_code is distinct from new.account_reference then raise exception 'Selected store has no matching verified destination' using errcode='40001';end if;
 end if;
 return new;
end $$;
create trigger advertising_program_job_destination before insert on private.advertising_jobs for each row execute function private.guard_advertising_program_job();
create or replace function private.price_advertising_publication() returns trigger language plpgsql security invoker set search_path='' as $$
declare r private.advertising_channel_rates;accepted private.advertising_charge_commitments;
begin
 perform pg_advisory_xact_lock(hashtextextended('advertising-billing:'||new.company_id::text,0));
 select * into accepted from private.advertising_charge_commitments where company_id=new.company_id and listing_id=new.listing_id and channel=new.channel;
 if found then
  insert into private.advertising_publication_prices(publication_id,unit_price_ore,source,rate_id,program_store_id,program_period_id,program_version)
  values(new.id,accepted.unit_price_ore,case when accepted.program_store_id is null then 'rate' else 'program' end,accepted.rate_id,accepted.program_store_id,accepted.program_period_id,accepted.program_version);
 else
  select * into r from private.advertising_channel_rates where company_id=new.company_id and channel=new.channel and effective_at<=new.first_published_at order by version desc limit 1;
  if found then insert into private.advertising_publication_prices(publication_id,unit_price_ore,source,rate_id) values(new.id,r.unit_price_ore,'rate',r.id);end if;
 end if;
 return new;
end $$;
revoke all on function private.bind_advertising_program_commitment(),private.guard_advertising_program_job() from public,anon,authenticated,service_role;

commit;
