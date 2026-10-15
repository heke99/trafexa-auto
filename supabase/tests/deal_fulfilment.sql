-- Rollback-only hosted proof: synthetic accepted/signed deals, NO Storage writes,
-- bank calls, provider jobs or actual bank verification. Missing originals deny
-- payment/delivery; positive file-dependent path is covered by local native suite.
begin;

-- Constants are confined to this rollback fixture. Refuse collisions first.
do $$begin
 if exists(select 1 from auth.users where id::text like 'fd240000-0000-4000-8000-%')
 or exists(select 1 from public.companies where id::text like 'fd240000-0000-4000-8000-%') then
  raise exception 'Native archive fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
 ('fd240000-0000-4000-8000-000000000001','fulfilment-owner-a@fixture.invalid',now(),false),
 ('fd240000-0000-4000-8000-000000000002','fulfilment-owner-b@fixture.invalid',now(),false),
 ('fd240000-0000-4000-8000-000000000003','fulfilment-admin@fixture.invalid',now(),false),
 ('fd240000-0000-4000-8000-000000000004','fulfilment-finance@fixture.invalid',now(),false),
 ('fd240000-0000-4000-8000-000000000005','fulfilment-sales@fixture.invalid',now(),false),
 ('fd240000-0000-4000-8000-000000000006','fulfilment-viewer@fixture.invalid',now(),false),
 ('fd240000-0000-4000-8000-000000000007','fulfilment-buyer-a@fixture.invalid',now(),false),
 ('fd240000-0000-4000-8000-000000000008','fulfilment-buyer-b@fixture.invalid',now(),false),
 ('fd240000-0000-4000-8000-000000000009','fulfilment-pending@fixture.invalid',now(),false),
 ('fd240000-0000-4000-8000-000000000010','fulfilment-unverified@fixture.invalid',null,false),
 ('fd240000-0000-4000-8000-000000000011','fulfilment-revoked@fixture.invalid',now(),false),
 ('fd240000-0000-4000-8000-000000000012','fulfilment-anonymous@fixture.invalid',now(),true);
insert into private.account_approvals(user_id,status,updated_by)
select id,case when id='fd240000-0000-4000-8000-000000000009' then 'pending' else 'approved' end,'fd240000-0000-4000-8000-000000000001'
from auth.users where id::text like 'fd240000-0000-4000-8000-%';
insert into public.companies(id,name,organisation_number,created_by) values
 ('fd240000-0000-4000-8000-000000000101','Native Archive A','9911000001','fd240000-0000-4000-8000-000000000001'),
 ('fd240000-0000-4000-8000-000000000102','Native Archive B','9911000002','fd240000-0000-4000-8000-000000000002');
insert into public.memberships(company_id,user_id,role,status)
select 'fd240000-0000-4000-8000-000000000101',id,
 case right(id::text,3) when '003' then 'admin' when '004' then 'finance' when '005' then 'sales' when '006' then 'viewer' else 'owner' end,
 case when id='fd240000-0000-4000-8000-000000000011' then 'suspended' else 'active' end
from auth.users where id::text like 'fd240000-0000-4000-8000-%' and id not in('fd240000-0000-4000-8000-000000000002','fd240000-0000-4000-8000-000000000007','fd240000-0000-4000-8000-000000000008');
insert into public.memberships(company_id,user_id,role)values('fd240000-0000-4000-8000-000000000102','fd240000-0000-4000-8000-000000000002','owner');
insert into public.customers(id,company_id,name,email) values
 ('fd240000-0000-4000-8000-000000000201','fd240000-0000-4000-8000-000000000101','Native Buyer A','fulfilment-buyer-a@fixture.invalid'),
 ('fd240000-0000-4000-8000-000000000202','fd240000-0000-4000-8000-000000000102','Native Buyer B','fulfilment-buyer-b@fixture.invalid');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)
select ('fd240000-0000-4000-8000-'||lpad((300+n)::text,12,'0'))::uuid,
 case when n=2 then 'fd240000-0000-4000-8000-000000000102'::uuid else 'fd240000-0000-4000-8000-000000000101'::uuid end,
 'NA'||n::text,'Volvo','V60',2022 from generate_series(1,3)n;
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)
select ('fd240000-0000-4000-8000-'||lpad((400+n)::text,12,'0'))::uuid,company_id,id,10000000,12000000,'standard'
from public.vehicles v cross join lateral(select right(v.id::text,3)::integer-300 n)x where v.id::text like 'fd240000-0000-4000-8000-%';
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)
select ('fd240000-0000-4000-8000-'||lpad((500+n)::text,12,'0'))::uuid,company_id,id,
 case when n=2 then 'fd240000-0000-4000-8000-000000000202'::uuid else 'fd240000-0000-4000-8000-000000000201'::uuid end,12000000,
 case when n=2 then 'fd240000-0000-4000-8000-000000000002'::uuid else 'fd240000-0000-4000-8000-000000000001'::uuid end
from public.stock_items s cross join lateral(select right(s.id::text,3)::integer-400 n)x where s.id::text like 'fd240000-0000-4000-8000-%';
set local role authenticated;
do $$declare n integer;company uuid;owner_id uuid;buyer uuid;deal uuid;t jsonb;o uuid;review jsonb;d jsonb;s jsonb;sid uuid;h text;
 strokes jsonb:='[{"points":[{"x":0,"y":0},{"x":5,"y":20},{"x":10,"y":0}]}]';begin
 for n in 1..3 loop
  company:=case when n=2 then 'fd240000-0000-4000-8000-000000000102'::uuid else 'fd240000-0000-4000-8000-000000000101'::uuid end;
  owner_id:=case when n=2 then 'fd240000-0000-4000-8000-000000000002'::uuid else 'fd240000-0000-4000-8000-000000000001'::uuid end;
  buyer:=case when n=2 then 'fd240000-0000-4000-8000-000000000008'::uuid else 'fd240000-0000-4000-8000-000000000007'::uuid end;
  deal:=('fd240000-0000-4000-8000-'||lpad((500+n)::text,12,'0'))::uuid;
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

set local role authenticated;
do $$declare c uuid:='fd240000-0000-4000-8000-000000000101';d uuid:='fd240000-0000-4000-8000-000000000501';a uuid;p jsonb;blocked boolean;begin
 foreach a in array array['fd240000-0000-4000-8000-000000000001'::uuid,'fd240000-0000-4000-8000-000000000003','fd240000-0000-4000-8000-000000000004']loop
  perform set_config('request.jwt.claim.sub',a::text,true);p:=public.get_deal_fulfilment(c,d);
  if p->>'actorId'<>a::text or p->>'blockedReason'<>'original_required' or p->'source'<>'null'::jsonb or p->'canDeliver'<>'false'::jsonb or p->>'registeredOre'<>'0' or p->'entries'<>'[]'::jsonb then raise exception 'FAIL missing original read envelope';end if;
 end loop;
 foreach a in array array['fd240000-0000-4000-8000-000000000002'::uuid,'fd240000-0000-4000-8000-000000000005','fd240000-0000-4000-8000-000000000006','fd240000-0000-4000-8000-000000000009','fd240000-0000-4000-8000-000000000010','fd240000-0000-4000-8000-000000000011','fd240000-0000-4000-8000-000000000012']loop
  perform set_config('request.jwt.claim.sub',a::text,true);blocked:=false;
  begin perform public.get_deal_fulfilment(c,d);exception when insufficient_privilege then blocked:=true;end;
  if not blocked then raise exception 'FAIL financial privacy or approval scope';end if;
 end loop;
 perform set_config('request.jwt.claim.sub','fd240000-0000-4000-8000-000000000001',true);blocked:=false;
 begin perform public.mutate_deal_fulfilment(c,d,jsonb_build_object('companyId',c,'dealId',d,'requestId',gen_random_uuid(),'expectedVersion',0,'operation','payment','amountOre','12000000','bankReference','FD240 missing archive','bookedOn',(clock_timestamp()at time zone'Europe/Stockholm')::date::text,'reason','Rollback fixture manual entry'));
 exception when serialization_failure then blocked:=true;end;
 if not blocked then raise exception 'FAIL payment without original';end if;
 blocked:=false;
 begin perform public.mutate_deal_fulfilment(c,d,jsonb_build_object('companyId',c,'dealId',d,'requestId',gen_random_uuid(),'expectedVersion',0,'operation','deliver','reason','Rollback fixture delivery'));
 exception when serialization_failure then blocked:=true;end;
 if not blocked then raise exception 'FAIL delivery without original or payment';end if;
 perform set_config('request.jwt.claim.sub','fd240000-0000-4000-8000-000000000004',true);blocked:=false;
 begin perform public.mutate_deal_fulfilment(c,d,'{}');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL finance write authority';end if;
end$$;
reset role;
do $$declare t text;r text;begin
 foreach t in array array['deal_payment_entries','deal_deliveries','deal_fulfilment_requests']loop
  foreach r in array array['anon','authenticated','service_role']loop
   if has_table_privilege(r,'private.'||t,'select')or has_table_privilege(r,'private.'||t,'insert')or has_table_privilege(r,'private.'||t,'update')or has_table_privilege(r,'private.'||t,'delete')then raise exception 'FAIL direct private ledger privileges';end if;
  end loop;
 end loop;
 if exists(select 1 from private.deal_payment_entries where company_id::text like'fd240000-%')or exists(select 1 from private.deal_deliveries where company_id::text like'fd240000-%')or exists(select 1 from private.deal_fulfilment_requests where company_id::text like'fd240000-%')then raise exception 'FAIL blocked mutation persisted';end if;
end$$;
select 'PASS: fulfilment read roles, foreign/unapproved denial, missing-original payment/delivery refusal, finance readonly, no direct ledger access' result;
rollback;
