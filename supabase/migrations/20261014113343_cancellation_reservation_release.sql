begin;
-- Preserve the reservation API while sharing cancellation's stock/deal lock order.
create or replace function private.release_reservation(company uuid,deal uuid) returns void language plpgsql security definer set search_path='' as $$
declare stock uuid;d public.deals;a uuid;r text;
begin
 select actor,actor_role into a,r from private.customer_contact_access(company,true);
 select stock_item_id into stock from public.deals where id=deal and company_id=company;
 if not found then raise exception 'Deal unavailable' using errcode='42501';end if;
 perform 1 from public.stock_items where id=stock and company_id=company for update;
 if not found then raise exception 'Vehicle unavailable' using errcode='42501';end if;
 select * into d from public.deals where id=deal and company_id=company for update;
 if not found or d.stock_item_id<>stock or d.status not in ('draft','reserved') then raise exception 'Deal unavailable' using errcode='40001';end if;
 if exists(select 1 from private.offer_reviews where company_id=company and deal_id=deal and status='accepted') then raise exception 'Accepted offer requires agreement process' using errcode='40001';end if;
 update public.reservations set status='released' where company_id=company and deal_id=deal and stock_item_id=stock and status='active';
 if found then
  update public.stock_items set status='available' where company_id=company and id=stock and status='reserved' and not exists(select 1 from public.reservations where company_id=company and stock_item_id=stock and status='active');
  update public.deals set status='draft' where company_id=company and id=deal and status='reserved';
 end if;
end$$;
revoke all on function private.release_reservation(uuid,uuid) from public,anon,service_role;
grant execute on function private.release_reservation(uuid,uuid) to authenticated;
commit;
