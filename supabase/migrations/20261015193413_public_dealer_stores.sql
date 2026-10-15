-- Explicit opt-in public contact/store snapshots. Existing dealers remain private.
begin;
create table private.public_dealer_stores(
 company_id uuid primary key references public.companies(id),slug text not null unique,
 version integer not null check(version>0),status text not null check(status in('published','unpublished')),
 profile_version integer not null check(profile_version>0),selected_listings jsonb not null,
 snapshot jsonb not null,published_at timestamptz not null,updated_at timestamptz not null,
 check(slug~'^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),check(jsonb_typeof(selected_listings)='array' and jsonb_array_length(selected_listings)<=50)
);
create table private.public_dealer_store_versions(
 company_id uuid not null references public.companies(id),version integer not null,record jsonb not null,
 primary key(company_id,version)
);
create table private.public_dealer_store_audit(
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,company_id uuid not null references public.companies(id),
 payload jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(actor_user_id,request_id)
);
alter table private.public_dealer_stores enable row level security;
alter table private.public_dealer_store_versions enable row level security;
alter table private.public_dealer_store_audit enable row level security;
revoke all on private.public_dealer_stores,private.public_dealer_store_versions,private.public_dealer_store_audit from public,anon,authenticated,service_role;
create trigger immutable_public_store_versions before update or delete on private.public_dealer_store_versions for each row execute function private.reject_company_team_audit_mutation();
create trigger immutable_public_store_audit before update or delete on private.public_dealer_store_audit for each row execute function private.reject_company_team_audit_mutation();
create function private.public_store_guard()returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then raise exception 'Public store history cannot be deleted' using errcode='55000';end if;
 if new.company_id<>old.company_id or new.slug<>old.slug or new.version<>old.version+1 then raise exception 'Public store identity immutable' using errcode='55000';end if;return new;
end$$;
create trigger public_store_guard before update or delete on private.public_dealer_stores for each row execute function private.public_store_guard();
create function private.public_store_json(s private.public_dealer_stores)returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('slug',s.slug,'version',s.version,'status',s.status,'profileVersion',s.profile_version,'publishedAt',s.published_at,'updatedAt',s.updated_at,'selectedListings',s.selected_listings);
$$;
-- Compare complete current source privately; no registration number or internal metadata
-- is returned. Missing/archived photos and changed vehicle/price data fail closed.
create function private.public_store_listing_live(p_company uuid,p_listing uuid,p_version integer)returns boolean language plpgsql stable security invoker set search_path='' as $$
declare l private.advertising_listings;v private.advertising_versions;ids uuid[];fresh jsonb;
begin
 select *into l from private.advertising_listings where company_id=p_company and id=p_listing and version=p_version and status='ready';
 if l.id is null or not exists(select 1 from public.stock_items where company_id=p_company and id=l.stock_id and status='available')then return false;end if;
 select *into v from private.advertising_versions where company_id=p_company and listing_id=l.id and version=p_version;
 select coalesce(array_agg((x->>'id')::uuid order by ord),'{}'::uuid[])into ids from jsonb_array_elements(v.snapshot->'photos')with ordinality a(x,ord);
 if cardinality(ids)<1 then return false;end if;
 fresh:=private.advertising_snapshot(p_company,l.stock_id,v.snapshot->>'title',v.snapshot->>'description',ids,(v.snapshot->>'includeRegistrationNumber')::boolean);
 return fresh=v.snapshot;
 exception when others then return false;
end$$;
create function private.get_company_public_store(p_company_id uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;s private.public_dealer_stores;
begin select user_id into a from private.company_team_identity(true);perform 1 from public.companies where id=p_company_id for share;r:=private.company_team_manager(p_company_id,a,false);
 select *into s from private.public_dealer_stores where company_id=p_company_id;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'store',case when s.company_id is null then null else private.public_store_json(s)end);end$$;
create function private.mutate_public_store(p_action text,p_company uuid,p_slug text,p_expected integer,p_profile integer,p_listings jsonb,p_ack boolean,p_request uuid)returns jsonb language plpgsql security invoker set search_path='' as $$
declare a uuid;r text;s private.public_dealer_stores;prior private.public_dealer_store_audit;payload jsonb;receipt jsonb;profile private.company_store_profile_versions;
 h private.company_store_profile_heads;c public.companies;selected jsonb:='[]';items jsonb:='[]';shop jsonb;entry jsonb;lid uuid;lv integer;snap jsonb;photos jsonb;stamp timestamptz;
begin
 select user_id into a from private.company_team_identity(true);
 if p_request is null then raise exception 'Request required'using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('public_store:'||a::text||':'||p_request::text,0));
 r:=private.company_team_manager(p_company,a);
 if p_ack is distinct from true or p_expected is null or p_expected<0 or p_action not in('publish','unpublish')then raise exception 'Invalid public store review'using errcode='22023';end if;
 payload:=jsonb_build_object('action',p_action,'companyId',p_company,'slug',p_slug,'expectedVersion',p_expected,'profileVersion',p_profile,'listings',p_listings,'acknowledged',p_ack);
 select *into prior from private.public_dealer_store_audit where actor_user_id=a and request_id=p_request;
 if found then if prior.payload is distinct from payload then raise exception 'Public store request conflict'using errcode='40001';end if;return prior.receipt;end if;
 select *into s from private.public_dealer_stores where company_id=p_company for update;
 if coalesce(s.version,0)<>p_expected then raise exception 'Public store version conflict'using errcode='40001';end if;
 stamp:=clock_timestamp();
 if p_action='publish' then
 if p_slug is null or p_slug!~'^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' or p_slug in('api','admin','dashboard','login','register','settings','onboarding','privacy','terms','demo','invitations','butik','butiker','stores','trafexa','www','support','help','auth','account','billing') or p_profile is null or p_profile<1
 or p_listings is null or jsonb_typeof(p_listings)<>'array' or jsonb_array_length(p_listings)>50 then raise exception 'Invalid public store selection'using errcode='22023';end if;
 if s.company_id is not null and s.slug<>p_slug then raise exception 'Public slug immutable'using errcode='40001';end if;
 select *into c from public.companies where id=p_company;
 if not private.company_store_identity_valid(c.organisation_number)then raise exception 'Company identity invalid'using errcode='22023';end if;
 select *into h from private.company_store_profile_heads where company_id=p_company for share;
 if h.profile_version is distinct from p_profile then raise exception 'Profile version conflict'using errcode='40001';end if;
 select *into profile from private.company_store_profile_versions where company_id=p_company and id=h.profile_id and version=p_profile;
 if profile.id is null then raise exception 'Profile required'using errcode='40001';end if;
 -- Lock all selected source entities in canonical order. These locks are shared
 -- with advertising source mutations; the company lock serializes other managers.
 for entry in select value from jsonb_array_elements(p_listings)loop
 if jsonb_typeof(entry)<>'object' or not(entry?&array['listingId','version'])or entry-array['listingId','version']<>'{}'::jsonb or jsonb_typeof(entry->'listingId')<>'string' or coalesce(entry->>'listingId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'or jsonb_typeof(entry->'version')<>'number' or coalesce(entry->>'version','')!~'^[1-9][0-9]{0,9}$' then raise exception 'Invalid listing selection'using errcode='22023';end if;
 if (entry->>'version')::numeric>2147483647 then raise exception 'Invalid listing version'using errcode='22023';end if;
 end loop;
 if (select count(distinct (value->>'listingId')::uuid)from jsonb_array_elements(p_listings))<>jsonb_array_length(p_listings)then raise exception 'Duplicate selected listing'using errcode='22023';end if;
 perform 1 from public.stock_items st join private.advertising_listings l on l.company_id=st.company_id and l.stock_id=st.id where l.company_id=p_company and l.id in(select (value->>'listingId')::uuid from jsonb_array_elements(p_listings))order by st.id for share of st;
 perform 1 from public.vehicles v join public.stock_items st on st.company_id=v.company_id and st.vehicle_id=v.id join private.advertising_listings l on l.company_id=st.company_id and l.stock_id=st.id where l.company_id=p_company and l.id in(select (value->>'listingId')::uuid from jsonb_array_elements(p_listings))order by v.id for share of v;
 perform 1 from private.advertising_listings l where l.company_id=p_company and l.id in(select (value->>'listingId')::uuid from jsonb_array_elements(p_listings))order by l.id for share;
 perform 1 from private.vehicle_photos p join private.advertising_listings l on l.company_id=p.company_id and l.stock_id=p.stock_id where l.company_id=p_company and l.id in(select (value->>'listingId')::uuid from jsonb_array_elements(p_listings))order by p.id for share of p;
 for entry in select value from jsonb_array_elements(p_listings)order by (value->>'listingId')::uuid loop
 lid:=(entry->>'listingId')::uuid;lv:=(entry->>'version')::integer;
 if not private.public_store_listing_live(p_company,lid,lv)then raise exception 'Selected advertising source conflict'using errcode='40001';end if;
 select snapshot into snap from private.advertising_versions where company_id=p_company and listing_id=lid and version=lv;
 select coalesce(jsonb_agg(jsonb_build_object('id',x->>'id')order by ord),'[]')into photos from jsonb_array_elements(snap->'photos')with ordinality a(x,ord);
 items:=items||jsonb_build_array(jsonb_build_object('id',lid,'version',lv,'title',snap->>'title','description',snap->>'description','priceOre',snap->>'priceGrossOre','currency','SEK','make',snap->>'make','model',snap->>'model','year',snap->'year','mileageKm',snap->'mileageKm','fuel',snap->'fuel','transmission',snap->'transmission','photos',photos));
 selected:=selected||jsonb_build_array(jsonb_build_object('listingId',lid,'version',lv));
 end loop;
 -- profile.fields has exactly the validated public-contact schema, but enumerate
 -- every key here so later private fields can never enter publication implicitly.
 shop:=jsonb_build_object('legalName',c.name,'organisationNumber',c.organisation_number,
 'displayName',profile.fields->'displayName','addressLine1',profile.fields->'addressLine1','addressLine2',profile.fields->'addressLine2',
 'postalCode',profile.fields->'postalCode','city',profile.fields->'city','countryCode',profile.fields->'countryCode',
 'publicEmail',profile.fields->'publicEmail','publicPhone',profile.fields->'publicPhone','websiteUrl',profile.fields->'websiteUrl',
 'logoUrl',profile.fields->'logoUrl','description',profile.fields->'description','openingHoursText',profile.fields->'openingHoursText');
 if s.company_id is null then insert into private.public_dealer_stores(company_id,slug,version,status,profile_version,selected_listings,snapshot,published_at,updated_at)values(p_company,p_slug,1,'published',p_profile,selected,jsonb_build_object('shop',shop,'listings',items),stamp,stamp)returning *into s;
 else update private.public_dealer_stores set version=version+1,status='published',profile_version=p_profile,selected_listings=selected,snapshot=jsonb_build_object('shop',shop,'listings',items),published_at=stamp,updated_at=stamp where company_id=p_company returning *into s;end if;
 else
 if s.company_id is null or s.status<>'published'then raise exception 'Public store status conflict'using errcode='40001';end if;
 update private.public_dealer_stores set version=version+1,status='unpublished',updated_at=stamp where company_id=p_company returning *into s;
 end if;
 receipt:=jsonb_build_object('companyId',p_company,'actorUserId',a,'requestId',p_request,'action',p_action,'store',private.public_store_json(s));
 insert into private.public_dealer_store_versions(company_id,version,record)values(p_company,s.version,to_jsonb(s));
 insert into private.public_dealer_store_audit(actor_user_id,request_id,company_id,payload,receipt)values(a,p_request,p_company,payload,receipt);return receipt;
 exception when unique_violation then raise exception 'Public store slug or nonce conflict'using errcode='40001';
end$$;
create function private.publish_company_public_store(p_company_id uuid,p_slug text,p_expected_version integer,p_profile_version integer,p_listings jsonb,p_acknowledged boolean,p_request_id uuid)returns jsonb language sql security definer set search_path='' as $$select private.mutate_public_store('publish',p_company_id,p_slug,p_expected_version,p_profile_version,p_listings,p_acknowledged,p_request_id)$$;
create function private.unpublish_company_public_store(p_company_id uuid,p_expected_version integer,p_acknowledged boolean,p_request_id uuid)returns jsonb language sql security definer set search_path='' as $$select private.mutate_public_store('unpublish',p_company_id,null,p_expected_version,null,null,p_acknowledged,p_request_id)$$;
create function private.get_public_dealer_store(p_slug text)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s private.public_dealer_stores;items jsonb;
begin
 select st.*into s from private.public_dealer_stores st join public.companies c on c.id=st.company_id and c.status='active' where st.slug=p_slug and st.status='published' and c.name=st.snapshot->'shop'->>'legalName' and c.organisation_number=st.snapshot->'shop'->>'organisationNumber';
 if s.company_id is null then return null;end if;
 select coalesce(jsonb_agg(x order by x->>'id'),'[]')into items from jsonb_array_elements(s.snapshot->'listings')x where private.public_store_listing_live(s.company_id,(x->>'id')::uuid,(x->>'version')::integer);
 return jsonb_build_object('slug',s.slug,'version',s.version,'publishedAt',s.published_at,'shop',s.snapshot->'shop','listings',items);
end$$;
create function private.get_public_store_photo(p_slug text,p_photo_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare page jsonb;p private.vehicle_photos;
begin
 page:=private.get_public_dealer_store(p_slug);
 if page is null or not exists(select 1 from jsonb_array_elements(page->'listings')l,jsonb_array_elements(l->'photos')photo where photo->>'id'=p_photo_id::text)then return null;end if;
 select *into p from private.vehicle_photos where id=p_photo_id and status='active';
 if p.id is null then return null;end if;
 return jsonb_build_object('objectPath',p.object_path,'contentType',p.content_type,'sizeBytes',p.size_bytes);
end$$;
create function private.public_store_photo_access(p_name text)returns boolean language plpgsql stable security definer set search_path='' as $$
declare slug text;pid uuid;
begin
 select s.slug,p.id into slug,pid from private.vehicle_photos p join private.public_dealer_stores s on s.company_id=p.company_id where p.object_path=p_name and p.status='active' and s.status='published';
 return slug is not null and private.get_public_store_photo(slug,pid)is not null;
end$$;
revoke all on function private.public_store_guard(),private.public_store_json(private.public_dealer_stores),private.public_store_listing_live(uuid,uuid,integer),private.mutate_public_store(text,uuid,text,integer,integer,jsonb,boolean,uuid)from public,anon,authenticated,service_role;
revoke all on function private.get_company_public_store(uuid),private.publish_company_public_store(uuid,text,integer,integer,jsonb,boolean,uuid),private.unpublish_company_public_store(uuid,integer,boolean,uuid)from public,anon,authenticated,service_role;
grant execute on function private.get_company_public_store(uuid),private.publish_company_public_store(uuid,text,integer,integer,jsonb,boolean,uuid),private.unpublish_company_public_store(uuid,integer,boolean,uuid)to authenticated;
revoke all on function private.get_public_dealer_store(text),private.get_public_store_photo(text,uuid),private.public_store_photo_access(text)from public,anon,authenticated,service_role;
grant execute on function private.get_public_dealer_store(text),private.get_public_store_photo(text,uuid),private.public_store_photo_access(text)to anon,authenticated;
create function public.get_company_public_store(p_company_id uuid)returns jsonb language sql security invoker set search_path='' as $$select private.get_company_public_store(p_company_id)$$;
create function public.publish_company_public_store(p_company_id uuid,p_slug text,p_expected_version integer,p_profile_version integer,p_listings jsonb,p_acknowledged boolean,p_request_id uuid)returns jsonb language sql security invoker set search_path='' as $$select private.publish_company_public_store(p_company_id,p_slug,p_expected_version,p_profile_version,p_listings,p_acknowledged,p_request_id)$$;
create function public.unpublish_company_public_store(p_company_id uuid,p_expected_version integer,p_acknowledged boolean,p_request_id uuid)returns jsonb language sql security invoker set search_path='' as $$select private.unpublish_company_public_store(p_company_id,p_expected_version,p_acknowledged,p_request_id)$$;
create function public.get_public_dealer_store(p_slug text)returns jsonb language sql security invoker set search_path='' as $$select private.get_public_dealer_store(p_slug)$$;
create function public.get_public_store_photo(p_slug text,p_photo_id uuid)returns jsonb language sql security invoker set search_path='' as $$select private.get_public_store_photo(p_slug,p_photo_id)$$;
revoke all on function public.get_company_public_store(uuid),public.publish_company_public_store(uuid,text,integer,integer,jsonb,boolean,uuid),public.unpublish_company_public_store(uuid,integer,boolean,uuid)from public,anon,authenticated,service_role;
grant execute on function public.get_company_public_store(uuid),public.publish_company_public_store(uuid,text,integer,integer,jsonb,boolean,uuid),public.unpublish_company_public_store(uuid,integer,boolean,uuid)to authenticated;
revoke all on function public.get_public_dealer_store(text),public.get_public_store_photo(text,uuid)from public,anon,authenticated,service_role;
grant execute on function public.get_public_dealer_store(text),public.get_public_store_photo(text,uuid)to anon,authenticated;
grant usage on schema storage to anon;
grant select on storage.objects to anon;
create policy public_store_selected_photo on storage.objects for select to anon,authenticated using(bucket_id='ads-vehicle-photos'and private.public_store_photo_access(name));
commit;
