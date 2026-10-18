-- HISTORICAL CHECKPOINT ONLY: requires the schema through 20261018164815.
-- The old renewal creator is retired by later migrations. For current hosted
-- verification use customer_document_renewal.sql and its separate cleanup query.
-- Synthetic rollback-only guest delivery proof. Only the dealer has Auth.
-- No token, account or invitation is created through an external Auth API.
begin;
do $$begin if exists(select 1 from auth.users where id='af360000-0000-4000-8000-000000000001') or exists(select 1 from public.companies where id='af360000-0000-4000-8000-000000000003') then raise exception 'Guest renewal fixture collision';end if;end $$;
insert into auth.users(id,email,email_confirmed_at)values('af360000-0000-4000-8000-000000000001','guest-delivery-owner-af360000@example.invalid',now());
insert into private.account_approvals(user_id,status,updated_by)values('af360000-0000-4000-8000-000000000001','approved','af360000-0000-4000-8000-000000000001');
insert into public.companies(id,name,organisation_number,created_by)values('af360000-0000-4000-8000-000000000003','Guest renewal fixture','5568554884','af360000-0000-4000-8000-000000000001');
insert into public.memberships(company_id,user_id,role)values('af360000-0000-4000-8000-000000000003','af360000-0000-4000-8000-000000000001','owner');
insert into public.customers(id,company_id,name,email)values('af360000-0000-4000-8000-000000000005','af360000-0000-4000-8000-000000000003','Guest Buyer','guest-delivery-buyer-af360000@example.invalid');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('af360000-0000-4000-8000-000000000007','af360000-0000-4000-8000-000000000003','AF36000','Fixture','Guest',2020);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('af360000-0000-4000-8000-000000000006','af360000-0000-4000-8000-000000000003','af360000-0000-4000-8000-000000000007',100,200,'standard');
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)values('af360000-0000-4000-8000-000000000004','af360000-0000-4000-8000-000000000003','af360000-0000-4000-8000-000000000006','af360000-0000-4000-8000-000000000005',200,'af360000-0000-4000-8000-000000000001');
-- Synthetic historical metadata is inserted already expired; production immutable
-- capability triggers stay enabled throughout. No Storage or Auth API calls.
do $$declare c uuid:='af360000-0000-4000-8000-000000000003';d uuid:='af360000-0000-4000-8000-000000000004';u uuid:='af360000-0000-4000-8000-000000000001';offer uuid;q jsonb;r jsonb;proof_receipt jsonb;again jsonb;e private.transactional_email_outbox;i private.guest_document_invitations;old_i uuid;lease jsonb;prepared jsonb;st text;nonce uuid:='af360000-0000-4000-8000-000000000090';hash text:=repeat('a',64);begin
 set local role authenticated;perform set_config('request.jwt.claim.sub',u::text,true);
 offer:=public.create_offer_version(c,d,'af360000-0000-4000-8000-000000000010','Guest renewal terms',(clock_timestamp() at time zone 'Europe/Stockholm')::date,true);
 q:=public.publish_offer_review(c,d,offer,'af360000-0000-4000-8000-000000000011');
 r:=public.get_guest_invitation_renewal_review(c,d,'offer_invitation',(q->'review'->>'id')::uuid);
 if r->>'status'<>'pending' or r->'canRenew'<>'false'::jsonb or r->'invitationId'<>'null'::jsonb then raise exception 'Missing capability read mismatch';end if;
 reset role;
 select * into e from private.transactional_email_outbox where id=(r->>'emailId')::uuid;
 i:=private.guest_email_source(e);
 insert into private.guest_document_invitations(email_id,kind,reference_id,company_id,dealer_actor_user_id,recipient_email,document_hash,document_version,token_hash,created_at,expires_at)
 values(e.id,e.kind,e.reference_id,c,i.dealer_actor_user_id,e.recipient,i.document_hash,i.document_version,hash,now()-interval '8 days',now()-interval '1 day') returning id into old_i;
 update private.transactional_email_outbox set status='accepted',provider_id='synthetic_prior_acceptance',attempts=1,first_attempt_at=now()-interval '8 days' where id=e.id;
 set local role authenticated;
 r:=public.get_guest_invitation_renewal_review(c,d,e.kind,e.reference_id);
 if r->'canRenew'<>'true'::jsonb or r->>'documentHash'<>i.document_hash or(r->>'generation')::integer<>0 then raise exception 'Expired accepted review mismatch';end if;
 reset role;
 foreach st in array array['pending','unknown','rejected','cancelled'] loop
  update private.transactional_email_outbox set status=st where id=e.id;
  set local role authenticated;
  if(public.get_guest_invitation_renewal_review(c,d,e.kind,e.reference_id)->>'canRenew')::boolean then raise exception 'Unsafe state renewable: %',st;end if;
  begin perform public.renew_guest_document_invitation(c,d,e.kind,e.reference_id,e.id,0,i.document_hash,nonce);raise exception 'Unsafe renewal succeeded';exception when serialization_failure then null;end;
  reset role;
 end loop;
 update private.transactional_email_outbox set status='accepted' where id=e.id;
 set local role authenticated;
 proof_receipt:=public.renew_guest_document_invitation(c,d,e.kind,e.reference_id,e.id,0,i.document_hash,nonce);
 again:=public.renew_guest_document_invitation(c,d,e.kind,e.reference_id,e.id,0,i.document_hash,nonce);
 if proof_receipt<>again or proof_receipt->>'actorUserId'<>u::text or proof_receipt->>'expectedEmailId'<>e.id::text or(proof_receipt->>'generation')::integer<>1 or proof_receipt->>'emailId'=e.id::text then raise exception 'Renewal receipt mismatch';end if;
 begin perform public.renew_guest_document_invitation(c,d,e.kind,e.reference_id,e.id,0,i.document_hash,'af360000-0000-4000-8000-000000000091');raise exception 'Stale generation accepted';exception when serialization_failure then null;end;
 begin perform public.renew_guest_document_invitation(c,d,e.kind,e.reference_id,e.id,0,repeat('f',64),nonce);raise exception 'Request payload changed';exception when serialization_failure then null;end;
 if public.get_offer_review_delivery(c,d,e.reference_id)->>'status'<>'pending' then raise exception 'Delivery reader selected old generation';end if;
 reset role;
 perform private.enqueue_transactional_email(e.kind,e.reference_id,e.recipient);
 if(select count(*) from private.transactional_email_outbox where kind=e.kind and reference_id=e.reference_id and recipient=e.recipient)<>2 then raise exception 'Original enqueue duplicated';end if;
 begin update private.guest_invitation_renewal_audit set receipt='{}'::jsonb where email_id=(proof_receipt->>'emailId')::uuid;raise exception 'Audit receipt changed';exception when object_not_in_prerequisite_state then null;end;
 set local role service_role;
 begin perform public.get_guest_customer_document(old_i,hash);raise exception 'Expired original token accepted';exception when insufficient_privilege then null;end;
 lease:=public.claim_transactional_email_exact((proof_receipt->>'emailId')::uuid);
 if lease->>'id'<>proof_receipt->>'emailId' then raise exception 'Exact queue claim selected wrong generation';end if;
 prepared:=public.prepare_customer_contract_invitation((lease->>'id')::uuid,(lease->>'leaseId')::uuid);
 if prepared->>'invitationId'=old_i::text or prepared->'ciphertext'<>'null'::jsonb then raise exception 'Old capability reused';end if;
 perform public.bind_guest_document_invitation((lease->>'id')::uuid,(lease->>'leaseId')::uuid,(prepared->>'invitationId')::uuid,repeat('b',64),repeat('opaque-renewal-proof-',4));
 if public.get_guest_customer_document((prepared->>'invitationId')::uuid,repeat('b',64))->>'documentHash'<>i.document_hash then raise exception 'Renewed document changed';end if;
 reset role;
 if has_function_privilege('anon','public.get_guest_invitation_renewal_review(uuid,uuid,text,uuid)','execute') or has_function_privilege('authenticated','public.claim_transactional_email_exact(uuid)','execute') or has_function_privilege('service_role','public.renew_guest_document_invitation(uuid,uuid,text,uuid,uuid,integer,text,uuid)','execute') then raise exception 'Guest renewal RPC grant leaked';end if;
 if exists(select 1 from auth.users where lower(email)='guest-delivery-buyer-af360000@example.invalid') then raise exception 'Buyer account created';end if;
end $$;
select 'PASS: reviewed expired guest invitation renewal; immutable receipt, CAS, generation-zero idempotency, exact new capability and unsafe-state/grant denial; no external effects' result;
rollback;
