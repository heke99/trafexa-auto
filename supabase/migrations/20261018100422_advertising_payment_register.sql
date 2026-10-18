begin;
create function private.register_advertising_payment(p_company uuid,p_invoice uuid,p_hash text,p_token text,p_amount text,p_identifier text,p_reference text,p_date date,p_reason text,p_replaces uuid,p_replaced_hash text,p_review boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();doc private.advertising_issued_invoices;prior private.advertising_payment_entries;request private.advertising_payment_requests;r private.advertising_payment_entries;payload jsonb;page jsonb;seller text;begin
 perform private.advertising_invoice_context(p_company,true);doc:=private.advertising_payment_document(p_company,p_invoice);seller:=doc.snapshot->'series'->>'sellerOrganisationNumber';
 if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_amount is null or p_amount !~ '^[1-9][0-9]{0,18}$' or p_amount::numeric>9223372036854775807 or p_identifier is null or p_identifier !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' or not private.advertising_payment_text(p_reference,200) or not private.advertising_payment_text(p_reason,500) or p_date is null or p_date<'2000-01-01'::date or p_date>'2099-12-31'::date or p_review is distinct from true or p_request is null or (p_replaces is null)<>(p_replaced_hash is null) or (p_replaced_hash is not null and p_replaced_hash !~ '^[0-9a-f]{64}$') then raise exception 'Explicit reviewed payment required' using errcode='22023';end if;
 payload:=jsonb_build_object('kind','receipt','companyId',p_company,'invoiceId',p_invoice,'expectedInvoiceSourceHash',p_hash,'expectedReviewToken',p_token,'amountOre',p_amount,'paymentIdentifier',p_identifier,'bankReference',p_reference,'bookedDate',p_date,'reason',p_reason,'replacesEntryId',p_replaces,'expectedReplacedEntryHash',p_replaced_hash,'reviewAcknowledged',true);
 select * into request from private.advertising_payment_requests where actor_user_id=actor and request_id=p_request;
 if found then
  if request.payload<>payload then raise exception 'Payment request reused' using errcode='40001';end if;
  select * into r from private.advertising_payment_entries where id=request.entry_id;
 else
  page:=private.advertising_payment_page(p_company,p_invoice,null,true);
  if doc.source_hash<>p_hash or page->>'reviewToken'<>p_token then raise exception 'Payment review changed' using errcode='40001';end if;
  if p_date>(page->>'businessDate')::date then raise exception 'Future payment date' using errcode='22023';end if;
  if p_replaces is null then
   if exists(select 1 from private.advertising_payment_entries where seller_organisation_number=seller and payment_identifier=p_identifier and kind='receipt') then raise exception 'Payment identifier already reserved; review correction' using errcode='40001';end if;
  else
   select * into prior from private.advertising_payment_entries where id=p_replaces;
   if not found or prior.source_hash<>p_replaced_hash or prior.kind<>'receipt' or prior.payment_identifier<>p_identifier or prior.seller_organisation_number<>seller or not exists(select 1 from private.advertising_payment_entries where reverses_entry_id=prior.id) or exists(select 1 from private.advertising_payment_entries where replaces_entry_id=prior.id) then raise exception 'Payment correction source changed' using errcode='40001';end if;
  end if;
  r:=private.advertising_payment_insert(doc,'receipt',p_amount::bigint,p_identifier,p_reference,p_date,p_reason,null,p_replaces);
  insert into private.advertising_payment_requests(actor_user_id,request_id,company_id,invoice_id,entry_id,payload) values(actor,p_request,p_company,p_invoice,r.id,payload);
 end if;
 return private.advertising_payment_result(r,p_request,p_token);
end $$;
revoke all on function private.register_advertising_payment(uuid,uuid,text,text,text,text,text,date,text,uuid,text,boolean,uuid) from public,anon,service_role;
grant execute on function private.register_advertising_payment(uuid,uuid,text,text,text,text,text,date,text,uuid,text,boolean,uuid) to authenticated;
commit;
