begin;

-- No direct grants: only the current, verified platform administrator can use
-- the guarded functions. Payloads include private procurement prices.
create table private.advertising_program_requests (
  actor_id uuid not null references auth.users(id),
  request_id uuid not null,
  company_id uuid not null references public.companies(id),
  input_store_id uuid,
  input jsonb,
  state text not null check (state in ('saved','not_saved')),
  receipt jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor_id,request_id),
  check ((state='saved')=(input is not null and receipt is not null))
);
alter table private.advertising_program_requests enable row level security;
revoke all on private.advertising_program_requests from public,anon,authenticated,service_role;
create trigger immutable_advertising_program_request before update or delete
  on private.advertising_program_requests for each row execute function private.advertising_immutable();

create function private.save_advertising_program_request(p_company uuid,p_store uuid,p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := private.blocket_admin_identity();
  prior private.advertising_program_requests;
  saved_store uuid;
  operation text;
  period uuid;
  revision integer;
  result jsonb;
  allowed text[];
begin
  if p_company is null or p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object' then
    raise exception 'Invalid program request' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('advertising-program-request:'||actor::text||':'||p_request_id::text,0));
  select * into prior from private.advertising_program_requests where actor_id=actor and request_id=p_request_id;
  if found then
    if prior.company_id is distinct from p_company or prior.state<>'saved'
      or prior.input_store_id is distinct from p_store or prior.input is distinct from p_input then
      raise exception 'Program request changed or closed' using errcode='40001';
    end if;
    return prior.receipt;
  end if;
  if p_store is null then
    operation := 'store';
    allowed := array['store_name','dealer_code'];
    if jsonb_typeof(p_input->'store_name') is distinct from 'string' or jsonb_typeof(p_input->'dealer_code') is distinct from 'string'
      or p_input->>'store_name' ~ '[[:cntrl:]]' or p_input->>'dealer_code' ~ '[[:cntrl:]]' then
      raise exception 'Invalid program store' using errcode='22023';
    end if;
  elsif p_input->'cancelled'='true'::jsonb then
    operation := 'cancel';
    allowed := array['period_id','version','cancelled'];
  else
    operation := 'period';
    allowed := array['period_id','version','agreement_reference','desired_start','confirmed_start','notice_date','contract_end','confirmed_end',
      'blocket_price_ore','bytbil_price_ore','monthly_fee_ore','partial_month_rule','blocket_cost_ore','bytbil_cost_ore','monthly_cost_ore'];
    if jsonb_typeof(p_input->'agreement_reference') is distinct from 'string' or p_input->>'agreement_reference' ~ '[[:cntrl:]]' then
      raise exception 'Invalid program agreement' using errcode='22023';
    end if;
  end if;
  if (select count(*) from jsonb_object_keys(p_input))<>cardinality(allowed)
    or exists(select 1 from jsonb_object_keys(p_input) k where not k=any(allowed)) then
    raise exception 'Invalid program fields' using errcode='22023';
  end if;
  if p_store is not null then
    period := (p_input->>'period_id')::uuid;
    revision := (p_input->>'version')::integer;
    if period is null or revision is null or revision<0 or revision=2147483647 then
      raise exception 'Invalid program revision' using errcode='22023';
    end if;
  end if;
  -- Shared with quote/send pricing: take company billing lock before store row.
  perform pg_advisory_xact_lock(hashtextextended('advertising-billing:'||p_company::text,0));
  saved_store := private.save_advertising_program(p_company,p_store,p_input);
  result := jsonb_build_object('actorId',actor,'requestId',p_request_id,'companyId',p_company,
    'storeId',saved_store,'periodId',period,'version',case when p_store is null then 0 else revision+1 end,'operation',operation);
  insert into private.advertising_program_requests(actor_id,request_id,company_id,input_store_id,input,state,receipt)
    values(actor,p_request_id,p_company,p_store,p_input,'saved',result);
  return result;
end $$;

-- Resolving an uncertain result is an explicit action, not a passive GET. A
-- missing request becomes a tombstone under the same lock: a delayed original
-- write can never arrive later and mutate data after "not saved" was returned.
create function private.resolve_advertising_program_request(p_company uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := private.blocket_admin_identity(); prior private.advertising_program_requests;
begin
  if p_company is null or p_request_id is null then raise exception 'Invalid program request' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('advertising-program-request:'||actor::text||':'||p_request_id::text,0));
  select * into prior from private.advertising_program_requests where actor_id=actor and request_id=p_request_id;
  if found and prior.company_id is distinct from p_company then raise exception 'Program request changed' using errcode='40001';end if;
  if not found then
    insert into private.advertising_program_requests(actor_id,request_id,company_id,state)
      values(actor,p_request_id,p_company,'not_saved') returning * into prior;
  end if;
  return jsonb_build_object('actorId',actor,'companyId',p_company,'requestId',p_request_id,'state',prior.state,'receipt',prior.receipt);
end $$;

create function public.save_advertising_program_request(p_company uuid,p_store uuid,p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.save_advertising_program_request(p_company,p_store,p_input,p_request_id) $$;
create function public.resolve_advertising_program_request(p_company uuid,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.resolve_advertising_program_request(p_company,p_request_id) $$;
revoke all on function private.save_advertising_program_request(uuid,uuid,jsonb,uuid),public.save_advertising_program_request(uuid,uuid,jsonb,uuid),
  private.resolve_advertising_program_request(uuid,uuid),public.resolve_advertising_program_request(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.save_advertising_program_request(uuid,uuid,jsonb,uuid),public.save_advertising_program_request(uuid,uuid,jsonb,uuid),
  private.resolve_advertising_program_request(uuid,uuid),public.resolve_advertising_program_request(uuid,uuid) to authenticated;

commit;
