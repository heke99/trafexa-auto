-- Run as the migration administrator. No scheduler is installed and every fixture rolls back.
begin;
create temporary table expiry_ids(key text primary key,id uuid not null);
insert into expiry_ids
select key,gen_random_uuid() from unnest(array[
 'company_a','company_b','owner_a','sales_a','finance_a','viewer_a','owner_b','customer_a','customer_b'
]) key;
grant select on expiry_ids to authenticated,anon;
insert into auth.users(id,email,email_confirmed_at)
select id,id::text||'@test.invalid',now() from expiry_ids where key in ('owner_a','sales_a','finance_a','viewer_a','owner_b');
insert into public.companies(id,name,organisation_number,created_by) values
((select id from expiry_ids where key='company_a'),'Expiration A','5560000061',(select id from expiry_ids where key='owner_a')),
((select id from expiry_ids where key='company_b'),'Expiration B','5560000062',(select id from expiry_ids where key='owner_b'));
insert into public.memberships(company_id,user_id,role)
select company.id,actor.id,input.role_name
from (values
 ('company_a','owner_a','owner'),('company_a','sales_a','sales'),('company_a','finance_a','finance'),
 ('company_a','viewer_a','viewer'),('company_b','owner_b','owner')
) input(company_key,actor_key,role_name)
join expiry_ids company on company.key=input.company_key
join expiry_ids actor on actor.key=input.actor_key;
insert into public.customers(id,company_id,name) values
((select id from expiry_ids where key='customer_a'),(select id from expiry_ids where key='company_a'),'Expiry Customer A'),
((select id from expiry_ids where key='customer_b'),(select id from expiry_ids where key='company_b'),'Expiry Customer B');
create temporary table expiry_stock(
 key text primary key,company_id uuid,owner_id uuid,customer_id uuid,
 vehicle_id uuid default gen_random_uuid(),stock_id uuid default gen_random_uuid(),
 old_deal_id uuid default gen_random_uuid(),draft_deal_id uuid default gen_random_uuid(),
 reservation_id uuid,created_deal_id uuid
);
insert into expiry_stock(key,company_id,owner_id,customer_id)
select input.key,company.id,actor.id,customer.id
from (values
 ('expired_a','company_a','owner_a','customer_a'),('future_a','company_a','owner_a','customer_a'),
 ('lazy_create_a','company_a','owner_a','customer_a'),('lazy_reserve_a','company_a','owner_a','customer_a'),
 ('sold_a','company_a','owner_a','customer_a'),('expired_b','company_b','owner_b','customer_b')
) input(key,company_key,actor_key,customer_key)
join expiry_ids company on company.key=input.company_key
join expiry_ids actor on actor.key=input.actor_key
join expiry_ids customer on customer.key=input.customer_key;
grant select on expiry_stock to authenticated,anon;
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)
select vehicle_id,company_id,'E'||substr(replace(vehicle_id::text,'-',''),1,12),'Volvo','V60',2022 from expiry_stock;
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)
select stock_id,company_id,vehicle_id,15000000,20000000,'unknown' from expiry_stock;
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)
select old_deal_id,company_id,stock_id,customer_id,20000000,owner_id from expiry_stock
union all
select draft_deal_id,company_id,stock_id,customer_id,20000000,owner_id from expiry_stock;
do $$ declare item record; reservation uuid; begin
 for item in select * from expiry_stock order by stock_id loop
  perform set_config('request.jwt.claim.sub',item.owner_id::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',item.owner_id,'role','authenticated')::text,true);
  reservation:=public.reserve_vehicle(item.company_id,item.old_deal_id,48);
  update expiry_stock set reservation_id=reservation where key=item.key;
 end loop;
end $$;
update public.reservations set expires_at=now()-interval '1 minute'
where id in (select reservation_id from expiry_stock where key in ('expired_a','expired_b','sold_a'));
update public.stock_items set status='sold' where id=(select stock_id from expiry_stock where key='sold_a');

-- Owner privileges remain tenant scoped; workers cannot be called by ordinary users.
select set_config('request.jwt.claim.sub',(select id::text from expiry_ids where key='owner_a'),true);
select set_config('request.jwt.claims',json_build_object('sub',(select id from expiry_ids where key='owner_a'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare blocked boolean; item record; duration integer; begin
 blocked:=false;
 begin perform private.expire_reservations(); exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL authenticated worker execute'; end if;
 blocked:=false;
 begin perform private.expire_stock_reservations((select stock_id from expiry_stock where key='expired_b'));
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL authenticated stock expiry execute'; end if;
 blocked:=false;
 begin perform public.reserve_vehicle((select company_id from expiry_stock where key='expired_b'),(select draft_deal_id from expiry_stock where key='expired_b'),48);
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL cross-company reservation'; end if;
 blocked:=false;
 begin perform public.create_deal((select company_id from expiry_stock where key='expired_b'),(select stock_id from expiry_stock where key='expired_b'),(select customer_id from expiry_stock where key='expired_b'),20000000);
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL cross-company lazy expiry'; end if;
 select * into item from expiry_stock where key='future_a';
 foreach duration in array array[null,0,-1,169] loop
  blocked:=false;
  begin perform public.reserve_vehicle(item.company_id,item.draft_deal_id,duration);
  exception when raise_exception then blocked:=true; end;
  if not blocked then raise exception 'FAIL invalid duration %',duration; end if;
 end loop;
 blocked:=false;
 begin perform public.reserve_vehicle(item.company_id,item.draft_deal_id,48);
 exception when unique_violation then blocked:=true; end;
 if not blocked then raise exception 'FAIL active reservation collision'; end if;
end $$;
reset role;

do $$ declare actor uuid; blocked boolean; item record; begin
 select * into item from expiry_stock where key='expired_a';
 for actor in select id from expiry_ids where key in ('viewer_a','finance_a') loop
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  blocked:=false;
  begin perform public.reserve_vehicle(item.company_id,item.draft_deal_id,48);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL non-sales reservation role'; end if;
  blocked:=false;
  begin perform public.create_deal(item.company_id,item.stock_id,item.customer_id,20000000);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL non-sales create-deal role'; end if;
  execute 'reset role';
 end loop;
end $$;

-- The administrator worker expires both tenants and preserves a sold stock lifecycle.
select private.expire_reservations();
do $$ begin
 if exists(select 1 from public.reservations r join expiry_stock f on f.reservation_id=r.id where f.key in ('expired_a','expired_b','sold_a') and r.status<>'expired') then
  raise exception 'FAIL worker reservation status';
 end if;
 if exists(select 1 from public.deals d join expiry_stock f on f.old_deal_id=d.id where f.key in ('expired_a','expired_b','sold_a') and d.status<>'draft') then
  raise exception 'FAIL worker old deal release';
 end if;
 if exists(select 1 from public.stock_items s join expiry_stock f on f.stock_id=s.id where f.key in ('expired_a','expired_b') and s.status<>'available') then
  raise exception 'FAIL worker stock release';
 end if;
 if (select status from public.stock_items where id=(select stock_id from expiry_stock where key='sold_a'))<>'sold' then
  raise exception 'FAIL expiration resurrected sold stock';
 end if;
 if (select r.status from public.reservations r join expiry_stock f on f.reservation_id=r.id where f.key='future_a')<>'active'
 or (select d.status from public.deals d join expiry_stock f on f.old_deal_id=d.id where f.key='future_a')<>'reserved'
 or (select s.status from public.stock_items s join expiry_stock f on f.stock_id=s.id where f.key='future_a')<>'reserved' then
  raise exception 'FAIL future reservation was changed';
 end if;
end $$;
select private.expire_reservations();

-- expires_at equal to the transaction timestamp is already expired.
select set_config('request.jwt.claim.sub',(select id::text from expiry_ids where key='owner_a'),true);
select set_config('request.jwt.claims',json_build_object('sub',(select id from expiry_ids where key='owner_a'),'role','authenticated')::text,true);
update expiry_stock set reservation_id=public.reserve_vehicle(company_id,old_deal_id,48) where key='expired_a';
update public.reservations set expires_at=now() where id=(select reservation_id from expiry_stock where key='expired_a');
select private.expire_reservations();
do $$ begin
 if (select r.status from public.reservations r join expiry_stock f on f.reservation_id=r.id where f.key='expired_a')<>'expired' then
  raise exception 'FAIL exact expiration boundary';
 end if;
end $$;

-- A failed new deal rolls the lazy expiry back as part of the same transaction.
update public.reservations set expires_at=now()-interval '1 minute' where id=(select reservation_id from expiry_stock where key='lazy_create_a');
set local role authenticated;
do $$ declare item record; blocked boolean:=false; begin
 select * into item from expiry_stock where key='lazy_create_a';
 begin perform public.create_deal(item.company_id,item.stock_id,(select id from expiry_ids where key='customer_b'),20000000);
 exception when foreign_key_violation then blocked:=true; end;
 if not blocked then raise exception 'FAIL foreign customer in lazy deal'; end if;
 if (select status from public.stock_items where id=item.stock_id)<>'reserved'
 or (select status from public.deals where id=item.old_deal_id)<>'reserved'
 or (select status from public.reservations where id=item.reservation_id)<>'active' then
  raise exception 'FAIL failed deal partially expired reservation';
 end if;
end $$;
reset role;
update expiry_stock set created_deal_id=public.create_deal(company_id,stock_id,customer_id,20000000) where key='lazy_create_a';
do $$ declare item record; begin
 select * into item from expiry_stock where key='lazy_create_a';
 if (select status from public.stock_items where id=item.stock_id)<>'available'
 or (select status from public.deals where id=item.old_deal_id)<>'draft'
 or (select status from public.reservations where id=item.reservation_id)<>'expired'
 or (select status from public.deals where id=item.created_deal_id)<>'draft' then
  raise exception 'FAIL lazy create-deal state';
 end if;
end $$;

-- An older draft can claim expired stock, after the former deal is released atomically.
update public.reservations set expires_at=now()-interval '1 minute' where id=(select reservation_id from expiry_stock where key='lazy_reserve_a');
update public.deals set status='cancelled' where id=(select draft_deal_id from expiry_stock where key='lazy_reserve_a');
set local role authenticated;
do $$ declare item record; blocked boolean:=false; begin
 select * into item from expiry_stock where key='lazy_reserve_a';
 begin perform public.reserve_vehicle(item.company_id,item.draft_deal_id,48);
 exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'FAIL cancelled deal reserved'; end if;
 if (select status from public.reservations where id=item.reservation_id)<>'active'
 or (select status from public.deals where id=item.old_deal_id)<>'reserved'
 or (select status from public.stock_items where id=item.stock_id)<>'reserved' then
  raise exception 'FAIL failed reserve partially expired reservation';
 end if;
end $$;
reset role;
update public.deals set status='draft' where id=(select draft_deal_id from expiry_stock where key='lazy_reserve_a');
select set_config('request.jwt.claim.sub',(select id::text from expiry_ids where key='sales_a'),true);
select set_config('request.jwt.claims',json_build_object('sub',(select id from expiry_ids where key='sales_a'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare item record; new_reservation uuid; begin
 select * into item from expiry_stock where key='lazy_reserve_a';
 new_reservation:=public.reserve_vehicle(item.company_id,item.draft_deal_id,48);
 if (select status from public.deals where id=item.old_deal_id)<>'draft'
 or (select status from public.reservations where id=item.reservation_id)<>'expired'
 or (select status from public.deals where id=item.draft_deal_id)<>'reserved'
 or (select status from public.stock_items where id=item.stock_id)<>'reserved'
 or (select count(*) from public.reservations where stock_item_id=item.stock_id and status='active')<>1
 or (select created_by from public.reservations where id=new_reservation)<>auth.uid() then
  raise exception 'FAIL lazy reserve state or creator';
 end if;
 perform public.release_reservation(item.company_id,item.draft_deal_id);
 if (select status from public.stock_items where id=item.stock_id)<>'available'
 or (select status from public.deals where id=item.draft_deal_id)<>'draft'
 or exists(select 1 from public.reservations where stock_item_id=item.stock_id and status='active') then
  raise exception 'FAIL release after lazy reservation';
 end if;
end $$;
reset role;

update public.memberships set status='suspended' where user_id=(select id from expiry_ids where key='sales_a');
set local role authenticated;
do $$ declare item record; blocked boolean:=false; begin
 select * into item from expiry_stock where key='lazy_reserve_a';
 begin perform public.reserve_vehicle(item.company_id,item.draft_deal_id,48);
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL suspended salesperson reservation'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ declare blocked boolean:=false; begin
 begin perform private.expire_reservations(); exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL anonymous worker execute'; end if;
 blocked:=false;
 begin perform public.reserve_vehicle((select company_id from expiry_stock where key='expired_a'),(select old_deal_id from expiry_stock where key='expired_a'),48);
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL anonymous reservation execute'; end if;
end $$;
reset role;
select 'PASS: worker tenant expiry, exact time boundary, future/sold preservation, lazy create/reserve, atomic rollback, one active reservation, release, role/tenant/private-worker denial' as result;
rollback;
