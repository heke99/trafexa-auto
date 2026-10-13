-- All lifecycle functions lock stock before touching reservations or deals.
-- These internal workers are deliberately unavailable to Data API callers.
create function private.expire_stock_reservations(stock uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.stock_items where id=stock for update;
 if not found then return; end if;
 with expired as (
  update public.reservations set status='expired'
  where stock_item_id=stock and status='active' and expires_at<=now()
  returning deal_id
 )
 update public.deals set status='draft'
 where status='reserved' and id in (select deal_id from expired);
 update public.stock_items set status='available'
 where id=stock and status='reserved'
 and not exists (
  select 1 from public.reservations r where r.stock_item_id=stock and r.status='active'
 );
end $$;
revoke all on function private.expire_stock_reservations(uuid) from public,anon,authenticated;

create index reservations_active_expiry_idx on public.reservations(expires_at,stock_item_id)
where status='active';
create function private.expire_reservations() returns integer
language plpgsql security definer set search_path='' as $$
declare item record; processed integer:=0;
begin
 -- Stock UUID ordering and SKIP LOCKED keep concurrent workers and user transactions safe.
 for item in
  select s.id from public.stock_items s
  where exists (
   select 1 from public.reservations r
   where r.stock_item_id=s.id and r.status='active' and r.expires_at<=now()
  )
  order by s.id for update of s skip locked
 loop
  perform private.expire_stock_reservations(item.id);
  processed:=processed+1;
 end loop;
 return processed;
end $$;
revoke all on function private.expire_reservations() from public,anon,authenticated;

-- Lazy expiry releases the old deal and stock atomically before a new deal is created.
create or replace function private.create_deal(company uuid,stock uuid,customer uuid,price_ore bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not private.has_company_role(company,array['owner','admin','sales']) then
  raise exception 'Access denied' using errcode='42501';
 end if;
 perform 1 from public.stock_items where id=stock and company_id=company for update;
 if not found then raise exception 'Vehicle is not available'; end if;
 perform private.expire_stock_reservations(stock);
 if not exists (
  select 1 from public.stock_items where id=stock and company_id=company and status='available'
 ) then raise exception 'Vehicle is not available'; end if;
 insert into public.deals(company_id,stock_item_id,customer_id,sale_price_ore,created_by)
 values(company,stock,customer,price_ore,auth.uid()) returning id into result;
 return result;
end $$;

-- Re-read status after taking the stock lock and expiring any prior reservation.
create or replace function private.reserve_vehicle(company uuid,deal uuid,hours integer default 48) returns uuid
language plpgsql security definer set search_path='' as $$
declare stock uuid; d public.deals; s public.stock_items; result uuid;
begin
 if not private.has_company_role(company,array['owner','admin','sales']) then
  raise exception 'Access denied' using errcode='42501';
 end if;
 if hours is null or hours<1 or hours>168 then raise exception 'Invalid reservation duration'; end if;
 select stock_item_id into stock from public.deals where id=deal and company_id=company;
 if not found then raise exception 'Deal unavailable'; end if;
 select * into s from public.stock_items where id=stock and company_id=company for update;
 if not found then raise exception 'Vehicle unavailable'; end if;
 perform private.expire_stock_reservations(stock);
 select * into s from public.stock_items where id=stock and company_id=company;
 select * into d from public.deals where id=deal and company_id=company for update;
 if not found or d.status not in ('draft','reserved') then raise exception 'Deal unavailable'; end if;
 if exists (
  select 1 from public.reservations where stock_item_id=stock and status='active'
 ) then raise exception 'Vehicle already reserved' using errcode='23505'; end if;
 if s.status<>'available' then raise exception 'Vehicle unavailable'; end if;
 insert into public.reservations(company_id,stock_item_id,deal_id,expires_at,created_by)
 values(company,stock,deal,now()+make_interval(hours=>hours),auth.uid()) returning id into result;
 update public.stock_items set status='reserved' where id=stock;
 update public.deals set status='reserved' where id=deal;
 return result;
end $$;

-- No extension or cron schedule is installed here. Scheduling is a separate reviewed operation.
