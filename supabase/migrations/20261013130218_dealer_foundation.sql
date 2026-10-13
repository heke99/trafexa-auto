-- Trafexa dealer foundation. No live financing provider or demo records are seeded.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.companies (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 160),
 organisation_number text not null check(organisation_number ~ '^[0-9]{10}$'),
 status text not null default 'active' check(status in ('active','suspended')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.memberships (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 user_id uuid not null references auth.users(id), role text not null check(role in ('owner','admin','sales','finance','viewer')),
 status text not null default 'active' check(status in ('active','suspended')),
 created_at timestamptz not null default now(), unique(company_id,user_id)
);
create index memberships_user_active_idx on public.memberships(user_id,company_id) where status='active';
create function private.has_company_role(target uuid, allowed_roles text[] default array['owner','admin','sales','finance','viewer'])
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.memberships m join public.companies c on c.id=m.company_id
 where m.company_id=target and m.user_id=(select auth.uid()) and m.status='active' and c.status='active' and m.role=any(allowed_roles));
$$;
revoke all on function private.has_company_role(uuid,text[]) from public,anon;
grant execute on function private.has_company_role(uuid,text[]) to authenticated;

create table public.customers (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 kind text not null default 'person' check(kind in ('person','business')), name text not null check(length(name) between 2 and 160),
 email text, phone text, address text, notes text, created_at timestamptz not null default now(),
 unique(company_id,id)
);
create index customers_company_idx on public.customers(company_id,created_at desc);
create table public.leads (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 customer_id uuid, subject text not null, status text not null default 'new' check(status in ('new','contacted','qualified','closed')),
 created_at timestamptz not null default now(), unique(company_id,id),
 foreign key(company_id,customer_id) references public.customers(company_id,id)
);
create index leads_company_idx on public.leads(company_id,status);
-- Vehicle identity is tenant-owned; published network data is a separate future module.
create table public.vehicles (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 registration_number text not null check(length(registration_number) between 2 and 15), vin text,
 make text not null, model text not null, model_year integer not null check(model_year between 1900 and 2100),
 mileage_km integer not null default 0 check(mileage_km>=0), fuel text not null default 'petrol' check(fuel in ('petrol','diesel','electric','hybrid','other')),
 gearbox text not null default 'automatic' check(gearbox in ('automatic','manual')),
 created_at timestamptz not null default now(), unique(company_id,id), unique(company_id,registration_number)
);
create table public.stock_items (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), vehicle_id uuid not null,
 purchase_price_ore bigint not null check(purchase_price_ore>=0), asking_price_ore bigint not null check(asking_price_ore>=0),
 currency text not null default 'SEK' check(currency='SEK'), vat_scheme text not null check(vat_scheme in ('standard','vmb','unknown')),
 acquired_on date not null default current_date, status text not null default 'available' check(status in ('available','reserved','sold','archived')),
 created_at timestamptz not null default now(), unique(company_id,id),
 foreign key(company_id,vehicle_id) references public.vehicles(company_id,id)
);
create unique index stock_single_current_vehicle on public.stock_items(company_id,vehicle_id) where status in ('available','reserved');
create index stock_company_status_idx on public.stock_items(company_id,status,created_at desc);
create table public.vehicle_costs (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), stock_item_id uuid not null,
 category text not null check(category in ('repair','transport','inspection','finance','other')), description text not null,
 amount_ore bigint not null check(amount_ore>=0), incurred_on date not null default current_date,
 created_at timestamptz not null default now(), foreign key(company_id,stock_item_id) references public.stock_items(company_id,id)
);
create index vehicle_costs_stock_idx on public.vehicle_costs(company_id,stock_item_id);
create table public.deals (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), stock_item_id uuid not null, customer_id uuid not null,
 sale_price_ore bigint not null check(sale_price_ore>0), status text not null default 'draft' check(status in ('draft','reserved','cancelled')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(company_id,id),
 foreign key(company_id,stock_item_id) references public.stock_items(company_id,id),
 foreign key(company_id,customer_id) references public.customers(company_id,id)
);
create index deals_company_idx on public.deals(company_id,created_at desc);
create table public.offers (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), deal_id uuid not null,
 version integer not null check(version>0), snapshot jsonb not null, created_at timestamptz not null default now(),
 foreign key(company_id,deal_id) references public.deals(company_id,id), unique(deal_id,version)
);
create index offers_company_idx on public.offers(company_id,deal_id);
create table public.reservations (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), stock_item_id uuid not null, deal_id uuid not null,
 expires_at timestamptz not null, status text not null default 'active' check(status in ('active','released','expired')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 foreign key(company_id,stock_item_id) references public.stock_items(company_id,id), foreign key(company_id,deal_id) references public.deals(company_id,id)
);
create unique index reservations_one_active_stock on public.reservations(stock_item_id) where status='active';
create index reservations_company_idx on public.reservations(company_id,deal_id);
create table public.finance_partners (
 id uuid primary key default gen_random_uuid(), name text not null, status text not null default 'unavailable' check(status in ('unavailable','onboarding','active')),
 created_at timestamptz not null default now()
);
create table public.dealer_approvals (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), partner_id uuid not null references public.finance_partners(id),
 product text not null check(product in ('purchase','stock')), status text not null default 'pending' check(status in ('pending','approved','rejected','suspended')),
 external_reference text, confirmed_at timestamptz, created_at timestamptz not null default now(), unique(company_id,partner_id,product)
);
create table public.finance_applications (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), deal_id uuid,
 product text not null check(product in ('purchase','stock')), requested_amount_ore bigint not null check(requested_amount_ore>0),
 deposit_ore bigint not null default 0 check(deposit_ore>=0), term_months integer check(term_months between 1 and 120),
 status text not null default 'intake' check(status in ('intake','awaiting_partner','submitted','withdrawn')),
 note text, partner_id uuid references public.finance_partners(id), created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), unique(company_id,id),
 foreign key(company_id,deal_id) references public.deals(company_id,id)
);
create index finance_applications_company_idx on public.finance_applications(company_id,created_at desc);
create index dealer_approvals_partner_idx on public.dealer_approvals(partner_id);
create index finance_applications_partner_idx on public.finance_applications(partner_id);
create table public.documents (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), deal_id uuid,
 name text not null, object_path text not null unique, kind text not null check(kind in ('purchase','contract','finance','other')),
 created_at timestamptz not null default now(), foreign key(company_id,deal_id) references public.deals(company_id,id),
 check(object_path like company_id::text || '/%')
);
create index documents_company_idx on public.documents(company_id,deal_id);
create table public.activities (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 customer_id uuid, deal_id uuid, description text not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 foreign key(company_id,customer_id) references public.customers(company_id,id), foreign key(company_id,deal_id) references public.deals(company_id,id)
);
create index activities_company_idx on public.activities(company_id,created_at desc);
create table public.audit_events (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), actor_user_id uuid references auth.users(id),
 entity_table text not null, entity_id uuid not null, action text not null, created_at timestamptz not null default now()
);
create index audit_company_idx on public.audit_events(company_id,created_at desc);

-- No write permissions on organisation roles, audit records or partner decisions via the Data API.
alter table public.companies enable row level security;
alter table public.memberships enable row level security;
alter table public.finance_partners enable row level security;
create policy companies_read on public.companies for select to authenticated using(private.has_company_role(id));
create policy memberships_read on public.memberships for select to authenticated using(private.has_company_role(company_id));
create policy partners_read on public.finance_partners for select to authenticated using(exists(select 1 from public.memberships m where m.user_id=(select auth.uid()) and m.status='active'));
grant select on public.companies,public.memberships,public.finance_partners to authenticated;

do $$ declare tab text; begin
 foreach tab in array array['customers','leads','vehicles','stock_items','vehicle_costs','deals','offers','reservations','dealer_approvals','finance_applications','documents','activities','audit_events'] loop
 execute format('alter table public.%I enable row level security',tab);
 execute format('create policy tenant_read on public.%I for select to authenticated using(private.has_company_role(company_id))',tab);
 execute format('grant select on public.%I to authenticated',tab);
 end loop;
 -- Ordinary business writes only, with fixed actor identity where applicable.
 foreach tab in array array['customers','leads','vehicles','stock_items','vehicle_costs','documents'] loop
 execute format('create policy tenant_insert on public.%I for insert to authenticated with check(private.has_company_role(company_id,array[''owner'',''admin'',''sales'']))',tab);
 execute format('grant insert on public.%I to authenticated',tab);
 end loop;
 foreach tab in array array['customers','leads','vehicles','stock_items','vehicle_costs'] loop
 execute format('create policy tenant_update on public.%I for update to authenticated using(private.has_company_role(company_id,array[''owner'',''admin'',''sales''])) with check(private.has_company_role(company_id,array[''owner'',''admin'',''sales'']))',tab);
 execute format('grant update on public.%I to authenticated',tab);
 end loop;
end $$;
-- Restrict stock lifecycle to reservation functions; edited prices are allowed.
revoke update on public.stock_items from authenticated;
grant update(asking_price_ore,vat_scheme) on public.stock_items to authenticated;
create policy finance_intake_insert on public.finance_applications for insert to authenticated with check(
 private.has_company_role(company_id,array['owner','admin','sales','finance']) and created_by=(select auth.uid()) and status='intake' and partner_id is null);
grant insert on public.finance_applications to authenticated;
create policy activities_insert on public.activities for insert to authenticated with check(private.has_company_role(company_id,array['owner','admin','sales','finance']) and created_by=(select auth.uid()));
grant insert on public.activities to authenticated;

create function private.record_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_events(company_id,actor_user_id,entity_table,entity_id,action)
 values(new.company_id,auth.uid(),tg_table_name,new.id,tg_op);
 return new;
end $$;
revoke all on function private.record_audit() from public,anon,authenticated;
do $$ declare tab text; begin
 foreach tab in array array['customers','vehicles','stock_items','vehicle_costs','deals','reservations','finance_applications','documents'] loop
 execute format('create trigger audit_change after insert or update on public.%I for each row execute function private.record_audit()',tab);
 end loop;
end $$;

create function private.create_company(company_name text, org_number text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is null) then raise exception 'Confirm your email first' using errcode='42501'; end if;
 insert into public.companies(name,organisation_number,created_by) values(trim(company_name),org_number,auth.uid()) returning id into result;
 insert into public.memberships(company_id,user_id,role) values(result,auth.uid(),'owner');
 return result;
end $$;
revoke all on function private.create_company(text,text) from public,anon;
grant execute on function private.create_company(text,text) to authenticated;
create function public.create_company(company_name text,org_number text) returns uuid language sql security invoker set search_path='' as $$ select private.create_company(company_name,org_number); $$;
revoke all on function public.create_company(text,text) from public,anon;
grant execute on function public.create_company(text,text) to authenticated;

create function private.create_stock(company uuid, registration text, make_name text, model_name text, year integer, mileage integer, fuel_type text, gearbox_type text, purchase_ore bigint, asking_ore bigint, vat text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v uuid; s uuid; begin
 if not private.has_company_role(company,array['owner','admin','sales']) then raise exception 'Access denied' using errcode='42501'; end if;
 insert into public.vehicles(company_id,registration_number,make,model,model_year,mileage_km,fuel,gearbox)
 values(company,upper(registration),make_name,model_name,year,mileage,fuel_type,gearbox_type) returning id into v;
 insert into public.stock_items(company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme) values(company,v,purchase_ore,asking_ore,vat) returning id into s;
 return s;
end $$;
revoke all on function private.create_stock(uuid,text,text,text,integer,integer,text,text,bigint,bigint,text) from public,anon;
grant execute on function private.create_stock(uuid,text,text,text,integer,integer,text,text,bigint,bigint,text) to authenticated;
create function public.create_stock(company uuid,registration text,make_name text,model_name text,year integer,mileage integer,fuel_type text,gearbox_type text,purchase_ore bigint,asking_ore bigint,vat text) returns uuid language sql security invoker set search_path='' as $$ select private.create_stock(company,registration,make_name,model_name,year,mileage,fuel_type,gearbox_type,purchase_ore,asking_ore,vat); $$;
revoke all on function public.create_stock(uuid,text,text,text,integer,integer,text,text,bigint,bigint,text) from public,anon;
grant execute on function public.create_stock(uuid,text,text,text,integer,integer,text,text,bigint,bigint,text) to authenticated;

create function private.create_deal(company uuid,stock uuid,customer uuid,price_ore bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; begin
 if not private.has_company_role(company,array['owner','admin','sales']) then raise exception 'Access denied' using errcode='42501'; end if;
 if not exists(select 1 from public.stock_items where id=stock and company_id=company and status='available') then raise exception 'Vehicle is not available'; end if;
 insert into public.deals(company_id,stock_item_id,customer_id,sale_price_ore,created_by) values(company,stock,customer,price_ore,auth.uid()) returning id into result;
 return result;
end $$;
revoke all on function private.create_deal(uuid,uuid,uuid,bigint) from public,anon;
grant execute on function private.create_deal(uuid,uuid,uuid,bigint) to authenticated;
create function public.create_deal(company uuid,stock uuid,customer uuid,price_ore bigint) returns uuid language sql security invoker set search_path='' as $$ select private.create_deal(company,stock,customer,price_ore); $$;
revoke all on function public.create_deal(uuid,uuid,uuid,bigint) from public,anon;
grant execute on function public.create_deal(uuid,uuid,uuid,bigint) to authenticated;

create function private.reserve_vehicle(company uuid,deal uuid,hours integer default 48) returns uuid language plpgsql security definer set search_path='' as $$
declare d public.deals; s public.stock_items; result uuid; begin
 if not private.has_company_role(company,array['owner','admin','sales']) then raise exception 'Access denied' using errcode='42501'; end if;
 if hours<1 or hours>168 then raise exception 'Invalid reservation duration'; end if;
 select * into d from public.deals where id=deal and company_id=company;
 if not found or d.status not in ('draft','reserved') then raise exception 'Deal unavailable'; end if;
 -- All reservations serialize on the stock row. The unique index is an additional invariant.
 select * into s from public.stock_items where id=d.stock_item_id and company_id=company for update;
 update public.reservations set status='expired' where stock_item_id=s.id and status='active' and expires_at<=now();
 if exists(select 1 from public.reservations where stock_item_id=s.id and status='active') then raise exception 'Vehicle already reserved' using errcode='23505'; end if;
 if s.status not in ('available','reserved') then raise exception 'Vehicle unavailable'; end if;
 insert into public.reservations(company_id,stock_item_id,deal_id,expires_at,created_by) values(company,s.id,d.id,now()+make_interval(hours=>hours),auth.uid()) returning id into result;
 update public.stock_items set status='reserved' where id=s.id;
 update public.deals set status='reserved' where id=d.id;
 return result;
end $$;
revoke all on function private.reserve_vehicle(uuid,uuid,integer) from public,anon;
grant execute on function private.reserve_vehicle(uuid,uuid,integer) to authenticated;
create function public.reserve_vehicle(company uuid,deal uuid,hours integer default 48) returns uuid language sql security invoker set search_path='' as $$ select private.reserve_vehicle(company,deal,hours); $$;
revoke all on function public.reserve_vehicle(uuid,uuid,integer) from public,anon;
grant execute on function public.reserve_vehicle(uuid,uuid,integer) to authenticated;

-- Documents are private, with tenant UUID as the first path segment.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('dealer-documents','dealer-documents',false,20971520,array['application/pdf','image/jpeg','image/png']) on conflict(id) do nothing;
create policy dealer_documents_read on storage.objects for select to authenticated using(bucket_id='dealer-documents' and exists(select 1 from public.memberships m where m.company_id::text=(storage.foldername(name))[1] and private.has_company_role(m.company_id)));
create policy dealer_documents_insert on storage.objects for insert to authenticated with check(bucket_id='dealer-documents' and exists(select 1 from public.memberships m where m.company_id::text=(storage.foldername(name))[1] and private.has_company_role(m.company_id,array['owner','admin','sales','finance'])));
create function private.release_reservation(company uuid,deal uuid) returns void language plpgsql security definer set search_path='' as $$
declare stock uuid; begin
 if not private.has_company_role(company,array['owner','admin','sales']) then raise exception 'Access denied' using errcode='42501'; end if;
 select stock_item_id into stock from public.deals where id=deal and company_id=company;
 if not found then raise exception 'Deal unavailable'; end if;
 perform 1 from public.stock_items where id=stock and company_id=company for update;
 update public.reservations set status='released' where company_id=company and deal_id=deal and status='active';
 if found then
 update public.stock_items set status='available' where id=stock and status='reserved';
 update public.deals set status='draft' where id=deal and status='reserved';
 end if;
end $$;
revoke all on function private.release_reservation(uuid,uuid) from public,anon;
grant execute on function private.release_reservation(uuid,uuid) to authenticated;
create function public.release_reservation(company uuid,deal uuid) returns void language sql security invoker set search_path='' as $$ select private.release_reservation(company,deal); $$;
revoke all on function public.release_reservation(uuid,uuid) from public,anon;
grant execute on function public.release_reservation(uuid,uuid) to authenticated;

create table private.demo_requests (
 id uuid primary key default gen_random_uuid(),name text not null,email text not null,company text not null,phone text,
 message text,created_at timestamptz not null default now()
);
alter table private.demo_requests enable row level security;
revoke all on private.demo_requests from public,anon,authenticated;
create index demo_requests_created_idx on private.demo_requests(created_at);
create index demo_requests_email_created_idx on private.demo_requests(email,created_at);
create function private.submit_demo_request(contact_name text,contact_email text,company_name text,contact_phone text default null,contact_message text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if length(trim(contact_name)) not between 2 and 160 or length(trim(company_name)) not between 2 and 160
 or length(contact_email)>254 or contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or coalesce(length(contact_phone),0)>60 or coalesce(length(contact_message),0)>2000 then raise exception 'Invalid request'; end if;
 -- Global bounded intake and per-address throttle apply even when bypassing the website endpoint.
 perform pg_advisory_xact_lock(97261013);
 if (select count(*) from private.demo_requests where created_at>now()-interval '1 minute')>=10
 or (select count(*) from private.demo_requests where email=lower(trim(contact_email)) and created_at>now()-interval '1 hour')>=3 then raise exception 'Too many requests' using errcode='P0001'; end if;
 insert into private.demo_requests(name,email,company,phone,message) values(trim(contact_name),lower(trim(contact_email)),trim(company_name),contact_phone,contact_message);
end $$;
revoke all on function private.submit_demo_request(text,text,text,text,text) from public;
grant usage on schema private to anon;
grant execute on function private.submit_demo_request(text,text,text,text,text) to anon,authenticated;
create function public.submit_demo_request(contact_name text,contact_email text,company_name text,contact_phone text default null,contact_message text default null)
returns void language sql security invoker set search_path='' as $$ select private.submit_demo_request(contact_name,contact_email,company_name,contact_phone,contact_message); $$;
revoke all on function public.submit_demo_request(text,text,text,text,text) from public;
grant execute on function public.submit_demo_request(text,text,text,text,text) to anon,authenticated;
