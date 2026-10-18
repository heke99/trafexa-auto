-- Synthetic rollback-only guest fulfilment proof. Only the dealer has Auth.
-- No provider dispatch/acceptance, Storage object writes or business records persist.
-- No token, account or invitation is created through an external Auth API.
begin;
do $$begin if exists(select 1 from auth.users where id='af310000-0000-4000-8000-000000000001') or exists(select 1 from public.companies where id='af310000-0000-4000-8000-000000000003') then raise exception 'Guest delivery fixture collision';end if;end $$;
insert into auth.users(id,email,email_confirmed_at)values('af310000-0000-4000-8000-000000000001','guest-fulfilment-owner-af310000@example.invalid',now());
insert into private.account_approvals(user_id,status,updated_by)values('af310000-0000-4000-8000-000000000001','approved','af310000-0000-4000-8000-000000000001');
insert into public.companies(id,name,organisation_number,created_by)values('af310000-0000-4000-8000-000000000003','Guest delivery fixture','5568554884','af310000-0000-4000-8000-000000000001');
insert into public.memberships(company_id,user_id,role)values('af310000-0000-4000-8000-000000000003','af310000-0000-4000-8000-000000000001','owner');
insert into public.customers(id,company_id,name,email)values('af310000-0000-4000-8000-000000000005','af310000-0000-4000-8000-000000000003','Guest Buyer','guest-fulfilment-buyer-af310000@example.invalid');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('af310000-0000-4000-8000-000000000007','af310000-0000-4000-8000-000000000003','AF24000','Fixture','Guest',2020);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('af310000-0000-4000-8000-000000000006','af310000-0000-4000-8000-000000000003','af310000-0000-4000-8000-000000000007',100,200,'standard');
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)values('af310000-0000-4000-8000-000000000004','af310000-0000-4000-8000-000000000003','af310000-0000-4000-8000-000000000006','af310000-0000-4000-8000-000000000005',200,'af310000-0000-4000-8000-000000000001');
do $$declare offer uuid;review jsonb;lease jsonb;prepared jsonb;bound jsonb;again jsonb;template jsonb;draft jsonb;signing jsonb;complete jsonb;document jsonb;sid uuid;hash text;oh text:=repeat('a',64);ch text:=repeat('b',64);dh text:=repeat('c',64);cipher text:=repeat('opaque-synthetic-guest-body-',4);strokes jsonb:='[{"points":[{"x":0,"y":0},{"x":5,"y":20},{"x":10,"y":0}]}]';begin
 set local role authenticated;
 perform set_config('request.jwt.claim.sub','af310000-0000-4000-8000-000000000001',true);
 offer:=public.create_offer_version('af310000-0000-4000-8000-000000000003','af310000-0000-4000-8000-000000000004','af310000-0000-4000-8000-000000000010','Guest delivery terms',(clock_timestamp() at time zone 'Europe/Stockholm')::date,true);
 review:=public.publish_offer_review('af310000-0000-4000-8000-000000000003','af310000-0000-4000-8000-000000000004',offer,'af310000-0000-4000-8000-000000000011');
 reset role;set local role service_role;
 lease:=public.claim_transactional_email('offer_invitation',(review->'review'->>'id')::uuid);
 prepared:=public.prepare_customer_contract_invitation((lease->>'id')::uuid,(lease->>'leaseId')::uuid);
 if prepared->>'mode'<>'guest' or prepared->'userId'<>'null'::jsonb or prepared->'firstAttemptAt'<>'null'::jsonb then raise exception 'Guest offer preparation mismatch';end if;
 bound:=public.bind_guest_document_invitation((lease->>'id')::uuid,(lease->>'leaseId')::uuid,(prepared->>'invitationId')::uuid,oh,cipher);
 again:=public.current_customer_contract_invitation((lease->>'id')::uuid,(lease->>'leaseId')::uuid,(prepared->>'invitationId')::uuid);
 if bound<>again or bound->>'ciphertext'<>cipher then raise exception 'Guest frozen receipt mismatch';end if;
 begin perform public.bind_guest_document_invitation((lease->>'id')::uuid,(lease->>'leaseId')::uuid,(prepared->>'invitationId')::uuid,ch,cipher);raise exception 'Guest token rotated';exception when serialization_failure then null;end;
 perform public.respond_guest_offer((prepared->>'invitationId')::uuid,oh,1,'accepted','Guest Buyer',null,true,'2026-10-14','af310000-0000-4000-8000-000000000020');
 reset role;set local role authenticated;
 template:=public.create_contract_template_version('af310000-0000-4000-8000-000000000003','af310000-0000-4000-8000-000000000021',0,'Guest contract','Seller {{company.name}} Buyer {{customer.name}} Price {{offer.price_ore}}','af310000-0000-4000-8000-000000000022');
 perform public.review_contract_template('af310000-0000-4000-8000-000000000003',(template->'template'->>'id')::uuid,1,'approved','Reviewed guest contract','af310000-0000-4000-8000-000000000023');
 draft:=public.create_sale_contract_draft('af310000-0000-4000-8000-000000000003','af310000-0000-4000-8000-000000000004',offer,(template->'template'->>'id')::uuid,2,'af310000-0000-4000-8000-000000000024');
 signing:=public.request_contract_signing('af310000-0000-4000-8000-000000000003','af310000-0000-4000-8000-000000000004',(draft->'draft'->>'id')::uuid,true,'af310000-0000-4000-8000-000000000025');
 sid:=(signing->'signing'->>'id')::uuid;hash:=signing->'signing'->>'documentHash';
 reset role;set local role service_role;
 lease:=public.claim_transactional_email('contract_invitation',sid);
 prepared:=public.prepare_customer_contract_invitation((lease->>'id')::uuid,(lease->>'leaseId')::uuid);
 perform public.bind_guest_document_invitation((lease->>'id')::uuid,(lease->>'leaseId')::uuid,(prepared->>'invitationId')::uuid,ch,cipher);
 perform public.sign_guest_contract((prepared->>'invitationId')::uuid,ch,1,hash,'Guest Buyer','[]',true,'2026-10-14','af310000-0000-4000-8000-000000000030');
 reset role;set local role authenticated;
 complete:=public.sign_contract(sid,'af310000-0000-4000-8000-000000000003',2,hash,'Guest Dealer',strokes,true,'2026-10-14','af310000-0000-4000-8000-000000000031');
 if complete->'signing'->>'status'<>'completed' then raise exception 'Guest two-party completion failed';end if;
 if (public.get_deal_fulfilment('af310000-0000-4000-8000-000000000003','af310000-0000-4000-8000-000000000004')->>'blockedReason')is distinct from'original_required' then raise exception 'FAIL completed guest signing not recognized';end if;
 begin
  perform public.mutate_deal_fulfilment('af310000-0000-4000-8000-000000000003','af310000-0000-4000-8000-000000000004',jsonb_build_object('companyId','af310000-0000-4000-8000-000000000003','dealId','af310000-0000-4000-8000-000000000004','requestId','af310000-0000-4000-8000-000000000070','expectedVersion',0,'operation','payment','amountOre','200','bankReference','GUEST-ROLLBACK-ONLY','bookedOn',(clock_timestamp()at time zone'Europe/Stockholm')::date::text,'reason','Rollback-only manual test'));
  raise exception 'FAIL missing archive permitted payment';
 exception when serialization_failure then null;end;
 reset role;
 if(select count(*)from private.contract_signatures where signing_id=sid)<>1 or(select count(*)from private.guest_contract_signatures where signing_id=sid)<>1 then raise exception 'FAIL incorrect party fixtures';end if;
 if exists(select 1 from auth.users where lower(email)='guest-fulfilment-buyer-af310000@example.invalid')then raise exception 'FAIL created buyer Auth';end if;
 if exists(select 1 from private.deal_payment_entries where company_id='af310000-0000-4000-8000-000000000003')or exists(select 1 from private.deal_deliveries where company_id='af310000-0000-4000-8000-000000000003')then raise exception 'FAIL missing original mutated business state';end if;
end$$;
select 'PASS: guest customer plus authenticated company recognized as completed; missing original still blocks payment; no buyer Auth, Storage writes or provider dispatch' result;
rollback;
