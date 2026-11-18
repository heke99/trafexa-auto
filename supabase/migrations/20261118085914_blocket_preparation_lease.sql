begin;

-- A preparation can expire and be repeated because no mutation has been authorized.
-- Existing revisions remain write intents and therefore retain reconciliation-only recovery.
create table private.blocket_job_preparations (
  job_id uuid primary key references private.advertising_jobs(id) on delete cascade,
  token uuid,
  expires_at timestamptz,
  failures integer not null default 0 check (failures between 0 and 5),
  check ((token is null) = (expires_at is null))
);
alter table private.blocket_job_preparations enable row level security;
revoke all on private.blocket_job_preparations from public,anon,authenticated,service_role;

create function public.reserve_blocket_preparation(p_job_id uuid,p_expected_job_version integer,p_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.advertising_jobs;i private.blocket_delivery_identities;p private.blocket_job_preparations;
begin
  perform private.blocket_service_identity();
  if p_job_id is null or p_token is null then raise exception 'Invalid Blocket preparation' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('blocket-preparation:'||p_job_id::text,0));
  select * into j from private.advertising_jobs where id=p_job_id and channel='blocket';
  if j.id is null or j.version is distinct from p_expected_job_version or j.status not in('queued','retryable')
     or exists(select 1 from private.blocket_delivery_revisions where job_id=j.id) then return null;end if;
  select * into p from private.blocket_job_preparations where job_id=j.id;
  if p.failures>=5 or (p.token=p_token and p.expires_at<=clock_timestamp())
     or (p.token is distinct from p_token and p.expires_at>clock_timestamp()) then return null;end if;
  perform private.get_blocket_worker_binding(j.id);
  select * into i from private.blocket_delivery_identities where listing_id=j.listing_id;
  if i.id is not null and (i.company_id<>j.company_id or i.dealer_code<>j.account_reference) then
    raise exception 'Blocket delivery identity conflict' using errcode='40001';
  end if;
  if exists(select 1 from private.blocket_delivery_revisions where identity_id=i.id and
    (status not in('published','rejected') or listing_version>=j.listing_version)) then return null;end if;
  if p.token=p_token then
    return jsonb_build_object('token',p.token,'expiresAt',p.expires_at,'providerAdId',i.provider_ad_id);
  end if;
  insert into private.blocket_job_preparations(job_id,token,expires_at)
  values(j.id,p_token,clock_timestamp()+interval '90 seconds')
  on conflict(job_id) do update set token=excluded.token,expires_at=excluded.expires_at
  returning * into p;
  return jsonb_build_object('token',p.token,'expiresAt',p.expires_at,'providerAdId',i.provider_ad_id);
end
$$;

create function public.begin_prepared_blocket_delivery(p_job_id uuid,p_expected_job_version integer,p_claim_token uuid,
 p_payload_sha256 text,p_expected_provider_ad_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.blocket_service_identity();
  perform pg_advisory_xact_lock(hashtextextended('blocket-preparation:'||p_job_id::text,0));
  if not exists(select 1 from private.blocket_job_preparations where job_id=p_job_id and token=p_claim_token and expires_at>clock_timestamp()) then
    raise exception 'Blocket preparation expired' using errcode='40001';
  end if;
  result:=private.begin_blocket_delivery(p_job_id,p_expected_job_version,p_claim_token,p_payload_sha256);
  if result#>>'{delivery,providerAdId}' is distinct from p_expected_provider_ad_id then
    raise exception 'Blocket preparation identity changed' using errcode='40001';
  end if;
  delete from private.blocket_job_preparations where job_id=p_job_id;
  return result;
end
$$;

create function public.finish_blocket_preparation(p_job_id uuid,p_expected_job_version integer,p_token uuid,p_status text,p_error_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.advertising_jobs;p private.blocket_job_preparations;
begin
  perform private.blocket_service_identity();
  if p_status is null or p_status not in('retryable','rejected') or p_error_code is null or p_error_code!~'^[a-z0-9_]{1,100}$' then
    raise exception 'Invalid Blocket preparation result' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('blocket-preparation:'||p_job_id::text,0));
  select * into p from private.blocket_job_preparations where job_id=p_job_id and token=p_token and expires_at>clock_timestamp();
  select * into j from private.advertising_jobs where id=p_job_id and channel='blocket';
  if p.job_id is null or j.id is null or j.version is distinct from p_expected_job_version or j.status not in('queued','retryable')
     or exists(select 1 from private.blocket_delivery_revisions where job_id=j.id) then
    raise exception 'Blocket preparation changed' using errcode='40001';
  end if;
  -- Reuse the current SQL source checks and publish-state CAS. Both updates
  -- commit atomically, so no dispatching job can escape a failed preparation.
  perform private.advertising_worker('claim',j.id,j.version,p_token,null,null,null,null,null,null,null);
  update private.blocket_job_preparations set token=null,expires_at=null,failures=failures+1 where job_id=j.id returning * into p;
  return private.advertising_worker('save',j.id,j.version+1,p_token,
    case when p.failures=5 then 'rejected' else p_status end,j.provider_ad_id,j.provider_url,p_error_code,null,null,null);
end
$$;

revoke all on function public.reserve_blocket_preparation(uuid,integer,uuid),public.begin_prepared_blocket_delivery(uuid,integer,uuid,text,text),
 public.finish_blocket_preparation(uuid,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_blocket_preparation(uuid,integer,uuid),public.begin_prepared_blocket_delivery(uuid,integer,uuid,text,text),
 public.finish_blocket_preparation(uuid,integer,uuid,text,text) to service_role;
commit;
