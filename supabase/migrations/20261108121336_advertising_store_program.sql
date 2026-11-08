begin;

create table private.advertising_program_stores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  dealer_code text not null unique check (length(dealer_code) between 1 and 160
    and dealer_code=btrim(dealer_code) and dealer_code !~ '[[:cntrl:]]'),
  store_name text not null check (length(btrim(store_name)) between 1 and 160)
);

create table private.advertising_program_revisions (
  store_id uuid not null references private.advertising_program_stores(id),
  period_id uuid not null,
  version integer not null check (version > 0),
  agreement_reference text not null check (length(btrim(agreement_reference)) between 1 and 300),
  desired_start date not null,
  confirmed_start date,
  cancelled boolean not null default false,
  notice_date date,
  contract_end date,
  confirmed_end date,
  blocket_price_ore bigint check (blocket_price_ore >= 0),
  bytbil_price_ore bigint check (bytbil_price_ore >= 0),
  monthly_fee_ore bigint check (monthly_fee_ore >= 0),
  partial_month_rule text check (partial_month_rule in ('full','prorated')),
  blocket_cost_ore bigint check (blocket_cost_ore >= 0),
  bytbil_cost_ore bigint check (bytbil_cost_ore >= 0),
  monthly_cost_ore bigint check (monthly_cost_ore >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key (store_id,period_id,version),
  check (not cancelled or confirmed_start is null),
  check ((notice_date is null)=(contract_end is null)),
  check (contract_end is null or (contract_end > greatest(desired_start,confirmed_start)
    and contract_end >= notice_date)),
  check (confirmed_end is null or (contract_end is not null and confirmed_start is not null
    and confirmed_end > confirmed_start))
);

alter table private.advertising_program_stores enable row level security;
alter table private.advertising_program_revisions enable row level security;
revoke all on private.advertising_program_stores,private.advertising_program_revisions
  from public,anon,authenticated,service_role;
create trigger immutable_advertising_program_revision before update or delete
  on private.advertising_program_revisions for each row execute function private.advertising_immutable();

create function private.list_advertising_program(p_company uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.blocket_admin_identity();
  return (select jsonb_build_object(
    'companyId',c.id,'name',c.name,'organisationNumber',c.organisation_number,'stores',coalesce((
    select jsonb_agg(to_jsonb(s) || jsonb_build_object('periods',coalesce((
      select jsonb_agg(to_jsonb(r) || jsonb_build_object(
        'blocket_price_ore',r.blocket_price_ore::text,'bytbil_price_ore',r.bytbil_price_ore::text,
        'monthly_fee_ore',r.monthly_fee_ore::text,'blocket_cost_ore',r.blocket_cost_ore::text,
        'bytbil_cost_ore',r.bytbil_cost_ore::text,'monthly_cost_ore',r.monthly_cost_ore::text
      ) order by r.desired_start desc,r.period_id)
      from (select distinct on (period_id) * from private.advertising_program_revisions
        where store_id=s.id order by period_id,version desc) r
    ),'[]'::jsonb)) order by s.store_name,s.id)
    from private.advertising_program_stores s where s.company_id=p_company
  ),'[]'::jsonb)) from public.companies c where c.id=p_company);
end $$;

create function private.save_advertising_program(p_company uuid,p_store uuid,p_input jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := private.blocket_admin_identity();
  store private.advertising_program_stores;
  entry private.advertising_program_revisions;
  previous private.advertising_program_revisions;
  expected integer := (p_input->>'version')::integer;
begin
  if p_store is null then
    insert into private.advertising_program_stores(company_id,dealer_code,store_name)
      values (p_company,btrim(p_input->>'dealer_code'),btrim(p_input->>'store_name'))
      returning * into store;
    return store.id;
  end if;
  select * into store from private.advertising_program_stores
    where id=p_store and company_id=p_company for update;
  if not found then raise exception 'Store unavailable' using errcode='42501'; end if;
  entry := jsonb_populate_record(null::private.advertising_program_revisions,p_input);
  entry.store_id := store.id;
  entry.period_id := coalesce(entry.period_id,gen_random_uuid());
  select * into previous from private.advertising_program_revisions
    where store_id=store.id and period_id=entry.period_id order by version desc limit 1;
  if expected is distinct from coalesce(previous.version,0) then
    raise exception 'Period changed' using errcode='40001';
  end if;
  if previous.cancelled then
    raise exception 'Cancelled period cannot be changed' using errcode='40001';
  end if;
  if coalesce(entry.cancelled,false) then
    if previous.version is null or previous.confirmed_start is not null then
      raise exception 'Only pending periods can be cancelled' using errcode='23514';
    end if;
    entry := previous;
    entry.cancelled := true;
  else
    if previous.confirmed_start is not null and entry.confirmed_start is null then
      raise exception 'Confirmed start cannot be cleared' using errcode='23514';
    end if;
    entry.cancelled := false;
  end if;
  if not entry.cancelled and exists (
    select 1 from (select distinct on (period_id) * from private.advertising_program_revisions
      where store_id=store.id and period_id<>entry.period_id order by period_id,version desc) r
    where not r.cancelled and least(r.desired_start,r.confirmed_start)<greatest(entry.contract_end,coalesce(entry.confirmed_end,'infinity'::date))
      and least(entry.desired_start,entry.confirmed_start)<greatest(r.contract_end,coalesce(r.confirmed_end,'infinity'::date))
  ) then raise exception 'Overlapping program periods' using errcode='23P01'; end if;
  entry.version := expected+1;
  entry.created_by := actor;
  entry.created_at := clock_timestamp();
  insert into private.advertising_program_revisions select (entry).*;
  return store.id;
end $$;

create function public.list_advertising_program(p_company uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select private.list_advertising_program(p_company)
$$;
create function public.save_advertising_program(p_company uuid,p_store uuid,p_input jsonb) returns uuid
language sql security invoker set search_path='' as $$
  select private.save_advertising_program(p_company,p_store,p_input)
$$;
revoke all on function private.list_advertising_program(uuid), public.list_advertising_program(uuid),
  private.save_advertising_program(uuid,uuid,jsonb), public.save_advertising_program(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function private.list_advertising_program(uuid), public.list_advertising_program(uuid),
  private.save_advertising_program(uuid,uuid,jsonb), public.save_advertising_program(uuid,uuid,jsonb)
  to authenticated;

commit;
