begin;
-- Private dealer contact data and reviewed LOCAL exports. No partner request,
-- credential, external account verification or company legal-identity update.
create table private.company_store_profile_versions(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 version integer not null check(version>0),fields jsonb not null check(jsonb_typeof(fields)='object'),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 unique(company_id,version),unique(company_id,id,version)
);
create index company_store_profile_actor on private.company_store_profile_versions(created_by);
create table private.company_store_profile_heads(
 company_id uuid primary key references public.companies(id),profile_id uuid,profile_version integer not null default 0,
 check((profile_id is null and profile_version=0) or (profile_id is not null and profile_version>0)),
 foreign key(company_id,profile_id,profile_version) references private.company_store_profile_versions(company_id,id,version)
);
create table private.company_store_exports(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 channel text not null check(channel in('blocket','wayke')),purpose text not null check(purpose in('new_store','existing_store')),
 profile_id uuid not null,profile_version integer not null,snapshot jsonb not null,source_sha256 text not null,
 canonical_content text not null,export_sha256 text not null,attestation_version text not null check(attestation_version='2026-10-15'),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 unique(company_id,id),foreign key(company_id,profile_id,profile_version) references private.company_store_profile_versions(company_id,id,version),
 check(snapshot->>'companyId'=company_id::text and snapshot->>'profileId'=profile_id::text and snapshot->'profileVersion'=to_jsonb(profile_version)
  and source_sha256=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex')
  and canonical_content=jsonb_build_object('schemaVersion',1,'kind','trafexa_store_profile','channel',channel,'purpose',purpose,'profile',snapshot)::text
  and export_sha256=encode(sha256(convert_to(canonical_content,'UTF8')),'hex'))
);
create index company_store_exports_page on private.company_store_exports(company_id,created_at desc,id desc);
create index company_store_exports_profile on private.company_store_exports(company_id,profile_id,profile_version);
create index company_store_exports_actor on private.company_store_exports(created_by);
create table private.company_store_requests(
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,company_id uuid not null references public.companies(id),
 operation text not null check(operation in('create','save','export')),payload jsonb not null,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(actor_user_id,request_id)
);
create index company_store_requests_company on private.company_store_requests(company_id);
alter table private.company_store_profile_versions enable row level security;
alter table private.company_store_profile_heads enable row level security;
alter table private.company_store_exports enable row level security;
alter table private.company_store_requests enable row level security;
revoke all on private.company_store_profile_versions,private.company_store_profile_heads,private.company_store_exports,private.company_store_requests from public,anon,authenticated,service_role;
create trigger company_store_profile_immutable before update or delete on private.company_store_profile_versions for each row execute function private.reject_company_team_audit_mutation();
create trigger company_store_export_immutable before update or delete on private.company_store_exports for each row execute function private.reject_company_team_audit_mutation();
create trigger company_store_request_immutable before update or delete on private.company_store_requests for each row execute function private.reject_company_team_audit_mutation();

create function private.company_store_text_valid(p_value text,p_min integer,p_max integer,p_multiline boolean default false) returns boolean
language plpgsql immutable security invoker set search_path='' as $$declare trim_chars text:=chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);begin
 if p_value is null or p_value<>btrim(p_value,trim_chars) or length(p_value) not between p_min and p_max
  or p_value ~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' or p_value ~ ('['||chr(128)||'-'||chr(159)||']')
  or (not p_multiline and p_value ~ '[[:cntrl:]]') then return false;end if;
 -- Unicode code points, matching Array.from(value).length in the server validator.
 return true;
end$$;
create function private.company_store_url_valid(p_value text) returns boolean
language plpgsql immutable security invoker set search_path='' as $$declare host text;path text;label text;segment text;begin
 if p_value is null then return true;end if;
 if length(p_value)>2048 or p_value !~ '^https://[^/]+/.*$' or p_value ~ '[[:space:][:cntrl:]]' or position(chr(92) in p_value)>0
  or p_value ~ '[?#]' then return false;end if;
 host:=split_part(substr(p_value,9),'/',1);path:=substr(p_value,9+length(host));
 if length(host)>253 or host<>lower(host) or host !~ '^[a-z0-9.-]+$' or host !~ '\.' or host ~ '\.$' or host ~ '^[0-9.]+$'
  or split_part(host,'.',array_length(string_to_array(host,'.'),1)) !~ '[a-z]'
  or split_part(host,'.',array_length(string_to_array(host,'.'),1)) ~ '^0x[0-9a-f]+$'
  or host ~ '(^|\.)(localhost|local|internal|test|example|invalid|onion)$' or host ~ '(^|\.)home\.arpa$'
  or host ~ '(^|\.)example\.(com|net|org)$' then return false;end if;
 foreach label in array string_to_array(host,'.') loop
  -- ASCII DNS only in v1. No partial IDNA/UTS46 parser in SQL: reject both
  -- invalid and valid punycode labels rather than persist an unreadable URL.
  if length(label) not between 1 and 63 or label !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' or label like 'xn--%' then return false;end if;
 end loop;
 if path ~ '[^\x21-\x7e]' or path ~ '["<>{}]' or position(chr(96) in path)>0
  or regexp_replace(path,'%[0-9a-fA-F]{2}','','g') like '%\%%' escape '\'
  or path ~* '%(0[0-9a-f]|1[0-9a-f]|7f|5c)' then return false;end if;
 foreach segment in array string_to_array(path,'/') loop
  if regexp_replace(segment,'%2e','.','gi') in('.','..') then return false;end if;
 end loop;
 return true;
end$$;
create function private.company_store_fields(p_fields jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$declare k text;v text;minimum integer;maximum integer;multi boolean;begin
 if p_fields is null or jsonb_typeof(p_fields)<>'object' or octet_length(p_fields::text)>65536
  or not(p_fields ?& array['displayName','addressLine1','addressLine2','postalCode','city','countryCode','publicEmail','publicPhone','websiteUrl','logoUrl','description','openingHoursText'])
  or p_fields-array['displayName','addressLine1','addressLine2','postalCode','city','countryCode','publicEmail','publicPhone','websiteUrl','logoUrl','description','openingHoursText']<>'{}'::jsonb then
  raise exception 'Invalid store profile fields' using errcode='22023';end if;
 foreach k in array array['displayName','addressLine1','addressLine2','postalCode','city','countryCode','publicEmail','publicPhone','websiteUrl','logoUrl','description','openingHoursText'] loop
  if p_fields->k='null'::jsonb and k in('addressLine2','websiteUrl','logoUrl','description','openingHoursText') then continue;end if;
  if jsonb_typeof(p_fields->k)<>'string' then raise exception 'Invalid store profile fields' using errcode='22023';end if;
  v:=p_fields->>k;minimum:=case when k in('displayName','addressLine1','city') then 2 when k='publicEmail' then 3 when k='publicPhone' then 7 else 1 end;
  maximum:=case k when 'city' then 100 when 'postalCode' then 5 when 'countryCode' then 2 when 'publicEmail' then 254 when 'publicPhone' then 40 when 'websiteUrl' then 2048 when 'logoUrl' then 2048 when 'description' then 5000 when 'openingHoursText' then 2000 else 160 end;
  multi:=k in('description','openingHoursText');
  if not private.company_store_text_valid(v,minimum,maximum,multi)
   or (k='postalCode' and v !~ '^[0-9]{5}$') or (k='countryCode' and v<>'SE')
   -- NBSP, narrow NBSP and BOM are ECMAScript whitespace but are not all
   -- classified as POSIX space by PostgreSQL's Unicode locale.
   or (k='publicEmail' and (v<>lower(v) or v !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or v ~ ('['||chr(160)||chr(8239)||chr(65279)||']')))
   or (k='publicPhone' and (v !~ '^\+?[0-9 ()-]+$' or length(regexp_replace(v,'[^0-9]','','g')) not between 7 and 15))
   or (k in('websiteUrl','logoUrl') and not private.company_store_url_valid(v)) then raise exception 'Invalid store profile fields' using errcode='22023';end if;
 end loop;
 return p_fields;
end$$;
create function private.company_store_access(p_company uuid,p_actor uuid) returns text
language plpgsql security invoker set search_path='' as $$declare state text;r text;begin
 select c.status into state from public.companies c where c.id=p_company for share;
 if state is distinct from 'active' then raise exception 'Store profile access denied' using errcode='42501';end if;
 select m.role into r from public.memberships m where m.company_id=p_company and m.user_id=p_actor and m.status='active' for share;
 if r is null or r not in('owner','admin') then raise exception 'Store profile access denied' using errcode='42501';end if;
 return r;
end$$;
create function private.company_store_identity_valid(p_org text) returns boolean
language plpgsql immutable security invoker set search_path='' as $$begin
 return private.normalize_organisation_number(p_org)=p_org;
exception when sqlstate '22023' then return false;end$$;
create function private.company_store_profile_json(p private.company_store_profile_versions,p_actor uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select jsonb_build_object('id',p.id,'companyId',p.company_id,'version',p.version,'fields',p.fields,'createdAt',p.created_at,'actorLabel',case when p.created_by=p_actor then 'Du' else 'Kollega' end)$$;
create function private.company_store_source(p private.company_store_profile_versions) returns jsonb
language sql stable security invoker set search_path='' as $$select jsonb_build_object('schemaVersion',1,'companyId',p.company_id,'profileId',p.id,'profileVersion',p.version,'legalName',c.name,'organisationNumber',c.organisation_number,'shop',p.fields) from public.companies c where c.id=p.company_id$$;
create function private.company_store_export_json(e private.company_store_exports,p_actor uuid,p_full boolean) returns jsonb
language sql stable security invoker set search_path='' as $$select jsonb_build_object('id',e.id,'companyId',e.company_id,'channel',e.channel,'purpose',e.purpose,'profileId',e.profile_id,'profileVersion',e.profile_version,'sourceSha256',e.source_sha256,'exportSha256',e.export_sha256,'createdAt',e.created_at,'actorLabel',case when e.created_by=p_actor then 'Du' else 'Kollega' end,'status','prepared','attestationVersion',e.attestation_version)
 ||case when p_full then jsonb_build_object('snapshot',e.snapshot,'canonicalContent',e.canonical_content) else '{}'::jsonb end$$;

create function private.get_company_store_profile(p_company_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare a uuid;r text;p private.company_store_profile_versions;h private.company_store_profile_heads;c public.companies;source jsonb;identity_valid boolean;history jsonb;begin
 select x.user_id into a from private.company_team_identity(true)x;r:=private.company_store_access(p_company_id,a);
 select * into c from public.companies where id=p_company_id;
 select * into h from private.company_store_profile_heads where company_id=p_company_id for share;
 if h.profile_id is not null then select * into p from private.company_store_profile_versions where company_id=p_company_id and id=h.profile_id;source:=private.company_store_source(p);end if;
 identity_valid:=private.company_store_identity_valid(c.organisation_number);
 select coalesce(jsonb_agg(private.company_store_export_json(x,a,false) order by x.created_at desc,x.id desc),'[]') into history
 from(select * from private.company_store_exports where company_id=p_company_id order by created_at desc,id desc limit 20)x;
 return jsonb_build_object('actorId',a,'role',r,'companyId',p_company_id,'legalName',c.name,'organisationNumber',c.organisation_number,'identityValid',identity_valid,
  'profile',case when p.id is null then null else private.company_store_profile_json(p,a) end,'source',source,'sourceSha256',case when source is null then null else encode(sha256(convert_to(source::text,'UTF8')),'hex') end,
  'canExport',p.id is not null and identity_valid,'reason',case when p.id is null then 'profile_missing' when not identity_valid then 'invalid_organisation_number' else null end,'exports',history);
end$$;
create function private.company_store_mutate(p_operation text,p_company uuid,p_payload jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare a uuid;r text;prior private.company_store_requests;h private.company_store_profile_heads;p private.company_store_profile_versions;e private.company_store_exports;fields jsonb;source jsonb;receipt jsonb;v_org text;expected integer;source_hash text;canonical text;begin
 select x.user_id into a from private.company_team_identity(true)x;
 if p_request is null or p_operation is null or p_operation not in('create','save','export') then raise exception 'Invalid store request' using errcode='22023';end if;
 -- Same order for all mutations, including create replay whose company is in its receipt.
 perform pg_advisory_xact_lock(hashtextextended('company-store:'||a::text||':'||p_request::text,0));
 select * into prior from private.company_store_requests where actor_user_id=a and request_id=p_request;
 if p_operation='create' and prior.request_id is not null then r:=private.company_store_access(prior.company_id,a);
 elsif p_operation<>'create' then r:=private.company_store_access(p_company,a);end if;
 if prior.request_id is not null then
  if prior.operation<>p_operation or prior.payload is distinct from p_payload or (p_operation<>'create' and prior.company_id is distinct from p_company) then raise exception 'Store request payload conflict' using errcode='40001';end if;
  return prior.receipt||jsonb_build_object('actorId',a,'role',r);
 end if;
 if p_operation='create' then
  if p_payload->'representationAcknowledged' is distinct from 'true'::jsonb or not private.company_store_text_valid(p_payload->>'legalName',2,160)
   then raise exception 'Invalid new company fields' using errcode='22023';end if;
  v_org:=private.normalize_organisation_number(p_payload->>'organisationNumber');
  fields:=private.company_store_fields(p_payload->'fields');
  p_company:=private.create_company(p_payload->>'legalName',v_org);r:=private.company_store_access(p_company,a);
 else
  expected:=(p_payload->>'expectedVersion')::integer;
  if expected is null or expected<0 then raise exception 'Invalid profile version' using errcode='22023';end if;
 end if;
 if p_operation in('create','save') then
  if p_operation='save' then
   if p_payload->'acknowledged' is distinct from 'true'::jsonb then raise exception 'Profile acknowledgement required' using errcode='22023';end if;
   fields:=private.company_store_fields(p_payload->'fields');
  end if;
  insert into private.company_store_profile_heads(company_id) values(p_company) on conflict(company_id) do nothing;
  select * into h from private.company_store_profile_heads where company_id=p_company for update;
  if p_operation='save' and h.profile_version<>expected then raise exception 'Store profile version conflict' using errcode='40001';end if;
  insert into private.company_store_profile_versions(company_id,version,fields,created_by) values(p_company,h.profile_version+1,fields,a) returning * into p;
  update private.company_store_profile_heads set profile_id=p.id,profile_version=p.version where company_id=p_company;
  source:=private.company_store_source(p);
  receipt:=jsonb_build_object('actorId',a,'role',r,'companyId',p_company,'requestId',p_request,'profile',private.company_store_profile_json(p,a),'source',source,'sourceSha256',encode(sha256(convert_to(source::text,'UTF8')),'hex'));
 else
  if p_payload->'acknowledged' is distinct from 'true'::jsonb or p_payload->>'attestationVersion' is distinct from '2026-10-15'
   or p_payload->>'channel' is null or p_payload->>'channel' not in('blocket','wayke') or p_payload->>'purpose' is null or p_payload->>'purpose' not in('new_store','existing_store')
   or p_payload->>'expectedSourceSha256' is null or p_payload->>'expectedSourceSha256' !~ '^[0-9a-f]{64}$' then raise exception 'Invalid reviewed export fields' using errcode='22023';end if;
  select * into h from private.company_store_profile_heads where company_id=p_company for share;
  if h.profile_id is null or h.profile_version<>expected then raise exception 'Store profile version conflict' using errcode='40001';end if;
  select * into p from private.company_store_profile_versions where company_id=p_company and id=h.profile_id;
  source:=private.company_store_source(p);source_hash:=encode(sha256(convert_to(source::text,'UTF8')),'hex');
  if source_hash is distinct from p_payload->>'expectedSourceSha256' then raise exception 'Store source identity conflict' using errcode='40001';end if;
  if not private.company_store_identity_valid(source->>'organisationNumber') then raise exception 'Invalid organisation number for export' using errcode='22023';end if;
  canonical:=jsonb_build_object('schemaVersion',1,'kind','trafexa_store_profile','channel',p_payload->>'channel','purpose',p_payload->>'purpose','profile',source)::text;
  insert into private.company_store_exports(company_id,channel,purpose,profile_id,profile_version,snapshot,source_sha256,canonical_content,export_sha256,attestation_version,created_by)
   values(p_company,p_payload->>'channel',p_payload->>'purpose',p.id,p.version,source,source_hash,canonical,encode(sha256(convert_to(canonical,'UTF8')),'hex'),'2026-10-15',a) returning * into e;
  receipt:=jsonb_build_object('actorId',a,'role',r,'companyId',p_company,'requestId',p_request,'export',private.company_store_export_json(e,a,true));
 end if;
 insert into private.company_store_requests(actor_user_id,request_id,company_id,operation,payload,receipt) values(a,p_request,p_company,p_operation,p_payload,receipt);
 return receipt;
end$$;
create function private.get_company_store_export(p_company_id uuid,p_export_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare a uuid;r text;e private.company_store_exports;begin
 select x.user_id into a from private.company_team_identity(true)x;r:=private.company_store_access(p_company_id,a);
 select * into e from private.company_store_exports where company_id=p_company_id and id=p_export_id;
 if not found then raise exception 'Store export access denied' using errcode='42501';end if;
 return jsonb_build_object('actorId',a,'role',r,'companyId',p_company_id,'export',private.company_store_export_json(e,a,true));
end$$;
create function public.get_company_store_profile(p_company_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.get_company_store_profile(p_company_id)$$;
create function public.create_company_with_profile(p_legal_name text,p_organisation_number text,p_fields jsonb,p_representation_acknowledged boolean,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.company_store_mutate('create',null,jsonb_build_object('legalName',p_legal_name,'organisationNumber',p_organisation_number,'fields',p_fields,'representationAcknowledged',p_representation_acknowledged),p_request_id)$$;
create function public.save_company_store_profile(p_company_id uuid,p_expected_version integer,p_fields jsonb,p_acknowledged boolean,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.company_store_mutate('save',p_company_id,jsonb_build_object('companyId',p_company_id,'expectedVersion',p_expected_version,'fields',p_fields,'acknowledged',p_acknowledged),p_request_id)$$;
create function public.prepare_company_store_export(p_company_id uuid,p_expected_version integer,p_expected_source_sha256 text,p_channel text,p_purpose text,p_acknowledged boolean,p_attestation_version text,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.company_store_mutate('export',p_company_id,jsonb_build_object('companyId',p_company_id,'expectedVersion',p_expected_version,'expectedSourceSha256',p_expected_source_sha256,'channel',p_channel,'purpose',p_purpose,'acknowledged',p_acknowledged,'attestationVersion',p_attestation_version),p_request_id)$$;
create function public.get_company_store_export(p_company_id uuid,p_export_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.get_company_store_export(p_company_id,p_export_id)$$;
revoke all on function private.company_store_text_valid(text,integer,integer,boolean),private.company_store_url_valid(text),private.company_store_fields(jsonb),private.company_store_access(uuid,uuid),private.company_store_identity_valid(text),private.company_store_profile_json(private.company_store_profile_versions,uuid),private.company_store_source(private.company_store_profile_versions),private.company_store_export_json(private.company_store_exports,uuid,boolean),private.get_company_store_profile(uuid),private.company_store_mutate(text,uuid,jsonb,uuid),private.get_company_store_export(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_company_store_profile(uuid),private.company_store_mutate(text,uuid,jsonb,uuid),private.get_company_store_export(uuid,uuid) to authenticated;
revoke all on function public.get_company_store_profile(uuid),public.create_company_with_profile(text,text,jsonb,boolean,uuid),public.save_company_store_profile(uuid,integer,jsonb,boolean,uuid),public.prepare_company_store_export(uuid,integer,text,text,text,boolean,text,uuid),public.get_company_store_export(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_company_store_profile(uuid),public.create_company_with_profile(text,text,jsonb,boolean,uuid),public.save_company_store_profile(uuid,integer,jsonb,boolean,uuid),public.prepare_company_store_export(uuid,integer,text,text,text,boolean,text,uuid),public.get_company_store_export(uuid,uuid) to authenticated;
commit;
