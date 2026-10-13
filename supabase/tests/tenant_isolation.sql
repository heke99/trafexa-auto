-- Run as migration administrator against a test project. All fixtures roll back.
begin;
create temporary table fixtures(key text primary key,id uuid not null);
grant select on fixtures to authenticated;
insert into fixtures values('user_a',gen_random_uuid()),('user_b',gen_random_uuid()),('company_a',gen_random_uuid()),('company_b',gen_random_uuid()),('customer_b',gen_random_uuid());
insert into auth.users(id,email,email_confirmed_at) select id,key||'@test.invalid',now() from fixtures where key in ('user_a','user_b');
insert into public.companies(id,name,organisation_number,created_by) values
((select id from fixtures where key='company_a'),'Tenant isolation A','5560000001',(select id from fixtures where key='user_a')),
((select id from fixtures where key='company_b'),'Tenant isolation B','5560000002',(select id from fixtures where key='user_b'));
insert into public.memberships(company_id,user_id,role) values
((select id from fixtures where key='company_a'),(select id from fixtures where key='user_a'),'owner'),
((select id from fixtures where key='company_b'),(select id from fixtures where key='user_b'),'owner');
insert into public.customers(id,company_id,name) values((select id from fixtures where key='customer_b'),(select id from fixtures where key='company_b'),'Private B');
select set_config('request.jwt.claim.sub',(select id::text from fixtures where key='user_a'),true);
select set_config('request.jwt.claims',json_build_object('sub',(select id from fixtures where key='user_a'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare ca uuid; cb uuid; cust uuid; stock uuid; deal1 uuid; deal2 uuid; blocked boolean; begin
 select id into ca from fixtures where key='company_a';select id into cb from fixtures where key='company_b';
 if (select count(*) from public.companies)!=1 then raise exception 'FAIL company isolation'; end if;
 if exists(select 1 from public.customers where company_id=cb) then raise exception 'FAIL customer privacy'; end if;
 blocked:=false;
 begin insert into public.customers(company_id,name) values(cb,'Unauthorized');exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL tenant write boundary'; end if;
 blocked:=false;
 begin update public.memberships set role='admin';exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL membership escalation'; end if;
 insert into public.customers(company_id,name) values(ca,'Customer A') returning id into cust;
 stock:=public.create_stock(ca,'TEST123','Volvo','V60',2022,50000,'hybrid','automatic',15000000,20000000,'unknown');
 blocked:=false;
 begin perform public.create_deal(ca,stock,(select id from fixtures where key='customer_b'),20000000);exception when foreign_key_violation then blocked:=true; end;
 if not blocked then raise exception 'FAIL cross tenant relationship'; end if;
 deal1:=public.create_deal(ca,stock,cust,20000000);deal2:=public.create_deal(ca,stock,cust,20000000);
 perform public.reserve_vehicle(ca,deal1,48);
 blocked:=false;
 begin perform public.reserve_vehicle(ca,deal2,48);exception when unique_violation then blocked:=true; end;
 if not blocked then raise exception 'FAIL duplicate active reservation'; end if;
 if (select count(*) from public.reservations where stock_item_id=stock and status='active')!=1 then raise exception 'FAIL reservation invariant'; end if;
 perform public.release_reservation(ca,deal1);
 perform public.reserve_vehicle(ca,deal2,48);
 if (select status from public.stock_items where id=stock)!='reserved' then raise exception 'FAIL reservation stock state'; end if;
 blocked:=false;
 begin insert into public.finance_applications(company_id,product,requested_amount_ore,status,created_by) values(ca,'purchase',10000,'submitted',auth.uid());exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL fake partner submission'; end if;
 blocked:=false;
 begin perform public.reserve_vehicle(cb,deal2,48);exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL reservation authorization'; end if;
end $$;
reset role;
update public.memberships set status='suspended' where user_id=(select id from fixtures where key='user_a');
set local role authenticated;
do $$ begin
 if exists(select 1 from public.customers) then raise exception 'FAIL suspended membership retains access';end if;
end $$;
reset role;
select 'PASS: tenant read/write isolation, role escalation, cross-tenant foreign key, reservation conflict/release, finance intake boundary, suspended membership' as result;
rollback;
