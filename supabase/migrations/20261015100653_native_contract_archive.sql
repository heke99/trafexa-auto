begin;
-- Native signing originals are separate from ordinary dealer documents and the
-- disabled external-provider ledger. Object bytes are written only by Storage API.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('native-contract-originals','native-contract-originals',false,52428800,array['application/pdf','application/json'])
on conflict(id) do nothing;
do $$begin
 if not exists(select 1 from storage.buckets where id='native-contract-originals' and not public
  and file_size_limit=52428800 and allowed_mime_types @> array['application/pdf','application/json']
  and allowed_mime_types <@ array['application/pdf','application/json']) then
  raise exception 'Private native contract archive bucket required' using errcode='42501';
 end if;
end$$;

alter table private.contract_signings add constraint contract_signings_company_identity unique(company_id,id);
alter table private.sale_contract_drafts add constraint sale_contract_drafts_company_identity unique(company_id,id);

create table private.contract_signing_archives(
 id uuid primary key default gen_random_uuid(),signing_id uuid not null unique,
 company_id uuid not null references public.companies(id),deal_id uuid not null,draft_id uuid not null,draft_version integer not null check(draft_version>0),
 document_content_sha256 text not null check(document_content_sha256 ~ '^[a-f0-9]{64}$'),signing_revision integer not null check(signing_revision=3),
 renderer_version text not null check(renderer_version='trafexa-native-v1'),evidence_schema_version integer not null default 1 check(evidence_schema_version=1),
 pdf_sha256 text not null check(pdf_sha256 ~ '^[a-f0-9]{64}$'),pdf_bytes bigint not null check(pdf_bytes between 5 and 52428800),pdf_object_path text not null unique,
 evidence_sha256 text not null check(evidence_sha256 ~ '^[a-f0-9]{64}$'),evidence_bytes bigint not null check(evidence_bytes between 2 and 1048576),evidence_object_path text not null unique,
 archived_by uuid not null references auth.users(id),archived_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,signing_id) references private.contract_signings(company_id,id),foreign key(company_id,deal_id) references public.deals(company_id,id),foreign key(company_id,draft_id) references private.sale_contract_drafts(company_id,id),
 check(pdf_object_path=company_id::text||'/native-contracts/'||signing_id::text||'/v1/signed-'||pdf_sha256||'.pdf'),
 check(evidence_object_path=company_id::text||'/native-contracts/'||signing_id::text||'/v1/evidence-'||evidence_sha256||'.json')
);
create index contract_signing_archives_company on private.contract_signing_archives(company_id,deal_id);
create index contract_signing_archives_actor on private.contract_signing_archives(archived_by);
create index contract_signing_archives_draft on private.contract_signing_archives(company_id,draft_id);
create table private.contract_archive_requests(
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,
 signing_id uuid not null references private.contract_signings(id),archive_id uuid not null references private.contract_signing_archives(id),
 created_at timestamptz not null default clock_timestamp(),primary key(actor_user_id,request_id)
);
create index contract_archive_requests_archive on private.contract_archive_requests(archive_id);
create index contract_archive_requests_signing on private.contract_archive_requests(signing_id);
alter table private.contract_signing_archives enable row level security;
alter table private.contract_archive_requests enable row level security;
revoke all on private.contract_signing_archives,private.contract_archive_requests from public,anon,authenticated,service_role;
create trigger contract_signing_archive_immutable before update or delete on private.contract_signing_archives
 for each row execute function private.sale_contract_immutable();
create trigger contract_archive_request_immutable before update or delete on private.contract_archive_requests
 for each row execute function private.sale_contract_immutable();

create function private.require_native_contract_archive_bucket() returns void
language plpgsql security invoker set search_path='' as $$begin
 perform 1 from storage.buckets where id='native-contract-originals' and public=false for share;
 if not found then raise exception 'Private native contract archive unavailable' using errcode='42501';end if;
end$$;

-- All entry points prove the current actor, not editable metadata or a stored
-- archive receipt. Parent locks precede signing and the archive's foreign keys.
create function private.require_contract_archive_source(p_signing_id uuid,p_company_id uuid,p_actor_user_id uuid,p_write boolean)
returns private.contract_signings language plpgsql security invoker set search_path='' as $$
declare e text;r text;s private.contract_signings;d private.sale_contract_drafts;n integer;actors integer;
begin
 if p_actor_user_id is null or p_write is null or(p_write and p_company_id is null) then
  raise exception 'Native archive access denied' using errcode='42501';end if;
 e:=private.company_team_account(p_actor_user_id,true);
 select * into s from private.contract_signings where id=p_signing_id
 and(case when p_company_id is null then customer_email=e else company_id=p_company_id end);
 if not found then raise exception 'Native archive access denied' using errcode='42501';end if;
 perform 1 from public.companies where id=s.company_id and status='active' for share;
 if not found then raise exception 'Native archive access denied' using errcode='42501';end if;
 if p_company_id is not null then
  select role into r from public.memberships where company_id=s.company_id and user_id=p_actor_user_id and status='active' for share;
  if r is null or r not in('owner','admin','finance') or(p_write and r='finance') then
   raise exception 'Native archive access denied' using errcode='42501';end if;
 end if;
 -- Historical completed originals remain readable after a deal is cancelled/sold.
 perform 1 from public.deals where company_id=s.company_id and id=s.deal_id for share;
 if not found then raise exception 'Native archive source unavailable' using errcode='42501';end if;
 if p_write then select * into s from private.contract_signings where id=s.id for update;
 else select * into s from private.contract_signings where id=s.id for share;end if;
 select * into d from private.sale_contract_drafts where company_id=s.company_id and deal_id=s.deal_id and id=s.draft_id for share;
 if not found or s.canonical_content is distinct from jsonb_build_object('draftId',d.id,'companyId',d.company_id,'dealId',d.deal_id,'draftVersion',d.version,'content',d.snapshot)::text
  or s.document_hash is distinct from encode(sha256(convert_to(s.canonical_content,'UTF8')),'hex') then
  raise exception 'Native archive source conflict' using errcode='40001';end if;
 select count(*),count(distinct actor_user_id) into n,actors from private.contract_signatures
 where signing_id=s.id and document_hash=s.document_hash and consent_version='2026-10-14';
 if n<>2 or actors<>2 then raise exception 'Completed native signing required' using errcode='40001';end if;
 return s;
end$$;

create function private.contract_signing_archive_json(a private.contract_signing_archives) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('id',a.id,'signingId',a.signing_id,'companyId',a.company_id,'dealId',a.deal_id,'draftId',a.draft_id,'draftVersion',a.draft_version,
 'documentContentSha256',a.document_content_sha256,'signingRevision',a.signing_revision,'rendererVersion',a.renderer_version,'evidenceSchemaVersion',a.evidence_schema_version,
 'pdf',jsonb_build_object('objectPath',a.pdf_object_path,'sha256',a.pdf_sha256,'bytes',a.pdf_bytes,'mimeType','application/pdf'),
 'evidence',jsonb_build_object('objectPath',a.evidence_object_path,'sha256',a.evidence_sha256,'bytes',a.evidence_bytes,'mimeType','application/json'),'archivedAt',a.archived_at);
$$;

-- A catalog check is not a checksum proof. The trusted server must hash actual
-- uploaded/read-back bytes before this service-only registration capability.
create function private.check_native_contract_archive_objects(p_pdf_path text,p_pdf_bytes bigint,p_evidence_path text,p_evidence_bytes bigint)
returns void language plpgsql security invoker set search_path='' as $$declare item record;m jsonb;begin
 perform private.require_native_contract_archive_bucket();
 for item in select * from(values(p_pdf_path,p_pdf_bytes,'application/pdf'),(p_evidence_path,p_evidence_bytes,'application/json'))v(path,bytes,mime) loop
  select metadata into m from storage.objects where bucket_id='native-contract-originals' and name=item.path for share;
  if not found then raise exception 'Native original object unavailable' using errcode='P0002';end if;
  if jsonb_typeof(m->'size') is distinct from 'number' or length(m->>'size')>16 or(m->>'size') !~ '^[0-9]+$'
   or(m->>'size')::numeric is distinct from item.bytes::numeric
   or m->>'mimetype' is distinct from item.mime
   or(m ? 'contentType' and m->>'contentType' is distinct from item.mime) then
   raise exception 'Native original metadata mismatch' using errcode='23514';end if;
 end loop;
end$$;

create function private.get_contract_signing_archive(p_signing_id uuid,p_company_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare actor uuid;s private.contract_signings;a private.contract_signing_archives;begin
 if current_setting('role',true) is distinct from 'authenticated' or auth.uid() is null then
  raise exception 'Authenticated native archive read required' using errcode='42501';end if;
 actor:=auth.uid();s:=private.require_contract_archive_source(p_signing_id,p_company_id,actor,false);
 -- Every successful read, even archive:null, is an implicit private-bucket receipt.
 perform private.require_native_contract_archive_bucket();
 select * into a from private.contract_signing_archives where signing_id=s.id and company_id=s.company_id;
 return jsonb_build_object('actorId',actor,'companyId',s.company_id,'signingId',s.id,'archive',case when a.id is null then null else private.contract_signing_archive_json(a) end);
end$$;
create function public.get_contract_signing_archive(p_signing_id uuid,p_company_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$select private.get_contract_signing_archive(p_signing_id,p_company_id);$$;

create function private.register_contract_signing_archive(
 p_company_id uuid,p_signing_id uuid,p_actor_user_id uuid,p_request_id uuid,p_document_content_sha256 text,p_revision integer,
 p_pdf_sha256 text,p_pdf_bytes bigint,p_evidence_sha256 text,p_evidence_bytes bigint,p_renderer_version text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.contract_signings;a private.contract_signing_archives;old private.contract_archive_requests;d private.sale_contract_drafts;pdf_path text;evidence_path text;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Verified server archive registration required' using errcode='42501';end if;
 s:=private.require_contract_archive_source(p_signing_id,p_company_id,p_actor_user_id,true);
 if p_request_id is null or p_document_content_sha256 is distinct from s.document_hash or p_revision is distinct from 3
  or p_renderer_version is distinct from 'trafexa-native-v1' or p_pdf_sha256 is null or p_pdf_sha256 !~ '^[a-f0-9]{64}$'
  or p_evidence_sha256 is null or p_evidence_sha256 !~ '^[a-f0-9]{64}$' or p_pdf_bytes is null or p_pdf_bytes not between 5 and 52428800
  or p_evidence_bytes is null or p_evidence_bytes not between 2 and 1048576 then
  raise exception 'Invalid native archive registration' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text||p_request_id::text,11));
 select * into old from private.contract_archive_requests where actor_user_id=p_actor_user_id and request_id=p_request_id;
 if found and old.signing_id<>s.id then raise exception 'Native archive request conflict' using errcode='40001';end if;
 select * into a from private.contract_signing_archives where signing_id=s.id;
 if a.id is null then
  pdf_path:=s.company_id::text||'/native-contracts/'||s.id::text||'/v1/signed-'||p_pdf_sha256||'.pdf';
  evidence_path:=s.company_id::text||'/native-contracts/'||s.id::text||'/v1/evidence-'||p_evidence_sha256||'.json';
  perform private.check_native_contract_archive_objects(pdf_path,p_pdf_bytes,evidence_path,p_evidence_bytes);
  select * into d from private.sale_contract_drafts where id=s.draft_id;
  insert into private.contract_signing_archives(signing_id,company_id,deal_id,draft_id,draft_version,document_content_sha256,signing_revision,
   renderer_version,pdf_sha256,pdf_bytes,pdf_object_path,evidence_sha256,evidence_bytes,evidence_object_path,archived_by)
  values(s.id,s.company_id,s.deal_id,s.draft_id,d.version,s.document_hash,3,p_renderer_version,p_pdf_sha256,p_pdf_bytes,pdf_path,p_evidence_sha256,p_evidence_bytes,evidence_path,p_actor_user_id)
  returning * into a;
 else
  -- A competing verified bundle never replaces the first original. Only the
  -- winning object's metadata is relevant when recovering its historical receipt.
  perform private.check_native_contract_archive_objects(a.pdf_object_path,a.pdf_bytes,a.evidence_object_path,a.evidence_bytes);
 end if;
 if old.actor_user_id is null then
  insert into private.contract_archive_requests(actor_user_id,request_id,signing_id,archive_id)values(p_actor_user_id,p_request_id,s.id,a.id);
 elsif old.archive_id<>a.id then raise exception 'Native archive receipt conflict' using errcode='40001';end if;
 return jsonb_build_object('actorId',p_actor_user_id,'companyId',s.company_id,'signingId',s.id,'archive',private.contract_signing_archive_json(a));
end$$;
create function public.register_contract_signing_archive(
 p_company_id uuid,p_signing_id uuid,p_actor_user_id uuid,p_request_id uuid,p_document_content_sha256 text,p_revision integer,
 p_pdf_sha256 text,p_pdf_bytes bigint,p_evidence_sha256 text,p_evidence_bytes bigint,p_renderer_version text
) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 if current_user<>'service_role' then raise exception 'Verified server archive registration required' using errcode='42501';end if;
 return private.register_contract_signing_archive(p_company_id,p_signing_id,p_actor_user_id,p_request_id,p_document_content_sha256,p_revision,p_pdf_sha256,p_pdf_bytes,p_evidence_sha256,p_evidence_bytes,p_renderer_version);
end$$;

-- Authenticated Storage uploads remain user-scoped. Clients cannot attest their
-- own bytes via registration; the service-only capability remains separate.
create function private.native_contract_storage_access(p_path text,p_write boolean,p_owner_id text) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();company uuid;signing uuid;e text;dealer boolean;s private.contract_signings;
begin
 if current_setting('role',true) is distinct from 'authenticated' or actor is null or p_write is null
  or p_path is null or p_path !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/native-contracts/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/v1/(signed-[a-f0-9]{64}\.pdf|evidence-[a-f0-9]{64}\.json)$' then return false;end if;
 company:=split_part(p_path,'/',1)::uuid;signing:=split_part(p_path,'/',3)::uuid;
 dealer:=exists(select 1 from public.memberships where company_id=company and user_id=actor and status='active' and role=any(case when p_write then array['owner','admin'] else array['owner','admin','finance'] end));
 if p_write and not dealer then return false;end if;
 s:=private.require_contract_archive_source(signing,case when dealer then company else null end,actor,p_write);
 if s.company_id<>company then return false;end if;
 perform private.require_native_contract_archive_bucket();
 if p_write then return p_owner_id=actor::text and not exists(select 1 from private.contract_signing_archives where signing_id=s.id);end if;
 if exists(select 1 from private.contract_signing_archives where company_id=company and signing_id=signing
  and(p_path=pdf_object_path or p_path=evidence_object_path)) then return true;end if;
 -- Only an authorized owner/admin uploader can recover their own unregistered
 -- object after an uncertain upload; finance/customers cannot inspect orphans.
 return p_owner_id=actor::text and exists(select 1 from public.memberships where company_id=company and user_id=actor and status='active' and role in('owner','admin'));
exception when others then return false;
end$$;
create policy native_contract_original_insert on storage.objects for insert to authenticated
 with check(bucket_id='native-contract-originals' and private.native_contract_storage_access(name,true,owner_id));
create policy native_contract_original_read on storage.objects for select to authenticated
 using(bucket_id='native-contract-originals' and private.native_contract_storage_access(name,false,owner_id));
-- These restrictive guards also deny native-original mutation if an unrelated
-- future permissive policy grants broader ordinary-document updates/deletes.
create policy native_contract_original_no_update on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'native-contract-originals') with check(bucket_id<>'native-contract-originals');
create policy native_contract_original_no_delete on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'native-contract-originals');

revoke all on function private.require_native_contract_archive_bucket(),private.require_contract_archive_source(uuid,uuid,uuid,boolean),private.contract_signing_archive_json(private.contract_signing_archives),private.check_native_contract_archive_objects(text,bigint,text,bigint) from public,anon,authenticated,service_role;
revoke all on function private.native_contract_storage_access(text,boolean,text),private.get_contract_signing_archive(uuid,uuid),public.get_contract_signing_archive(uuid,uuid),private.register_contract_signing_archive(uuid,uuid,uuid,uuid,text,integer,text,bigint,text,bigint,text),public.register_contract_signing_archive(uuid,uuid,uuid,uuid,text,integer,text,bigint,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function private.native_contract_storage_access(text,boolean,text),private.get_contract_signing_archive(uuid,uuid),public.get_contract_signing_archive(uuid,uuid) to authenticated;
grant execute on function private.register_contract_signing_archive(uuid,uuid,uuid,uuid,text,integer,text,bigint,text,bigint,text),public.register_contract_signing_archive(uuid,uuid,uuid,uuid,text,integer,text,bigint,text,bigint,text) to service_role;
commit;
