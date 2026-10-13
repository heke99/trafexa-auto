-- Additive ledger for the existing companies/memberships/deals/documents model.
-- Local verification only; do not apply before the main integration review.
begin;

alter table public.documents add constraint documents_company_id_id_signing_key unique (company_id, id);

create table public.signing_document_versions (
  company_id uuid not null references public.companies(id),
  document_id uuid not null,
  document_version integer not null check (document_version > 0),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_object_path text not null,
  approved_signers jsonb not null check(jsonb_typeof(approved_signers)='array' and jsonb_array_length(approved_signers) between 1 and 20 and octet_length(approved_signers::text)<=65536),
  approved_template_id bigint not null check(approved_template_id between 1 and 9007199254740991),
  approved_template_version integer not null check(approved_template_version>0),
  approved_template_sha256 text not null check(approved_template_sha256 ~ '^[0-9a-f]{64}$'),
  registered_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (company_id, document_id, document_version),
  foreign key (company_id, document_id) references public.documents(company_id, id)
);
create index signing_document_versions_actor_idx on public.signing_document_versions(registered_by);

create table public.signing_templates (
  company_id uuid not null references public.companies(id),
  provider_instance text not null default 'docuseal-main' check (provider_instance='docuseal-main'),
  template_id bigint not null check (template_id between 1 and 9007199254740991),
  template_version integer not null check (template_version>0),
  template_sha256 text not null check (template_sha256 ~ '^[0-9a-f]{64}$'),
  document_kind text not null check (document_kind in ('purchase','contract')),
  active boolean not null default true,
  registered_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key(company_id,provider_instance,template_id,template_version)
);
create unique index signing_templates_active_idx on public.signing_templates(company_id,provider_instance,template_id) where active;
create index signing_templates_actor_idx on public.signing_templates(registered_by);

create table public.signing_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  document_id uuid not null,
  deal_id uuid,
  document_version integer not null check (document_version > 0),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_object_path text not null,
  template_id bigint not null check (template_id between 1 and 9007199254740991),
  template_version integer not null check (template_version>0),
  template_sha256 text not null check (template_sha256 ~ '^[0-9a-f]{64}$'),
  document_kind text not null check (document_kind in ('purchase','contract')),
  created_by uuid not null references auth.users(id),
  idempotency_key uuid not null,
  provider_instance text not null default 'docuseal-main' check (provider_instance = 'docuseal-main'),
  provider_submission_id bigint check (provider_submission_id between 1 and 9007199254740991),
  state text not null default 'prepared' check (state in ('prepared','dispatching','outcome_unknown','dispatch_failed','awaiting_signatures','awaiting_archive','completed','expired','declined')),
  version integer not null default 1 check (version > 0),
  snapshot jsonb not null,
  signers jsonb not null,
  claim_token uuid,
  claim_expires_at timestamptz,
  error_code text check (error_code in ('outcome_unknown','provider_rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, created_by, idempotency_key),
  unique (company_id, document_id, document_version),
  unique (provider_instance, provider_submission_id),
  foreign key (company_id, document_id) references public.documents(company_id, id),
  foreign key (company_id, deal_id) references public.deals(company_id, id),
  foreign key (company_id,provider_instance,template_id,template_version) references public.signing_templates(company_id,provider_instance,template_id,template_version),
  foreign key (company_id, document_id, document_version)
    references public.signing_document_versions(company_id, document_id, document_version)
);
create index signing_jobs_company_created_idx on public.signing_jobs(company_id, created_at desc, id desc);
create index signing_jobs_deal_idx on public.signing_jobs(company_id, deal_id);
create index signing_jobs_creator_idx on public.signing_jobs(created_by);
create index signing_jobs_dispatch_idx on public.signing_jobs(claim_expires_at) where state='dispatching';

create table public.signing_webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  provider_instance text not null default 'docuseal-main' check (provider_instance='docuseal-main'),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  event jsonb not null,
  provider_submission_id bigint not null check (provider_submission_id between 1 and 9007199254740991),
  job_id uuid references public.signing_jobs(id),
  status text not null check (status in ('pending','processed','quarantined')),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider_instance, body_sha256),
  check ((status='quarantined' and job_id is null and processed_at is null)
    or (status='pending' and job_id is not null and processed_at is null)
    or (status='processed' and job_id is not null and processed_at is not null))
);
create index signing_webhook_inbox_job_idx on public.signing_webhook_inbox(job_id);
create index signing_webhook_inbox_pending_idx on public.signing_webhook_inbox(created_at,id) where status='pending';

alter table public.signing_document_versions enable row level security;
alter table public.signing_templates enable row level security;
create policy signing_templates_read on public.signing_templates for select to authenticated
  using (private.has_company_role(company_id,array['owner','admin','finance']));
alter table public.signing_jobs enable row level security;
alter table public.signing_webhook_inbox enable row level security;
create policy signing_versions_read on public.signing_document_versions for select to authenticated
  using (private.has_company_role(company_id, array['owner','admin','finance']));
create policy signing_jobs_read on public.signing_jobs for select to authenticated
  using (private.has_company_role(company_id, array['owner','admin','finance']));
create policy signing_jobs_prepare on public.signing_jobs for insert to authenticated with check (
  created_by=(select auth.uid()) and state='prepared' and version=1
  and provider_submission_id is null and claim_token is null and claim_expires_at is null and error_code is null
  and private.has_company_role(company_id, array['owner','admin','finance'])
);

-- Trigger functions run as the caller; there are no new security-definer functions.
-- Authentication calls need no EXECUTE on a trigger function to fire the trigger.
create function private.signing_validate_job() returns trigger language plpgsql security invoker set search_path='' as $$
declare
  d public.documents;
  v public.signing_document_versions;
  approved_template public.signing_templates;
  signer jsonb;
  binding jsonb;
  expected jsonb;
  ids bigint[] := '{}';
  externals text[] := '{}';
  roles text[] := '{}';
  external text;
  signer_id bigint;
  s jsonb := new.snapshot;
  proof jsonb;
  item jsonb;
  expected_context jsonb;
begin
  if tg_op='INSERT' then
    select * into d from public.documents where company_id=new.company_id and id=new.document_id;
    if not found or d.deal_id is distinct from new.deal_id or d.object_path<>new.source_object_path
       or d.kind not in ('purchase','contract') or d.kind<>new.document_kind or (d.kind='contract' and d.deal_id is null) then
      raise exception 'Signing document context denied' using errcode='42501';
    end if;
    if not exists(select 1 from public.signing_templates where company_id=new.company_id and provider_instance=new.provider_instance
       and template_id=new.template_id and template_version=new.template_version and template_sha256=new.template_sha256 and document_kind=new.document_kind and active) then
      raise exception 'Template approval required' using errcode='42501'; end if;
    if current_user<>'service_role' and (auth.uid() is null or new.created_by<>auth.uid()) then
      raise exception 'Signing creator denied' using errcode='42501';
    end if;
    if new.state<>'prepared' or new.version<>1 or new.provider_submission_id is not null
       or new.claim_token is not null or new.claim_expires_at is not null or new.error_code is not null then
      raise exception 'Initial signing state invalid' using errcode='23514';
    end if;
    select * into v from public.signing_document_versions where company_id=new.company_id
      and document_id=new.document_id and document_version=new.document_version;
    if not found or v.source_sha256<>new.source_sha256 or v.source_object_path<>new.source_object_path then
      raise exception 'Document version source conflict' using errcode='40001';
    end if;
  else
    if (to_jsonb(new)-array['snapshot','state','version','provider_submission_id','claim_token','claim_expires_at','error_code','updated_at'])
      is distinct from (to_jsonb(old)-array['snapshot','state','version','provider_submission_id','claim_token','claim_expires_at','error_code','updated_at']) then
      raise exception 'Immutable signing context' using errcode='23514';
    end if;
    if new.version<>old.version+1 then raise exception 'Signing version conflict' using errcode='40001'; end if;
    if not (
      (old.state='prepared' and new.state='dispatching')
      or (old.state='dispatching' and new.state in ('outcome_unknown','dispatch_failed','awaiting_signatures'))
      or (old.state='outcome_unknown' and new.state='awaiting_signatures')
      or (old.state='awaiting_signatures' and new.state in ('awaiting_signatures','awaiting_archive','declined','expired'))
      or (old.state='awaiting_archive' and new.state in ('awaiting_archive','completed'))
    ) then raise exception 'Signing transition invalid' using errcode='23514'; end if;
    if old.provider_submission_id is not null and new.provider_submission_id is distinct from old.provider_submission_id then
      raise exception 'Immutable provider submission' using errcode='23514';
    end if;
    if old.provider_submission_id is not null and s->'submitters' is distinct from old.snapshot->'submitters' then
      raise exception 'Immutable provider signer bindings' using errcode='23514';
    end if;
    if not ((s->'completedSubmitterIds') @> (old.snapshot->'completedSubmitterIds')) then
      raise exception 'Signer completion regression' using errcode='23514';
    end if;
    new.updated_at:=clock_timestamp();
  end if;
  if jsonb_typeof(new.signers)<>'array' or jsonb_array_length(new.signers) not between 1 and 20
    or octet_length(new.signers::text)>65536 then raise exception 'Invalid signers' using errcode='23514'; end if;
  for signer in select value from jsonb_array_elements(new.signers) loop
    if jsonb_typeof(signer)<>'object' or signer-array['role','email','name','externalId','values']<>'{}'::jsonb
      or jsonb_typeof(signer->'role') is distinct from 'string' or length(signer->>'role') not between 1 and 200
      or signer->>'role'<>btrim(signer->>'role') or (signer->>'role')~'[[:cntrl:]]'
      or jsonb_typeof(signer->'email') is distinct from 'string' or length(signer->>'email') not between 3 and 254
      or (signer->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      or jsonb_typeof(signer->'externalId') is distinct from 'string' or length(signer->>'externalId') not between 1 and 200
      or signer->>'externalId'<>btrim(signer->>'externalId') or (signer->>'externalId')~'[[:cntrl:]]'
      or (signer ? 'name' and (jsonb_typeof(signer->'name')<>'string' or length(signer->>'name') not between 1 and 200 or (signer->>'name')~'[[:cntrl:]]'))
      or (signer ? 'values' and jsonb_typeof(signer->'values')<>'object') then
      raise exception 'Invalid signer payload' using errcode='23514';
    end if;
    external:=signer->>'externalId';
    if external=any(externals) or signer->>'role'=any(roles) then raise exception 'Duplicate signer' using errcode='23514'; end if;
    externals:=array_append(externals,external); roles:=array_append(roles,signer->>'role');
  end loop;
  if tg_op='INSERT' and (new.signers is distinct from v.approved_signers or new.template_id is distinct from v.approved_template_id
    or new.template_version is distinct from v.approved_template_version or new.template_sha256 is distinct from v.approved_template_sha256) then
    raise exception 'Server source approval mismatch' using errcode='42501'; end if;
  if octet_length(jsonb_build_object('template_id',new.template_id,'order','preserved','send_email',false,'send_sms',false,
    'submitters',(select jsonb_agg((value-'externalId')||jsonb_build_object('external_id',value->'externalId',
      'values',coalesce(value->'values','{}'::jsonb),'send_email',false,'send_sms',false))
      from jsonb_array_elements(new.signers)))::text)>65536 then
    raise exception 'Signer dispatch body exceeds limit' using errcode='23514'; end if;
  expected:=to_jsonb(externals);
  expected_context:=jsonb_build_object('id',new.id,'companyId',new.company_id,'documentId',new.document_id,'dealId',new.deal_id,
    'documentVersion',new.document_version,'sourceSha256',new.source_sha256,'templateId',new.template_id,
    'templateVersion',new.template_version,'templateSha256',new.template_sha256);
  if jsonb_typeof(s)<>'object' or s-array['id','companyId','documentId','dealId','documentVersion','sourceSha256','templateId',
      'templateVersion','templateSha256','expectedSignerExternalIds','state','version','submissionId','submitters','completedSubmitterIds','archive']<>'{}'::jsonb
    or not (s @> expected_context) or s->'expectedSignerExternalIds' is distinct from expected
    or s->'state' is distinct from to_jsonb(new.state) or s->'version' is distinct from to_jsonb(new.version)
    or s->'submissionId' is distinct from coalesce(to_jsonb(new.provider_submission_id),'null'::jsonb)
    or jsonb_typeof(s->'submitters') is distinct from 'array'
    or jsonb_typeof(s->'completedSubmitterIds') is distinct from 'array' then
    raise exception 'Invalid signing snapshot' using errcode='23514';
  end if;
  if new.state in ('prepared','dispatching','outcome_unknown','dispatch_failed') then
    if new.provider_submission_id is not null or s->'submitters'<>'[]'::jsonb or s->'completedSubmitterIds'<>'[]'::jsonb or s->'archive' is distinct from 'null'::jsonb then
      raise exception 'Invalid unbound signing state' using errcode='23514'; end if;
  else
    if new.provider_submission_id is null or jsonb_array_length(s->'submitters')<>cardinality(externals) then
      raise exception 'Missing provider bindings' using errcode='23514'; end if;
    externals:='{}';
    for binding in select value from jsonb_array_elements(s->'submitters') loop
      if jsonb_typeof(binding)<>'object' or binding-array['id','externalId']<>'{}'::jsonb
        or jsonb_typeof(binding->'id') is distinct from 'number' or (binding->>'id') !~ '^[1-9][0-9]{0,15}$'
        or (binding->>'id')::numeric>9007199254740991 or jsonb_typeof(binding->'externalId') is distinct from 'string'
        or not(expected @> jsonb_build_array(binding->>'externalId')) then
        raise exception 'Invalid provider signer mapping' using errcode='23514'; end if;
      signer_id:=(binding->>'id')::bigint; external:=binding->>'externalId';
      if signer_id=any(ids) or external=any(externals) then raise exception 'Duplicate provider binding' using errcode='23514'; end if;
      ids:=array_append(ids,signer_id); externals:=array_append(externals,external);
    end loop;
    if (select count(*) from jsonb_array_elements(s->'completedSubmitterIds'))<>
       (select count(distinct value) from jsonb_array_elements(s->'completedSubmitterIds')) then
      raise exception 'Duplicate completion' using errcode='23514'; end if;
    for item in select value from jsonb_array_elements(s->'completedSubmitterIds') loop
      if jsonb_typeof(item)<>'number' or item::text !~ '^[1-9][0-9]{0,15}$'
        or item::text::numeric>9007199254740991 or not(item::text::bigint=any(ids)) then
        raise exception 'Unknown completed signer' using errcode='23514'; end if;
    end loop;
    if new.state='completed' then
      proof:=s->'archive';
      if jsonb_typeof(proof) is distinct from 'object' or proof-array['context','submissionId','storageVisibility','signedPdf','audit']<>'{}'::jsonb
        or proof->'context' is distinct from expected_context or proof->'submissionId' is distinct from to_jsonb(new.provider_submission_id)
        or proof->>'storageVisibility' is distinct from 'private' then raise exception 'Invalid archive context' using errcode='23514'; end if;
      for item in select value from jsonb_each(jsonb_build_object('pdf',proof->'signedPdf','audit',proof->'audit')) loop
        if jsonb_typeof(item) is distinct from 'object' or item-array['path','sha256']<>'{}'::jsonb
          or jsonb_typeof(item->'sha256') is distinct from 'string' or (item->>'sha256') !~ '^[0-9a-f]{64}$'
          or jsonb_typeof(item->'path') is distinct from 'string' or length(item->>'path') not between 1 and 1024
          or (item->>'path') !~ ('^'||new.company_id::text||'/[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)*$')
          or (item->>'path') ~ '(^|/)[.]{1,2}(/|$)' then raise exception 'Invalid private archive object' using errcode='23514'; end if;
      end loop;
      if (proof->'signedPdf'->>'path') !~ '[.]pdf$' or proof->'signedPdf'->>'path'=proof->'audit'->>'path' then
        raise exception 'Invalid archive objects' using errcode='23514'; end if;
    elsif s->'archive' is distinct from 'null'::jsonb then raise exception 'Premature archive' using errcode='23514'; end if;
  end if;
  if new.state='dispatching' then
    if new.claim_token is null or new.claim_expires_at is null then raise exception 'Dispatch claim required' using errcode='23514'; end if;
  elsif new.state='outcome_unknown' then
    if new.claim_token is null or new.claim_expires_at is not null then raise exception 'Uncertain dispatch token required' using errcode='23514'; end if;
  elsif new.claim_token is not null or new.claim_expires_at is not null then raise exception 'Unexpected dispatch claim' using errcode='23514'; end if;
  if (new.state='dispatch_failed' and new.error_code is distinct from 'provider_rejected')
    or (new.state='outcome_unknown' and new.error_code is distinct from 'outcome_unknown')
    or (new.state not in ('dispatch_failed','outcome_unknown') and new.error_code is not null) then
    raise exception 'Invalid dispatch error code' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger signing_validate_job before insert or update on public.signing_jobs
  for each row execute function private.signing_validate_job();

create function public.register_signing_document_version(p_company_id uuid,p_document_id uuid,p_document_version integer,
 p_source_sha256 text,p_source_object_path text,p_actor_user_id uuid,p_approved_signers jsonb,p_approved_template_id bigint,p_approved_template_version integer,p_approved_template_sha256 text) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare d public.documents; v public.signing_document_versions;
begin
  if current_user<>'service_role' then raise exception 'Worker role required' using errcode='42501'; end if;
  select * into d from public.documents where company_id=p_company_id and id=p_document_id;
  if not found or d.kind not in ('purchase','contract') or (d.kind='contract' and d.deal_id is null)
    or d.object_path is distinct from p_source_object_path or not exists (
      select 1 from public.companies c join public.memberships m on m.company_id=c.id
      where c.id=p_company_id and c.status='active' and m.user_id=p_actor_user_id and m.status='active'
        and m.role in ('owner','admin','finance')) then
    raise exception 'Signing document authorization denied' using errcode='42501'; end if;
  if not exists(select 1 from public.signing_templates where company_id=p_company_id and provider_instance='docuseal-main'
    and template_id=p_approved_template_id and template_version=p_approved_template_version and template_sha256=p_approved_template_sha256 and document_kind=d.kind and active) then
    raise exception 'Source template approval mismatch' using errcode='42501'; end if;
  insert into public.signing_document_versions(company_id,document_id,document_version,source_sha256,source_object_path,
    approved_signers,approved_template_id,approved_template_version,approved_template_sha256,registered_by)
    values(p_company_id,p_document_id,p_document_version,p_source_sha256,p_source_object_path,
    p_approved_signers,p_approved_template_id,p_approved_template_version,p_approved_template_sha256,p_actor_user_id)
    on conflict(company_id,document_id,document_version) do nothing;
  select * into v from public.signing_document_versions where company_id=p_company_id and document_id=p_document_id and document_version=p_document_version;
  if v.source_sha256 is distinct from p_source_sha256 or v.source_object_path is distinct from p_source_object_path
    or v.approved_signers is distinct from p_approved_signers or v.approved_template_id is distinct from p_approved_template_id
    or v.approved_template_version is distinct from p_approved_template_version or v.approved_template_sha256 is distinct from p_approved_template_sha256 then
    raise exception 'Document version source conflict' using errcode='40001'; end if;
  return to_jsonb(v);
end;
$$;

create function public.register_signing_template(p_company_id uuid,p_template_id bigint,p_template_version integer,
 p_template_sha256 text,p_document_kind text,p_actor_user_id uuid) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare t public.signing_templates;
begin
  if current_user<>'service_role' then raise exception 'Worker role required' using errcode='42501'; end if;
  -- Serialize approved revisions within a company without granting clients registry writes.
  perform 1 from public.companies where id=p_company_id for update;
  if not exists(select 1 from public.companies c join public.memberships m on m.company_id=c.id
    where c.id=p_company_id and c.status='active' and m.user_id=p_actor_user_id and m.status='active' and m.role in ('owner','admin')) then
    raise exception 'Template governance denied' using errcode='42501'; end if;
  if exists(select 1 from public.signing_templates where company_id=p_company_id and provider_instance='docuseal-main'
    and template_id=p_template_id and template_version>p_template_version) then
    raise exception 'Template revision regression' using errcode='40001'; end if;
  select * into t from public.signing_templates where company_id=p_company_id and provider_instance='docuseal-main'
    and template_id=p_template_id and template_version=p_template_version;
  if found then
    if t.template_sha256 is distinct from p_template_sha256 or t.document_kind is distinct from p_document_kind then
      raise exception 'Template revision conflict' using errcode='40001'; end if;
    return to_jsonb(t);
  end if;
  update public.signing_templates set active=false where company_id=p_company_id and provider_instance='docuseal-main' and template_id=p_template_id and active;
  insert into public.signing_templates(company_id,template_id,template_version,template_sha256,document_kind,registered_by)
    values(p_company_id,p_template_id,p_template_version,p_template_sha256,p_document_kind,p_actor_user_id) returning * into t;
  return to_jsonb(t);
end;
$$;

create function public.prepare_signing_job(p_company_id uuid,p_document_id uuid,p_deal_id uuid,p_document_version integer,
 p_source_sha256 text,p_template_id bigint,p_signers jsonb,p_idempotency_key uuid,p_expected_template_version integer,p_expected_template_sha256 text) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare d public.documents; j public.signing_jobs; t public.signing_templates; job_id uuid:=gen_random_uuid(); expected jsonb; s jsonb;
begin
  if auth.uid() is null or not private.has_company_role(p_company_id,array['owner','admin','finance']) then
    raise exception 'Signing preparation denied' using errcode='42501'; end if;
  select * into d from public.documents where company_id=p_company_id and id=p_document_id;
  if not found then raise exception 'Signing document ownership denied' using errcode='42501'; end if;
  select * into j from public.signing_jobs where company_id=p_company_id and created_by=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if j.document_id is distinct from p_document_id or j.deal_id is distinct from p_deal_id or j.document_version is distinct from p_document_version
      or j.source_sha256 is distinct from p_source_sha256
      or j.template_id is distinct from p_template_id or j.template_version is distinct from p_expected_template_version
      or j.template_sha256 is distinct from p_expected_template_sha256 or j.signers is distinct from p_signers then
      raise exception 'Signing retry payload conflict' using errcode='40001'; end if;
    return to_jsonb(j);
  end if;
  if d.deal_id is distinct from p_deal_id or d.kind not in ('purchase','contract') or (d.kind='contract' and d.deal_id is null) then
    raise exception 'Signing document context denied' using errcode='42501'; end if;
  select * into t from public.signing_templates where company_id=p_company_id and provider_instance='docuseal-main' and template_id=p_template_id and document_kind=d.kind and active;
  if not found then raise exception 'Template approval required' using errcode='42501'; end if;
  if t.template_version is distinct from p_expected_template_version or t.template_sha256 is distinct from p_expected_template_sha256 then
    raise exception 'Template revision changed' using errcode='40001'; end if;
  if jsonb_typeof(p_signers) is distinct from 'array' then raise exception 'Invalid signers' using errcode='23514'; end if;
  select coalesce(jsonb_agg(value->'externalId'),'[]'::jsonb) into expected from jsonb_array_elements(p_signers);
  s:=jsonb_build_object('id',job_id,'companyId',p_company_id,'documentId',p_document_id,'dealId',p_deal_id,
    'documentVersion',p_document_version,'sourceSha256',p_source_sha256,'templateId',p_template_id,
    'templateVersion',t.template_version,'templateSha256',t.template_sha256,
    'expectedSignerExternalIds',expected,'state','prepared','version',1,'submissionId',null,
    'submitters','[]'::jsonb,'completedSubmitterIds','[]'::jsonb,'archive',null);
  insert into public.signing_jobs(id,company_id,document_id,deal_id,document_version,source_sha256,source_object_path,
    template_id,template_version,template_sha256,document_kind,created_by,idempotency_key,snapshot,signers)
    values(job_id,p_company_id,p_document_id,p_deal_id,p_document_version,p_source_sha256,d.object_path,p_template_id,t.template_version,t.template_sha256,d.kind,auth.uid(),p_idempotency_key,s,p_signers)
    on conflict(company_id,created_by,idempotency_key) do nothing;
  select * into j from public.signing_jobs where company_id=p_company_id and created_by=auth.uid() and idempotency_key=p_idempotency_key;
  if j.document_id is distinct from p_document_id or j.deal_id is distinct from p_deal_id or j.document_version is distinct from p_document_version
    or j.source_sha256 is distinct from p_source_sha256 or j.source_object_path is distinct from d.object_path
    or j.template_id is distinct from p_template_id or j.template_version is distinct from p_expected_template_version
    or j.template_sha256 is distinct from p_expected_template_sha256 or j.signers is distinct from p_signers then
    raise exception 'Signing retry payload conflict' using errcode='40001'; end if;
  return to_jsonb(j);
end;
$$;

create function public.claim_signing_job(p_job_id uuid,p_expected_version integer,p_claim_token uuid) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare j public.signing_jobs;
begin
  if current_user<>'service_role' then raise exception 'Worker role required' using errcode='42501'; end if;
  select * into j from public.signing_jobs where id=p_job_id for update;
  if not found or j.version is distinct from p_expected_version then raise exception 'Signing version conflict' using errcode='40001'; end if;
  if j.state<>'prepared' or p_claim_token is null then raise exception 'Dispatch is not claimable' using errcode='23514'; end if;
  if not exists(select 1 from public.companies c join public.memberships m on m.company_id=c.id
    join public.documents d on d.company_id=c.id where c.id=j.company_id and c.status='active'
      and m.user_id=j.created_by and m.status='active' and m.role in ('owner','admin','finance')
      and d.id=j.document_id and d.deal_id is not distinct from j.deal_id and d.object_path=j.source_object_path
      and d.kind=j.document_kind and d.kind in ('purchase','contract') and (d.kind='purchase' or d.deal_id is not null))
    or not exists(select 1 from public.signing_templates where company_id=j.company_id and provider_instance=j.provider_instance
      and template_id=j.template_id and template_version=j.template_version and template_sha256=j.template_sha256 and document_kind=j.document_kind and active) then
    raise exception 'Dispatch authorization or source revoked' using errcode='42501'; end if;
  update public.signing_jobs set state='dispatching',version=version+1,claim_token=p_claim_token,
    claim_expires_at=clock_timestamp()+interval '5 minutes',
    snapshot=snapshot||jsonb_build_object('state','dispatching','version',version+1) where id=j.id returning * into j;
  return to_jsonb(j);
end;
$$;

create function public.save_signing_job(p_job_id uuid,p_expected_version integer,p_claim_token uuid,p_snapshot jsonb,p_error_code text default null)
 returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.signing_jobs; new_state text; sid bigint;
begin
  if current_user<>'service_role' then raise exception 'Worker role required' using errcode='42501'; end if;
  select * into j from public.signing_jobs where id=p_job_id for update;
  if not found or j.version is distinct from p_expected_version then raise exception 'Signing version conflict' using errcode='40001'; end if;
  if j.state in ('dispatching','outcome_unknown') and (p_claim_token is null or p_claim_token is distinct from j.claim_token) then
    raise exception 'Dispatch token mismatch' using errcode='42501'; end if;
  if p_snapshot=j.snapshot and p_error_code is not distinct from j.error_code then return to_jsonb(j); end if;
  if j.state='prepared' then raise exception 'Use dispatch claim' using errcode='23514'; end if;
  new_state:=p_snapshot->>'state';
  if p_snapshot->'version' is distinct from to_jsonb(j.version+1) then raise exception 'Snapshot version conflict' using errcode='40001'; end if;
  if jsonb_typeof(p_snapshot->'submissionId')='number' and (p_snapshot->>'submissionId') ~ '^[1-9][0-9]{0,15}$' then
    sid:=(p_snapshot->>'submissionId')::bigint;
  elsif p_snapshot->'submissionId' is distinct from 'null'::jsonb then raise exception 'Invalid provider submission' using errcode='23514'; end if;
  update public.signing_jobs set snapshot=p_snapshot,state=new_state,version=version+1,provider_submission_id=sid,error_code=p_error_code,
    claim_token=case when new_state='outcome_unknown' then claim_token else null end,claim_expires_at=null
    where id=j.id returning * into j;
  return to_jsonb(j);
end;
$$;

create function public.mark_expired_signing_dispatch(p_job_id uuid,p_expected_version integer) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare j public.signing_jobs;
begin
  if current_user<>'service_role' then raise exception 'Worker role required' using errcode='42501'; end if;
  select * into j from public.signing_jobs where id=p_job_id for update;
  if not found or j.version is distinct from p_expected_version then raise exception 'Signing version conflict' using errcode='40001'; end if;
  if j.state<>'dispatching' or j.claim_expires_at>clock_timestamp() then raise exception 'Dispatch lease has not expired' using errcode='23514'; end if;
  return public.save_signing_job(j.id,j.version,j.claim_token,j.snapshot||jsonb_build_object('state','outcome_unknown','version',j.version+1),'outcome_unknown');
end;
$$;

create function public.enqueue_signing_webhook(p_body_sha256 text,p_event jsonb) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare inbox public.signing_webhook_inbox; job_id uuid; sid bigint; event_type text;
begin
  if current_user<>'service_role' then raise exception 'Worker role required' using errcode='42501'; end if;
  event_type:=p_event->>'eventType';
  if jsonb_typeof(p_event) is distinct from 'object' or p_event-array['eventType','entity','submissionId','submitterId','occurredAt']<>'{}'::jsonb
    or event_type is null or event_type not in ('form.viewed','form.started','form.completed','form.declined','submission.created','submission.completed','submission.expired','submission.archived')
    or jsonb_typeof(p_event->'submissionId') is distinct from 'number' or (p_event->>'submissionId') !~ '^[1-9][0-9]{0,15}$'
    or (p_event->>'submissionId')::numeric>9007199254740991
    or (p_event ? 'occurredAt' and (jsonb_typeof(p_event->'occurredAt')<>'string' or length(p_event->>'occurredAt')>64 or (p_event->>'occurredAt')!~'^\d{4}-\d{2}-\d{2}T')) then
    raise exception 'Invalid normalized webhook' using errcode='23514'; end if;
  if event_type like 'form.%' then
    if p_event->>'entity' is distinct from 'submitter' or jsonb_typeof(p_event->'submitterId') is distinct from 'number'
      or (p_event->>'submitterId') !~ '^[1-9][0-9]{0,15}$' or (p_event->>'submitterId')::numeric>9007199254740991 then
      raise exception 'Invalid submitter event' using errcode='23514'; end if;
  elsif p_event->>'entity' is distinct from 'submission' or p_event->'submitterId' is distinct from 'null'::jsonb then
    raise exception 'Invalid submission event' using errcode='23514'; end if;
  sid:=(p_event->>'submissionId')::bigint;
  select id into job_id from public.signing_jobs where provider_instance='docuseal-main' and provider_submission_id=sid;
  insert into public.signing_webhook_inbox(body_sha256,event,provider_submission_id,job_id,status)
    values(p_body_sha256,p_event,sid,job_id,case when job_id is null then 'quarantined' else 'pending' end)
    on conflict(provider_instance,body_sha256) do nothing;
  select * into inbox from public.signing_webhook_inbox where provider_instance='docuseal-main' and body_sha256=p_body_sha256;
  if inbox.event is distinct from p_event then raise exception 'Webhook digest conflict' using errcode='40001'; end if;
  return to_jsonb(inbox);
end;
$$;

create function public.apply_signing_webhook(p_inbox_id uuid,p_expected_job_version integer,p_snapshot jsonb) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare inbox public.signing_webhook_inbox; j public.signing_jobs; expected jsonb; done jsonb; event_type text; signer_id bigint;
begin
  if current_user<>'service_role' then raise exception 'Worker role required' using errcode='42501'; end if;
  select * into inbox from public.signing_webhook_inbox where id=p_inbox_id for update;
  if not found then raise exception 'Inbox not found' using errcode='23514'; end if;
  if inbox.status in ('processed','quarantined') then return to_jsonb(inbox); end if;
  select * into j from public.signing_jobs where id=inbox.job_id for update;
  if not found or j.version is distinct from p_expected_job_version then raise exception 'Signing version conflict' using errcode='40001'; end if;
  expected:=j.snapshot; event_type:=inbox.event->>'eventType'; signer_id:=(inbox.event->>'submitterId')::bigint;
  if inbox.provider_submission_id=j.provider_submission_id and j.state in ('awaiting_signatures','awaiting_archive') then
    if event_type='form.completed' and exists(select 1 from jsonb_array_elements(expected->'submitters') b where (b->>'id')::bigint=signer_id)
      and not(expected->'completedSubmitterIds' @> jsonb_build_array(signer_id)) then
      select jsonb_agg(value order by value::text::bigint) into done from jsonb_array_elements((expected->'completedSubmitterIds')||jsonb_build_array(signer_id));
      expected:=expected||jsonb_build_object('completedSubmitterIds',done,'version',j.version+1);
    elsif j.state='awaiting_signatures' then
      if event_type='submission.completed' then expected:=expected||jsonb_build_object('state','awaiting_archive','version',j.version+1);
      elsif event_type='submission.expired' then expected:=expected||jsonb_build_object('state','expired','version',j.version+1);
      elsif event_type='form.declined' and exists(select 1 from jsonb_array_elements(expected->'submitters') b where (b->>'id')::bigint=signer_id) then
        expected:=expected||jsonb_build_object('state','declined','version',j.version+1);
      end if;
    end if;
  end if;
  if p_snapshot is distinct from expected then raise exception 'Webhook snapshot mismatch' using errcode='23514'; end if;
  if expected is distinct from j.snapshot then perform public.save_signing_job(j.id,j.version,null,expected,null); end if;
  update public.signing_webhook_inbox set status='processed',processed_at=clock_timestamp() where id=inbox.id returning * into inbox;
  return to_jsonb(inbox);
end;
$$;

-- Strip installation-specific default privileges before granting exact APIs.
revoke all on public.signing_document_versions,public.signing_templates,public.signing_jobs,public.signing_webhook_inbox from public,anon,authenticated,service_role;
grant select on public.signing_document_versions,public.signing_templates,public.signing_jobs to authenticated;
grant insert(id,company_id,document_id,deal_id,document_version,source_sha256,source_object_path,template_id,template_version,template_sha256,document_kind,created_by,idempotency_key,snapshot,signers)
  on public.signing_jobs to authenticated;
grant select,insert on public.signing_document_versions,public.signing_templates to service_role;
grant update(active) on public.signing_templates to service_role;
grant select,insert,update on public.signing_jobs,public.signing_webhook_inbox to service_role;
grant usage on schema private to service_role;
revoke all on function private.signing_validate_job() from public,anon,authenticated;
grant execute on function private.signing_validate_job() to service_role;
revoke all on function public.prepare_signing_job(uuid,uuid,uuid,integer,text,bigint,jsonb,uuid,integer,text) from public,anon,service_role;
grant execute on function public.prepare_signing_job(uuid,uuid,uuid,integer,text,bigint,jsonb,uuid,integer,text) to authenticated;
revoke all on function public.register_signing_template(uuid,bigint,integer,text,text,uuid),public.register_signing_document_version(uuid,uuid,integer,text,text,uuid,jsonb,bigint,integer,text),
 public.claim_signing_job(uuid,integer,uuid),public.save_signing_job(uuid,integer,uuid,jsonb,text),
 public.mark_expired_signing_dispatch(uuid,integer),public.enqueue_signing_webhook(text,jsonb),
 public.apply_signing_webhook(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.register_signing_template(uuid,bigint,integer,text,text,uuid),public.register_signing_document_version(uuid,uuid,integer,text,text,uuid,jsonb,bigint,integer,text),
 public.claim_signing_job(uuid,integer,uuid),public.save_signing_job(uuid,integer,uuid,jsonb,text),
 public.mark_expired_signing_dispatch(uuid,integer),public.enqueue_signing_webhook(text,jsonb),
 public.apply_signing_webhook(uuid,integer,jsonb) to service_role;

commit;
