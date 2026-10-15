-- Hosted-safe proof: random, explicitly approved fixtures and every change rolls
-- back. No background jobs, provider calls or permanent test approval hooks.
begin;
create temporary table register_fixture(key text primary key,id uuid not null);
insert into register_fixture select key,gen_random_uuid() from unnest(array['owner','finance','viewer','pending','other_owner','company','foreign_company','foreign_customer']) key;
grant select on register_fixture to authenticated,anon,service_role;
insert into auth.users(id,email,email_confirmed_at)
 select id,id::text||'@register-fixture.invalid',now() from register_fixture where key in ('owner','finance','viewer','pending','other_owner');
insert into private.account_approvals(user_id,status,updated_by)
 select id,case when key='pending' then 'pending' else 'approved' end,id from register_fixture where key in ('owner','finance','viewer','pending','other_owner');
insert into public.companies(id,name,organisation_number,created_by) values
 ((select id from register_fixture where key='company'),'Register rollback proof','9915000001',(select id from register_fixture where key='owner')),
 ((select id from register_fixture where key='foreign_company'),'Foreign register rollback proof','9915000002',(select id from register_fixture where key='other_owner'));
insert into public.memberships(company_id,user_id,role)
 select (select id from register_fixture where key='company'),id,case when key='owner' then 'owner' when key='pending' then 'sales' else key end
 from register_fixture where key in ('owner','finance','viewer','pending');
insert into public.memberships(company_id,user_id,role) values
 ((select id from register_fixture where key='foreign_company'),(select id from register_fixture where key='other_owner'),'owner');
create temporary table register_rows as
 select g,gen_random_uuid() as vehicle_id,gen_random_uuid() as stock_id,gen_random_uuid() as customer_id,gen_random_uuid() as deal_id
 from generate_series(1,600) g;
grant select on register_rows to authenticated;
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)
 select vehicle_id,(select id from register_fixture where key='company'),'RG'||lpad(g::text,4,'0'),'Fixture',case when g=600 then 'Late 100%_ O''Brien' else 'Car' end,2022 from register_rows;
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme,status,created_at)
 select stock_id,(select id from register_fixture where key='company'),vehicle_id,12500029,15900009+(g%3)*100,'unknown',
 case when g%6 in (0,1,2) then 'available' when g%6=3 then 'reserved' when g%6=4 then 'sold' else 'archived' end,
 case when g>550 then '2026-01-01T00:00:00.123456Z'::timestamptz else '2026-10-15T08:30:00.123456Z'::timestamptz end from register_rows;
insert into public.customers(id,company_id,name,kind,email,created_at)
 select customer_id,(select id from register_fixture where key='company'),case when g=600 then 'Late 100%_ O''Brien' else 'Buyer '||g end,
 case when g%2=0 then 'business' else 'person' end,'buyer-'||g||'@fixture.invalid',
 case when g>550 then '2026-01-01T00:00:00.123456Z'::timestamptz else '2026-10-15T08:30:00.123456Z'::timestamptz end from register_rows;
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by,created_at)
 select deal_id,(select id from register_fixture where key='company'),
 case when g=1 then (select stock_id from register_rows where g=600) else stock_id end,
 case when g=1 then (select customer_id from register_rows where g=600) else customer_id end,
 15900009+(g%3)*100,(select id from register_fixture where key='owner'),
 case when g=1 then '2026-10-15T08:31:00.123456Z'::timestamptz else '2026-10-15T08:30:00.123456Z'::timestamptz end from register_rows;
insert into public.customers(id,company_id,name) values((select id from register_fixture where key='foreign_customer'),(select id from register_fixture where key='foreign_company'),'Foreign only buyer');
select set_config('request.jwt.claim.sub',(select id::text from register_fixture where key='owner'),true);
set local role authenticated;
do $$ declare company uuid; p jsonb; next_key jsonb; seen uuid[]; expected uuid[]; kind text; sorting text; selected uuid; denied boolean; begin
 select id into company from register_fixture where key='company';
 foreach kind in array array['inventory','customers','deals'] loop
  foreach sorting in array case when kind='customers' then array['recent'] else array['recent','price_asc','price_desc'] end loop
   next_key:=null; seen:=array[]::uuid[];
   loop
    p:=public.dealer_register_page(company,kind,'','all',sorting,next_key,false,null);
    if p->>'totalCount'<>'600' or p->>'filteredCount'<>'600' or p->'counts'->>'all'<>'600'
     or p->>'companyId'<>company::text or p->>'actorId'<>auth.uid()::text or p->>'role'<>'owner' then raise exception 'FAIL full totals/scope';end if;
    if jsonb_array_length(p->'rows')<>50 then raise exception 'FAIL fifty-record pages';end if;
    seen:=seen||array(select (value->>'id')::uuid from jsonb_array_elements(p->'rows'));
    if p->'nextCursor'='null'::jsonb then exit;end if;
    next_key:=p->'nextCursor';
    if not (next_key->>'createdAt') ~ '\.123456' then raise exception 'FAIL cursor microseconds';end if;
    if cardinality(seen)>600 then raise exception 'FAIL cursor loop';end if;
   end loop;
   if cardinality(seen)<>600 or (select count(distinct x) from unnest(seen)x)<>600 then raise exception 'FAIL duplicated/missing keyset row';end if;
   if kind='inventory' then
    select array_agg(id order by case when sorting='price_asc' then asking_price_ore end asc,case when sorting='price_desc' then asking_price_ore end desc,case when sorting='price_asc' then created_at end asc,case when sorting<>'price_asc' then created_at end desc,case when sorting='price_asc' then id end asc,case when sorting<>'price_asc' then id end desc) into expected from public.stock_items where company_id=company;
   elsif kind='customers' then select array_agg(id order by created_at desc,id desc) into expected from public.customers where company_id=company;
   else
    select array_agg(id order by case when sorting='price_asc' then sale_price_ore end asc,case when sorting='price_desc' then sale_price_ore end desc,case when sorting='price_asc' then created_at end asc,case when sorting<>'price_asc' then created_at end desc,case when sorting='price_asc' then id end asc,case when sorting<>'price_asc' then id end desc) into expected from public.deals where company_id=company;
   end if;
   if seen<>expected then raise exception 'FAIL deterministic sorted ID tie break';end if;
  end loop;
 end loop;
 p:=public.dealer_register_page(company,'inventory','','available','recent');
 if p->>'filteredCount'<>'300' or p->'counts'->>'available'<>'300' or p->'counts'->>'reserved'<>'100' or p->'counts'->>'sold'<>'100' or p->'counts'->>'archived'<>'100' then raise exception 'FAIL full inventory tab counts';end if;
 p:=public.dealer_register_page(company,'customers','','business','recent');
 if p->>'filteredCount'<>'300' or p->'counts'->>'person'<>'300' or p->'counts'->>'business'<>'300' then raise exception 'FAIL full customer kind totals';end if;
 foreach kind in array array['inventory','customers','deals'] loop
  p:=public.dealer_register_page(company,kind,'100%_ O''Brien','all','recent');
  if (p->>'filteredCount')::int<>(case when kind='deals' then 2 else 1 end) or p->>'totalCount'<>'600' then raise exception 'FAIL literal search or whole-company search';end if;
 end loop;
 p:=public.dealer_register_page(company,'deals','','all','recent');
 if p->'rows'->0->'customer'->>'id'<>(select customer_id::text from register_rows where g=600)
 or p->'rows'->0->'stockItem'->>'id'<>(select stock_id::text from register_rows where g=600)
 or p->'rows'->0->'stockItem'->'vehicles'->>'registration_number'<>'RG0600' then raise exception 'FAIL deal relations beyond old snapshot';end if;
 select stock_id into selected from register_rows where g=600;
 p:=public.dealer_register_page(company,'inventory','no-match','available','recent',null,true,selected);
 if p->>'totalCount'<>'300' or p->>'filteredCount'<>'0' or p->'selected'->>'id'<>selected::text or jsonb_array_length(p->'rows')<>0 then raise exception 'FAIL pinned selected available option';end if;
 select stock_id into selected from register_rows where g=599;
 p:=public.dealer_register_page(company,'inventory','','available','recent',null,true,selected);
 if p->'selected'<>'null'::jsonb then raise exception 'FAIL unavailable selected option';end if;
 select customer_id into selected from register_rows where g=600;
 p:=public.dealer_register_page(company,'customers','no-match','all','recent',null,true,selected);
 if p->'selected'->>'id'<>selected::text or p->>'filteredCount'<>'0' then raise exception 'FAIL pinned customer beyond 500';end if;
 p:=public.dealer_register_page(company,'customers','','all','recent',null,true,(select id from register_fixture where key='foreign_customer'));
 if p->'selected'<>'null'::jsonb then raise exception 'FAIL foreign selected customer';end if;
 -- A cursor cannot be reused for another search, tenant, actor, role or mode.
 p:=public.dealer_register_page(company,'inventory','','all','recent');next_key:=p->'nextCursor';
 denied:=false;begin perform public.dealer_register_page(company,'inventory','changed','all','recent',next_key);exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'FAIL changed query cursor';end if;
 denied:=false;begin perform public.dealer_register_page(company,'inventory','','available','recent',next_key);exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'FAIL changed status cursor';end if;
 denied:=false;begin perform public.dealer_register_page(company,'inventory','','all','price_asc',next_key);exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'FAIL changed sort cursor';end if;
 denied:=false;begin perform public.dealer_register_page(company,'inventory','','all','recent',jsonb_set(next_key,'{actorId}',to_jsonb((select id::text from register_fixture where key='finance'))));exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'FAIL changed actor cursor';end if;
 denied:=false;begin perform public.dealer_register_page(company,'inventory','','all','recent',jsonb_set(next_key,'{role}','"finance"'::jsonb));exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'FAIL changed role cursor';end if;
 denied:=false;begin perform public.dealer_register_page(company,'inventory','','all','recent',next_key||'{"extra":true}'::jsonb);exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'FAIL unknown cursor fields';end if;
 denied:=false;begin perform public.dealer_register_page(company,'inventory','','all','recent',jsonb_set(next_key,'{createdAt}','"2026-02-30T00:00:00Z"'));exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'FAIL invalid cursor date';end if;
 denied:=false;begin perform public.dealer_register_page(company,'inventory',repeat('x',121),'all','recent');exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'FAIL search bound';end if;
 denied:=false;begin perform public.dealer_register_page(company,'inventory','','unknown','recent');exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'FAIL whitelist status';end if;
 denied:=false;begin perform public.dealer_register_page(company,'customers','','all','price_asc');exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'FAIL whitelist sort';end if;
 denied:=false;begin perform public.dealer_register_page((select id from register_fixture where key='foreign_company'),'customers');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL foreign company';end if;
end $$;
reset role;
-- Finance and viewer retain the intended read permission, without write grants.
select set_config('request.jwt.claim.sub',(select id::text from register_fixture where key='finance'),true);
set local role authenticated;
do $$declare p jsonb;begin p:=public.dealer_register_page((select id from register_fixture where key='company'),'customers');if p->>'role'<>'finance' or p->>'totalCount'<>'600' then raise exception 'FAIL finance read';end if;end$$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from register_fixture where key='viewer'),true);
set local role authenticated;
do $$declare p jsonb;begin p:=public.dealer_register_page((select id from register_fixture where key='company'),'deals');if p->>'role'<>'viewer' or p->>'totalCount'<>'600' then raise exception 'FAIL viewer read';end if;end$$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from register_fixture where key='pending'),true);
set local role authenticated;
do $$declare denied boolean:=false;begin begin perform public.dealer_register_page((select id from register_fixture where key='company'),'inventory');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL pending account';end if;end$$;
reset role;
update private.account_approvals set status='suspended' where user_id=(select id from register_fixture where key='owner');
select set_config('request.jwt.claim.sub',(select id::text from register_fixture where key='owner'),true);
set local role authenticated;
do $$declare denied boolean:=false;begin begin perform public.dealer_register_page((select id from register_fixture where key='company'),'inventory');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL suspended approval';end if;end$$;
reset role;
update private.account_approvals set status='approved' where user_id=(select id from register_fixture where key='owner');
update public.memberships set status='suspended' where user_id=(select id from register_fixture where key='owner');
set local role authenticated;
do $$declare denied boolean:=false;begin begin perform public.dealer_register_page((select id from register_fixture where key='company'),'inventory');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL suspended membership';end if;end$$;
reset role;
set local role anon;
do $$declare denied boolean:=false;begin begin perform public.dealer_register_page((select id from register_fixture where key='company'),'customers');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL anonymous RPC';end if;end$$;
reset role;
set local role service_role;
do $$declare denied boolean:=false;begin begin perform public.dealer_register_page((select id from register_fixture where key='company'),'customers');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL service-role RPC';end if;end$$;
reset role;
select 'PASS: full 600-record totals and seven sorted keyset walks, precise cursors, literal search, complete deal relations, pinned scoped selectors, finance/viewer reads, approval/tenant/role boundaries' as result;
rollback;
