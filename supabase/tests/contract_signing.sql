begin;
do $$begin
 if exists(select 1 from auth.users where id='ee280000-0000-4000-8000-000000000001') or exists(select 1 from public.companies where id='ee280000-0000-4000-8000-000000000002') or exists(select 1 from public.customers where id='ee280000-0000-4000-8000-000000000003') or exists(select 1 from public.vehicles where id='ee280000-0000-4000-8000-000000000004') or exists(select 1 from public.stock_items where id='ee280000-0000-4000-8000-000000000005') or exists(select 1 from public.deals where id='ee280000-0000-4000-8000-000000000006') then raise exception 'Signing smoke fixture collision';end if;
 if exists(select 1 from auth.users where id='ee280000-0000-4000-8000-000000000007') then raise exception 'Signing customer collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at)values('ee280000-0000-4000-8000-000000000001','signing-owner-ee280000@example.invalid',now()),('ee280000-0000-4000-8000-000000000007','signing-customer-ee280000@example.invalid',now());
insert into public.companies(id,name,organisation_number,created_by)values('ee280000-0000-4000-8000-000000000002','Signing Rollback Fixture','9928000001','ee280000-0000-4000-8000-000000000001');
insert into public.memberships(company_id,user_id,role)values('ee280000-0000-4000-8000-000000000002','ee280000-0000-4000-8000-000000000001','owner');
insert into public.customers(id,company_id,name,email)values('ee280000-0000-4000-8000-000000000003','ee280000-0000-4000-8000-000000000002','Rollback Customer','signing-customer-ee280000@example.invalid');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('ee280000-0000-4000-8000-000000000004','ee280000-0000-4000-8000-000000000002','EE280000','Fixture','Rollback',2020);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('ee280000-0000-4000-8000-000000000005','ee280000-0000-4000-8000-000000000002','ee280000-0000-4000-8000-000000000004',100,200,'standard');
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)values('ee280000-0000-4000-8000-000000000006','ee280000-0000-4000-8000-000000000002','ee280000-0000-4000-8000-000000000005','ee280000-0000-4000-8000-000000000003',200,'ee280000-0000-4000-8000-000000000001');
-- Explicit synthetic approval; this fixture is rolled back and never grants a real user access.
do $$begin
 if to_regclass('private.account_approvals') is not null then
  insert into private.account_approvals(user_id,status,updated_by) values('ee280000-0000-4000-8000-000000000001','approved','ee280000-0000-4000-8000-000000000001'),('ee280000-0000-4000-8000-000000000007','approved','ee280000-0000-4000-8000-000000000001') on conflict(user_id) do nothing;
 end if;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ee280000-0000-4000-8000-000000000001',true);
do $$declare t jsonb;reviewed jsonb;published jsonb;accepted jsonb;d jsonb;s jsonb;first_sign jsonb;last_sign jsonb;again jsonb;offer uuid;sid uuid;h text;strokes jsonb:='[{"points":[{"x":0,"y":0},{"x":5,"y":20},{"x":10,"y":0}]}]';begin
 t:=public.create_contract_template_version('ee280000-0000-4000-8000-000000000002','ee280000-0000-4000-8000-000000000009',0,'Sale contract','Seller {{company.name}} Buyer {{customer.name}} Price {{offer.price_ore}}','ee280000-0000-4000-8000-000000000010');
 reviewed:=public.review_contract_template('ee280000-0000-4000-8000-000000000002',(t->'template'->>'id')::uuid,1,'approved','Reviewed company sale terms','ee280000-0000-4000-8000-000000000011');
 offer:=public.create_offer_version('ee280000-0000-4000-8000-000000000002','ee280000-0000-4000-8000-000000000006','ee280000-0000-4000-8000-000000000012','Original accepted terms',(clock_timestamp() at time zone 'Europe/Stockholm')::date,true);
 published:=public.publish_offer_review('ee280000-0000-4000-8000-000000000002','ee280000-0000-4000-8000-000000000006',offer,'ee280000-0000-4000-8000-000000000014');
 perform set_config('request.jwt.claim.sub','ee280000-0000-4000-8000-000000000007',true);
 accepted:=public.respond_offer_review((published->'review'->>'id')::uuid,1,'accepted','Rollback Customer',null,'2026-10-14','ee280000-0000-4000-8000-000000000015');
 if accepted->'review'->>'status'<>'accepted' then raise exception 'Actual customer acceptance failed';end if;
 perform set_config('request.jwt.claim.sub','ee280000-0000-4000-8000-000000000001',true);
 d:=public.create_sale_contract_draft('ee280000-0000-4000-8000-000000000002','ee280000-0000-4000-8000-000000000006',offer,(t->'template'->>'id')::uuid,2,'ee280000-0000-4000-8000-000000000013');
 s:=public.request_contract_signing('ee280000-0000-4000-8000-000000000002','ee280000-0000-4000-8000-000000000006',(d->'draft'->>'id')::uuid,true,'ee280000-0000-4000-8000-000000000016');
 again:=public.request_contract_signing('ee280000-0000-4000-8000-000000000002','ee280000-0000-4000-8000-000000000006',(d->'draft'->>'id')::uuid,true,'ee280000-0000-4000-8000-000000000016');
 if s is distinct from again or s->'signing'->>'status'<>'pending' then raise exception 'Request/replay failed';end if;
 sid:=(s->'signing'->>'id')::uuid;h:=s->'signing'->>'documentHash';
 if h<>encode(sha256(convert_to(s->'signing'->>'canonicalContent','UTF8')),'hex') then raise exception 'Immutable content hash mismatch';end if;
 perform set_config('request.jwt.claim.sub','ee280000-0000-4000-8000-000000000007',true);
 first_sign:=public.sign_contract(sid,null,1,h,'Rollback Customer',strokes,true,'2026-10-14','ee280000-0000-4000-8000-000000000017');
 again:=public.sign_contract(sid,null,1,h,'Rollback Customer',strokes,true,'2026-10-14','ee280000-0000-4000-8000-000000000017');
 if first_sign is distinct from again or first_sign->'signing'->>'revision'<>'2' or first_sign->'signing'->>'status'<>'pending' then raise exception 'Customer signature/replay failed';end if;
 perform set_config('request.jwt.claim.sub','ee280000-0000-4000-8000-000000000001',true);
 last_sign:=public.sign_contract(sid,'ee280000-0000-4000-8000-000000000002',2,h,'Rollback Company Signer',strokes,true,'2026-10-14','ee280000-0000-4000-8000-000000000018');
 again:=public.sign_contract(sid,'ee280000-0000-4000-8000-000000000002',2,h,'Rollback Company Signer',strokes,true,'2026-10-14','ee280000-0000-4000-8000-000000000018');
 if last_sign is distinct from again or last_sign->'signing'->>'status'<>'completed' or last_sign->'signing'->>'revision'<>'3' or last_sign->'signing'->>'completedAt' is null or last_sign->'signing'->'customerSignature'->>'documentHash'<>h or last_sign->'signing'->'companySignature'->>'documentHash'<>h then raise exception 'Two-party completion failed';end if;
 reset role;
 if(select count(*) from private.contract_signatures where signing_id=sid)<>2 or(select count(*) from private.transactional_email_outbox where reference_id=sid and kind in('contract_invitation','contract_completed','contract_completed_company'))<>3 then raise exception 'Immutable receipt/outbox count failed';end if;
end$$;
select 'PASS: accepted offer, approved template, immutable source hash, two actual parties, authorized retries, three queued transactional notifications; no provider dispatch' as result;
rollback;
