-- HISTORICAL CHECKPOINT ONLY: requires the schema through 20261018171408.
-- The old renewal creator is retired by later migrations. For current hosted
-- verification use customer_document_renewal.sql and its separate cleanup query.
-- Synthetic rollback-only guest delivery proof. Only the dealer has Auth.
-- No token, account or invitation is created through an external Auth API.
begin;
do $$begin if exists(select 1 from auth.users where id='af370000-0000-4000-8000-000000000001') or exists(select 1 from public.companies where id='af370000-0000-4000-8000-000000000003') then raise exception 'Guest recovery fixture collision';end if;end $$;
insert into auth.users(id,email,email_confirmed_at)values('af370000-0000-4000-8000-000000000001','guest-delivery-owner-af370000@example.invalid',now());
insert into private.account_approvals(user_id,status,updated_by)values('af370000-0000-4000-8000-000000000001','approved','af370000-0000-4000-8000-000000000001');
insert into public.companies(id,name,organisation_number,created_by)values('af370000-0000-4000-8000-000000000003','Guest recovery fixture','5568554884','af370000-0000-4000-8000-000000000001');
insert into public.memberships(company_id,user_id,role)values('af370000-0000-4000-8000-000000000003','af370000-0000-4000-8000-000000000001','owner');
insert into public.customers(id,company_id,name,email)values('af370000-0000-4000-8000-000000000005','af370000-0000-4000-8000-000000000003','Guest Buyer','guest-delivery-buyer-af370000@example.invalid');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('af370000-0000-4000-8000-000000000007','af370000-0000-4000-8000-000000000003','AF37000','Fixture','Guest',2020);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('af370000-0000-4000-8000-000000000006','af370000-0000-4000-8000-000000000003','af370000-0000-4000-8000-000000000007',100,200,'standard');
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)values('af370000-0000-4000-8000-000000000004','af370000-0000-4000-8000-000000000003','af370000-0000-4000-8000-000000000006','af370000-0000-4000-8000-000000000005',200,'af370000-0000-4000-8000-000000000001');
-- Only synthetic expired metadata is inserted directly. All capability/audit
-- immutability triggers stay enabled; no Storage or external service is used.
do $$declare c uuid:='af370000-0000-4000-8000-000000000003';d uuid:='af370000-0000-4000-8000-000000000004';u uuid:='af370000-0000-4000-8000-000000000001';offer uuid;q jsonb;r jsonb;result_receipt jsonb;again jsonb;e private.transactional_email_outbox;i private.guest_document_invitations;old_offer uuid;old_completed uuid;lease jsonb;p jsonb;template jsonb;draft jsonb;signing jsonb;completed jsonb;sid uuid;hash text;doc jsonb;party_before jsonb;st text;begin
 set local role authenticated;perform set_config('request.jwt.claim.sub',u::text,true);
 offer:=public.create_offer_version(c,d,'af370000-0000-4000-8000-000000000010','Guest recovery terms',(clock_timestamp() at time zone 'Europe/Stockholm')::date,true);
 q:=public.publish_offer_review(c,d,offer,'af370000-0000-4000-8000-000000000011');
 r:=public.get_guest_invitation_renewal_review(c,d,'offer_invitation',(q->'review'->>'id')::uuid);
 reset role;select * into e from private.transactional_email_outbox where id=(r->>'emailId')::uuid;i:=private.guest_email_source(e);
 insert into private.guest_document_invitations(email_id,kind,reference_id,company_id,dealer_actor_user_id,recipient_email,document_hash,document_version,token_hash,created_at,expires_at)
 values(e.id,e.kind,e.reference_id,c,i.dealer_actor_user_id,e.recipient,i.document_hash,i.document_version,repeat('a',64),now()-interval '8 days',now()-interval '1 day') returning id into old_offer;
 update private.transactional_email_outbox set customer_ciphertext=repeat('opaque-recovery-original-',4),attempts=1,first_attempt_at=now()-interval '8 days' where id=e.id;
 foreach st in array array['unknown','rejected','cancelled'] loop
  update private.transactional_email_outbox set status=st where id=e.id;set local role authenticated;
  if(public.get_guest_invitation_renewal_review(c,d,e.kind,e.reference_id)->>'canRecoverPending')::boolean then raise exception 'Unsafe outcome recovered: %',st;end if;
  begin perform public.renew_guest_document_invitation(c,d,e.kind,e.reference_id,e.id,0,i.document_hash,'af370000-0000-4000-8000-000000000090');raise exception 'Unsafe recovery accepted';exception when serialization_failure then null;end;reset role;
 end loop;
 update private.transactional_email_outbox set status='pending',customer_provider_started_at=now() where id=e.id;set local role authenticated;
 if(public.get_guest_invitation_renewal_review(c,d,e.kind,e.reference_id)->>'canRecoverPending')::boolean then raise exception 'Provider-started pending recovered';end if;
 reset role;update private.transactional_email_outbox set customer_provider_started_at=null where id=e.id;set local role authenticated;
 r:=public.get_guest_invitation_renewal_review(c,d,e.kind,e.reference_id);
 if r->'canRecoverPending'<>'true'::jsonb or r->'canRenew'<>'false'::jsonb then raise exception 'Known pending recovery unavailable';end if;
 result_receipt:=public.renew_guest_document_invitation(c,d,e.kind,e.reference_id,e.id,0,i.document_hash,'af370000-0000-4000-8000-000000000090');
 again:=public.renew_guest_document_invitation(c,d,e.kind,e.reference_id,e.id,0,i.document_hash,'af370000-0000-4000-8000-000000000090');
 if result_receipt<>again then raise exception 'Recovery receipt changed';end if;
 begin perform public.renew_guest_document_invitation(c,d,e.kind,e.reference_id,e.id,0,i.document_hash,'af370000-0000-4000-8000-000000000091');raise exception 'Stale pending recovery accepted';exception when serialization_failure then null;end;
 reset role;if(select status from private.transactional_email_outbox where id=e.id)<>'cancelled' then raise exception 'Old pending queue remains live';end if;
 set local role service_role;
 begin perform public.get_guest_customer_document(old_offer,repeat('a',64));raise exception 'Expired/cancelled old token revived';exception when insufficient_privilege then null;end;
 lease:=public.claim_transactional_email_exact((result_receipt->>'emailId')::uuid);p:=public.prepare_customer_contract_invitation((lease->>'id')::uuid,(lease->>'leaseId')::uuid);
 perform public.bind_guest_document_invitation((lease->>'id')::uuid,(lease->>'leaseId')::uuid,(p->>'invitationId')::uuid,repeat('b',64),repeat('opaque-recovery-offer-',4));
 perform public.respond_guest_offer((p->>'invitationId')::uuid,repeat('b',64),1,'accepted','Guest Buyer',null,true,'2026-10-14','af370000-0000-4000-8000-000000000020');
 reset role;set local role authenticated;
 template:=public.create_contract_template_version(c,'af370000-0000-4000-8000-000000000021',0,'Recovery contract','Seller {{company.name}} Buyer {{customer.name}} Price {{offer.price_ore}}','af370000-0000-4000-8000-000000000022');
 perform public.review_contract_template(c,(template->'template'->>'id')::uuid,1,'approved','Reviewed recovery contract','af370000-0000-4000-8000-000000000023');
 draft:=public.create_sale_contract_draft(c,d,offer,(template->'template'->>'id')::uuid,2,'af370000-0000-4000-8000-000000000024');
 signing:=public.request_contract_signing(c,d,(draft->'draft'->>'id')::uuid,true,'af370000-0000-4000-8000-000000000025');sid:=(signing->'signing'->>'id')::uuid;hash:=signing->'signing'->>'documentHash';
 r:=public.get_guest_invitation_renewal_review(c,d,'contract_invitation',sid);reset role;set local role service_role;lease:=public.claim_transactional_email_exact((r->>'emailId')::uuid);
 p:=public.prepare_customer_contract_invitation((lease->>'id')::uuid,(lease->>'leaseId')::uuid);
 perform public.bind_guest_document_invitation((lease->>'id')::uuid,(lease->>'leaseId')::uuid,(p->>'invitationId')::uuid,repeat('c',64),repeat('opaque-recovery-contract-',4));
 perform public.sign_guest_contract((p->>'invitationId')::uuid,repeat('c',64),1,hash,'Guest Buyer','[]',true,'2026-10-14','af370000-0000-4000-8000-000000000030');
 reset role;set local role authenticated;
 completed:=public.sign_contract(sid,c,2,hash,'Guest Dealer','[{"points":[{"x":0,"y":0},{"x":5,"y":20},{"x":10,"y":0}]}]',true,'2026-10-14','af370000-0000-4000-8000-000000000031');
 if completed->'signing'->>'status'<>'completed' then raise exception 'Source not completed';end if;
 r:=public.get_guest_invitation_renewal_review(c,d,'contract_completed',sid);
 reset role;select jsonb_agg(to_jsonb(x) order by party) into party_before from private.contract_party_signatures(sid)x;
 select * into e from private.transactional_email_outbox where id=(r->>'emailId')::uuid;i:=private.guest_email_source(e);
 insert into private.guest_document_invitations(email_id,kind,reference_id,company_id,dealer_actor_user_id,recipient_email,document_hash,document_version,created_at,expires_at)
 values(e.id,e.kind,e.reference_id,c,i.dealer_actor_user_id,e.recipient,i.document_hash,i.document_version,now()-interval '8 days',now()-interval '1 day') returning id into old_completed;
 set local role authenticated;r:=public.get_guest_invitation_renewal_review(c,d,e.kind,e.reference_id);
 if r->'canRecoverPending'<>'true'::jsonb or r->'canRenew'<>'false'::jsonb then raise exception 'Prepared unbound completion not recoverable';end if;
 result_receipt:=public.renew_guest_document_invitation(c,d,e.kind,e.reference_id,e.id,0,i.document_hash,'af370000-0000-4000-8000-000000000092');
 if result_receipt->>'kind'<>'contract_completed' then raise exception 'Completed recovery kind changed';end if;
 reset role;if(select status from private.transactional_email_outbox where id=e.id)<>'cancelled' then raise exception 'Old prepared completion remains live';end if;
 set local role service_role;lease:=public.claim_transactional_email_exact((result_receipt->>'emailId')::uuid);p:=public.prepare_customer_contract_invitation((lease->>'id')::uuid,(lease->>'leaseId')::uuid);
 perform public.bind_guest_document_invitation((lease->>'id')::uuid,(lease->>'leaseId')::uuid,(p->>'invitationId')::uuid,repeat('d',64),repeat('opaque-recovery-completed-',4));
 doc:=public.get_guest_customer_document((p->>'invitationId')::uuid,repeat('d',64));
 if doc->>'kind'<>'contract_completed' or doc->'document'->>'status'<>'completed' or doc->>'documentHash'<>hash then raise exception 'Read-only completion changed';end if;
 begin perform public.sign_guest_contract((p->>'invitationId')::uuid,repeat('d',64),3,hash,'Guest Buyer','[]',true,'2026-10-14','af370000-0000-4000-8000-000000000093');raise exception 'Recovered completed link allowed signature';exception when insufficient_privilege then null;end;
 begin perform public.respond_guest_offer((p->>'invitationId')::uuid,repeat('d',64),1,'accepted','Guest Buyer',null,true,'2026-10-14','af370000-0000-4000-8000-000000000094');raise exception 'Recovered completed link allowed offer response';exception when insufficient_privilege then null;end;
 reset role;if(select jsonb_agg(to_jsonb(x) order by party)from private.contract_party_signatures(sid)x) is distinct from party_before then raise exception 'Recovery changed signature evidence';end if;
 if(select token_hash from private.guest_document_invitations where id=old_completed) is not null then raise exception 'Old unbound capability changed';end if;
 if has_function_privilege('anon','public.get_guest_invitation_renewal_review(uuid,uuid,text,uuid)','execute') or has_function_privilege('authenticated','public.claim_transactional_email_exact(uuid)','execute') or has_function_privilege('service_role','public.renew_guest_document_invitation(uuid,uuid,text,uuid,uuid,integer,text,uuid)','execute') then raise exception 'Recovery RPC grant leaked';end if;
 if exists(select 1 from auth.users where lower(email)='guest-delivery-buyer-af370000@example.invalid') then raise exception 'Buyer account created';end if;
end $$;
select 'PASS: controlled expired pending offer and completed read-only link recovery; unsafe provider outcomes denied, exact fresh capabilities, unchanged signatures/hash, immutable CAS/replay and no buyer Auth or external effects' result;
rollback;
