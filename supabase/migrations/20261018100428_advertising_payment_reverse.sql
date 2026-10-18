begin;
create function private.reverse_advertising_payment(p_company uuid,p_invoice uuid,p_hash text,p_token text,p_entry uuid,p_reason text,p_review boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();doc private.advertising_issued_invoices;prior private.advertising_payment_entries;request private.advertising_payment_requests;r private.advertising_payment_entries;payload jsonb;page jsonb;begin
 perform private.advertising_invoice_context(p_company,true);doc:=private.advertising_payment_document(p_company,p_invoice);
 if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_entry is null or not private.advertising_payment_text(p_reason,500) or p_review is distinct from true or p_request is null then raise exception 'Explicit reviewed payment reversal required' using errcode='22023';end if;
 payload:=jsonb_build_object('kind','reversal','companyId',p_company,'invoiceId',p_invoice,'expectedInvoiceSourceHash',p_hash,'expectedReviewToken',p_token,'entryId',p_entry,'reason',p_reason,'reviewAcknowledged',true);
 select * into request from private.advertising_payment_requests where actor_user_id=actor and request_id=p_request;
 if found then
  if request.payload<>payload then raise exception 'Payment request reused' using errcode='40001';end if;
  select * into r from private.advertising_payment_entries where id=request.entry_id;
 else
  page:=private.advertising_payment_page(p_company,p_invoice,null,true);
  if doc.source_hash<>p_hash or page->>'reviewToken'<>p_token then raise exception 'Payment review changed' using errcode='40001';end if;
  select * into prior from private.advertising_payment_entries where id=p_entry and company_id=p_company and invoice_id=p_invoice;
  if not found or prior.kind<>'receipt' or exists(select 1 from private.advertising_payment_entries where reverses_entry_id=prior.id) then raise exception 'Payment reversal source changed' using errcode='40001';end if;
  r:=private.advertising_payment_insert(doc,'reversal',prior.amount_ore,prior.payment_identifier,prior.bank_reference,prior.booked_date,p_reason,prior.id,null);
  insert into private.advertising_payment_requests(actor_user_id,request_id,company_id,invoice_id,entry_id,payload) values(actor,p_request,p_company,p_invoice,r.id,payload);
 end if;
 return private.advertising_payment_result(r,p_request,p_token);
end $$;
revoke all on function private.reverse_advertising_payment(uuid,uuid,text,text,uuid,text,boolean,uuid) from public,anon,service_role;
grant execute on function private.reverse_advertising_payment(uuid,uuid,text,text,uuid,text,boolean,uuid) to authenticated;
commit;
