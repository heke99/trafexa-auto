-- Bootstrap only the immutable offer archive, not the experimental external
-- signing ledger. Hosted deployments intentionally lack both old prototypes.
begin;
do $prerequisite$
begin
 if not exists(select 1 from pg_constraint c where c.conrelid='public.documents'::regclass and c.contype in('u','p')
  and c.conkey=array[(select attnum from pg_attribute where attrelid='public.documents'::regclass and attname='company_id'),(select attnum from pg_attribute where attrelid='public.documents'::regclass and attname='id')]::smallint[])then
  alter table public.documents add constraint documents_company_id_id_archive_key unique(company_id,id);
 end if;
 if to_regclass('public.offer_document_archives')is null then
  execute $archive$


create table public.offer_document_archives (
 company_id uuid not null references public.companies(id),
 offer_id uuid not null,
 deal_id uuid not null,
 offer_version integer not null check(offer_version>0),
 pdf_sha256 text not null check(pdf_sha256 ~ '^[0-9a-f]{64}$'),
 snapshot_sha256 text not null check(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
 object_path text not null unique,
 document_id uuid not null unique,
 document_name text not null,
 document_kind text not null default 'other' check(document_kind='other'),
 storage_bucket text not null default 'dealer-documents' check(storage_bucket='dealer-documents'),
 submission_id uuid not null,
 archived_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 primary key(company_id,offer_id),
 foreign key(company_id,offer_id) references public.offers(company_id,id),
 foreign key(company_id,deal_id) references public.deals(company_id,id),
 foreign key(company_id,document_id) references public.documents(company_id,id),
 check(object_path=company_id::text||'/offers/'||offer_id::text||'/v'||offer_version::text||'/'||pdf_sha256||'.pdf')
);
create index offer_document_archives_deal_idx on public.offer_document_archives(company_id,deal_id);
create index offer_document_archives_document_idx on public.offer_document_archives(company_id,document_id);
create index offer_document_archives_actor_idx on public.offer_document_archives(archived_by);
alter table public.offer_document_archives enable row level security;
revoke all on public.offer_document_archives from public,anon,authenticated,service_role;
grant select on public.offer_document_archives to authenticated;
create policy offer_archives_read on public.offer_document_archives for select to authenticated
 using(private.has_company_role(company_id,array['owner','admin','finance']));

create function private.reject_offer_archive_mutation() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 raise exception 'Offer archive metadata is immutable' using errcode='55000';
end $$;
revoke all on function private.reject_offer_archive_mutation() from public,anon,authenticated,service_role;
create trigger immutable_offer_archive before update or delete on public.offer_document_archives
 for each row execute function private.reject_offer_archive_mutation();

-- Preserve the linked document's identity too, even if a later migration adds
-- document UPDATE grants. The authoritative offers snapshot already is immutable.
create function private.protect_offer_archive_document() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if tg_table_schema<>'public' or tg_table_name<>'documents' or tg_level<>'ROW' or tg_op not in ('UPDATE','DELETE') then
  raise exception 'Invalid offer document guard context' using errcode='42501'; end if;
 if current_setting('role',true)='authenticated' and auth.uid() is null then
  raise exception 'Authentication required' using errcode='42501'; end if;
 if exists(select 1 from public.offer_document_archives a where a.document_id=old.id) then
  raise exception 'Archived offer document is immutable' using errcode='55000';
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function private.protect_offer_archive_document() from public,anon,authenticated,service_role;
create trigger immutable_archived_offer_document before update or delete on public.documents
 for each row execute function private.protect_offer_archive_document();

-- A narrow privacy receipt for this company. No catalog rows are exposed.
create function private.require_private_offer_archive_bucket(p_company_id uuid) returns void
 language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true) is distinct from 'authenticated' or auth.uid() is null
  or not private.has_company_role(p_company_id,array['owner','admin','finance']) then
  raise exception 'Offer archive authorization denied' using errcode='42501'; end if;
 if not exists(select 1 from storage.buckets where id='dealer-documents' and public=false) then
  raise exception 'Private document bucket required' using errcode='42501'; end if;
end $$;
revoke all on function private.require_private_offer_archive_bucket(uuid) from public,anon,service_role;
grant execute on function private.require_private_offer_archive_bucket(uuid) to authenticated;

-- SHA-256 uses PostgreSQL's deterministic jsonb text representation. The server
-- uses this returned digest unchanged; it must not guess JS/JSON key formatting.
create function public.get_offer_archive_source(p_company_id uuid,p_offer_id uuid) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare o public.offers; result jsonb;
begin
 if current_user<>'authenticated' or auth.uid() is null or not private.has_company_role(p_company_id,array['owner','admin','finance']) then
  raise exception 'Offer archive authorization denied' using errcode='42501'; end if;
 perform private.require_private_offer_archive_bucket(p_company_id);
 select * into o from public.offers where company_id=p_company_id and id=p_offer_id;
 if not found then raise exception 'Offer unavailable' using errcode='P0002'; end if;
 if o.snapshot->>'document_type' is distinct from 'offer' or o.snapshot->'schema_version' is distinct from to_jsonb(1)
  or o.snapshot->'version' is distinct from to_jsonb(o.version) or o.snapshot->>'deal_id' is distinct from o.deal_id::text
  or o.snapshot#>>'{company,id}' is distinct from o.company_id::text
  or o.snapshot->>'currency' is distinct from 'SEK' or o.snapshot->>'price_basis' is distinct from 'gross'
  or length(coalesce(o.snapshot#>>'{vehicle,registration_number}','')) not between 2 and 15 then
  raise exception 'Invalid immutable offer identity' using errcode='23514'; end if;
 result:=jsonb_build_object('company_id',o.company_id,'offer_id',o.id,'deal_id',o.deal_id,'offer_version',o.version,
  'snapshot',o.snapshot,'snapshot_sha256',encode(sha256(convert_to(o.snapshot::text,'UTF8')),'hex'),
  'document_name','Offert v'||o.version::text||' – '||(o.snapshot#>>'{vehicle,registration_number}'),'document_kind','other',
  'storage_bucket','dealer-documents','storage_visibility','private');
 return result;
end $$;
revoke all on function public.get_offer_archive_source(uuid,uuid) from public,anon,service_role;
grant execute on function public.get_offer_archive_source(uuid,uuid) to authenticated;

create function public.get_offer_document_archive(p_company_id uuid,p_offer_id uuid) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if current_user<>'authenticated' or auth.uid() is null or not private.has_company_role(p_company_id,array['owner','admin','finance']) then
  raise exception 'Offer archive authorization denied' using errcode='42501'; end if;
 perform private.require_private_offer_archive_bucket(p_company_id);
 select to_jsonb(a)||jsonb_build_object('storage_visibility','private') into result from public.offer_document_archives a where company_id=p_company_id and offer_id=p_offer_id;
 return result;
end $$;
revoke all on function public.get_offer_document_archive(uuid,uuid) from public,anon,service_role;
grant execute on function public.get_offer_document_archive(uuid,uuid) to authenticated;

create function public.get_offer_archive_by_document(p_company_id uuid,p_document_id uuid) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if current_user<>'authenticated' or auth.uid() is null or not private.has_company_role(p_company_id,array['owner','admin','finance']) then
  raise exception 'Offer archive authorization denied' using errcode='42501'; end if;
 perform private.require_private_offer_archive_bucket(p_company_id);
 select to_jsonb(a)||jsonb_build_object('storage_visibility','private') into result from public.offer_document_archives a where company_id=p_company_id and document_id=p_document_id;
 return result;
end $$;
revoke all on function public.get_offer_archive_by_document(uuid,uuid) from public,anon,service_role;
grant execute on function public.get_offer_archive_by_document(uuid,uuid) to authenticated;

-- Internal transaction capability: reads the actual storage catalog without
-- broadening clients' catalog privileges, then creates only DB-derived metadata.
-- The server-only wrapper and definer require service_role and explicitly
-- recheck the verified actor's current membership. The server bridge alone
-- computes actual PDF bytes from the immutable snapshot and checks readback.
create function private.register_offer_document_archive(p_company_id uuid,p_offer_id uuid,p_offer_version integer,
 p_pdf_sha256 text,p_snapshot_sha256 text,p_object_path text,p_submission_id uuid,p_actor_user_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=p_actor_user_id; o public.offers; a public.offer_document_archives;
 expected_sha text; expected_name text; expected_path text; object_metadata jsonb; new_document uuid;
begin
 if current_setting('role',true) is distinct from 'service_role' or actor is null
  or not exists(select 1 from public.companies c join public.memberships m on m.company_id=c.id
    where c.id=p_company_id and c.status='active' and m.user_id=actor and m.status='active' and m.role in ('owner','admin','finance')) then
  raise exception 'Offer archive authorization denied' using errcode='42501'; end if;
 if p_submission_id is null or p_pdf_sha256 is null or p_pdf_sha256 !~ '^[0-9a-f]{64}$'
  or p_snapshot_sha256 is null or p_snapshot_sha256 !~ '^[0-9a-f]{64}$' then
  raise exception 'Invalid archive request' using errcode='22023'; end if;
 -- The offer row lock serializes distinct actors and nonce retries: one artifact.
 select * into o from public.offers where company_id=p_company_id and id=p_offer_id for update;
 if not found then raise exception 'Offer unavailable' using errcode='P0002'; end if;
 if o.snapshot->>'document_type' is distinct from 'offer' or o.snapshot->'schema_version' is distinct from to_jsonb(1)
  or o.snapshot->'version' is distinct from to_jsonb(o.version) or o.snapshot->>'deal_id' is distinct from o.deal_id::text
  or o.snapshot#>>'{company,id}' is distinct from o.company_id::text
  or o.snapshot->>'currency' is distinct from 'SEK' or o.snapshot->>'price_basis' is distinct from 'gross'
  or length(coalesce(o.snapshot#>>'{vehicle,registration_number}','')) not between 2 and 15 then
  raise exception 'Invalid immutable offer identity' using errcode='23514'; end if;
 expected_sha:=encode(sha256(convert_to(o.snapshot::text,'UTF8')),'hex');
 expected_name:='Offert v'||o.version::text||' – '||(o.snapshot#>>'{vehicle,registration_number}');
 expected_path:=o.company_id::text||'/offers/'||o.id::text||'/v'||o.version::text||'/'||p_pdf_sha256||'.pdf';
 if p_offer_version is distinct from o.version or p_snapshot_sha256 is distinct from expected_sha or p_object_path is distinct from expected_path then
  raise exception 'Offer archive source conflict' using errcode='40001'; end if;
 -- Bucket/catalog checks apply even to metadata retries; stale storage cannot be
 -- reported as a valid archive merely because a previous registration exists.
 if not exists(select 1 from storage.buckets b where b.id='dealer-documents' and b.public=false) then
  raise exception 'Private document bucket required' using errcode='42501'; end if;
 select metadata into object_metadata from storage.objects where bucket_id='dealer-documents' and name=expected_path;
 if not found then raise exception 'Archived file unavailable' using errcode='P0002'; end if;
 if object_metadata ? 'mimetype' and lower(coalesce(object_metadata->>'mimetype',''))<>'application/pdf' then
  raise exception 'Archived file must be PDF' using errcode='23514'; end if;
 if object_metadata ? 'contentType' and lower(coalesce(object_metadata->>'contentType',''))<>'application/pdf' then
  raise exception 'Archived file must be PDF' using errcode='23514'; end if;
 select * into a from public.offer_document_archives where company_id=p_company_id and offer_id=p_offer_id;
 if found then
  if a.offer_version<>o.version or a.pdf_sha256<>p_pdf_sha256 or a.snapshot_sha256<>expected_sha or a.object_path<>expected_path then
   raise exception 'Offer already has a different archive' using errcode='40001'; end if;
  return to_jsonb(a)||jsonb_build_object('storage_visibility','private');
 end if;
 insert into public.documents(company_id,deal_id,name,object_path,kind)
  values(o.company_id,o.deal_id,expected_name,expected_path,'other') returning id into new_document;
 insert into public.offer_document_archives(company_id,offer_id,deal_id,offer_version,pdf_sha256,snapshot_sha256,
  object_path,document_id,document_name,submission_id,archived_by)
  values(o.company_id,o.id,o.deal_id,o.version,p_pdf_sha256,expected_sha,expected_path,new_document,expected_name,p_submission_id,actor)
  returning * into a;
 return to_jsonb(a)||jsonb_build_object('storage_visibility','private');
end $$;
revoke all on function private.register_offer_document_archive(uuid,uuid,integer,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function private.register_offer_document_archive(uuid,uuid,integer,text,text,text,uuid,uuid) to service_role;

create function public.register_offer_document_archive(p_company_id uuid,p_offer_id uuid,p_offer_version integer,
 p_pdf_sha256 text,p_snapshot_sha256 text,p_object_path text,p_submission_id uuid,p_actor_user_id uuid) returns jsonb
 language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'Verified server registration required' using errcode='42501'; end if;
 return private.register_offer_document_archive(p_company_id,p_offer_id,p_offer_version,p_pdf_sha256,p_snapshot_sha256,p_object_path,p_submission_id,p_actor_user_id);
end $$;
revoke all on function public.register_offer_document_archive(uuid,uuid,integer,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.register_offer_document_archive(uuid,uuid,integer,text,text,text,uuid,uuid) to service_role;


$archive$;
 end if;
end $prerequisite$;

-- Fresh actual Auth/approval and tenant/membership row locks protect every
-- archive source/metadata/download read, including after a concurrent revocation.
create or replace function private.require_private_offer_archive_bucket(p_company_id uuid)returns void
language plpgsql security definer set search_path=''as $$
declare actor_role text;
begin
 if current_setting('role',true)is distinct from 'authenticated'or auth.uid()is null then
  raise exception 'Offer archive authorization denied'using errcode='42501';end if;
 select x.actor_role into actor_role from private.internal_inventory_scope(p_company_id,false)x;
 if actor_role not in('owner','admin','finance')then raise exception 'Offer archive authorization denied'using errcode='42501';end if;
 perform 1 from storage.buckets where id='dealer-documents'and public=false for share;
 if not found then raise exception 'Private document bucket required'using errcode='42501';end if;
end$$;
revoke all on function private.require_private_offer_archive_bucket(uuid)from public,anon,authenticated,service_role;
grant execute on function private.require_private_offer_archive_bucket(uuid)to authenticated;
commit;
