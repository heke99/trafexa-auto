-- Reviewed per-channel prices bind the durable unique publication identity before enqueue.
-- No rates, credentials, provider connections, readiness leases or external sends are seeded.
begin;
create table private.advertising_charge_commitments (
 company_id uuid not null,listing_id uuid not null,channel text not null check(channel in ('blocket','wayke')),
 rate_id uuid not null references private.advertising_channel_rates(id),unit_price_ore bigint not null check(unit_price_ore>=0),
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,quote_token text not null check(quote_token ~ '^[0-9a-f]{64}$'),
 accepted_at timestamptz not null default clock_timestamp(),primary key(company_id,listing_id,channel),
 foreign key(company_id,listing_id) references private.advertising_listings(company_id,id)
);
create table private.advertising_job_price_commitments (
 job_id uuid primary key references private.advertising_jobs(id),company_id uuid not null,listing_id uuid not null,channel text not null,
 rate_id uuid not null references private.advertising_channel_rates(id),unit_price_ore bigint not null check(unit_price_ore>=0),
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,quote_token text not null check(quote_token ~ '^[0-9a-f]{64}$'),
 accepted_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,listing_id,channel) references private.advertising_charge_commitments(company_id,listing_id,channel)
);
alter table private.advertising_charge_commitments enable row level security;
alter table private.advertising_job_price_commitments enable row level security;
revoke all on private.advertising_charge_commitments,private.advertising_job_price_commitments from public,anon,authenticated,service_role;
create trigger immutable_advertising_charge_commitment before update or delete on private.advertising_charge_commitments for each row execute function private.advertising_immutable();
create trigger immutable_advertising_job_price_commitment before update or delete on private.advertising_job_price_commitments for each row execute function private.advertising_immutable();

create function private.advertising_send_quote(p_company uuid,p_listing uuid,p_expected integer,p_channels text[]) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid;l private.advertising_listings%rowtype;channels text[];ch text;r private.advertising_channel_rates%rowtype;
 accepted private.advertising_charge_commitments%rowtype;publication uuid;already boolean;items jsonb:='[]';snapshot jsonb;total numeric:=0;missing boolean:=false;
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
 foreach ch in array channels loop
  select * into accepted from private.advertising_charge_commitments where company_id=p_company and listing_id=p_listing and channel=ch;
  if found then select * into r from private.advertising_channel_rates where id=accepted.rate_id;
  else select * into r from private.advertising_channel_rates where company_id=p_company and channel=ch and effective_at<=clock_timestamp() order by version desc limit 1;end if;
  select id into publication from private.advertising_publications where company_id=p_company and listing_id=p_listing and channel=ch;
  already:=publication is not null or exists(select 1 from private.advertising_legacy_publications where company_id=p_company and listing_id=p_listing and channel=ch);
  if r.id is null then missing:=true;else total:=total+case when already then 0 else r.unit_price_ore end;end if;
  items:=items||jsonb_build_array(jsonb_build_object('channel',ch,'rateId',r.id,'rateVersion',r.version,'unitPriceOre',r.unit_price_ore::text,
    'chargeOre',case when r.id is null then null when already then '0' else r.unit_price_ore::text end,'alreadyPublished',already,'publicationId',publication));
 end loop;
 if total>18446744073709551614 then raise exception 'Advertising quote total too large' using errcode='22023';end if;
 snapshot:=jsonb_build_object('companyId',p_company,'actorUserId',actor,'listingId',p_listing,'listingVersion',p_expected,'channels',channels,
  'currency','SEK','taxBasis','exclusive','billingUnit','unique_publication','items',items,'totalOre',case when missing then null else total::text end);
 return snapshot||jsonb_build_object('reviewToken',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'));
end $$;
revoke all on function private.advertising_send_quote(uuid,uuid,integer,text[]) from public,anon,service_role;
grant execute on function private.advertising_send_quote(uuid,uuid,integer,text[]) to authenticated;
create function public.get_advertising_send_quote(p_company_id uuid,p_listing_id uuid,p_expected_version integer,p_channels text[]) returns jsonb
 language sql security invoker set search_path='' as $$select private.advertising_send_quote(p_company_id,p_listing_id,p_expected_version,p_channels);$$;
revoke all on function public.get_advertising_send_quote(uuid,uuid,integer,text[]) from public,anon,service_role;
grant execute on function public.get_advertising_send_quote(uuid,uuid,integer,text[]) to authenticated;

create or replace function private.advertising_mutate(p_action text,p_company uuid,p_payload jsonb,p_request uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid;sid uuid;lid uuid;expected integer;payload jsonb;receipt jsonb;prior jsonb;old_value jsonb;
 l private.advertising_listings%rowtype;p private.vehicle_photos%rowtype;o storage.objects%rowtype;c private.advertising_connections%rowtype;j private.advertising_jobs%rowtype;
 snap jsonb;quote jsonb;quote_item jsonb;commitment private.advertising_charge_commitments%rowtype;ids uuid[];v_channel text;channels text[];queued jsonb:='[]';ext text;path text;mime text;bytes bigint;
begin
 select user_id into actor from private.company_team_identity(true);
 sid:=(p_payload->>'stockId')::uuid;lid:=(p_payload->>'listingId')::uuid;expected:=(p_payload->>'expectedVersion')::integer;
 perform private.advertising_context(p_company,sid,actor,case when p_action='connection' then array['owner','admin'] else array['owner','admin','sales'] end,true);
 if p_request is null then raise exception 'Request UUID required' using errcode='22023';end if;
 if p_action='send' then
  select array_agg(x order by x) into channels from jsonb_array_elements_text(p_payload->'channels') x;
  if channels is null or cardinality(channels) not between 1 and 2 or cardinality(channels)<>(select count(distinct x) from unnest(channels)x)
   or exists(select 1 from unnest(channels)x where x not in ('blocket','wayke')) then raise exception 'Invalid advertising channels' using errcode='22023';end if;
  p_payload:=jsonb_set(p_payload,'{channels}',to_jsonb(channels));
 end if;
 payload:=jsonb_build_object('action',p_action,'companyId',p_company,'input',p_payload);
 select a.receipt,a.payload into receipt,prior from private.advertising_audit a where a.actor_user_id=actor and a.request_id=p_request;
 if receipt is not null then
  if prior is distinct from payload then raise exception 'Request payload conflict' using errcode='40001';end if;return receipt;
 end if;
 if p_action='send' then
  if p_payload->>'expectedQuoteToken' is null or p_payload->>'expectedQuoteToken' !~ '^[0-9a-f]{64}$' then
   raise exception 'Reviewed advertising quote required' using errcode='22023';end if;
  quote:=private.advertising_send_quote(p_company,lid,expected,channels);
  if quote->>'reviewToken' is distinct from p_payload->>'expectedQuoteToken' then raise exception 'Advertising quote changed' using errcode='40001';end if;
  if quote->>'totalOre' is null then raise exception 'Selected advertising price missing' using errcode='22023';end if;
 end if;
 if p_action='photo_register' then
  perform private.advertising_photo_bucket();
  path:=p_payload->>'objectPath';mime:=p_payload->>'contentType';bytes:=(p_payload->>'sizeBytes')::bigint;
  if mime not in ('image/jpeg','image/png','image/webp') or mime is null or bytes is null or bytes not between 1 and 10485760 or (p_payload->>'photoId') is null then raise exception 'Invalid photo metadata' using errcode='22023';end if;
  ext:=case mime when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end;
  if path is distinct from p_company::text||'/'||sid::text||'/'||(p_payload->>'photoId')::uuid::text||ext then raise exception 'Photo path binding denied' using errcode='42501';end if;
  select * into o from storage.objects where bucket_id='ads-vehicle-photos' and name=path for share;
  if not found or not(coalesce(o.owner_id=actor::text,false) or coalesce(o.owner=actor,false))
   or (o.owner_id is not null and o.owner_id<>actor::text) or (o.owner is not null and o.owner<>actor)
   or o.metadata->>'mimetype' is distinct from mime or coalesce(o.metadata->>'size','') !~ '^[0-9]{1,12}$'
   or (o.metadata->>'size')::bigint<>bytes then raise exception 'Stored photo metadata/owner mismatch' using errcode='42501';end if;
  if exists(select 1 from private.vehicle_photos where id=(p_payload->>'photoId')::uuid) then raise exception 'Photo registration conflict' using errcode='40001';end if;
  if (select count(*) from private.vehicle_photos where company_id=p_company and stock_id=sid and status='active')>=20 then raise exception 'Photo limit reached' using errcode='22023';end if;
  insert into private.vehicle_photos(id,company_id,stock_id,object_path,content_type,size_bytes,created_by) values((p_payload->>'photoId')::uuid,p_company,sid,path,mime,bytes,actor) returning * into p;
  receipt:=jsonb_build_object('photo',private.vehicle_photo_json(p));snap:=to_jsonb(p);
 elsif p_action='photo_archive' then
  select * into p from private.vehicle_photos where company_id=p_company and id=(p_payload->>'photoId')::uuid for update;
  if not found then raise exception 'Photo access denied' using errcode='42501';end if;
  if expected is null or p.version<>expected or p.status<>'active' then raise exception 'Photo version conflict' using errcode='40001';end if;
  old_value:=to_jsonb(p);update private.vehicle_photos set status='archived',version=version+1,archived_at=clock_timestamp() where id=p.id returning * into p;
  receipt:=jsonb_build_object('photo',private.vehicle_photo_json(p));snap:=to_jsonb(p);
 elsif p_action='connection' then
  v_channel:=p_payload->>'channel';
  if v_channel is null or v_channel not in ('blocket','wayke') or length(p_payload->>'accountReference') not between 1 and 160 or (p_payload->>'accountReference') is null
   or (p_payload->>'accountReference')<>btrim(p_payload->>'accountReference') or (p_payload->>'accountReference') ~ '[[:cntrl:]]' then raise exception 'Invalid nonsecret account reference' using errcode='22023';end if;
  select * into c from private.advertising_connections where company_id=p_company and advertising_connections.channel=v_channel for update;
  if found and c.status='verified' and c.account_reference<>(p_payload->>'accountReference') then raise exception 'Verified account cannot be replaced by user request' using errcode='40001';end if;
  old_value:=case when c.id is null then null else to_jsonb(c) end;
  if c.id is null then insert into private.advertising_connections(company_id,channel,account_reference,status,created_by) values(p_company,v_channel,p_payload->>'accountReference','requested',actor) returning * into c;
  elsif c.status<>'verified' then update private.advertising_connections set account_reference=p_payload->>'accountReference',status='requested',version=version+1,dispatcher_id=null where id=c.id returning * into c;end if;
  receipt:=jsonb_build_object('connection',(select x from jsonb_array_elements(private.advertising_channels(p_company)) x where x->>'channel'=v_channel));snap:=to_jsonb(c);
 else
  select * into l from private.advertising_listings where company_id=p_company and id=lid for update;
  if p_action='save' then
   if expected is null or expected<0 or (expected=0 and l.id is not null) or (expected>0 and (l.id is null or l.version<>expected)) then raise exception 'Listing version conflict' using errcode='40001';end if;
   if l.id is not null and l.stock_id is distinct from sid then raise exception 'Listing stock binding denied' using errcode='42501';end if;
   select coalesce(array_agg(x::uuid),'{}'::uuid[]) into ids from jsonb_array_elements_text(p_payload->'photoIds') x;
   snap:=private.advertising_snapshot(p_company,sid,p_payload->>'title',p_payload->>'description',ids,(p_payload->>'includeRegistrationNumber')::boolean);
   old_value:=case when l.id is null then null else private.advertising_listing_json(l) end;
   if expected=0 then insert into private.advertising_listings(id,company_id,stock_id,status,created_by) values(lid,p_company,sid,'draft',actor) returning * into l;
   else update private.advertising_listings set version=version+1,status='draft',updated_at=clock_timestamp() where id=l.id returning * into l;end if;
   insert into private.advertising_versions(company_id,listing_id,version,snapshot,created_by) values(p_company,l.id,l.version,snap,actor);
   receipt:=jsonb_build_object('listing',private.advertising_listing_json(l));
  elsif p_action in ('ready','send') then
   if l.id is null then raise exception 'Listing access denied' using errcode='42501';end if;
   perform private.advertising_context(p_company,l.stock_id,actor,array['owner','admin','sales'],true);
   if expected is null or l.version<>expected then raise exception 'Listing version conflict' using errcode='40001';end if;
   select snapshot into snap from private.advertising_versions where listing_id=l.id and version=l.version;
   select coalesce(array_agg((x->>'id')::uuid order by ordinality),'{}'::uuid[]) into ids from jsonb_array_elements(snap->'photos') with ordinality a(x,ordinality);
   if cardinality(ids)<1 or (select status from public.stock_items where id=l.stock_id)<>'available' then raise exception 'Listing not publishable' using errcode='40001';end if;
   if snap is distinct from private.advertising_snapshot(p_company,l.stock_id,snap->>'title',snap->>'description',ids,(snap->>'includeRegistrationNumber')::boolean) then raise exception 'Advertising snapshot is stale' using errcode='40001';end if;
   if p_action='ready' then
    if l.status='ready' then raise exception 'Listing already ready' using errcode='40001';end if;
    old_value:=private.advertising_listing_json(l);update private.advertising_listings set version=version+1,status='ready',updated_at=clock_timestamp() where id=l.id returning * into l;
    insert into private.advertising_versions(company_id,listing_id,version,snapshot,created_by) values(p_company,l.id,l.version,snap,actor);
    receipt:=jsonb_build_object('listing',private.advertising_listing_json(l));
   else
    if l.status<>'ready' then raise exception 'Ready listing required' using errcode='40001';end if;
    select array_agg(x order by x) into channels from jsonb_array_elements_text(p_payload->'channels') x;
    if channels is null or cardinality(channels) not between 1 and 2 or cardinality(channels)<>(select count(distinct x) from unnest(channels)x)
     or exists(select 1 from unnest(channels)x where x not in ('blocket','wayke')) then raise exception 'Invalid advertising channels' using errcode='22023';end if;
    -- All channels checked before any enqueue. Failed preparation is not memoized.
    foreach v_channel in array channels loop
     select c0.* into c from private.advertising_connections c0 join private.advertising_dispatchers d on d.id=c0.dispatcher_id and d.channel=c0.channel
      where c0.company_id=p_company and c0.channel=v_channel and c0.status='verified' and d.available_until>clock_timestamp() for share of c0,d;
     if not found then return jsonb_build_object('actorUserId',actor,'requestId',p_request,'status','connection_required','jobs','[]'::jsonb,'listing',private.advertising_listing_json(l));end if;
     select * into j from private.advertising_jobs j0 where j0.listing_id=l.id and j0.listing_version=l.version and j0.channel=v_channel and j0.connection_id=c.id for share;
     if found and j.status<>'queued' then raise exception 'Selected advertising job already dispatched; refresh current status' using errcode='40001';end if;
    end loop;
    foreach v_channel in array channels loop
     select * into c from private.advertising_connections c0 where c0.company_id=p_company and c0.channel=v_channel;
     insert into private.advertising_jobs(company_id,stock_id,listing_id,listing_version,channel,connection_id,connection_version,account_reference,dispatcher_id,created_by,snapshot)
      values(p_company,l.stock_id,l.id,l.version,v_channel,c.id,c.version,c.account_reference,c.dispatcher_id,actor,snap) on conflict(listing_id,listing_version,channel,connection_id) do nothing;
     select * into j from private.advertising_jobs j0 where j0.listing_id=l.id and j0.listing_version=l.version and j0.channel=v_channel and j0.connection_id=c.id;
     select x into quote_item from jsonb_array_elements(quote->'items') x where x->>'channel'=v_channel;
     insert into private.advertising_charge_commitments(company_id,listing_id,channel,rate_id,unit_price_ore,actor_user_id,request_id,quote_token)
      values(p_company,l.id,v_channel,(quote_item->>'rateId')::uuid,(quote_item->>'unitPriceOre')::bigint,actor,p_request,quote->>'reviewToken')
      on conflict(company_id,listing_id,channel) do nothing;
     select * into commitment from private.advertising_charge_commitments where company_id=p_company and listing_id=l.id and channel=v_channel;
     if commitment.rate_id is distinct from (quote_item->>'rateId')::uuid or commitment.unit_price_ore is distinct from (quote_item->>'unitPriceOre')::bigint then
      raise exception 'Accepted advertising price conflict' using errcode='40001';end if;
     insert into private.advertising_job_price_commitments(job_id,company_id,listing_id,channel,rate_id,unit_price_ore,actor_user_id,request_id,quote_token)
      values(j.id,p_company,l.id,v_channel,commitment.rate_id,commitment.unit_price_ore,actor,p_request,quote->>'reviewToken') on conflict(job_id) do nothing;
     queued:=queued||jsonb_build_array(private.advertising_job_json(j));
    end loop;
    receipt:=jsonb_build_object('status','queued','jobs',queued,'listing',private.advertising_listing_json(l),'quote',quote);
   end if;
  else raise exception 'Unknown advertising mutation' using errcode='22023';end if;
 end if;
 receipt:=receipt||jsonb_build_object('actorUserId',actor,'requestId',p_request);
 insert into private.advertising_audit(company_id,actor_user_id,request_id,action,payload,receipt,previous_value,current_value)
 values(p_company,actor,p_request,p_action,payload,receipt,old_value,coalesce(snap,receipt));return receipt;
exception when unique_violation then raise exception 'Advertising request conflict' using errcode='40001';
end $$;

create function public.send_vehicle_advertisement_priced(p_company_id uuid,p_listing_id uuid,p_expected_version integer,p_channels text[],p_request_id uuid,p_expected_quote_token text) returns jsonb
 language sql security invoker set search_path='' as $$select private.advertising_mutate('send',p_company_id,jsonb_build_object('listingId',p_listing_id,'expectedVersion',p_expected_version,'channels',p_channels,'expectedQuoteToken',p_expected_quote_token),p_request_id);$$;
revoke all on function public.send_vehicle_advertisement_priced(uuid,uuid,integer,text[],uuid,text) from public,anon,service_role;
grant execute on function public.send_vehicle_advertisement_priced(uuid,uuid,integer,text[],uuid,text) to authenticated;

create or replace function private.price_advertising_publication() returns trigger language plpgsql security invoker set search_path='' as $$
declare r private.advertising_channel_rates;accepted private.advertising_charge_commitments;
begin
 perform pg_advisory_xact_lock(hashtextextended('advertising-billing:'||new.company_id::text,0));
 select * into accepted from private.advertising_charge_commitments where company_id=new.company_id and listing_id=new.listing_id and channel=new.channel;
 if found then
  insert into private.advertising_publication_prices(publication_id,unit_price_ore,source,rate_id) values(new.id,accepted.unit_price_ore,'rate',accepted.rate_id);
 else
  -- Historic jobs without an accepted price keep their original publication-time rule.
  select * into r from private.advertising_channel_rates where company_id=new.company_id and channel=new.channel and effective_at<=new.first_published_at order by version desc limit 1;
  if found then insert into private.advertising_publication_prices(publication_id,unit_price_ore,source,rate_id) values(new.id,r.unit_price_ore,'rate',r.id);end if;
 end if;
 return new;
end $$;
create or replace function private.advertising_worker(p_action text,p_job_id uuid,p_expected integer,p_token uuid,p_status text,p_provider_ad_id text,p_provider_url text,p_error_code text,p_dispatcher text,p_channel text,p_available_until timestamptz)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.advertising_jobs%rowtype;l private.advertising_listings%rowtype;c private.advertising_connections%rowtype;ids uuid[];fresh jsonb;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'Trusted advertising worker required' using errcode='42501';end if;
 if p_action='refresh' then
  if p_dispatcher is null or length(p_dispatcher) not between 1 and 100 or p_dispatcher !~ '^[a-z0-9_-]+$' or p_channel is null or p_channel not in ('blocket','wayke')
   or p_available_until is null or p_available_until<=clock_timestamp() or p_available_until>clock_timestamp()+interval '5 minutes' then raise exception 'Invalid dispatcher readiness lease' using errcode='22023';end if;
  if exists(select 1 from private.advertising_dispatchers where id=p_dispatcher and channel<>p_channel) then raise exception 'Dispatcher channel binding conflict' using errcode='40001';end if;
  insert into private.advertising_dispatchers(id,channel,available_until) values(p_dispatcher,p_channel,p_available_until)
   on conflict(id) do update set available_until=excluded.available_until,updated_at=clock_timestamp();
  return jsonb_build_object('dispatcherId',p_dispatcher,'channel',p_channel,'availableUntil',p_available_until);
 end if;
 select * into j from private.advertising_jobs where id=p_job_id;
 if not found then if p_action='get' then return null;end if;raise exception 'Advertising job missing' using errcode='42501';end if;
 if p_action='get' then return private.advertising_job_json(j,true);end if;
 if p_action='claim' then
  -- Lock shared Auth account -> company -> current stock -> listing/connection/job.
  perform private.advertising_context(j.company_id,j.stock_id,j.created_by,array['owner','admin','sales'],true);
  select * into l from private.advertising_listings where id=j.listing_id for share;
  select c0.* into c from private.advertising_connections c0 join private.advertising_dispatchers d on d.id=c0.dispatcher_id and d.channel=c0.channel
   where c0.id=j.connection_id and c0.status='verified' and d.available_until>clock_timestamp() for share of c0,d;
  if c.id is null or c.company_id<>j.company_id or c.channel<>j.channel or c.version<>j.connection_version or c.account_reference<>j.account_reference or c.dispatcher_id<>j.dispatcher_id then raise exception 'Advertising connection changed' using errcode='40001';end if;
  if l.company_id<>j.company_id or l.stock_id<>j.stock_id or l.version<>j.listing_version or l.status<>'ready' or (select status from public.stock_items where id=j.stock_id)<>'available' then raise exception 'Advertising source is no longer publishable' using errcode='40001';end if;
  select coalesce(array_agg((x->>'id')::uuid order by ordinality),'{}'::uuid[]) into ids from jsonb_array_elements(j.snapshot->'photos') with ordinality a(x,ordinality);
  fresh:=private.advertising_snapshot(j.company_id,j.stock_id,j.snapshot->>'title',j.snapshot->>'description',ids,(j.snapshot->>'includeRegistrationNumber')::boolean);
  if cardinality(ids)<1 or fresh is distinct from j.snapshot then raise exception 'Advertising source snapshot changed' using errcode='40001';end if;
 end if;
 -- Match reviewed send -> job order; publication trigger reuses this transaction lock.
 perform pg_advisory_xact_lock(hashtextextended('advertising-billing:'||j.company_id::text,0));
 select * into j from private.advertising_jobs where id=p_job_id for update;
 if p_expected is null or j.version<>p_expected then raise exception 'Advertising job CAS conflict' using errcode='40001';end if;
 if p_action='claim' then
  if p_token is null or j.status not in ('queued','retryable') then raise exception 'Advertising job cannot be dispatched again' using errcode='40001';end if;
  update private.advertising_jobs set status='dispatching',version=version+1,claim_token=p_token,claim_expires_at=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() where id=j.id returning * into j;
 elsif p_action='expire' then
  if j.status<>'dispatching' or j.claim_expires_at>clock_timestamp() then raise exception 'Advertising dispatch not expired' using errcode='40001';end if;
  update private.advertising_jobs set status='outcome_unknown',version=version+1,claim_token=null,claim_expires_at=null,error_code='dispatch_lease_expired',updated_at=clock_timestamp() where id=j.id returning * into j;
 elsif p_action='save' then
  if p_status is null or not ( (j.status='dispatching' and p_status in ('outcome_unknown','submitted','published','rejected','retryable'))
   or (j.status='outcome_unknown' and p_status in ('submitted','published','rejected')) or (j.status='submitted' and p_status in ('submitted','published','rejected'))
   or (j.status in ('published','rejected') and p_status=j.status)) then raise exception 'Advertising state transition denied' using errcode='40001';end if;
  if (j.status='dispatching' and j.claim_token is distinct from p_token) or (j.status<>'dispatching' and p_token is not null) then raise exception 'Advertising claim token mismatch' using errcode='40001';end if;
  if p_provider_ad_id is not null and (length(p_provider_ad_id) not between 1 and 200 or p_provider_ad_id ~ '[[:cntrl:]]')
   or p_error_code is not null and p_error_code !~ '^[a-z0-9_]{1,100}$'
   or p_provider_url is not null and (length(p_provider_url)>2048 or p_provider_url ~ '[[:space:][:cntrl:]?#]' or
    case j.channel when 'blocket' then p_provider_url !~ '^https://(www\.)?blocket\.se/.' else p_provider_url !~ '^https://(www\.)?wayke\.se/.' end)
   or (p_status='published' and p_provider_ad_id is null) then raise exception 'Invalid advertising provider receipt' using errcode='22023';end if;
  if j.provider_ad_id is not null and p_provider_ad_id is distinct from j.provider_ad_id then raise exception 'Provider ad identity is immutable' using errcode='40001';end if;
  if j.status in ('published','rejected') then
   if j.provider_ad_id is distinct from p_provider_ad_id or j.provider_url is distinct from p_provider_url or j.error_code is distinct from p_error_code then raise exception 'Terminal advertising receipt is immutable' using errcode='40001';end if;
  elsif j.status=p_status and j.provider_ad_id is not distinct from p_provider_ad_id and j.provider_url is not distinct from p_provider_url and j.error_code is not distinct from p_error_code then null;
  else update private.advertising_jobs set status=p_status,version=version+1,claim_token=null,claim_expires_at=null,
   provider_ad_id=p_provider_ad_id,provider_url=p_provider_url,error_code=p_error_code,updated_at=clock_timestamp() where id=j.id returning * into j;end if;
 else raise exception 'Unknown worker operation' using errcode='22023';end if;
 return private.advertising_job_json(j,true);
end $$;
commit;
