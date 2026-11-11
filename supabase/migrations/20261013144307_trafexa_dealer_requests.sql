-- Company membership is provisioned by a trusted administrator, never by clients.
-- No live database is linked or changed by this migration's local tests.
begin;

create schema if not exists private;

create table public.trafexa_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  created_at timestamptz not null default now()
);

create table public.trafexa_memberships (
  company_id uuid not null references public.trafexa_companies(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('member', 'manager', 'viewer')),
  primary key (company_id, user_id)
);
create index trafexa_memberships_user_company_idx
  on public.trafexa_memberships(user_id, company_id);

create table public.trafexa_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.trafexa_companies(id),
  created_by uuid not null references auth.users(id),
  idempotency_key uuid not null,
  name text not null check (length(btrim(name)) between 1 and 200),
  email text not null check (length(btrim(email)) between 1 and 254 and email ~ '^[^[:space:]]+@[^[:space:]]+[.][^[:space:]]+$'),
  phone text check (length(phone) <= 80),
  country text not null check (length(btrim(country)) between 1 and 100),
  buyer_type text not null check (buyer_type in (
    'Dealer / reseller', 'Fleet / company buyer', 'Broker / trader',
    'Professional private buyer', 'Other'
  )),
  brand text not null check (length(btrim(brand)) between 1 and 120),
  model text not null check (length(btrim(model)) between 1 and 120),
  year text check (length(year) <= 40),
  quantity integer not null check (quantity between 1 and 1000),
  condition text not null default 'Either'
    check (condition in ('New / unregistered', 'Nearly new', 'Either')),
  budget text check (length(budget) <= 100),
  destination text not null check (length(btrim(destination)) between 1 and 100),
  notes text check (length(notes) <= 5000),
  consent boolean not null check (consent = true),
  status text not null default 'submitted'
    check (status in ('submitted', 'sourcing', 'offered', 'confirmed', 'closed')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, created_by, idempotency_key)
);
create index trafexa_requests_company_created_idx
  on public.trafexa_requests(company_id, created_at desc, id desc);
create index trafexa_requests_created_by_idx on public.trafexa_requests(created_by);

create table public.trafexa_request_events (
  request_id uuid not null,
  company_id uuid not null references public.trafexa_companies(id),
  actor_id uuid not null references auth.users(id),
  from_status text check (from_status in ('submitted', 'sourcing', 'offered', 'confirmed', 'closed')),
  to_status text not null check (to_status in ('submitted', 'sourcing', 'offered', 'confirmed', 'closed')),
  version integer not null check (version > 0),
  created_at timestamptz not null default now(),
  primary key (request_id, version),
  foreign key (request_id, company_id) references public.trafexa_requests(id, company_id)
);
create index trafexa_request_events_company_idx
  on public.trafexa_request_events(company_id, created_at desc);
create index trafexa_request_events_actor_idx on public.trafexa_request_events(actor_id);

alter table public.trafexa_companies enable row level security;
alter table public.trafexa_memberships enable row level security;
alter table public.trafexa_requests enable row level security;
alter table public.trafexa_request_events enable row level security;

create policy trafexa_memberships_select_self on public.trafexa_memberships
  for select to authenticated using (user_id = (select auth.uid()));
create policy trafexa_companies_select_member on public.trafexa_companies
  for select to authenticated using (id in (
    select company_id from public.trafexa_memberships where user_id = (select auth.uid())
  ));
create policy trafexa_requests_select_member on public.trafexa_requests
  for select to authenticated using (company_id in (
    select company_id from public.trafexa_memberships where user_id = (select auth.uid())
  ));
create policy trafexa_events_select_member on public.trafexa_request_events
  for select to authenticated using (company_id in (
    select company_id from public.trafexa_memberships where user_id = (select auth.uid())
  ));
create policy trafexa_requests_insert_member on public.trafexa_requests
  for insert to authenticated with check (
    created_by = (select auth.uid()) and status = 'submitted' and version = 1
    and company_id in (
      select company_id from public.trafexa_memberships
      where user_id = (select auth.uid()) and role in ('member', 'manager')
    )
  );
create policy trafexa_requests_update_manager on public.trafexa_requests
  for update to authenticated using (company_id in (
    select company_id from public.trafexa_memberships
    where user_id = (select auth.uid()) and role = 'manager'
  )) with check (company_id in (
    select company_id from public.trafexa_memberships
    where user_id = (select auth.uid()) and role = 'manager'
  ));

-- Invoker trigger enforces immutability even if column privileges are later widened.
create function private.trafexa_guard_request_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (to_jsonb(new) - 'status' - 'version' - 'updated_at')
     is distinct from (to_jsonb(old) - 'status' - 'version' - 'updated_at')
     or new.version is distinct from old.version
     or new.updated_at is distinct from old.updated_at then
    raise exception 'Only request status may be updated' using errcode = '42501';
  end if;
  if auth.uid() is null or not exists (
    select 1 from public.trafexa_memberships
    where company_id = old.company_id and user_id = auth.uid() and role = 'manager'
  ) then
    raise exception 'Manager membership required' using errcode = '42501';
  end if;
  if new.status = old.status then
    return new;
  end if;
  if not (
    (old.status = 'submitted' and new.status = 'sourcing')
    or (old.status = 'sourcing' and new.status = 'offered')
    or (old.status = 'offered' and new.status = 'confirmed')
    or (old.status in ('submitted', 'sourcing', 'offered', 'confirmed') and new.status = 'closed')
  ) then
    raise exception 'Invalid request status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- The only privileged function: an unexposed, non-callable trigger that writes audit.
create function private.trafexa_record_request_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'trafexa_requests'
     or tg_when <> 'AFTER' or tg_level <> 'ROW' or tg_op not in ('INSERT', 'UPDATE') then
    raise exception 'Invalid audit trigger context' using errcode = '42501';
  end if;
  if actor is null or not exists (
    select 1 from public.trafexa_memberships
    where company_id = new.company_id and user_id = actor
      and ((tg_op = 'INSERT' and role in ('member', 'manager'))
        or (tg_op = 'UPDATE' and role = 'manager'))
  ) then
    raise exception 'Authorized company membership required' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.created_by <> actor or new.status <> 'submitted' or new.version <> 1 then
      raise exception 'Invalid initial request state' using errcode = '42501';
    end if;
    insert into public.trafexa_request_events
      (request_id, company_id, actor_id, from_status, to_status, version)
      values (new.id, new.company_id, actor, null, new.status, new.version);
  elsif new.status is distinct from old.status then
    if new.company_id <> old.company_id or new.created_by <> old.created_by
       or new.version <> old.version + 1 then
      raise exception 'Invalid audit request state' using errcode = '42501';
    end if;
    insert into public.trafexa_request_events
      (request_id, company_id, actor_id, from_status, to_status, version)
      values (new.id, new.company_id, actor, old.status, new.status, new.version);
  end if;
  return new;
end;
$$;
revoke all on function private.trafexa_guard_request_update() from public, anon, authenticated;
revoke all on function private.trafexa_record_request_event() from public, anon, authenticated;

create trigger trafexa_guard_request_update before update on public.trafexa_requests
  for each row execute function private.trafexa_guard_request_update();
create trigger trafexa_record_request_event after insert or update on public.trafexa_requests
  for each row execute function private.trafexa_record_request_event();

-- Supabase installations can have broad default privileges. Explicitly narrow them.
revoke all on public.trafexa_companies, public.trafexa_memberships,
  public.trafexa_requests, public.trafexa_request_events from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.trafexa_companies, public.trafexa_memberships,
  public.trafexa_requests, public.trafexa_request_events to authenticated;
grant insert (company_id, created_by, idempotency_key, name, email, phone, country,
  buyer_type, brand, model, year, quantity, condition, budget, destination, notes, consent)
  on public.trafexa_requests to authenticated;
grant update (status) on public.trafexa_requests to authenticated;

commit;
