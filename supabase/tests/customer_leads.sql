-- Migration-administrator test. Every contact, lead, receipt and audit event rolls back.
begin;
create temporary table lead_ids(key text primary key,id uuid not null);
insert into lead_ids select key,gen_random_uuid() from unnest(array['company_a','company_b','owner_a','admin_a','sales_a','finance_a','viewer_a','owner_b']) key;
create temporary table lead_actors(key text,user_id uuid,company_id uuid,role_name text,can_write boolean,submission_id uuid default gen_random_uuid(),lead_id uuid);
insert into lead_actors(key,user_id,company_id,role_name,can_write)
select input.key,actor.id,company.id,input.role_name,input.can_write
from (values
 ('owner_a','company_a','owner',true),('admin_a','company_a','admin',true),('sales_a','company_a','sales',true),
 ('finance_a','company_a','finance',false),('viewer_a','company_a','viewer',false),('owner_b','company_b','owner',true)
) input(key,company_key,role_name,can_write)
join lead_ids actor on actor.key=input.key join lead_ids company on company.key=input.company_key;
grant select on lead_ids,lead_actors to authenticated,anon;
insert into auth.users(id,email,email_confirmed_at) select user_id,user_id::text||'@test.invalid',now() from lead_actors;
insert into public.companies(id,name,organisation_number,created_by) values
((select id from lead_ids where key='company_a'),'Lead Company A','5560000071',(select id from lead_ids where key='owner_a')),
((select id from lead_ids where key='company_b'),'Lead Company B','5560000072',(select id from lead_ids where key='owner_b'));
insert into public.memberships(company_id,user_id,role) select company_id,user_id,role_name from lead_actors;
do $$ declare actor record; result uuid; begin
 for actor in select * from lead_actors where can_write loop
  perform set_config('request.jwt.claim.sub',actor.user_id::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',actor.user_id,'role','authenticated')::text,true);
  result:=public.create_customer_lead(actor.company_id,actor.submission_id,'Contact '||actor.key,actor.user_id::text||'@test.invalid','','Family car request');
  update lead_actors set lead_id=result where key=actor.key;
 end loop;
end $$;

do $$ declare actor record; foreign_company uuid; target uuid; result uuid; blocked boolean; affected integer; initial_count integer;
begin
 for actor in select * from lead_actors order by key loop
  select id into foreign_company from lead_ids where key in ('company_a','company_b') and id<>actor.company_id;
  select lead_id into target from lead_actors where company_id=actor.company_id and can_write order by key limit 1;
  if actor.can_write then target:=actor.lead_id; end if;
  perform set_config('request.jwt.claim.sub',actor.user_id::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',actor.user_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if (select count(*) from public.leads where company_id=actor.company_id)<>(case when actor.key='owner_b' then 1 else 3 end) then raise exception 'FAIL lead read role %',actor.key; end if;
  if exists(select 1 from public.leads where company_id=foreign_company) or exists(select 1 from public.customers where company_id=foreign_company) then raise exception 'FAIL cross-company lead/contact read'; end if;
  select count(*) into initial_count from public.customers where company_id=actor.company_id;
  blocked:=false;
  begin result:=public.create_customer_lead(actor.company_id,actor.submission_id,'  Contact '||actor.key||'  ',upper(actor.user_id::text||'@test.invalid'),'','  Family car request  ');
  exception when insufficient_privilege then blocked:=true; end;
  if blocked=actor.can_write then raise exception 'FAIL lead create role %',actor.key; end if;
  if actor.can_write and result<>actor.lead_id then raise exception 'FAIL normalized retry changed lead'; end if;
  if (select count(*) from public.customers where company_id=actor.company_id)<>initial_count then raise exception 'FAIL retry created duplicate contact'; end if;
  blocked:=false;
  begin perform public.create_customer_lead(foreign_company,gen_random_uuid(),'Foreign Contact','contact@test.invalid','','Denied');
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL cross-company lead creation'; end if;

  update public.leads set status='contacted' where company_id=actor.company_id and id=target and status='new';
  get diagnostics affected=row_count;
  if affected<>(case when actor.can_write then 1 else 0 end) then raise exception 'FAIL lead status role %',actor.key; end if;
  update public.leads set status='closed' where company_id=actor.company_id and id=target and status='new';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'FAIL stale status overwrote current state'; end if;
  update public.leads set status='closed' where company_id=foreign_company;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'FAIL foreign lead status update'; end if;
  blocked:=false;
  begin update public.leads set subject='Unauthorized note rewrite' where id=target;
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL non-status lead column grant'; end if;
  blocked:=false;
  begin update public.leads set company_id=foreign_company,created_at=now() where id=target;
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL tenant/timestamp lead column grant'; end if;
  blocked:=false;
  begin insert into public.leads(company_id,subject) values(actor.company_id,'Bypass intake');
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL direct lead insert bypass'; end if;
  blocked:=false;
  begin perform 1 from private.lead_intakes;
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL private receipt access'; end if;
  if actor.can_write then
   blocked:=false;
   begin perform public.create_customer_lead(actor.company_id,actor.submission_id,'Changed Contact',actor.user_id::text||'@test.invalid','','Family car request');
   exception when invalid_parameter_value then blocked:=true; end;
   if not blocked then raise exception 'FAIL reused UUID changed payload'; end if;
   blocked:=false;
   begin update public.leads set status='reserved' where id=target;
   exception when check_violation then blocked:=true; end;
   if not blocked then raise exception 'FAIL invalid lead status'; end if;
  end if;
  execute 'reset role';
 end loop;
end $$;

-- Invalid submissions must create neither a contact nor a lead.
select set_config('request.jwt.claim.sub',(select id::text from lead_ids where key='owner_a'),true);
select set_config('request.jwt.claims',json_build_object('sub',(select id from lead_ids where key='owner_a'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare company uuid; blocked boolean; customers_before integer; leads_before integer; input record; begin
 select id into company from lead_ids where key='company_a';
 select count(*) into customers_before from public.customers where company_id=company;
 select count(*) into leads_before from public.leads where company_id=company;
 for input in select * from (values
  ('','contact@test.invalid','','Valid note'),('Contact','','','Valid note'),
  ('Contact','a@b@c.example','','Valid note'),('Contact','','...','Valid note'),
  ('Contact','contact@test.invalid','',repeat('x',2001)),('Contact','contact@test.invalid','','')
 ) v(name,email,phone,subject) loop
  blocked:=false;
  begin perform public.create_customer_lead(company,gen_random_uuid(),input.name,input.email,input.phone,input.subject);
  exception when invalid_parameter_value then blocked:=true; end;
  if not blocked then raise exception 'FAIL invalid lead input accepted'; end if;
 end loop;
 if (select count(*) from public.customers where company_id=company)<>customers_before
 or (select count(*) from public.leads where company_id=company)<>leads_before then raise exception 'FAIL invalid intake partially created contact/lead'; end if;
end $$;
reset role;
do $$ declare actor record; result uuid; begin
 select * into actor from lead_actors where key='owner_a';
 if (select count(*) from public.audit_events where company_id=actor.company_id and entity_table='leads' and action='INSERT')<>3 then raise exception 'FAIL lead creation audit'; end if;
 if not exists(select 1 from public.audit_events where entity_id=actor.lead_id and entity_table='leads' and action='UPDATE' and actor_user_id=actor.user_id) then raise exception 'FAIL lead status audit actor'; end if;
 -- Expired receipts permit a new intake; replay protection is explicitly seven days.
 update private.lead_intakes set created_at=now()-interval '7 days' where company_id=actor.company_id and user_id=actor.user_id and submission_id=actor.submission_id;
 result:=public.create_customer_lead(actor.company_id,actor.submission_id,'Contact '||actor.key,actor.user_id::text||'@test.invalid','','Family car request');
 if result=actor.lead_id then raise exception 'FAIL receipt expiration boundary'; end if;
 update lead_actors set lead_id=result where key=actor.key;
end $$;

-- The receipt ceiling rejects new work atomically but still permits successful retries.
insert into private.lead_intakes(company_id,user_id,submission_id,payload_hash,lead_id)
select actor.company_id,actor.user_id,gen_random_uuid(),repeat('a',64),actor.lead_id
from lead_actors actor cross join lateral generate_series(1,1000-(select count(*)::integer from private.lead_intakes r where r.company_id=actor.company_id)) n
where actor.key='owner_a';
set local role authenticated;
do $$ declare actor record; blocked boolean:=false; initial_count integer; result uuid; begin
 select * into actor from lead_actors where key='owner_a';
 select count(*) into initial_count from public.customers where company_id=actor.company_id;
 result:=public.create_customer_lead(actor.company_id,actor.submission_id,'Contact '||actor.key,actor.user_id::text||'@test.invalid','','Family car request');
 if result<>actor.lead_id then raise exception 'FAIL full receipt table retry'; end if;
 begin perform public.create_customer_lead(actor.company_id,gen_random_uuid(),'Over Limit','contact@test.invalid','','Too many');
 exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'FAIL receipt limit'; end if;
 if (select count(*) from public.customers where company_id=actor.company_id)<>initial_count then raise exception 'FAIL quota partially created contact'; end if;
end $$;
reset role;
update public.memberships set status='suspended' where user_id=(select id from lead_ids where key='owner_a');
set local role authenticated;
do $$ declare actor record; blocked boolean:=false; begin
 select * into actor from lead_actors where key='owner_a';
 begin perform public.create_customer_lead(actor.company_id,actor.submission_id,'Contact '||actor.key,actor.user_id::text||'@test.invalid','','Family car request');
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL revoked membership receipt replay'; end if;
 if exists(select 1 from public.leads) then raise exception 'FAIL revoked membership lead read'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ declare blocked boolean:=false; begin
 begin perform public.create_customer_lead((select id from lead_ids where key='company_b'),gen_random_uuid(),'Anonymous','contact@test.invalid','','Denied');
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL anonymous lead intake'; end if;
end $$;
reset role;
select 'PASS: atomic contact/lead, tenant and role reads/writes, UUID retries and seven-day expiration, private bounded receipts, status CAS/readonly columns, audit, revoked membership, anonymous denial' as result;
rollback;
