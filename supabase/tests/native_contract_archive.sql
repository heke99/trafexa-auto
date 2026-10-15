-- Hosted-safe rollback proof: synthetic approved Auth fixtures, real native RPCs,
-- no Storage object/catalog writes, no provider/email dispatch. File roundtrips
-- are proved separately through Storage API; local catalog fixtures are not files.
begin;
-- BEGIN NATIVE ARCHIVE FIXTURES
-- Constants are confined to this rollback fixture. Refuse collisions first.
do $$begin
 if exists(select 1 from auth.users where id::text like 'fc110000-0000-4000-8000-%')
 or exists(select 1 from public.companies where id::text like 'fc110000-0000-4000-8000-%') then
  raise exception 'Native archive fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
 ('fc110000-0000-4000-8000-000000000001','native-owner-a@fixture.invalid',now(),false),
 ('fc110000-0000-4000-8000-000000000002','native-owner-b@fixture.invalid',now(),false),
 ('fc110000-0000-4000-8000-000000000003','native-admin@fixture.invalid',now(),false),
 ('fc110000-0000-4000-8000-000000000004','native-finance@fixture.invalid',now(),false),
 ('fc110000-0000-4000-8000-000000000005','native-sales@fixture.invalid',now(),false),
 ('fc110000-0000-4000-8000-000000000006','native-viewer@fixture.invalid',now(),false),
 ('fc110000-0000-4000-8000-000000000007','native-buyer-a@fixture.invalid',now(),false),
 ('fc110000-0000-4000-8000-000000000008','native-buyer-b@fixture.invalid',now(),false),
 ('fc110000-0000-4000-8000-000000000009','native-pending@fixture.invalid',now(),false),
 ('fc110000-0000-4000-8000-000000000010','native-unverified@fixture.invalid',null,false),
 ('fc110000-0000-4000-8000-000000000011','native-revoked@fixture.invalid',now(),false),
 ('fc110000-0000-4000-8000-000000000012','native-anonymous@fixture.invalid',now(),true);
insert into private.account_approvals(user_id,status,updated_by)
select id,case when id='fc110000-0000-4000-8000-000000000009' then 'pending' else 'approved' end,'fc110000-0000-4000-8000-000000000001'
from auth.users where id::text like 'fc110000-0000-4000-8000-%';
insert into public.companies(id,name,organisation_number,created_by) values
 ('fc110000-0000-4000-8000-000000000101','Native Archive A','9911000001','fc110000-0000-4000-8000-000000000001'),
 ('fc110000-0000-4000-8000-000000000102','Native Archive B','9911000002','fc110000-0000-4000-8000-000000000002');
insert into public.memberships(company_id,user_id,role,status)
select 'fc110000-0000-4000-8000-000000000101',id,
 case right(id::text,3) when '003' then 'admin' when '004' then 'finance' when '005' then 'sales' when '006' then 'viewer' else 'owner' end,
 case when id='fc110000-0000-4000-8000-000000000011' then 'suspended' else 'active' end
from auth.users where id::text like 'fc110000-0000-4000-8000-%' and id not in('fc110000-0000-4000-8000-000000000002','fc110000-0000-4000-8000-000000000007','fc110000-0000-4000-8000-000000000008');
insert into public.memberships(company_id,user_id,role)values('fc110000-0000-4000-8000-000000000102','fc110000-0000-4000-8000-000000000002','owner');
insert into public.customers(id,company_id,name,email) values
 ('fc110000-0000-4000-8000-000000000201','fc110000-0000-4000-8000-000000000101','Native Buyer A','native-buyer-a@fixture.invalid'),
 ('fc110000-0000-4000-8000-000000000202','fc110000-0000-4000-8000-000000000102','Native Buyer B','native-buyer-b@fixture.invalid');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)
select ('fc110000-0000-4000-8000-'||lpad((300+n)::text,12,'0'))::uuid,
 case when n=2 then 'fc110000-0000-4000-8000-000000000102'::uuid else 'fc110000-0000-4000-8000-000000000101'::uuid end,
 'NA'||n::text,'Volvo','V60',2022 from generate_series(1,3)n;
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)
select ('fc110000-0000-4000-8000-'||lpad((400+n)::text,12,'0'))::uuid,company_id,id,10000000,12000000,'standard'
from public.vehicles v cross join lateral(select right(v.id::text,3)::integer-300 n)x where v.id::text like 'fc110000-0000-4000-8000-%';
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)
select ('fc110000-0000-4000-8000-'||lpad((500+n)::text,12,'0'))::uuid,company_id,id,
 case when n=2 then 'fc110000-0000-4000-8000-000000000202'::uuid else 'fc110000-0000-4000-8000-000000000201'::uuid end,12000000,
 case when n=2 then 'fc110000-0000-4000-8000-000000000002'::uuid else 'fc110000-0000-4000-8000-000000000001'::uuid end
from public.stock_items s cross join lateral(select right(s.id::text,3)::integer-400 n)x where s.id::text like 'fc110000-0000-4000-8000-%';
set local role authenticated;
do $$declare n integer;company uuid;owner_id uuid;buyer uuid;deal uuid;t jsonb;o uuid;review jsonb;d jsonb;s jsonb;sid uuid;h text;
 strokes jsonb:='[{"points":[{"x":0,"y":0},{"x":5,"y":20},{"x":10,"y":0}]}]';begin
 for n in 1..3 loop
  company:=case when n=2 then 'fc110000-0000-4000-8000-000000000102'::uuid else 'fc110000-0000-4000-8000-000000000101'::uuid end;
  owner_id:=case when n=2 then 'fc110000-0000-4000-8000-000000000002'::uuid else 'fc110000-0000-4000-8000-000000000001'::uuid end;
  buyer:=case when n=2 then 'fc110000-0000-4000-8000-000000000008'::uuid else 'fc110000-0000-4000-8000-000000000007'::uuid end;
  deal:=('fc110000-0000-4000-8000-'||lpad((500+n)::text,12,'0'))::uuid;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  t:=public.create_contract_template_version(company,gen_random_uuid(),0,'Native Archive Terms','Seller {{company.name}} Buyer {{customer.name}} Price {{offer.price_ore}}',gen_random_uuid());
  perform public.review_contract_template(company,(t->'template'->>'id')::uuid,1,'approved','Reviewed fixture sale terms',gen_random_uuid());
  o:=public.create_offer_version(company,deal,gen_random_uuid(),'Native original archive fixture',(clock_timestamp() at time zone 'Europe/Stockholm')::date,true);
  review:=public.publish_offer_review(company,deal,o,gen_random_uuid());
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  perform public.respond_offer_review((review->'review'->>'id')::uuid,1,'accepted','Native Buyer',null,'2026-10-14',gen_random_uuid());
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  d:=public.create_sale_contract_draft(company,deal,o,(t->'template'->>'id')::uuid,2,gen_random_uuid());
  s:=public.request_contract_signing(company,deal,(d->'draft'->>'id')::uuid,true,gen_random_uuid());
  sid:=(s->'signing'->>'id')::uuid;h:=s->'signing'->>'documentHash';
  if n<3 then
   perform set_config('request.jwt.claim.sub',buyer::text,true);
   perform public.sign_contract(sid,null,1,h,'Native Buyer',strokes,true,'2026-10-14',gen_random_uuid());
   perform set_config('request.jwt.claim.sub',owner_id::text,true);
   perform public.sign_contract(sid,company,2,h,'Native Owner',strokes,true,'2026-10-14',gen_random_uuid());
  end if;
 end loop;
end$$;
reset role;
-- END NATIVE ARCHIVE FIXTURES

create temporary table native_archive_proof as select id,company_id,deal_id,document_hash from private.contract_signings where company_id in('fc110000-0000-4000-8000-000000000101','fc110000-0000-4000-8000-000000000102');
grant select on native_archive_proof to authenticated,service_role;
select set_config('request.jwt.claim.sub','fc110000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare sid uuid;pending_id uuid;r jsonb;blocked boolean;actor uuid;begin
 select id into sid from native_archive_proof where deal_id='fc110000-0000-4000-8000-000000000501';
 select id into pending_id from native_archive_proof where deal_id='fc110000-0000-4000-8000-000000000503';
 r:=public.get_contract_signing_archive(sid,'fc110000-0000-4000-8000-000000000101');
 if r is distinct from jsonb_build_object('actorId',auth.uid(),'companyId','fc110000-0000-4000-8000-000000000101','signingId',sid,'archive',null) then raise exception 'FAIL exact null envelope';end if;
 blocked:=false;begin perform public.get_contract_signing_archive(pending_id,'fc110000-0000-4000-8000-000000000101');exception when serialization_failure then blocked:=true;end;
 if not blocked then raise exception 'FAIL pending signing read';end if;
 foreach actor in array array['fc110000-0000-4000-8000-000000000002'::uuid,'fc110000-0000-4000-8000-000000000005','fc110000-0000-4000-8000-000000000006','fc110000-0000-4000-8000-000000000009','fc110000-0000-4000-8000-000000000010','fc110000-0000-4000-8000-000000000011','fc110000-0000-4000-8000-000000000012'] loop
  perform set_config('request.jwt.claim.sub',actor::text,true);blocked:=false;
  begin perform public.get_contract_signing_archive(sid,'fc110000-0000-4000-8000-000000000101');exception when insufficient_privilege then blocked:=true;end;
  if not blocked then raise exception 'FAIL denied dealer/account role %',actor;end if;
 end loop;
 foreach actor in array array['fc110000-0000-4000-8000-000000000001'::uuid,'fc110000-0000-4000-8000-000000000003','fc110000-0000-4000-8000-000000000004'] loop
  perform set_config('request.jwt.claim.sub',actor::text,true);r:=public.get_contract_signing_archive(sid,'fc110000-0000-4000-8000-000000000101');
  if r->>'actorId'<>actor::text or r->'archive'<>'null'::jsonb then raise exception 'FAIL allowed dealer';end if;
 end loop;
 perform set_config('request.jwt.claim.sub','fc110000-0000-4000-8000-000000000007',true);
 r:=public.get_contract_signing_archive(sid,null);if r->>'signingId'<>sid::text then raise exception 'FAIL bound customer';end if;
 perform set_config('request.jwt.claim.sub','fc110000-0000-4000-8000-000000000008',true);blocked:=false;
 begin perform public.get_contract_signing_archive(sid,null);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL foreign customer';end if;
 blocked:=false;begin perform public.register_contract_signing_archive('fc110000-0000-4000-8000-000000000101',sid,'fc110000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64),3,repeat('b',64),20,repeat('c',64),40,'trafexa-native-v1');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL authenticated register';end if;
end$$;
reset role;
set local role service_role;
do $$declare s record;blocked boolean;actor uuid;begin
 select * into s from native_archive_proof where deal_id='fc110000-0000-4000-8000-000000000501';
 blocked:=false;begin perform public.register_contract_signing_archive(s.company_id,s.id,'fc110000-0000-4000-8000-000000000001',gen_random_uuid(),s.document_hash,3,repeat('b',64),20,repeat('c',64),40,'trafexa-native-v1');exception when no_data_found then blocked:=true;end;
 if not blocked then raise exception 'FAIL missing Storage objects registered';end if;
 foreach actor in array array['fc110000-0000-4000-8000-000000000004'::uuid,'fc110000-0000-4000-8000-000000000009','fc110000-0000-4000-8000-000000000011'] loop
  blocked:=false;begin perform public.register_contract_signing_archive(s.company_id,s.id,actor,gen_random_uuid(),s.document_hash,3,repeat('b',64),20,repeat('c',64),40,'trafexa-native-v1');exception when insufficient_privilege then blocked:=true;end;
  if not blocked then raise exception 'FAIL service actor authorization';end if;
 end loop;
end$$;
reset role;
do $$declare r text;begin
 foreach r in array array['anon','authenticated','service_role'] loop
  if has_table_privilege(r,'private.contract_signing_archives','select') or has_table_privilege(r,'private.contract_signing_archives','insert') or has_table_privilege(r,'private.contract_archive_requests','select') then raise exception 'FAIL direct private table privilege';end if;
 end loop;
 if has_function_privilege('authenticated','public.register_contract_signing_archive(uuid,uuid,uuid,uuid,text,integer,text,bigint,text,bigint,text)','execute')
 or has_function_privilege('anon','public.get_contract_signing_archive(uuid,uuid)','execute')
 or has_function_privilege('service_role','public.get_contract_signing_archive(uuid,uuid)','execute') then raise exception 'FAIL RPC grants';end if;
 if exists(select 1 from private.contract_signing_archives where company_id='fc110000-0000-4000-8000-000000000101') then raise exception 'FAIL archive created without original files';end if;
end$$;
select 'PASS: native completed source, exact null receipt, dealer/customer/approval isolation, pending/foreign denials, service-only registration and missing-object refusal; no Storage object or provider writes' as result;
rollback;
