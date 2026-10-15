begin;
-- Lock order shared by background expiry, reservation changes and advertising:
-- company -> stock -> deal -> reservation. Audit FK checks cannot invert it.
create or replace function private.expire_stock_reservations(stock uuid) returns void
language plpgsql security definer set search_path='' as $$
declare company uuid; item record;
begin
 select company_id into company from public.stock_items where id=stock;
 if not found then return; end if;
 perform 1 from public.companies where id=company for key share;
 if not found then return; end if;
 perform 1 from public.stock_items where id=stock and company_id=company for update;
 if not found then return; end if;
 for item in
  select d.id from public.deals d
  where d.company_id=company and exists (
   select 1 from public.reservations r
   where r.company_id=company and r.stock_item_id=stock and r.deal_id=d.id
   and r.status='active' and r.expires_at<=now()
  ) order by d.id for update of d
 loop
  -- Acceptance and signing paths serialize on this same deal lock.
  if exists(select 1 from private.offer_reviews where company_id=company and deal_id=item.id and status='accepted') then
   continue;
  end if;
  update public.reservations set status='expired'
  where company_id=company and stock_item_id=stock and deal_id=item.id
  and status='active' and expires_at<=now();
  if found then
   update public.deals set status='draft' where company_id=company and id=item.id and status='reserved';
  end if;
 end loop;
 update public.stock_items set status='available'
 where company_id=company and id=stock and status='reserved'
 and not exists(select 1 from public.reservations where company_id=company and stock_item_id=stock and status='active');
end $$;
revoke all on function private.expire_stock_reservations(uuid) from public,anon,authenticated,service_role;

create or replace function private.expire_reservations() returns integer
language plpgsql security definer set search_path='' as $$
declare tenant record; item record; reservation record; examined integer:=0; processed integer:=0;
begin
 -- Protecting offers are filtered before the batch limit so they cannot starve
 -- ordinary expirations. Every predicate is checked again after locking the deal.
 for tenant in
  select c.id from public.companies c
  where exists (
   select 1 from public.reservations r
   where r.company_id=c.id and r.status='active' and r.expires_at<=now()
   and not exists(select 1 from private.offer_reviews where company_id=r.company_id and deal_id=r.deal_id and status='accepted')
  ) order by c.id for key share of c skip locked
 loop
  exit when examined>=500;
  for item in
   select s.id from public.stock_items s
   where s.company_id=tenant.id and exists (
    select 1 from public.reservations r
    where r.company_id=tenant.id and r.stock_item_id=s.id and r.status='active' and r.expires_at<=now()
    and not exists(select 1 from private.offer_reviews where company_id=r.company_id and deal_id=r.deal_id and status='accepted')
   ) order by s.id limit (500-examined) for update of s skip locked
  loop
   examined:=examined+1;
   select r.id,r.deal_id into reservation from public.reservations r
   where r.company_id=tenant.id and r.stock_item_id=item.id and r.status='active' and r.expires_at<=now();
   if not found then continue; end if;
   -- A slow customer acceptance or contract transaction must not stall the batch.
   perform 1 from public.deals where company_id=tenant.id and id=reservation.deal_id for update skip locked;
   if not found then continue; end if;
   perform private.expire_stock_reservations(item.id);
   if exists(select 1 from public.reservations where id=reservation.id and status='expired') then
    processed:=processed+1;
   end if;
  end loop;
 end loop;
 return processed;
end $$;
revoke all on function private.expire_reservations() from public,anon,authenticated,service_role;

-- The existing public approval/auth wrappers remain unchanged. Their private
-- implementations also lock company first before entering lazy expiry.
create or replace function private.create_deal_approved_impl(company uuid,stock uuid,customer uuid,price_ore bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not private.has_company_role(company,array['owner','admin','sales']) then raise exception 'Access denied' using errcode='42501'; end if;
 perform 1 from public.companies where id=company for key share;
 perform 1 from public.stock_items where id=stock and company_id=company for update;
 if not found then raise exception 'Vehicle is not available'; end if;
 perform private.expire_stock_reservations(stock);
 if not exists(select 1 from public.stock_items where id=stock and company_id=company and status='available') then raise exception 'Vehicle is not available'; end if;
 insert into public.deals(company_id,stock_item_id,customer_id,sale_price_ore,created_by)
 values(company,stock,customer,price_ore,auth.uid()) returning id into result;
 return result;
end $$;
revoke all on function private.create_deal_approved_impl(uuid,uuid,uuid,bigint) from public,anon,authenticated,service_role;

create or replace function private.reserve_vehicle_approved_impl(company uuid,deal uuid,hours integer default 48) returns uuid
language plpgsql security definer set search_path='' as $$
declare stock uuid; d public.deals; s public.stock_items; result uuid;
begin
 if not private.has_company_role(company,array['owner','admin','sales']) then raise exception 'Access denied' using errcode='42501'; end if;
 if hours is null or hours<1 or hours>168 then raise exception 'Invalid reservation duration'; end if;
 select stock_item_id into stock from public.deals where id=deal and company_id=company;
 if not found then raise exception 'Deal unavailable'; end if;
 perform 1 from public.companies where id=company for key share;
 select * into s from public.stock_items where id=stock and company_id=company for update;
 if not found then raise exception 'Vehicle unavailable'; end if;
 perform private.expire_stock_reservations(stock);
 select * into s from public.stock_items where id=stock and company_id=company;
 select * into d from public.deals where id=deal and company_id=company for update;
 if not found or d.status not in ('draft','reserved') then raise exception 'Deal unavailable'; end if;
 if exists(select 1 from public.reservations where stock_item_id=stock and status='active') then raise exception 'Vehicle already reserved' using errcode='23505'; end if;
 if s.status<>'available' then raise exception 'Vehicle unavailable'; end if;
 insert into public.reservations(company_id,stock_item_id,deal_id,expires_at,created_by)
 values(company,stock,deal,now()+make_interval(hours=>hours),auth.uid()) returning id into result;
 update public.stock_items set status='reserved' where id=stock;
 update public.deals set status='reserved' where id=deal;
 return result;
end $$;
revoke all on function private.reserve_vehicle_approved_impl(uuid,uuid,integer) from public,anon,authenticated,service_role;

-- Explicitly approved background job. This is SQL-only: no provider or HTTP calls.
create extension if not exists pg_cron with schema pg_catalog;
revoke all on schema cron from public,anon,authenticated,service_role;
revoke all on all functions in schema cron from public,anon,authenticated,service_role;
revoke all on all tables in schema cron from public,anon,authenticated,service_role;
grant usage on schema cron to postgres;
grant execute on all functions in schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
select cron.schedule('trafexa-expire-reservations','* * * * *','set statement_timeout=''30s''; select private.expire_reservations();');
commit;
