-- Private advertising preparation. No partner credentials, activation or sends are seeded.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('ads-vehicle-photos','ads-vehicle-photos',false,10485760,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
do $$begin
 if not exists(select 1 from storage.buckets where id='ads-vehicle-photos' and not public and file_size_limit=10485760
  and allowed_mime_types @> array['image/jpeg','image/png','image/webp']) then raise exception 'Advertising photo bucket configuration conflict'; end if;
end $$;
-- Only a future trusted export bridge can upload to this private bucket.
-- Authenticated clients receive no export read/insert/update/delete policies.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('ads-export-media','ads-export-media',false,10485760,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
do $$begin
 if not exists(select 1 from storage.buckets where id='ads-export-media' and not public and file_size_limit=10485760
  and allowed_mime_types @> array['image/jpeg','image/png','image/webp']) then raise exception 'Advertising export bucket configuration conflict';end if;
end $$;
create table private.vehicle_photos(
 id uuid primary key,company_id uuid not null references public.companies(id),stock_id uuid not null,
 object_path text not null unique,content_type text not null check(content_type in ('image/jpeg','image/png','image/webp')),
 size_bytes bigint not null check(size_bytes between 1 and 10485760),created_by uuid not null references auth.users(id),
 status text not null default 'active' check(status in ('active','archived')),version integer not null default 1 check(version>0),
 created_at timestamptz not null default clock_timestamp(),archived_at timestamptz,
 foreign key(company_id,stock_id) references public.stock_items(company_id,id),
 check(object_path=company_id::text||'/'||stock_id::text||'/'||id::text||case content_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end)
);
create index vehicle_photos_stock_page on private.vehicle_photos(company_id,stock_id,id);
create table private.advertising_listings(
 id uuid primary key,company_id uuid not null references public.companies(id),stock_id uuid not null,
 version integer not null default 1 check(version>0),status text not null check(status in ('draft','ready')),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,stock_id) references public.stock_items(company_id,id),unique(company_id,stock_id),unique(company_id,id)
);
create table private.advertising_versions(
 company_id uuid not null,listing_id uuid not null,version integer not null check(version>0),snapshot jsonb not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),primary key(listing_id,version),
 foreign key(company_id,listing_id) references private.advertising_listings(company_id,id)
);
create table private.advertising_dispatchers(
 id text primary key check(length(id) between 1 and 100 and id ~ '^[a-z0-9_-]+$'),channel text not null check(channel in ('blocket','wayke')),
 available_until timestamptz not null default '-infinity',updated_at timestamptz not null default clock_timestamp(),unique(id,channel)
);
create table private.advertising_connections(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),channel text not null check(channel in ('blocket','wayke')),
 account_reference text not null check(length(account_reference) between 1 and 160 and account_reference=btrim(account_reference) and account_reference !~ '[[:cntrl:]]'),
 status text not null check(status in ('requested','verified','disabled')),version integer not null default 1 check(version>0),
 dispatcher_id text,created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 foreign key(dispatcher_id,channel) references private.advertising_dispatchers(id,channel),unique(company_id,channel),
 check(status<>'verified' or dispatcher_id is not null)
);
create table private.advertising_jobs(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),stock_id uuid not null,
 listing_id uuid not null,listing_version integer not null,channel text not null check(channel in ('blocket','wayke')),
 connection_id uuid not null references private.advertising_connections(id),connection_version integer not null,account_reference text not null,
 dispatcher_id text not null,created_by uuid not null references auth.users(id),snapshot jsonb not null,
 status text not null default 'queued' check(status in ('queued','dispatching','outcome_unknown','submitted','published','rejected','retryable')),
 version integer not null default 1 check(version>0),claim_token uuid,claim_expires_at timestamptz,provider_ad_id text,provider_url text,error_code text,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,stock_id) references public.stock_items(company_id,id),
 foreign key(listing_id,listing_version) references private.advertising_versions(listing_id,version),
 foreign key(dispatcher_id,channel) references private.advertising_dispatchers(id,channel),
 unique(listing_id,listing_version,channel,connection_id),check((claim_token is null)=(claim_expires_at is null)),
 check(status<>'dispatching' or claim_token is not null)
);
create table private.advertising_job_events(
 id uuid primary key default gen_random_uuid(),job_id uuid not null references private.advertising_jobs(id),
 version integer not null,from_status text,to_status text not null,provider_ad_id text,error_code text,
 worker_role text not null,created_at timestamptz not null default clock_timestamp(),unique(job_id,version)
);
create index advertising_job_events_job on private.advertising_job_events(job_id,version);
create index advertising_listings_company_page on private.advertising_listings(company_id,id);
create index advertising_jobs_company_page on private.advertising_jobs(company_id,id);
create index advertising_jobs_stock on private.advertising_jobs(company_id,stock_id,id);
create table private.advertising_audit(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),actor_user_id uuid not null references auth.users(id),
 request_id uuid not null,action text not null,payload jsonb not null,receipt jsonb not null,previous_value jsonb,current_value jsonb not null,
 created_at timestamptz not null default clock_timestamp(),unique(actor_user_id,request_id)
);
create index advertising_audit_company on private.advertising_audit(company_id,created_at desc);
do $$declare t text;begin
 foreach t in array array['vehicle_photos','advertising_listings','advertising_versions','advertising_dispatchers','advertising_connections','advertising_jobs','advertising_job_events','advertising_audit'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
create function private.advertising_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Advertising proof is immutable' using errcode='55000';end $$;
create trigger immutable_advertising_version before update or delete on private.advertising_versions for each row execute function private.advertising_immutable();
create trigger immutable_advertising_job_events before update or delete on private.advertising_job_events for each row execute function private.advertising_immutable();
create trigger immutable_advertising_audit before update or delete on private.advertising_audit for each row execute function private.advertising_immutable();
create function private.advertising_row_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Advertising record is durable' using errcode='55000';end if;
 if tg_table_name='vehicle_photos' then
  if (to_jsonb(new)-array['status','version','archived_at']) is distinct from (to_jsonb(old)-array['status','version','archived_at'])
   or old.status='archived' or new.status<>'archived' or new.version<>old.version+1 then raise exception 'Immutable photo object' using errcode='55000';end if;
 elsif tg_table_name='advertising_jobs' then
  if (to_jsonb(new)-array['status','version','claim_token','claim_expires_at','provider_ad_id','provider_url','error_code','updated_at']) is distinct from
     (to_jsonb(old)-array['status','version','claim_token','claim_expires_at','provider_ad_id','provider_url','error_code','updated_at']) then
   raise exception 'Immutable advertising job payload' using errcode='55000';end if;
 end if;
 return new;
end $$;
create trigger protect_vehicle_photo before update or delete on private.vehicle_photos for each row execute function private.advertising_row_guard();
create trigger protect_advertising_job before update or delete on private.advertising_jobs for each row execute function private.advertising_row_guard();

create function private.advertising_job_event() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' or new.version<>old.version then
  insert into private.advertising_job_events(job_id,version,from_status,to_status,provider_ad_id,error_code,worker_role)
   values(new.id,new.version,case when tg_op='INSERT' then null else old.status end,new.status,new.provider_ad_id,new.error_code,current_setting('role',true));
 end if;
 return new;
end $$;
create trigger advertising_job_state_event after insert or update on private.advertising_jobs for each row execute function private.advertising_job_event();
create function private.advertising_context(p_company uuid,p_stock uuid,p_actor uuid,p_roles text[],p_lock boolean) returns void
 language plpgsql security invoker set search_path='' as $$
declare cs text; mr text;
begin
 if p_lock then
  perform private.company_team_account(p_actor,true);
  select status into cs from public.companies where id=p_company for update;
  select role into mr from public.memberships where company_id=p_company and user_id=p_actor and status='active' for share;
 else
  select status into cs from public.companies where id=p_company;
  select role into mr from public.memberships where company_id=p_company and user_id=p_actor and status='active';
 end if;
 if cs is distinct from 'active' or mr is null or not mr=any(p_roles) then raise exception 'Advertising access denied' using errcode='42501';end if;
 if p_stock is not null then
  if p_lock then perform 1 from public.stock_items where company_id=p_company and id=p_stock for update;
  else perform 1 from public.stock_items where company_id=p_company and id=p_stock;end if;
  if not found then raise exception 'Stock access denied' using errcode='42501';end if;
 end if;
end $$;
create function private.vehicle_photo_json(p private.vehicle_photos) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('id',p.id,'companyId',p.company_id,'stockId',p.stock_id,'objectPath',p.object_path,'contentType',p.content_type,
 'sizeBytes',p.size_bytes,'version',p.version,'status',p.status,'createdAt',p.created_at,'storageBucket','ads-vehicle-photos','storageVisibility','private');
$$;
create function private.advertising_snapshot(p_company uuid,p_stock uuid,p_title text,p_description text,p_photos uuid[],p_include_registration boolean) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare v public.vehicles%rowtype;s public.stock_items%rowtype; photos jsonb;
begin
 if p_title is null or p_title<>btrim(p_title) or length(p_title) not between 1 and 160 or p_title ~ '[[:cntrl:]]'
  or p_description is null or length(p_description)>5000 or p_description ~ '[\x00-\x08\x0b\x0c\x0e-\x1f]'
  or p_include_registration is null or p_photos is null or cardinality(p_photos)>20 or array_position(p_photos,null) is not null
  or cardinality(p_photos)<>(select count(distinct x) from unnest(p_photos) x) then raise exception 'Invalid advertising fields' using errcode='22023';end if;
 perform private.advertising_photo_bucket();
 select * into s from public.stock_items where company_id=p_company and id=p_stock;
 select * into v from public.vehicles where company_id=p_company and id=s.vehicle_id for share;
 if v.id is null then raise exception 'Vehicle binding missing' using errcode='42501';end if;
 select coalesce(jsonb_agg(private.vehicle_photo_json(p) order by a.ordinality),'[]') into photos
 from unnest(p_photos) with ordinality a(id,ordinality) join private.vehicle_photos p on p.id=a.id
 where p.company_id=p_company and p.stock_id=p_stock and p.status='active';
 if jsonb_array_length(photos)<>cardinality(p_photos) then raise exception 'Photo binding denied' using errcode='42501';end if;
 return jsonb_build_object('title',p_title,'description',p_description,'priceGrossOre',s.asking_price_ore::text,'make',v.make,'model',v.model,
 'year',v.model_year,'mileageKm',v.mileage_km,'fuel',v.fuel,'transmission',v.gearbox,'photos',photos,
 'includeRegistrationNumber',p_include_registration,'registrationNumber',case when p_include_registration then v.registration_number else null end);
end $$;
create function private.advertising_listing_json(l private.advertising_listings) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('id',l.id,'companyId',l.company_id,'stockId',l.stock_id,'version',l.version,'status',l.status,'snapshot',v.snapshot,'createdAt',l.created_at,'updatedAt',l.updated_at)
 from private.advertising_versions v where v.listing_id=l.id and v.version=l.version;
$$;
create function private.advertising_job_json(j private.advertising_jobs,p_worker boolean default false) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('id',j.id,'companyId',j.company_id,'stockId',j.stock_id,'listingId',j.listing_id,'listingVersion',j.listing_version,
 'channel',j.channel,'connectionId',j.connection_id,'connectionVersion',j.connection_version,'accountReference',j.account_reference,
 'dispatcherId',j.dispatcher_id,'createdBy',j.created_by,'snapshot',j.snapshot,'status',j.status,'version',j.version,
 'claimToken',case when p_worker then j.claim_token else null end,'claimExpiresAt',j.claim_expires_at,
 'providerAdId',j.provider_ad_id,'providerUrl',j.provider_url,'errorCode',j.error_code,'createdAt',j.created_at,'updatedAt',j.updated_at);
$$;
create function private.advertising_channels(p_company uuid) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_agg(jsonb_build_object('channel',x.channel,'status',case when c.status='disabled' then 'disconnected' else coalesce(c.status,'disconnected') end,
 'accountReference',c.account_reference,'dispatcherAvailable',coalesce(c.status='verified' and d.available_until>clock_timestamp(),false)) order by x.channel)
 from (values('blocket'),('wayke')) x(channel) left join private.advertising_connections c on c.company_id=p_company and c.channel=x.channel
 left join private.advertising_dispatchers d on d.id=c.dispatcher_id and d.channel=c.channel;
$$;
create function private.advertising_photo_bucket() returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from storage.buckets where id='ads-vehicle-photos' and not public) then raise exception 'Private photo storage unavailable' using errcode='42501';end if;
end $$;

create function private.vehicle_photo_storage_access(p_name text,p_operation text) returns boolean
 language plpgsql security definer set search_path='' as $$
declare actor uuid;parts text[];cid uuid;sid uuid;
begin
 if current_setting('role',true)<>'authenticated' or auth.uid() is null or p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$' then return false;end if;
 parts:=string_to_array(p_name,'/');cid:=parts[1]::uuid;sid:=parts[2]::uuid;
 select user_id into actor from private.company_team_identity();
 perform private.advertising_photo_bucket();
 perform private.advertising_context(cid,sid,actor,case when p_operation='read' then array['owner','admin','sales','finance','viewer'] else array['owner','admin','sales'] end,false);
 if p_operation='read' then return true;
 elsif p_operation='insert' then return not exists(select 1 from private.vehicle_photos where object_path=p_name);
 else return false;end if;
exception when invalid_text_representation or insufficient_privilege then return false;
end $$;
revoke all on function private.vehicle_photo_storage_access(text,text) from public,anon,service_role;
grant execute on function private.vehicle_photo_storage_access(text,text) to authenticated;
create policy advertising_photo_read on storage.objects for select to authenticated using(bucket_id='ads-vehicle-photos' and private.vehicle_photo_storage_access(name,'read'));
create policy advertising_photo_insert on storage.objects for insert to authenticated with check(bucket_id='ads-vehicle-photos' and private.vehicle_photo_storage_access(name,'insert'));
-- No authenticated DELETE policy: retaining private orphans avoids a register/delete race.

create function private.advertising_read(p_action text,p_company uuid,p_stock uuid,p_id uuid,p_page uuid,p_jobs_page uuid,p_limit integer)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;items jsonb;jobs jsonb;channels jsonb;next_key uuid;next_jobs uuid;l private.advertising_listings%rowtype;photo private.vehicle_photos%rowtype;
begin
 select user_id into actor from private.company_team_identity();
 perform private.advertising_context(p_company,p_stock,actor,array['owner','admin','sales','finance','viewer'],false);
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Limit must be 1..50' using errcode='22023';end if;
 if p_action in ('photos','photo') then
  perform private.advertising_photo_bucket();
  if p_action='photo' then select * into photo from private.vehicle_photos where company_id=p_company and id=p_id;
   if not found then return null;end if;return private.vehicle_photo_json(photo);end if;
  select coalesce(jsonb_agg(private.vehicle_photo_json(x) order by x.id),'[]') into items from (select * from private.vehicle_photos
   where company_id=p_company and stock_id=p_stock and status='active' and (p_page is null or id>p_page) order by id limit p_limit+1)x;
 elsif p_action='stock' then
  select coalesce(jsonb_agg(j order by id),'[]') into items from (select s.id,jsonb_build_object('id',s.id,'make',v.make,'model',v.model,'year',v.model_year,'priceGrossOre',s.asking_price_ore::text,'status',s.status) j
   from public.stock_items s join public.vehicles v on v.company_id=s.company_id and v.id=s.vehicle_id
   where s.company_id=p_company and s.status='available' and (p_page is null or s.id>p_page) order by s.id limit p_limit+1)x;
 else
  channels:=private.advertising_channels(p_company);
  select coalesce(jsonb_agg(private.advertising_job_json(x) order by x.id),'[]') into jobs from (select * from private.advertising_jobs
   where company_id=p_company and (p_stock is null or stock_id=p_stock) and (p_jobs_page is null or id>p_jobs_page) order by id limit p_limit+1)x;
  if jsonb_array_length(jobs)>p_limit then next_jobs:=(jobs->(p_limit-1)->>'id')::uuid;jobs:=jobs-p_limit;end if;
  if p_action='one' then select * into l from private.advertising_listings where company_id=p_company and stock_id=p_stock;
   return jsonb_build_object('listing',case when l.id is null then null else private.advertising_listing_json(l) end,'jobs',jobs,'channels',channels);end if;
  if p_action<>'list' then raise exception 'Unknown advertising read' using errcode='22023';end if;
  select coalesce(jsonb_agg(private.advertising_listing_json(x) order by x.id),'[]') into items from(select * from private.advertising_listings
   where company_id=p_company and (p_page is null or id>p_page) order by id limit p_limit+1)x;
 end if;
 if jsonb_array_length(items)>p_limit then next_key:=(items->(p_limit-1)->>'id')::uuid;items:=items-p_limit;end if;
 return case p_action when 'photos' then jsonb_build_object('photos',items,'nextPageKey',next_key)
  when 'stock' then jsonb_build_object('stock',items,'nextPageKey',next_key)
  else jsonb_build_object('listings',items,'jobs',jobs,'channels',channels,'nextPageKey',next_key,'nextJobsPageKey',next_jobs) end;
end $$;

create function private.advertising_mutate(p_action text,p_company uuid,p_payload jsonb,p_request uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid;sid uuid;lid uuid;expected integer;payload jsonb;receipt jsonb;prior jsonb;old_value jsonb;
 l private.advertising_listings%rowtype;p private.vehicle_photos%rowtype;o storage.objects%rowtype;c private.advertising_connections%rowtype;j private.advertising_jobs%rowtype;
 snap jsonb;ids uuid[];v_channel text;channels text[];queued jsonb:='[]';ext text;path text;mime text;bytes bigint;
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
     queued:=queued||jsonb_build_array(private.advertising_job_json(j));
    end loop;
    receipt:=jsonb_build_object('status','queued','jobs',queued,'listing',private.advertising_listing_json(l));
   end if;
  else raise exception 'Unknown advertising mutation' using errcode='22023';end if;
 end if;
 receipt:=receipt||jsonb_build_object('actorUserId',actor,'requestId',p_request);
 insert into private.advertising_audit(company_id,actor_user_id,request_id,action,payload,receipt,previous_value,current_value)
 values(p_company,actor,p_request,p_action,payload,receipt,old_value,coalesce(snap,receipt));return receipt;
exception when unique_violation then raise exception 'Advertising request conflict' using errcode='40001';
end $$;

create function public.list_vehicle_photos(p_company_id uuid,p_stock_id uuid,p_page_key uuid default null,p_limit integer default 50) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_read('photos',p_company_id,p_stock_id,null,p_page_key,null,p_limit);$$;
revoke all on function public.list_vehicle_photos(uuid,uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.list_vehicle_photos(uuid,uuid,uuid,integer) to authenticated;

create function public.get_vehicle_photo(p_company_id uuid,p_photo_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_read('photo',p_company_id,null,p_photo_id,null,null,50);$$;
revoke all on function public.get_vehicle_photo(uuid,uuid) from public,anon,service_role;
grant execute on function public.get_vehicle_photo(uuid,uuid) to authenticated;

create function public.list_advertising_stock(p_company_id uuid,p_page_key uuid default null,p_limit integer default 50) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_read('stock',p_company_id,null,null,p_page_key,null,p_limit);$$;
revoke all on function public.list_advertising_stock(uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.list_advertising_stock(uuid,uuid,integer) to authenticated;

create function public.get_stock_advertising(p_company_id uuid,p_stock_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_read('one',p_company_id,p_stock_id,null,null,null,50);$$;
revoke all on function public.get_stock_advertising(uuid,uuid) from public,anon,service_role;
grant execute on function public.get_stock_advertising(uuid,uuid) to authenticated;

create function public.list_company_advertising(p_company_id uuid,p_page_key uuid default null,p_jobs_page_key uuid default null,p_limit integer default 50) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_read('list',p_company_id,null,null,p_page_key,p_jobs_page_key,p_limit);$$;
revoke all on function public.list_company_advertising(uuid,uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.list_company_advertising(uuid,uuid,uuid,integer) to authenticated;

create function public.register_vehicle_photo(p_company_id uuid,p_stock_id uuid,p_photo_id uuid,p_object_path text,p_content_type text,p_size_bytes bigint,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_mutate('photo_register',p_company_id,jsonb_build_object('stockId',p_stock_id,'photoId',p_photo_id,'objectPath',p_object_path,'contentType',p_content_type,'sizeBytes',p_size_bytes),p_request_id);$$;
revoke all on function public.register_vehicle_photo(uuid,uuid,uuid,text,text,bigint,uuid) from public,anon,service_role;
grant execute on function public.register_vehicle_photo(uuid,uuid,uuid,text,text,bigint,uuid) to authenticated;

create function public.archive_vehicle_photo(p_company_id uuid,p_photo_id uuid,p_expected_version integer,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_mutate('photo_archive',p_company_id,jsonb_build_object('photoId',p_photo_id,'expectedVersion',p_expected_version),p_request_id);$$;
revoke all on function public.archive_vehicle_photo(uuid,uuid,integer,uuid) from public,anon,service_role;
grant execute on function public.archive_vehicle_photo(uuid,uuid,integer,uuid) to authenticated;

create function public.save_vehicle_advertisement(p_company_id uuid,p_stock_id uuid,p_listing_id uuid,p_expected_version integer,p_title text,p_description text,p_photo_ids uuid[],p_include_registration_number boolean,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_mutate('save',p_company_id,jsonb_build_object('stockId',p_stock_id,'listingId',p_listing_id,'expectedVersion',p_expected_version,'title',p_title,'description',p_description,'photoIds',p_photo_ids,'includeRegistrationNumber',p_include_registration_number),p_request_id);$$;
revoke all on function public.save_vehicle_advertisement(uuid,uuid,uuid,integer,text,text,uuid[],boolean,uuid) from public,anon,service_role;
grant execute on function public.save_vehicle_advertisement(uuid,uuid,uuid,integer,text,text,uuid[],boolean,uuid) to authenticated;

create function public.mark_vehicle_advertisement_ready(p_company_id uuid,p_listing_id uuid,p_expected_version integer,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_mutate('ready',p_company_id,jsonb_build_object('listingId',p_listing_id,'expectedVersion',p_expected_version),p_request_id);$$;
revoke all on function public.mark_vehicle_advertisement_ready(uuid,uuid,integer,uuid) from public,anon,service_role;
grant execute on function public.mark_vehicle_advertisement_ready(uuid,uuid,integer,uuid) to authenticated;

create function public.send_vehicle_advertisement(p_company_id uuid,p_listing_id uuid,p_expected_version integer,p_channels text[],p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_mutate('send',p_company_id,jsonb_build_object('listingId',p_listing_id,'expectedVersion',p_expected_version,'channels',p_channels),p_request_id);$$;
revoke all on function public.send_vehicle_advertisement(uuid,uuid,integer,text[],uuid) from public,anon,service_role;
grant execute on function public.send_vehicle_advertisement(uuid,uuid,integer,text[],uuid) to authenticated;

create function public.request_advertising_connection(p_company_id uuid,p_channel text,p_account_reference text,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_mutate('connection',p_company_id,jsonb_build_object('channel',p_channel,'accountReference',p_account_reference),p_request_id);$$;
revoke all on function public.request_advertising_connection(uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.request_advertising_connection(uuid,text,text,uuid) to authenticated;

revoke all on function private.advertising_read(text,uuid,uuid,uuid,uuid,uuid,integer),private.advertising_mutate(text,uuid,jsonb,uuid) from public,anon,service_role;
grant execute on function private.advertising_read(text,uuid,uuid,uuid,uuid,uuid,integer),private.advertising_mutate(text,uuid,jsonb,uuid) to authenticated;

-- Service workers have narrow RPC access, not direct private-table grants.
-- Available dispatcher registration is a short trusted readiness lease, not a
-- client flag. No dispatcher/connection is provisioned by this migration.
create function private.advertising_worker(p_action text,p_job_id uuid,p_expected integer,p_token uuid,p_status text,p_provider_ad_id text,p_provider_url text,p_error_code text,p_dispatcher text,p_channel text,p_available_until timestamptz)
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
revoke all on function private.advertising_worker(text,uuid,integer,uuid,text,text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.advertising_worker(text,uuid,integer,uuid,text,text,text,text,text,text,timestamptz) to service_role;
create function public.get_advertising_job(p_job_id uuid) returns jsonb language sql security invoker set search_path='' as $$
 select private.advertising_worker('get',p_job_id,null,null,null,null,null,null,null,null,null);$$;
create function public.claim_advertising_job(p_job_id uuid,p_expected_version integer,p_claim_token uuid) returns jsonb language sql security invoker set search_path='' as $$
 select private.advertising_worker('claim',p_job_id,p_expected_version,p_claim_token,null,null,null,null,null,null,null);$$;
create function public.expire_advertising_dispatch(p_job_id uuid,p_expected_version integer) returns jsonb language sql security invoker set search_path='' as $$
 select private.advertising_worker('expire',p_job_id,p_expected_version,null,null,null,null,null,null,null,null);$$;
create function public.save_advertising_job(p_job_id uuid,p_expected_version integer,p_claim_token uuid,p_status text,p_provider_ad_id text default null,p_provider_url text default null,p_error_code text default null) returns jsonb language sql security invoker set search_path='' as $$
 select private.advertising_worker('save',p_job_id,p_expected_version,p_claim_token,p_status,p_provider_ad_id,p_provider_url,p_error_code,null,null,null);$$;
create function public.refresh_advertising_dispatcher(p_dispatcher_id text,p_channel text,p_available_until timestamptz) returns jsonb language sql security invoker set search_path='' as $$
 select private.advertising_worker('refresh',null,null,null,null,null,null,null,p_dispatcher_id,p_channel,p_available_until);$$;
do $$declare name text;begin
 foreach name in array array['get_advertising_job(uuid)','claim_advertising_job(uuid,integer,uuid)','expire_advertising_dispatch(uuid,integer)',
  'save_advertising_job(uuid,integer,uuid,text,text,text,text)','refresh_advertising_dispatcher(text,text,timestamptz)'] loop
  execute 'revoke all on function public.'||name||' from public,anon,authenticated';
  execute 'grant execute on function public.'||name||' to service_role';
 end loop;
end $$;
revoke all on function private.advertising_immutable(),private.advertising_row_guard(),private.advertising_job_event(),private.advertising_context(uuid,uuid,uuid,text[],boolean),
 private.vehicle_photo_json(private.vehicle_photos),private.advertising_snapshot(uuid,uuid,text,text,uuid[],boolean),
 private.advertising_listing_json(private.advertising_listings),private.advertising_job_json(private.advertising_jobs,boolean),
 private.advertising_channels(uuid),private.advertising_photo_bucket() from public,anon,authenticated,service_role;
commit;
