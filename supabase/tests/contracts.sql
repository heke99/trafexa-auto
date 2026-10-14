begin;
do $$begin
 if exists(select 1 from auth.users where id='ee240000-0000-4000-8000-000000000001') or exists(select 1 from public.companies where id='ee240000-0000-4000-8000-000000000002') or exists(select 1 from public.customers where id='ee240000-0000-4000-8000-000000000003') or exists(select 1 from public.vehicles where id='ee240000-0000-4000-8000-000000000004') or exists(select 1 from public.stock_items where id='ee240000-0000-4000-8000-000000000005') or exists(select 1 from public.deals where id='ee240000-0000-4000-8000-000000000006') then raise exception 'Contract smoke fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at)values('ee240000-0000-4000-8000-000000000001','trade-in-ee240000@example.invalid',now());
insert into public.companies(id,name,organisation_number,created_by)values('ee240000-0000-4000-8000-000000000002','Contract Rollback Fixture','9924000001','ee240000-0000-4000-8000-000000000001');
insert into public.memberships(company_id,user_id,role)values('ee240000-0000-4000-8000-000000000002','ee240000-0000-4000-8000-000000000001','owner');
insert into public.customers(id,company_id,name)values('ee240000-0000-4000-8000-000000000003','ee240000-0000-4000-8000-000000000002','Rollback Customer');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('ee240000-0000-4000-8000-000000000004','ee240000-0000-4000-8000-000000000002','EE160000','Fixture','Rollback',2020);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('ee240000-0000-4000-8000-000000000005','ee240000-0000-4000-8000-000000000002','ee240000-0000-4000-8000-000000000004',100,200,'standard');
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)values('ee240000-0000-4000-8000-000000000006','ee240000-0000-4000-8000-000000000002','ee240000-0000-4000-8000-000000000005','ee240000-0000-4000-8000-000000000003',200,'ee240000-0000-4000-8000-000000000001');
-- Explicit synthetic approval; this fixture is rolled back and never grants a real user access.
do $$begin
 if to_regclass('private.account_approvals') is not null then
  insert into private.account_approvals(user_id,status,updated_by) values('ee240000-0000-4000-8000-000000000001','approved','ee240000-0000-4000-8000-000000000001') on conflict(user_id) do nothing;
 end if;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ee240000-0000-4000-8000-000000000001',true);
do $$declare t jsonb;reviewed jsonb;d jsonb;again jsonb;offer uuid;begin
 t:=public.create_contract_template_version('ee240000-0000-4000-8000-000000000002','ee240000-0000-4000-8000-000000000009',0,'Sale contract','Seller {{company.name}} Buyer {{customer.name}} Price {{offer.price_ore}}','ee240000-0000-4000-8000-000000000010');
 reviewed:=public.review_contract_template('ee240000-0000-4000-8000-000000000002',(t->'template'->>'id')::uuid,1,'approved','Reviewed company sale terms','ee240000-0000-4000-8000-000000000011');
 offer:=public.create_offer_version('ee240000-0000-4000-8000-000000000002','ee240000-0000-4000-8000-000000000006','ee240000-0000-4000-8000-000000000012','Original accepted terms',(clock_timestamp() at time zone 'Europe/Stockholm')::date,true);
 reset role;
 insert into private.offer_reviews(company_id,deal_id,offer_id,offer_version,recipient_email,status,decided_at,responder_name)values('ee240000-0000-4000-8000-000000000002','ee240000-0000-4000-8000-000000000006',offer,1,'fixture-recipient@example.invalid','accepted',clock_timestamp(),'Rollback recipient');
 set local role authenticated;
 d:=public.create_sale_contract_draft('ee240000-0000-4000-8000-000000000002','ee240000-0000-4000-8000-000000000006',offer,(t->'template'->>'id')::uuid,2,'ee240000-0000-4000-8000-000000000013');
 again:=public.create_sale_contract_draft('ee240000-0000-4000-8000-000000000002','ee240000-0000-4000-8000-000000000006',offer,(t->'template'->>'id')::uuid,2,'ee240000-0000-4000-8000-000000000013');
 if d is distinct from again or d->'draft'->'sourceOffer'->>'terms'<>'Original accepted terms' or d->'draft'->'template'->>'approvalVersion'<>'2' then raise exception 'Contract snapshot failed';end if;
end$$;
select 'PASS: approved company template, exact accepted offer, immutable private contract draft and actor-bound retry' as result;
rollback;
