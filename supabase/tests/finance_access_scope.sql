-- Run as the migration administrator. Fixtures and every attempted write roll back.
begin;
create temporary table finance_scope_ids(key text primary key,id uuid not null);
insert into finance_scope_ids
select key,gen_random_uuid() from unnest(array[
 'company_a','company_b','owner_a','admin_a','finance_a','sales_a','sales_peer_a','viewer_a','owner_b',
 'app_owner_a','app_sales_a','app_sales_peer_a','app_owner_b','doc_a','doc_b'
]) key;
create temporary table finance_scope_actors(
 key text,user_id uuid,company_id uuid,role_name text,visible_applications integer,documents_allowed boolean
);
insert into finance_scope_actors
select actor.key,u.id,c.id,actor.role_name,actor.visible_applications,actor.documents_allowed
from (values
 ('owner_a','company_a','owner',3,true),('admin_a','company_a','admin',3,true),
 ('finance_a','company_a','finance',3,true),('sales_a','company_a','sales',1,false),
 ('sales_peer_a','company_a','sales',1,false),('viewer_a','company_a','viewer',0,false),
 ('owner_b','company_b','owner',1,true)
) actor(key,company_key,role_name,visible_applications,documents_allowed)
join finance_scope_ids u on u.key=actor.key
join finance_scope_ids c on c.key=actor.company_key;
grant select on finance_scope_ids,finance_scope_actors to authenticated,anon;

insert into auth.users(id,email,email_confirmed_at)
select user_id,user_id::text||'@test.invalid',now() from finance_scope_actors;
insert into public.companies(id,name,organisation_number,created_by) values
((select id from finance_scope_ids where key='company_a'),'Finance Scope A','5560000051',(select id from finance_scope_ids where key='owner_a')),
((select id from finance_scope_ids where key='company_b'),'Finance Scope B','5560000052',(select id from finance_scope_ids where key='owner_b'));
insert into public.memberships(company_id,user_id,role)
select company_id,user_id,role_name from finance_scope_actors;
insert into public.finance_applications(id,company_id,product,requested_amount_ore,created_by)
select app.id,company.id,'purchase',10000,actor.id
from (values
 ('app_owner_a','company_a','owner_a'),('app_sales_a','company_a','sales_a'),
 ('app_sales_peer_a','company_a','sales_peer_a'),('app_owner_b','company_b','owner_b')
) input(app_key,company_key,actor_key)
join finance_scope_ids app on app.key=input.app_key
join finance_scope_ids company on company.key=input.company_key
join finance_scope_ids actor on actor.key=input.actor_key;
insert into public.documents(id,company_id,name,object_path,kind)
select document.id,company.id,'Scope original',company.id::text||'/scope-original.pdf',input.kind
from (values ('doc_a','company_a','finance'),('doc_b','company_b','contract')) input(doc_key,company_key,kind)
join finance_scope_ids document on document.key=input.doc_key
join finance_scope_ids company on company.key=input.company_key;
insert into storage.objects(bucket_id,name)
select 'dealer-documents',id::text||'/scope-original.pdf'
from finance_scope_ids where key in ('company_a','company_b');

do $$
declare actor record; foreign_company uuid; forged_actor uuid; blocked boolean; kind_name text; path text;
begin
 for actor in select * from finance_scope_actors order by key loop
  select id into foreign_company from finance_scope_ids where key in ('company_a','company_b') and id<>actor.company_id;
  select id into forged_actor from finance_scope_ids where key='sales_a';
  if forged_actor=actor.user_id then select id into forged_actor from finance_scope_ids where key='owner_a'; end if;
  perform set_config('request.jwt.claim.sub',actor.user_id::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',actor.user_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if current_user<>'authenticated' then raise exception 'FAIL test role activation'; end if;

  if (select count(*) from public.finance_applications where id in (select id from finance_scope_ids where key like 'app_%'))<>actor.visible_applications then
   raise exception 'FAIL finance read scope for %',actor.key;
  end if;
  if exists(select 1 from public.finance_applications where company_id=foreign_company) then
   raise exception 'FAIL foreign finance visibility for %',actor.key;
  end if;
  if actor.role_name='sales' and exists(select 1 from public.finance_applications where created_by<>actor.user_id) then
   raise exception 'FAIL salesperson sees a colleague application';
  end if;
  if (select count(*) from public.documents where id in (select id from finance_scope_ids where key in ('doc_a','doc_b')))<>(case when actor.documents_allowed then 1 else 0 end) then
   raise exception 'FAIL document read scope for %',actor.key;
  end if;
  if (select count(*) from storage.objects where bucket_id='dealer-documents' and name=actor.company_id::text||'/scope-original.pdf')<>(case when actor.documents_allowed then 1 else 0 end) then
   raise exception 'FAIL storage read scope for %',actor.key;
  end if;
  if exists(select 1 from public.documents where company_id=foreign_company)
   or exists(select 1 from storage.objects where bucket_id='dealer-documents' and name=foreign_company::text||'/scope-original.pdf') then
   raise exception 'FAIL foreign document/storage visibility for %',actor.key;
  end if;

  blocked:=false;
  begin
   insert into public.finance_applications(company_id,product,requested_amount_ore,created_by)
   values(actor.company_id,'purchase',10000,actor.user_id);
  exception when insufficient_privilege then blocked:=true; end;
  if blocked<>(actor.role_name='viewer') then raise exception 'FAIL finance intake role for %',actor.key; end if;
  blocked:=false;
  begin
   insert into public.finance_applications(company_id,product,requested_amount_ore,created_by)
   values(actor.company_id,'purchase',10000,forged_actor);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL forged finance creator for %',actor.key; end if;
  blocked:=false;
  begin
   insert into public.finance_applications(company_id,product,requested_amount_ore,created_by)
   values(foreign_company,'purchase',10000,actor.user_id);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL foreign finance intake for %',actor.key; end if;
  blocked:=false;
  begin
   insert into public.finance_applications(company_id,product,requested_amount_ore,status,created_by)
   values(actor.company_id,'purchase',10000,'submitted',actor.user_id);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL false partner submission for %',actor.key; end if;

  foreach kind_name in array array['purchase','contract','finance','other'] loop
   path:=actor.company_id::text||'/scope-'||gen_random_uuid()::text||'.pdf';
   blocked:=false;
   begin
    insert into public.documents(company_id,name,object_path,kind)
    values(actor.company_id,'Scope role write',path,kind_name);
   exception when insufficient_privilege then blocked:=true; end;
   if blocked=actor.documents_allowed then raise exception 'FAIL document kind % write for %',kind_name,actor.key; end if;
  end loop;
  blocked:=false;
  begin
   insert into public.documents(company_id,name,object_path,kind)
   values(foreign_company,'Foreign denied',foreign_company::text||'/denied-'||gen_random_uuid()::text||'.pdf','finance');
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL foreign document insert for %',actor.key; end if;
  blocked:=false;
  begin
   insert into storage.objects(bucket_id,name)
   values('dealer-documents',actor.company_id::text||'/scope-upload-'||gen_random_uuid()::text||'.pdf');
  exception when insufficient_privilege then blocked:=true; end;
  if blocked=actor.documents_allowed then raise exception 'FAIL storage upload role for %',actor.key; end if;
  blocked:=false;
  begin
   insert into storage.objects(bucket_id,name)
   values('dealer-documents',foreign_company::text||'/denied-'||gen_random_uuid()::text||'.pdf');
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL foreign storage insert for %',actor.key; end if;
  blocked:=false;
  begin insert into storage.objects(bucket_id,name) values('dealer-documents','not-a-uuid/denied.pdf');
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL malformed storage path for %',actor.key; end if;
  execute 'reset role';
 end loop;
end $$;

-- Revoked membership and suspended company status take effect without JWT refresh.
update public.memberships set status='suspended' where user_id=(select id from finance_scope_ids where key='finance_a');
select set_config('request.jwt.claim.sub',(select id::text from finance_scope_ids where key='finance_a'),true);
select set_config('request.jwt.claims',json_build_object('sub',(select id from finance_scope_ids where key='finance_a'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.finance_applications) or exists(select 1 from public.documents)
 or exists(select 1 from storage.objects where bucket_id='dealer-documents') then raise exception 'FAIL suspended finance membership'; end if;
end $$;
reset role;
update public.companies set status='suspended' where id=(select id from finance_scope_ids where key='company_a');
select set_config('request.jwt.claim.sub',(select id::text from finance_scope_ids where key='owner_a'),true);
select set_config('request.jwt.claims',json_build_object('sub',(select id from finance_scope_ids where key='owner_a'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.finance_applications) or exists(select 1 from public.documents)
 or exists(select 1 from storage.objects where bucket_id='dealer-documents') then raise exception 'FAIL suspended company document access'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ declare blocked boolean:=false; begin
 begin perform 1 from public.finance_applications; exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL anonymous finance privilege'; end if;
 blocked:=false;
 begin perform 1 from public.documents; exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL anonymous document privilege'; end if;
 begin
  if exists(select 1 from storage.objects where bucket_id='dealer-documents') then raise exception 'FAIL anonymous storage visibility'; end if;
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: own salesperson finance, owner/admin/finance company scope, every document kind and storage role, tenant boundaries, actor forgery, revoked access, anonymous denial' as result;
rollback;
