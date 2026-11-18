begin;

-- Group-managed jobs use V5. Reject unsupported payloads before queueing or pricing a job.
create function private.guard_blocket_v5_job_payload()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.channel = 'blocket' and exists (
    select 1 from private.blocket_company_bindings b
    where b.company_id = new.company_id and b.connection_id = new.connection_id
  ) then
    if new.snapshot->'includeRegistrationNumber' is distinct from 'true'::jsonb
      or coalesce(new.snapshot->>'registrationNumber', '') !~ '^[A-Z0-9]{6}$'
      or coalesce(new.snapshot->>'priceGrossOre', '') !~ '^[1-9][0-9]{0,12}00$'
      or coalesce(new.snapshot->>'fuel', '') not in ('petrol','diesel','electric')
      or coalesce(new.snapshot->>'transmission', '') not in ('manual','automatic','sequential')
      or jsonb_array_length(new.snapshot->'photos') not between 1 and 20
      or exists (
        select 1 from jsonb_array_elements(new.snapshot->'photos') photo
        where coalesce(photo->>'contentType', '') not in ('image/jpeg','image/png')
      ) then
      raise exception 'Listing does not meet Blocket channel requirements' using errcode='22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_blocket_v5_job_payload() from public, anon, authenticated, service_role;
create trigger blocket_v5_job_payload before insert on private.advertising_jobs
for each row execute function private.guard_blocket_v5_job_payload();

-- Completing a verified internal publication has no partner I/O or dependency
-- on the present group configuration. The publication trigger retains billing ownership.
create function public.finalize_verified_blocket_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  job private.advertising_jobs;
  proof private.blocket_delivery_revisions;
  identity private.blocket_delivery_identities;
begin
  perform private.blocket_service_identity();
  select * into job from private.advertising_jobs where id = p_job_id and channel = 'blocket';
  if not found or job.status not in ('dispatching', 'submitted', 'outcome_unknown', 'published') then
    return null;
  end if;
  select * into proof from private.blocket_delivery_revisions where job_id = job.id and status = 'published';
  if not found then return null; end if;
  select * into identity from private.blocket_delivery_identities where id = proof.identity_id;
  if identity.company_id is distinct from job.company_id
    or identity.listing_id is distinct from job.listing_id
    or identity.dealer_code is distinct from job.account_reference
    or proof.listing_version is distinct from job.listing_version
    or proof.connection_id is distinct from job.connection_id
    or proof.connection_version is distinct from job.connection_version
    or proof.provider_request_id is null or proof.evidence_sha256 is null
    or proof.provider_ad_id is null or identity.provider_ad_id is distinct from proof.provider_ad_id then
    raise exception 'Verified Blocket publication required' using errcode='40001';
  end if;
  if job.status = 'published' then
    if job.provider_ad_id is distinct from proof.provider_ad_id then
      raise exception 'Verified Blocket publication required' using errcode='40001';
    end if;
    return private.advertising_job_json(job, true);
  end if;

  return private.advertising_worker('save', job.id, job.version, job.claim_token,
    'published', proof.provider_ad_id, null, null, null, null, null);
end;
$$;
revoke all on function public.finalize_verified_blocket_job(uuid) from public, anon, authenticated, service_role;
grant execute on function public.finalize_verified_blocket_job(uuid) to service_role;

commit;
