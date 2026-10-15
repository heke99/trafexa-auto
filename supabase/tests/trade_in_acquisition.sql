-- Hosted-safe synthetic rollback proof; no Storage API, email or bank operations.
begin;
-- BEGIN TRADE IN ACQUISITION FIXTURES

-- Constants are confined to this rollback fixture. Refuse collisions first.
do $$begin
 if exists(select 1 from auth.users where id::text like 'fc130000-0000-4000-8000-%')
 or exists(select 1 from public.companies where id::text like 'fc130000-0000-4000-8000-%') then
  raise exception 'Native archive fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
 ('fc130000-0000-4000-8000-000000000001','acquisition-owner-a@fixture.invalid',now(),false),
 ('fc130000-0000-4000-8000-000000000002','acquisition-owner-b@fixture.invalid',now(),false),
 ('fc130000-0000-4000-8000-000000000003','acquisition-admin@fixture.invalid',now(),false),
 ('fc130000-0000-4000-8000-000000000004','acquisition-finance@fixture.invalid',now(),false),
 ('fc130000-0000-4000-8000-000000000005','acquisition-sales@fixture.invalid',now(),false),
 ('fc130000-0000-4000-8000-000000000006','acquisition-viewer@fixture.invalid',now(),false),
 ('fc130000-0000-4000-8000-000000000007','acquisition-buyer-a@fixture.invalid',now(),false),
 ('fc130000-0000-4000-8000-000000000008','acquisition-buyer-b@fixture.invalid',now(),false),
 ('fc130000-0000-4000-8000-000000000009','acquisition-pending@fixture.invalid',now(),false),
 ('fc130000-0000-4000-8000-000000000010','acquisition-unverified@fixture.invalid',null,false),
 ('fc130000-0000-4000-8000-000000000011','acquisition-revoked@fixture.invalid',now(),false),
 ('fc130000-0000-4000-8000-000000000012','acquisition-anonymous@fixture.invalid',now(),true);
insert into private.account_approvals(user_id,status,updated_by)
select id,case when id='fc130000-0000-4000-8000-000000000009' then 'pending' else 'approved' end,'fc130000-0000-4000-8000-000000000001'
from auth.users where id::text like 'fc130000-0000-4000-8000-%';
insert into public.companies(id,name,organisation_number,created_by) values
 ('fc130000-0000-4000-8000-000000000101','Trade Acquisition A','9913000001','fc130000-0000-4000-8000-000000000001'),
 ('fc130000-0000-4000-8000-000000000102','Trade Acquisition B','9913000002','fc130000-0000-4000-8000-000000000002');
insert into public.memberships(company_id,user_id,role,status)
select 'fc130000-0000-4000-8000-000000000101',id,
 case right(id::text,3) when '003' then 'admin' when '004' then 'finance' when '005' then 'sales' when '006' then 'viewer' else 'owner' end,
 case when id='fc130000-0000-4000-8000-000000000011' then 'suspended' else 'active' end
from auth.users where id::text like 'fc130000-0000-4000-8000-%' and id not in('fc130000-0000-4000-8000-000000000002','fc130000-0000-4000-8000-000000000007','fc130000-0000-4000-8000-000000000008');
insert into public.memberships(company_id,user_id,role)values('fc130000-0000-4000-8000-000000000102','fc130000-0000-4000-8000-000000000002','owner');
insert into public.customers(id,company_id,name,email) values
 ('fc130000-0000-4000-8000-000000000201','fc130000-0000-4000-8000-000000000101','Native Buyer A','acquisition-buyer-a@fixture.invalid'),
 ('fc130000-0000-4000-8000-000000000202','fc130000-0000-4000-8000-000000000102','Native Buyer B','acquisition-buyer-b@fixture.invalid');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)
select ('fc130000-0000-4000-8000-'||lpad((300+n)::text,12,'0'))::uuid,
 case when n=2 then 'fc130000-0000-4000-8000-000000000102'::uuid else 'fc130000-0000-4000-8000-000000000101'::uuid end,
 'NA'||n::text,'Volvo','V60',2022 from generate_series(1,5)n;
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)
select ('fc130000-0000-4000-8000-'||lpad((400+n)::text,12,'0'))::uuid,company_id,id,10000000,12000000,'standard'
from public.vehicles v cross join lateral(select right(v.id::text,3)::integer-300 n)x where v.id::text like 'fc130000-0000-4000-8000-%';
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)
select ('fc130000-0000-4000-8000-'||lpad((500+n)::text,12,'0'))::uuid,company_id,id,
 case when n=2 then 'fc130000-0000-4000-8000-000000000202'::uuid else 'fc130000-0000-4000-8000-000000000201'::uuid end,12000000,
 case when n=2 then 'fc130000-0000-4000-8000-000000000002'::uuid else 'fc130000-0000-4000-8000-000000000001'::uuid end
from public.stock_items s cross join lateral(select right(s.id::text,3)::integer-400 n)x where s.id::text like 'fc130000-0000-4000-8000-%';
set local role authenticated;
do $$declare n integer;company uuid;owner_id uuid;buyer uuid;deal uuid;t jsonb;o uuid;trade jsonb;review jsonb;d jsonb;s jsonb;sid uuid;h text;
 strokes jsonb:='[{"points":[{"x":0,"y":0},{"x":5,"y":20},{"x":10,"y":0}]}]';begin
 for n in 1..4 loop
  company:=case when n=2 then 'fc130000-0000-4000-8000-000000000102'::uuid else 'fc130000-0000-4000-8000-000000000101'::uuid end;
  owner_id:=case when n=2 then 'fc130000-0000-4000-8000-000000000002'::uuid else 'fc130000-0000-4000-8000-000000000001'::uuid end;
  buyer:=case when n=2 then 'fc130000-0000-4000-8000-000000000008'::uuid else 'fc130000-0000-4000-8000-000000000007'::uuid end;
  deal:=('fc130000-0000-4000-8000-'||lpad((500+n)::text,12,'0'))::uuid;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  t:=public.create_contract_template_version(company,gen_random_uuid(),0,'Trade Acquisition Terms','Seller {{company.name}} Buyer {{customer.name}} Price {{offer.price_ore}}',gen_random_uuid());
  perform public.review_contract_template(company,(t->'template'->>'id')::uuid,1,'approved','Reviewed fixture sale terms',gen_random_uuid());
  if n<4 then
   trade:=public.create_trade_in_version(company,deal,0,12000000,case when n=1 then 'TI 001' when n=2 then 'TI-002' else 'TI003' end,'Volvo','V70',2020,110000,'PRIVATE CONDITION','PRIVATE EQUIPMENT',30000029,true,case when n=2 then 35000001 else 0 end,'PRIVATE LENDER',gen_random_uuid());
   o:=public.create_offer_version_with_trade_in(company,deal,gen_random_uuid(),'Reviewed inbyte',(clock_timestamp() at time zone 'Europe/Stockholm')::date,true,(trade->'tradeIn'->>'id')::uuid,1,0,12000000);
  else
   o:=public.create_offer_version(company,deal,gen_random_uuid(),'No attached trade-in',(clock_timestamp() at time zone 'Europe/Stockholm')::date,true);
  end if;
  review:=public.publish_offer_review(company,deal,o,gen_random_uuid());
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  perform public.respond_offer_review((review->'review'->>'id')::uuid,1,'accepted','Native Buyer',null,'2026-10-14',gen_random_uuid());
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  d:=public.create_sale_contract_draft(company,deal,o,(t->'template'->>'id')::uuid,2,gen_random_uuid());
  s:=public.request_contract_signing(company,deal,(d->'draft'->>'id')::uuid,true,gen_random_uuid());
  sid:=(s->'signing'->>'id')::uuid;h:=s->'signing'->>'documentHash';
  if n<>3 then
   perform set_config('request.jwt.claim.sub',buyer::text,true);
   perform public.sign_contract(sid,null,1,h,'Native Buyer',strokes,true,'2026-10-14',gen_random_uuid());
   perform set_config('request.jwt.claim.sub',owner_id::text,true);
   perform public.sign_contract(sid,company,2,h,'Native Owner',strokes,true,'2026-10-14',gen_random_uuid());
  end if;
 end loop;
end$$;
reset role;
-- END TRADE IN ACQUISITION FIXTURES
create temporary table acquisition_proof(company_id uuid,deal_id uuid,request_id uuid,receipt jsonb);
grant select,insert on acquisition_proof to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','fc130000-0000-4000-8000-000000000001',true);
do $$declare basis jsonb;r jsonb;again jsonb;sid uuid;blocked boolean;actor uuid;begin
 basis:=public.get_trade_in_acquisition('fc130000-0000-4000-8000-000000000101','fc130000-0000-4000-8000-000000000501');
 if basis->>'canAcquire'<>'true' or basis->'reason'<>'null'::jsonb or basis->'source'->>'signingRevision'<>'3' or basis::text like '%PRIVATE%' then raise exception 'FAIL ready immutable source';end if;
 if basis->'source'->>'sourceSha256'<>encode(sha256(convert_to(((basis->'source')-'sourceSha256')::text,'UTF8')),'hex') then raise exception 'FAIL source hash';end if;
 r:=public.get_trade_in_acquisition('fc130000-0000-4000-8000-000000000101','fc130000-0000-4000-8000-000000000503');
 if r->>'reason'<>'contract_incomplete' or r->'source'<>'null'::jsonb then raise exception 'FAIL pending contract readiness';end if;
 r:=public.get_trade_in_acquisition('fc130000-0000-4000-8000-000000000101','fc130000-0000-4000-8000-000000000504');
 if r->>'reason'<>'no_accepted_trade_in' or r->'source'<>'null'::jsonb then raise exception 'FAIL unattached trade readiness';end if;
 foreach actor in array array['fc130000-0000-4000-8000-000000000005'::uuid,'fc130000-0000-4000-8000-000000000006','fc130000-0000-4000-8000-000000000007','fc130000-0000-4000-8000-000000000002','fc130000-0000-4000-8000-000000000009','fc130000-0000-4000-8000-000000000010','fc130000-0000-4000-8000-000000000011','fc130000-0000-4000-8000-000000000012']loop
  perform set_config('request.jwt.claim.sub',actor::text,true);blocked:=false;
  begin perform public.get_trade_in_acquisition('fc130000-0000-4000-8000-000000000101','fc130000-0000-4000-8000-000000000501');exception when insufficient_privilege then blocked:=true;end;
  if not blocked then raise exception 'FAIL denied acquisition read %',actor;end if;
 end loop;
 perform set_config('request.jwt.claim.sub','fc130000-0000-4000-8000-000000000004',true);
 r:=public.get_trade_in_acquisition('fc130000-0000-4000-8000-000000000101','fc130000-0000-4000-8000-000000000501');
 if r->>'canAcquire'<>'false' or r->'source' is distinct from basis->'source' then raise exception 'FAIL finance read';end if;
 blocked:=false;begin perform public.record_trade_in_acquisition('fc130000-0000-4000-8000-000000000101','fc130000-0000-4000-8000-000000000501',basis->'source'->>'sourceSha256',date '2000-01-01','External purchase agreement fixture',0,date '1990-01-01','Manual zero-debt source fixture','hybrid','manual',40000000,true,true,true,true,'2026-10-15','fc130000-0000-4000-8000-000000000901');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL finance purchase write';end if;
 perform set_config('request.jwt.claim.sub','fc130000-0000-4000-8000-000000000001',true);
 r:=public.record_trade_in_acquisition('fc130000-0000-4000-8000-000000000101','fc130000-0000-4000-8000-000000000501',basis->'source'->>'sourceSha256',date '2000-01-01','External purchase agreement fixture',0,date '1990-01-01','Manual zero-debt source fixture','hybrid','manual',40000000,true,true,true,true,'2026-10-15','fc130000-0000-4000-8000-000000000901');
 again:=public.record_trade_in_acquisition('fc130000-0000-4000-8000-000000000101','fc130000-0000-4000-8000-000000000501',basis->'source'->>'sourceSha256',date '2000-01-01','External purchase agreement fixture',0,date '1990-01-01','Manual zero-debt source fixture','hybrid','manual',40000000,true,true,true,true,'2026-10-15','fc130000-0000-4000-8000-000000000901');
 if r is distinct from again or r->'acquisition'->>'purchasePriceOre'<>'30000029' or r->'acquisition'->>'debtConfirmedOre'<>'0' or r->'acquisition'->>'vatScheme'<>'unknown' then raise exception 'FAIL exact zero-debt gross/replay';end if;
 insert into acquisition_proof values('fc130000-0000-4000-8000-000000000101','fc130000-0000-4000-8000-000000000501','fc130000-0000-4000-8000-000000000901',r);
 perform set_config('request.jwt.claim.sub','fc130000-0000-4000-8000-000000000002',true);
 basis:=public.get_trade_in_acquisition('fc130000-0000-4000-8000-000000000102','fc130000-0000-4000-8000-000000000502');
 r:=public.record_trade_in_acquisition('fc130000-0000-4000-8000-000000000102','fc130000-0000-4000-8000-000000000502',basis->'source'->>'sourceSha256',date '1990-01-01','External positive debt purchase',35000001,date '2000-01-01','Manual settlement evidence fixture','electric','automatic',40000000,true,true,true,true,'2026-10-15','fc130000-0000-4000-8000-000000000902');
 if r->'acquisition'->>'purchasePriceOre'<>'30000029' or r->'acquisition'->>'debtConfirmedOre'<>'35000001' then raise exception 'FAIL positive debt changed gross price';end if;
end$$;
reset role;
do $$declare p record;s public.stock_items;v public.vehicles;begin
 for p in select receipt->'acquisition' a from acquisition_proof loop
  select * into s from public.stock_items where id=(p.a->>'stockItemId')::uuid;select * into v from public.vehicles where id=s.vehicle_id;
  if s.purchase_price_ore<>30000029 or s.asking_price_ore<>40000000 or s.vat_scheme<>'unknown' or s.purchase_vat_ore is not null or s.vat_basis_confirmed or s.status<>'available' or v.registration_number<>'TI001' or v.fuel<>'hybrid' or v.gearbox<>'manual' then raise exception 'FAIL actual atomic stock basis';end if;
 end loop;
 if(select count(*) from private.trade_in_acquisitions where company_id in('fc130000-0000-4000-8000-000000000101','fc130000-0000-4000-8000-000000000102'))<>2 then raise exception 'FAIL duplicate acquisition';end if;
 if exists(select 1 from public.stock_items where id in('fc130000-0000-4000-8000-000000000401','fc130000-0000-4000-8000-000000000402') and(purchase_price_ore<>10000000 or asking_price_ore<>12000000 or vat_scheme<>'standard')) then raise exception 'FAIL outgoing original stock mutated';end if;
end$$;
-- Later lifecycle changes do not invalidate an authorized exact historical receipt.
update public.deals set status='cancelled' where id='fc130000-0000-4000-8000-000000000501';
update public.stock_items set status='sold' where id=(select(receipt->'acquisition'->>'stockItemId')::uuid from acquisition_proof);
set local role authenticated;
select set_config('request.jwt.claim.sub','fc130000-0000-4000-8000-000000000001',true);
do $$declare p record;r jsonb;blocked boolean:=false;begin
 select * into p from acquisition_proof;
 r:=public.record_trade_in_acquisition(p.company_id,p.deal_id,p.receipt->'acquisition'->'source'->>'sourceSha256',date '2000-01-01','External purchase agreement fixture',0,date '1990-01-01','Manual zero-debt source fixture','hybrid','manual',40000000,true,true,true,true,'2026-10-15',p.request_id);
 if r is distinct from p.receipt then raise exception 'FAIL historical lifecycle replay';end if;
 r:=public.get_trade_in_acquisition(p.company_id,p.deal_id);
 if r->>'reason'<>'already_acquired' or r->'acquisition' is distinct from p.receipt->'acquisition' then raise exception 'FAIL historical private read';end if;
 begin perform public.record_trade_in_acquisition(p.company_id,p.deal_id,p.receipt->'acquisition'->'source'->>'sourceSha256',date '2000-01-01','External purchase agreement fixture',0,date '1990-01-01','Manual zero-debt source fixture','hybrid','manual',40000000,true,true,true,true,'2026-10-15',gen_random_uuid());exception when serialization_failure then blocked:=true;end;
 if not blocked then raise exception 'FAIL acquired deal accepted new purchase';end if;
end$$;
reset role;
do $$declare r text;begin
 foreach r in array array['anon','authenticated','service_role']loop
  if has_table_privilege(r,'private.trade_in_acquisitions','select') or has_table_privilege(r,'private.trade_in_acquisition_audit','insert') then raise exception 'FAIL private table grant';end if;
 end loop;
 if has_function_privilege('anon','public.get_trade_in_acquisition(uuid,uuid)','execute') or has_function_privilege('service_role','public.get_trade_in_acquisition(uuid,uuid)','execute') then raise exception 'FAIL unauthenticated/server authority';end if;
end$$;
select 'PASS: exact accepted/signed source, quiet readiness, private role/tenant isolation, zero/positive exact debt, atomic gross unknown-VAT stock, preserved original sale and historical replay; no external operations' as result;
rollback;
