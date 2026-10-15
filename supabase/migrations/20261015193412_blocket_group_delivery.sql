-- Blocket group provisioning and durable revision delivery. No token or live worker.
begin;
create table private.blocket_groups(
 id uuid primary key,version integer not null check(version>0),
 group_reference text not null check(private.company_store_text_valid(group_reference,1,160,false)),
 credential_reference text not null check(credential_reference~'^[a-z0-9_-]{1,100}$'),
 scope text not null check(scope in('dealer_group','dealer_code')),status text not null check(status in('active','disabled')),
 updated_at timestamptz not null default clock_timestamp()
);
create table private.blocket_company_bindings(
 company_id uuid primary key references public.companies(id),connection_id uuid not null unique references private.advertising_connections(id),
 connection_version integer not null check(connection_version>0),group_id uuid not null references private.blocket_groups(id),group_version integer not null check(group_version>0),
 dealer_code text not null check(private.company_store_text_valid(dealer_code,1,160,false)),
 evidence_reference text not null check(private.company_store_text_valid(evidence_reference,1,500,false)),
 valid_until timestamptz not null,status text not null check(status in('verified','disabled'))
);
create unique index blocket_active_dealer on private.blocket_company_bindings(dealer_code)where status='verified';
create index blocket_binding_group on private.blocket_company_bindings(group_id);
create table private.blocket_provision_audit(
 id uuid primary key default gen_random_uuid(),actor_user_id uuid not null references auth.users(id),request_id uuid not null,
 action text not null check(action in('group','bind','disable')),payload jsonb not null,receipt jsonb not null,
 previous_value jsonb,current_value jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(actor_user_id,request_id)
);
create index blocket_provision_actor on private.blocket_provision_audit(actor_user_id,created_at desc);
create table private.blocket_delivery_identities(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),listing_id uuid not null,
 source_id uuid not null,dealer_code text not null,provider_ad_id text,
 foreign key(company_id,listing_id)references private.advertising_listings(company_id,id),
 unique(listing_id),unique(dealer_code,source_id),check(source_id=listing_id)
);
create index blocket_delivery_dealer on private.blocket_delivery_identities(dealer_code,company_id);
create table private.blocket_delivery_revisions(
 id uuid primary key default gen_random_uuid(),identity_id uuid not null references private.blocket_delivery_identities(id),
 job_id uuid not null unique references private.advertising_jobs(id),listing_version integer not null check(listing_version>0),
 connection_id uuid not null references private.advertising_connections(id),connection_version integer not null,
 revision integer not null check(revision>0),operation text not null check(operation in('create','update')),
 payload_sha256 text not null check(payload_sha256~'^[0-9a-f]{64}$'),claim_token uuid not null,
 status text not null check(status in('dispatching','submitted','outcome_unknown','published','rejected')),version integer not null default 1 check(version>0),
 provider_request_id uuid,provider_ad_id text,evidence_sha256 text check(evidence_sha256~'^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(identity_id,revision),unique(identity_id,listing_version),
 check(status<>'published'or(provider_request_id is not null and provider_ad_id is not null and evidence_sha256 is not null))
);
create table private.blocket_delivery_events(
 id uuid primary key default gen_random_uuid(),delivery_id uuid not null references private.blocket_delivery_revisions(id),
 version integer not null,previous_value jsonb,current_value jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(delivery_id,version)
);
do $$declare t text;begin foreach t in array array['blocket_groups','blocket_company_bindings','blocket_provision_audit','blocket_delivery_identities','blocket_delivery_revisions','blocket_delivery_events']loop
 execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);end loop;end$$;
create trigger immutable_blocket_provision_audit before update or delete on private.blocket_provision_audit for each row execute function private.reject_company_team_audit_mutation();
create trigger immutable_blocket_delivery_events before update or delete on private.blocket_delivery_events for each row execute function private.reject_company_team_audit_mutation();

create function private.blocket_group_json(g private.blocket_groups)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('id',g.id,'version',g.version,'groupReference',g.group_reference,'credentialReference',g.credential_reference,'scope',g.scope,'status',g.status,'updatedAt',g.updated_at);
$$;
create function private.blocket_binding_json(b private.blocket_company_bindings)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('companyId',b.company_id,'connectionId',b.connection_id,'connectionVersion',b.connection_version,'groupId',b.group_id,'groupVersion',b.group_version,'dealerCode',b.dealer_code,'evidenceReference',b.evidence_reference,'validUntil',b.valid_until,'status',case when b.status='verified'and b.valid_until>clock_timestamp()and exists(select 1 from private.blocket_groups g where g.id=b.group_id and g.version=b.group_version and g.status='active')and exists(select 1 from private.advertising_connections c where c.id=b.connection_id and c.company_id=b.company_id and c.version=b.connection_version and c.status='verified'and c.account_reference=b.dealer_code)then 'verified'else 'disabled'end);
$$;
create function private.blocket_admin_identity()returns uuid language plpgsql security invoker set search_path=''as $$
declare a uuid:=auth.uid();s text;begin
 if current_setting('role',true)<>'authenticated'or a is null then raise exception 'Platform admin required'using errcode='42501';end if;
 perform private.company_team_account(a,true);
 select status into s from private.platform_admins where user_id=a for share;
 if s is distinct from 'active'then raise exception 'Platform admin required'using errcode='42501';end if;return a;
end$$;
revoke all on function private.blocket_admin_identity()from public,anon,authenticated,service_role;
create function private.get_platform_blocket_provisioning(p_company_id uuid,p_page_key uuid,p_limit integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid;c public.companies%rowtype;items jsonb;next_key uuid;b private.blocket_company_bindings%rowtype;begin
 a:=private.blocket_admin_identity();select *into c from public.companies where id=p_company_id for share;
 if c.id is null then raise exception 'Company missing'using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid group page'using errcode='22023';end if;
 select coalesce(jsonb_agg(private.blocket_group_json(g)order by g.id),'[]')into items from(select *from private.blocket_groups where p_page_key is null or id>p_page_key order by id limit p_limit)g;
 if jsonb_array_length(items)=p_limit and exists(select 1 from private.blocket_groups where id>(items->(p_limit-1)->>'id')::uuid)then next_key:=(items->(p_limit-1)->>'id')::uuid;end if;
 select *into b from private.blocket_company_bindings where company_id=p_company_id;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'legalName',c.name,'organisationNumber',c.organisation_number,'groups',items,'nextPageKey',next_key,'connectionVersion',coalesce((select version from private.advertising_connections where company_id=p_company_id and channel='blocket'),0),'binding',case when b.company_id is null then null else private.blocket_binding_json(b)end);
end$$;
create function private.blocket_service_identity()returns void language plpgsql security invoker set search_path=''as $$
begin if current_setting('role',true)<>'service_role'then raise exception 'Trusted Blocket worker required'using errcode='42501';end if;end$$;
create function private.blocket_delivery_json(r private.blocket_delivery_revisions)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('id',r.id,'companyId',i.company_id,'listingId',i.listing_id,'listingVersion',r.listing_version,'sourceId',i.source_id,'dealerCode',i.dealer_code,'revision',r.revision,'operation',r.operation,'providerAdId',r.provider_ad_id,'connectionId',r.connection_id,'connectionVersion',r.connection_version,'payloadSha256',r.payload_sha256,'providerRequestId',r.provider_request_id,'status',r.status,'version',r.version)from private.blocket_delivery_identities i where i.id=r.identity_id;
$$;
create function private.get_blocket_delivery(p_job_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r private.blocket_delivery_revisions%rowtype;begin perform private.blocket_service_identity();select *into r from private.blocket_delivery_revisions where job_id=p_job_id;return case when r.id is null then null else private.blocket_delivery_json(r)end;end$$;
create function private.guard_blocket_delivery_identity()returns trigger language plpgsql security invoker set search_path=''as $$
begin if tg_op='DELETE'or(to_jsonb(new)-'provider_ad_id')is distinct from(to_jsonb(old)-'provider_ad_id')or old.provider_ad_id is not null or new.provider_ad_id is null then raise exception 'Blocket delivery identity immutable'using errcode='55000';end if;return new;end$$;
create trigger guard_blocket_delivery_identity before update or delete on private.blocket_delivery_identities for each row execute function private.guard_blocket_delivery_identity();
create function private.guard_blocket_delivery_revision()returns trigger language plpgsql security invoker set search_path=''as $$
begin if tg_op='DELETE'then raise exception 'Blocket delivery immutable'using errcode='55000';end if;
 if(to_jsonb(new)-array['status','version','provider_request_id','provider_ad_id','evidence_sha256','updated_at'])is distinct from(to_jsonb(old)-array['status','version','provider_request_id','provider_ad_id','evidence_sha256','updated_at'])or new.version<>old.version+1 or old.status in('published','rejected')or(old.provider_request_id is not null and new.provider_request_id is distinct from old.provider_request_id)or(old.provider_ad_id is not null and new.provider_ad_id is distinct from old.provider_ad_id)then raise exception 'Blocket delivery revision immutable'using errcode='55000';end if;return new;
end$$;
create trigger guard_blocket_delivery_revision before update or delete on private.blocket_delivery_revisions for each row execute function private.guard_blocket_delivery_revision();

-- The generic worker remains compatible with unprovisioned prototype fixtures.
-- Once a connection is group-managed, actual claim and publication must pass this
-- database boundary even if callers bypass the TypeScript worker.
create function private.guard_blocket_managed_job()returns trigger language plpgsql security invoker set search_path=''as $$
declare b private.blocket_company_bindings%rowtype;g private.blocket_groups%rowtype;r private.blocket_delivery_revisions%rowtype;i private.blocket_delivery_identities%rowtype;
begin
 if new.channel<>'blocket'then return new;end if;
 select *into b from private.blocket_company_bindings where connection_id=new.connection_id;
 if b.company_id is null then return new;end if;
 if new.status='dispatching'and old.status is distinct from 'dispatching'then
 select *into b from private.blocket_company_bindings where connection_id=new.connection_id for share;
 select *into g from private.blocket_groups where id=b.group_id for share;
 if b.status<>'verified'or b.valid_until<=clock_timestamp()or b.company_id<>new.company_id or b.connection_version<>new.connection_version or b.dealer_code<>new.account_reference or g.status<>'active'or g.version<>b.group_version or new.dispatcher_id<>'blocket_'||replace(g.id::text,'-','')then raise exception 'Blocket verified binding changed'using errcode='40001';end if;
 elsif new.status='published'then
 select *into r from private.blocket_delivery_revisions where job_id=new.id;
 select *into i from private.blocket_delivery_identities where id=r.identity_id;
 if r.id is null or r.status<>'published'or r.listing_version<>new.listing_version or r.connection_id<>new.connection_id or r.connection_version<>new.connection_version or r.provider_ad_id is distinct from new.provider_ad_id or i.company_id<>new.company_id or i.listing_id<>new.listing_id or i.dealer_code<>new.account_reference then raise exception 'Blocket current revision evidence required'using errcode='40001';end if;
 end if;return new;
end$$;
create trigger blocket_managed_job_guard before update on private.advertising_jobs for each row execute function private.guard_blocket_managed_job();

create function private.begin_blocket_delivery(p_job_id uuid,p_expected_job_version integer,p_claim_token uuid,p_payload_sha256 text)returns jsonb language plpgsql security definer set search_path=''as $$
declare j private.advertising_jobs%rowtype;i private.blocket_delivery_identities%rowtype;r private.blocket_delivery_revisions%rowtype;previous_r private.blocket_delivery_revisions%rowtype;job_json jsonb;begin
 perform private.blocket_service_identity();if p_claim_token is null or p_payload_sha256 is null or p_payload_sha256!~'^[0-9a-f]{64}$'then raise exception 'Invalid Blocket delivery intent'using errcode='22023';end if;
 select *into j from private.advertising_jobs where id=p_job_id;
 if j.id is null or j.channel<>'blocket'then raise exception 'Blocket job required'using errcode='42501';end if;
 -- A lost commit response may be reread, but NEVER authorizes another network write.
 select *into r from private.blocket_delivery_revisions where job_id=p_job_id;
 if r.id is not null then
 if r.claim_token<>p_claim_token or r.payload_sha256<>p_payload_sha256 then raise exception 'Blocket delivery intent conflict'using errcode='40001';end if;
 return jsonb_build_object('job',private.advertising_job_json(j,true),'delivery',private.blocket_delivery_json(r),'replayed',true);end if;
 job_json:=private.advertising_worker('claim',p_job_id,p_expected_job_version,p_claim_token,null,null,null,null,null,null,null);
 select *into j from private.advertising_jobs where id=p_job_id;
 if not exists(select 1 from private.blocket_company_bindings where connection_id=j.connection_id)then raise exception 'Provisioned Blocket binding required'using errcode='42501';end if;
 select *into i from private.blocket_delivery_identities where listing_id=j.listing_id for update;
 if i.id is null then
 if exists(select 1 from private.blocket_delivery_identities where dealer_code=j.account_reference and company_id<>j.company_id)then raise exception 'Blocket dealer identity conflict'using errcode='40001';end if;
 insert into private.blocket_delivery_identities(company_id,listing_id,source_id,dealer_code)values(j.company_id,j.listing_id,j.listing_id,j.account_reference)returning *into i;
 elsif i.company_id<>j.company_id or i.dealer_code<>j.account_reference then raise exception 'Blocket delivery identity conflict'using errcode='40001';end if;
 select *into previous_r from private.blocket_delivery_revisions where identity_id=i.id order by revision desc limit 1;
 if previous_r.id is not null and previous_r.status not in('published','rejected')then raise exception 'Blocket unresolved revision conflict'using errcode='40001';end if;
 if previous_r.id is not null and j.listing_version<=previous_r.listing_version then raise exception 'Blocket listing revision conflict'using errcode='40001';end if;
 insert into private.blocket_delivery_revisions(identity_id,job_id,listing_version,connection_id,connection_version,revision,operation,payload_sha256,claim_token,status,provider_ad_id)
 values(i.id,j.id,j.listing_version,j.connection_id,j.connection_version,coalesce(previous_r.revision,0)+1,case when i.provider_ad_id is null then 'create'else 'update'end,p_payload_sha256,p_claim_token,'dispatching',i.provider_ad_id)returning *into r;
 insert into private.blocket_delivery_events(delivery_id,version,current_value)values(r.id,r.version,to_jsonb(r));
 return jsonb_build_object('job',job_json,'delivery',private.blocket_delivery_json(r),'replayed',false);
end$$;
create function private.record_blocket_delivery(p_job_id uuid,p_delivery_id uuid,p_expected_version integer,p_claim_token uuid,p_status text,p_provider_request_id uuid,p_provider_ad_id text,p_evidence_sha256 text)returns jsonb language plpgsql security definer set search_path=''as $$
declare r private.blocket_delivery_revisions%rowtype;i private.blocket_delivery_identities%rowtype;old_r jsonb;begin
 perform private.blocket_service_identity();
 if p_status is null or p_status not in('submitted','outcome_unknown','published','rejected')or p_expected_version is null or p_expected_version<1 or(p_provider_ad_id is not null and p_provider_ad_id!~'^[0-9]{1,30}$')or(p_evidence_sha256 is not null and p_evidence_sha256!~'^[0-9a-f]{64}$')then raise exception 'Invalid Blocket delivery receipt'using errcode='22023';end if;
 select i0.*into i from private.blocket_delivery_identities i0 join private.blocket_delivery_revisions r0 on r0.identity_id=i0.id where r0.id=p_delivery_id and r0.job_id=p_job_id for update of i0;
 select *into r from private.blocket_delivery_revisions where id=p_delivery_id and job_id=p_job_id for update;
 if r.id is null then raise exception 'Blocket delivery missing'using errcode='42501';end if;
 if p_claim_token is not null and p_claim_token<>r.claim_token then raise exception 'Blocket claim token conflict'using errcode='40001';end if;
 if r.status=p_status and r.provider_request_id is not distinct from p_provider_request_id and r.provider_ad_id is not distinct from p_provider_ad_id and r.evidence_sha256 is not distinct from p_evidence_sha256 then return private.blocket_delivery_json(r);end if;
 if r.version<>p_expected_version or r.status in('published','rejected')or(r.status='dispatching'and p_claim_token is distinct from r.claim_token)or(r.provider_request_id is not null and r.provider_request_id is distinct from p_provider_request_id)or(r.provider_ad_id is not null and r.provider_ad_id is distinct from p_provider_ad_id)or(i.provider_ad_id is not null and i.provider_ad_id is distinct from p_provider_ad_id)then raise exception 'Blocket delivery receipt conflict'using errcode='40001';end if;
 if p_status='published'and(r.provider_request_id is null or p_provider_request_id is null or p_provider_ad_id is null or p_evidence_sha256 is null)then raise exception 'Blocket correlated publication required'using errcode='40001';end if;
 if p_status='submitted'and p_provider_request_id is null then raise exception 'Blocket request correlation required'using errcode='22023';end if;
 if p_status<>'published'and p_evidence_sha256 is not null then raise exception 'Unexpected Blocket publication evidence'using errcode='22023';end if;
 old_r:=to_jsonb(r);
 update private.blocket_delivery_revisions set status=p_status,version=version+1,provider_request_id=p_provider_request_id,provider_ad_id=p_provider_ad_id,evidence_sha256=p_evidence_sha256,updated_at=clock_timestamp()where id=r.id returning *into r;
 if p_status='published'and i.provider_ad_id is null then update private.blocket_delivery_identities set provider_ad_id=p_provider_ad_id where id=i.id;end if;
 insert into private.blocket_delivery_events(delivery_id,version,previous_value,current_value)values(r.id,r.version,old_r,to_jsonb(r));return private.blocket_delivery_json(r);
end$$;
create function private.blocket_provision_replay(p_actor uuid,p_request uuid,p_payload jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare prior private.blocket_provision_audit%rowtype;begin
 if p_request is null then raise exception 'Request UUID required'using errcode='22023';end if;
 select *into prior from private.blocket_provision_audit where actor_user_id=p_actor and request_id=p_request;
 if found then if prior.payload is distinct from p_payload then raise exception 'Blocket provision payload conflict'using errcode='40001';end if;return prior.receipt;end if;return null;
end$$;
create function private.configure_blocket_group(p_group_id uuid,p_expected_version integer,p_group_reference text,p_credential_reference text,p_scope text,p_status text,p_reason text,p_acknowledged boolean,p_request_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid;g private.blocket_groups%rowtype;old_g jsonb;payload jsonb;receipt jsonb;begin
 a:=private.blocket_admin_identity();
 if p_group_id is null or p_expected_version is null or p_expected_version<0 or not private.company_store_text_valid(p_group_reference,1,160,false)or p_credential_reference is null or p_credential_reference!~'^[a-z0-9_-]{1,100}$'or p_scope is null or p_scope not in('dealer_group','dealer_code')or p_status is null or p_status not in('active','disabled')or not private.company_store_text_valid(p_reason,1,500,false)or p_acknowledged is distinct from true then raise exception 'Invalid Blocket group review'using errcode='22023';end if;
 payload:=jsonb_build_object('action','group','groupId',p_group_id,'expectedVersion',p_expected_version,'groupReference',p_group_reference,'credentialReference',p_credential_reference,'scope',p_scope,'status',p_status,'reason',p_reason,'acknowledged',p_acknowledged);
 perform pg_advisory_xact_lock(hashtextextended('blocket-provision',0));receipt:=private.blocket_provision_replay(a,p_request_id,payload);if receipt is not null then return receipt;end if;
 perform 1 from private.advertising_dispatchers where id='blocket_'||replace(p_group_id::text,'-','')for update;
 select *into g from private.blocket_groups where id=p_group_id for update;
 if(g.id is null and p_expected_version<>0)or(g.id is not null and g.version<>p_expected_version)then raise exception 'Blocket group version conflict'using errcode='40001';end if;
 old_g:=case when g.id is null then null else to_jsonb(g)end;
 if g.id is null then insert into private.blocket_groups(id,version,group_reference,credential_reference,scope,status)values(p_group_id,1,p_group_reference,p_credential_reference,p_scope,p_status)returning *into g;
 else update private.blocket_groups set version=version+1,group_reference=p_group_reference,credential_reference=p_credential_reference,scope=p_scope,status=p_status,updated_at=clock_timestamp()where id=p_group_id returning *into g;end if;
 -- Any configuration change invalidates existing runtime readiness until explicitly refreshed.
 update private.advertising_dispatchers set available_until='-infinity',updated_at=clock_timestamp()where id='blocket_'||replace(g.id::text,'-','');
 receipt:=jsonb_build_object('actorUserId',a,'requestId',p_request_id,'group',private.blocket_group_json(g));
 insert into private.blocket_provision_audit(actor_user_id,request_id,action,payload,receipt,previous_value,current_value)values(a,p_request_id,'group',payload,receipt,old_g,to_jsonb(g));return receipt;
end$$;
create function private.bind_blocket_company(p_company_id uuid,p_group_id uuid,p_expected_group_version integer,p_expected_connection_version integer,p_dealer_code text,p_evidence_reference text,p_valid_until timestamptz,p_reason text,p_acknowledged boolean,p_request_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid;g private.blocket_groups%rowtype;c private.advertising_connections%rowtype;b private.blocket_company_bindings%rowtype;old_b jsonb;payload jsonb;receipt jsonb;s text;dispatcher text;begin
 a:=private.blocket_admin_identity();
 if p_group_id is null or p_company_id is null or p_expected_group_version is null or p_expected_group_version<1 or p_expected_connection_version is null or p_expected_connection_version<0 or not private.company_store_text_valid(p_dealer_code,1,160,false)or not private.company_store_text_valid(p_evidence_reference,1,500,false)or not private.company_store_text_valid(p_reason,1,500,false)or p_valid_until is null or p_acknowledged is distinct from true then raise exception 'Invalid Blocket binding review'using errcode='22023';end if;
 payload:=jsonb_build_object('action','bind','companyId',p_company_id,'groupId',p_group_id,'groupVersion',p_expected_group_version,'connectionVersion',p_expected_connection_version,'dealerCode',p_dealer_code,'evidenceReference',p_evidence_reference,'validUntil',p_valid_until,'reason',p_reason,'acknowledged',p_acknowledged);
 perform pg_advisory_xact_lock(hashtextextended('blocket-provision',0));receipt:=private.blocket_provision_replay(a,p_request_id,payload);if receipt is not null then return receipt;end if;
 if p_valid_until<=clock_timestamp()or p_valid_until>clock_timestamp()+interval '90 days'then raise exception 'Invalid Blocket binding validity'using errcode='22023';end if;
 select *into g from private.blocket_groups where id=p_group_id for share;
 if g.id is null or g.status<>'active'or g.version<>p_expected_group_version then raise exception 'Blocket group version conflict'using errcode='40001';end if;
 select status into s from public.companies where id=p_company_id for update;if s is distinct from 'active'then raise exception 'Company access denied'using errcode='42501';end if;
 select *into c from private.advertising_connections where company_id=p_company_id and channel='blocket'for update;
 if coalesce(c.version,0)<>p_expected_connection_version then raise exception 'Blocket connection version conflict'using errcode='40001';end if;
 if c.id is not null and c.account_reference<>p_dealer_code and exists(select 1 from private.advertising_jobs where connection_id=c.id and status not in('queued','retryable'))then raise exception 'Blocket existing delivery identity conflict'using errcode='40001';end if;
 select *into b from private.blocket_company_bindings where company_id=p_company_id for update;old_b:=case when b.company_id is null then null else to_jsonb(b)end;
 if exists(select 1 from private.blocket_company_bindings where company_id<>p_company_id and dealer_code=p_dealer_code and status='verified')or exists(select 1 from private.blocket_delivery_identities where(dealer_code=p_dealer_code and company_id<>p_company_id)or(company_id=p_company_id and dealer_code<>p_dealer_code))then raise exception 'Blocket dealer identity conflict'using errcode='40001';end if;
 if g.scope='dealer_code'and exists(select 1 from private.blocket_company_bindings where group_id=g.id and dealer_code<>p_dealer_code and status='verified')then raise exception 'Single dealer scope conflict'using errcode='40001';end if;
 dispatcher:='blocket_'||replace(g.id::text,'-','');
 insert into private.advertising_dispatchers(id,channel,available_until)values(dispatcher,'blocket','-infinity')on conflict(id)do update set available_until='-infinity',updated_at=clock_timestamp();
 if c.id is null then insert into private.advertising_connections(company_id,channel,account_reference,status,dispatcher_id,created_by)values(p_company_id,'blocket',p_dealer_code,'verified',dispatcher,a)returning *into c;
 else update private.advertising_connections set account_reference=p_dealer_code,status='verified',version=version+1,dispatcher_id=dispatcher where id=c.id returning *into c;end if;
 insert into private.blocket_company_bindings(company_id,connection_id,connection_version,group_id,group_version,dealer_code,evidence_reference,valid_until,status)
 values(p_company_id,c.id,c.version,g.id,g.version,p_dealer_code,p_evidence_reference,p_valid_until,'verified')on conflict(company_id)do update set connection_id=excluded.connection_id,connection_version=excluded.connection_version,group_id=excluded.group_id,group_version=excluded.group_version,dealer_code=excluded.dealer_code,evidence_reference=excluded.evidence_reference,valid_until=excluded.valid_until,status='verified'returning *into b;
 receipt:=jsonb_build_object('actorUserId',a,'requestId',p_request_id,'companyId',p_company_id,'binding',private.blocket_binding_json(b));
 insert into private.blocket_provision_audit(actor_user_id,request_id,action,payload,receipt,previous_value,current_value)values(a,p_request_id,'bind',payload,receipt,old_b,to_jsonb(b));return receipt;
 exception when unique_violation then raise exception 'Blocket binding conflict'using errcode='40001';
end$$;
create function private.disable_blocket_company(p_company_id uuid,p_expected_connection_version integer,p_reason text,p_acknowledged boolean,p_request_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid;b private.blocket_company_bindings%rowtype;c private.advertising_connections%rowtype;payload jsonb;receipt jsonb;old_b jsonb;begin
 a:=private.blocket_admin_identity();if p_expected_connection_version is null or p_expected_connection_version<1 or not private.company_store_text_valid(p_reason,1,500,false)or p_acknowledged is distinct from true then raise exception 'Invalid Blocket disable review'using errcode='22023';end if;
 payload:=jsonb_build_object('action','disable','companyId',p_company_id,'connectionVersion',p_expected_connection_version,'reason',p_reason,'acknowledged',p_acknowledged);
 perform pg_advisory_xact_lock(hashtextextended('blocket-provision',0));receipt:=private.blocket_provision_replay(a,p_request_id,payload);if receipt is not null then return receipt;end if;
 perform 1 from public.companies where id=p_company_id for update;
 select *into c from private.advertising_connections where company_id=p_company_id and channel='blocket'for update;
 select *into b from private.blocket_company_bindings where company_id=p_company_id for update;
 if b.company_id is null or c.version<>p_expected_connection_version or b.status<>'verified'then raise exception 'Blocket connection version conflict'using errcode='40001';end if;
 old_b:=to_jsonb(b);update private.advertising_connections set status='disabled',version=version+1 where id=c.id returning *into c;
 update private.blocket_company_bindings set status='disabled',connection_version=c.version where company_id=p_company_id returning *into b;
 receipt:=jsonb_build_object('actorUserId',a,'requestId',p_request_id,'companyId',p_company_id,'binding',private.blocket_binding_json(b));
 insert into private.blocket_provision_audit(actor_user_id,request_id,action,payload,receipt,previous_value,current_value)values(a,p_request_id,'disable',payload,receipt,old_b,to_jsonb(b));return receipt;
end$$;

-- Explicit invoker API surface; private helpers remain non-executable by clients.
revoke all on function private.blocket_group_json(private.blocket_groups),private.blocket_binding_json(private.blocket_company_bindings),private.blocket_provision_replay(uuid,uuid,jsonb),private.blocket_service_identity(),private.blocket_delivery_json(private.blocket_delivery_revisions),private.guard_blocket_delivery_identity(),private.guard_blocket_delivery_revision(),private.guard_blocket_managed_job()from public,anon,authenticated,service_role;
revoke all on function private.get_platform_blocket_provisioning(uuid,uuid,integer),private.configure_blocket_group(uuid,integer,text,text,text,text,text,boolean,uuid),private.bind_blocket_company(uuid,uuid,integer,integer,text,text,timestamptz,text,boolean,uuid),private.disable_blocket_company(uuid,integer,text,boolean,uuid)from public,anon,authenticated,service_role;
grant execute on function private.get_platform_blocket_provisioning(uuid,uuid,integer),private.configure_blocket_group(uuid,integer,text,text,text,text,text,boolean,uuid),private.bind_blocket_company(uuid,uuid,integer,integer,text,text,timestamptz,text,boolean,uuid),private.disable_blocket_company(uuid,integer,text,boolean,uuid)to authenticated;
create function public.get_platform_blocket_provisioning(p_company_id uuid,p_page_key uuid default null,p_limit integer default 50)returns jsonb language sql security invoker set search_path=''as $$select private.get_platform_blocket_provisioning(p_company_id,p_page_key,p_limit)$$;
create function public.configure_blocket_group(p_group_id uuid,p_expected_version integer,p_group_reference text,p_credential_reference text,p_scope text,p_status text,p_reason text,p_acknowledged boolean,p_request_id uuid)returns jsonb language sql security invoker set search_path=''as $$select private.configure_blocket_group(p_group_id,p_expected_version,p_group_reference,p_credential_reference,p_scope,p_status,p_reason,p_acknowledged,p_request_id)$$;
create function public.bind_blocket_company(p_company_id uuid,p_group_id uuid,p_expected_group_version integer,p_expected_connection_version integer,p_dealer_code text,p_evidence_reference text,p_valid_until timestamptz,p_reason text,p_acknowledged boolean,p_request_id uuid)returns jsonb language sql security invoker set search_path=''as $$select private.bind_blocket_company(p_company_id,p_group_id,p_expected_group_version,p_expected_connection_version,p_dealer_code,p_evidence_reference,p_valid_until,p_reason,p_acknowledged,p_request_id)$$;
create function public.disable_blocket_company(p_company_id uuid,p_expected_connection_version integer,p_reason text,p_acknowledged boolean,p_request_id uuid)returns jsonb language sql security invoker set search_path=''as $$select private.disable_blocket_company(p_company_id,p_expected_connection_version,p_reason,p_acknowledged,p_request_id)$$;
revoke all on function public.get_platform_blocket_provisioning(uuid,uuid,integer),public.configure_blocket_group(uuid,integer,text,text,text,text,text,boolean,uuid),public.bind_blocket_company(uuid,uuid,integer,integer,text,text,timestamptz,text,boolean,uuid),public.disable_blocket_company(uuid,integer,text,boolean,uuid)from public,anon,authenticated,service_role;
grant execute on function public.get_platform_blocket_provisioning(uuid,uuid,integer),public.configure_blocket_group(uuid,integer,text,text,text,text,text,boolean,uuid),public.bind_blocket_company(uuid,uuid,integer,integer,text,text,timestamptz,text,boolean,uuid),public.disable_blocket_company(uuid,integer,text,boolean,uuid)to authenticated;
revoke all on function private.get_blocket_delivery(uuid),private.begin_blocket_delivery(uuid,integer,uuid,text),private.record_blocket_delivery(uuid,uuid,integer,uuid,text,uuid,text,text)from public,anon,authenticated,service_role;
grant execute on function private.get_blocket_delivery(uuid),private.begin_blocket_delivery(uuid,integer,uuid,text),private.record_blocket_delivery(uuid,uuid,integer,uuid,text,uuid,text,text)to service_role;
create function public.get_blocket_delivery(p_job_id uuid)returns jsonb language sql security invoker set search_path=''as $$select private.get_blocket_delivery(p_job_id)$$;
create function public.begin_blocket_delivery(p_job_id uuid,p_expected_job_version integer,p_claim_token uuid,p_payload_sha256 text)returns jsonb language sql security invoker set search_path=''as $$select private.begin_blocket_delivery(p_job_id,p_expected_job_version,p_claim_token,p_payload_sha256)$$;
create function public.record_blocket_delivery(p_job_id uuid,p_delivery_id uuid,p_expected_version integer,p_claim_token uuid,p_status text,p_provider_request_id uuid,p_provider_ad_id text,p_evidence_sha256 text)returns jsonb language sql security invoker set search_path=''as $$select private.record_blocket_delivery(p_job_id,p_delivery_id,p_expected_version,p_claim_token,p_status,p_provider_request_id,p_provider_ad_id,p_evidence_sha256)$$;
revoke all on function public.get_blocket_delivery(uuid),public.begin_blocket_delivery(uuid,integer,uuid,text),public.record_blocket_delivery(uuid,uuid,integer,uuid,text,uuid,text,text)from public,anon,authenticated,service_role;
grant execute on function public.get_blocket_delivery(uuid),public.begin_blocket_delivery(uuid,integer,uuid,text),public.record_blocket_delivery(uuid,uuid,integer,uuid,text,uuid,text,text)to service_role;

create function private.blocket_worker_group_json(g private.blocket_groups)returns jsonb language sql stable security invoker set search_path=''as $$select private.blocket_group_json(g)||jsonb_build_object('dispatcherId','blocket_'||replace(g.id::text,'-',''))$$;
create function private.get_blocket_worker_group(p_group_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare g private.blocket_groups%rowtype;begin perform private.blocket_service_identity();select *into g from private.blocket_groups where id=p_group_id;if g.id is null or g.status<>'active'then raise exception 'Blocket worker group unavailable'using errcode='42501';end if;return private.blocket_worker_group_json(g);end$$;
create function private.get_blocket_worker_binding(p_job_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare j private.advertising_jobs%rowtype;b private.blocket_company_bindings%rowtype;g private.blocket_groups%rowtype;c private.advertising_connections%rowtype;begin
 perform private.blocket_service_identity();select *into j from private.advertising_jobs where id=p_job_id;
 if j.id is null or j.channel<>'blocket'then raise exception 'Blocket worker binding unavailable'using errcode='42501';end if;
 select *into b from private.blocket_company_bindings where connection_id=j.connection_id;select *into g from private.blocket_groups where id=b.group_id;
 select *into c from private.advertising_connections where id=j.connection_id;
 if b.company_id is null or b.company_id<>j.company_id or b.connection_version<>j.connection_version or b.dealer_code<>j.account_reference or b.status<>'verified'or b.valid_until<=clock_timestamp()or g.id is null or g.status<>'active'or g.version<>b.group_version or c.status<>'verified'or c.company_id<>j.company_id or c.version<>j.connection_version or c.account_reference<>j.account_reference or c.dispatcher_id<>j.dispatcher_id or j.dispatcher_id<>'blocket_'||replace(g.id::text,'-','')or not exists(select 1 from public.companies where id=j.company_id and status='active')or not exists(select 1 from public.memberships where company_id=j.company_id and user_id=j.created_by and status='active'and role in('owner','admin','sales'))then raise exception 'Blocket worker binding unavailable'using errcode='42501';end if;
 perform private.company_team_account(j.created_by,false);
 return jsonb_build_object('companyId',b.company_id,'connectionId',b.connection_id,'connectionVersion',b.connection_version,'accountReference',b.dealer_code,'validUntil',b.valid_until,'group',private.blocket_worker_group_json(g));
end$$;
revoke all on function private.blocket_worker_group_json(private.blocket_groups),private.get_blocket_worker_group(uuid),private.get_blocket_worker_binding(uuid)from public,anon,authenticated,service_role;
grant execute on function private.get_blocket_worker_group(uuid),private.get_blocket_worker_binding(uuid)to service_role;
create function public.get_blocket_worker_group(p_group_id uuid)returns jsonb language sql security invoker set search_path=''as $$select private.get_blocket_worker_group(p_group_id)$$;
create function public.get_blocket_worker_binding(p_job_id uuid)returns jsonb language sql security invoker set search_path=''as $$select private.get_blocket_worker_binding(p_job_id)$$;
revoke all on function public.get_blocket_worker_group(uuid),public.get_blocket_worker_binding(uuid)from public,anon,authenticated,service_role;
grant execute on function public.get_blocket_worker_group(uuid),public.get_blocket_worker_binding(uuid)to service_role;
commit;
