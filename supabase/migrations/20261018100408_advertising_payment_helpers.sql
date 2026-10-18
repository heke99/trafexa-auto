begin;
create function private.advertising_payment_entry_json(r private.advertising_payment_entries) returns jsonb language sql set search_path='' as $$
 select r.canonical_snapshot::jsonb||jsonb_build_object('sourceHash',r.source_hash,'canonicalSnapshot',r.canonical_snapshot,'isReversed',exists(select 1 from private.advertising_payment_entries e where e.reverses_entry_id=r.id),'isReplaced',exists(select 1 from private.advertising_payment_entries e where e.replaces_entry_id=r.id));
$$;
create function private.advertising_payment_document(p_company uuid,p_invoice uuid) returns private.advertising_issued_invoices language plpgsql set search_path='' as $$
declare r private.advertising_issued_invoices;begin
 select * into r from private.advertising_issued_invoices where company_id=p_company and id=p_invoice;
 if not found then raise exception 'Invoice unavailable' using errcode='42501';end if;return r;
end $$;
create function private.advertising_payment_text(p_text text,p_max integer) returns boolean language sql immutable set search_path='' as $$
 select p_text is not null and length(p_text) between 1 and p_max and p_text=btrim(p_text) and p_text !~ '[[:cntrl:]]' and p_text !~ ('['||chr(128)||'-'||chr(159)||']');
$$;
create function private.advertising_payment_insert(p_invoice private.advertising_issued_invoices,p_kind text,p_amount bigint,p_identifier text,p_reference text,p_date date,p_reason text,p_reverses uuid,p_replaces uuid) returns private.advertising_payment_entries language plpgsql set search_path='' as $$
declare r private.advertising_payment_entries;s jsonb;entry_id uuid:=gen_random_uuid();seq bigint:=nextval('private.advertising_payment_sequence');at_time timestamptz:=clock_timestamp();begin
 s:=jsonb_build_object('id',entry_id,'sequence',seq::text,'companyId',p_invoice.company_id,'invoiceId',p_invoice.id,'invoiceNumber',p_invoice.invoice_number,'invoiceSourceHash',p_invoice.source_hash,'sellerOrganisationNumber',p_invoice.snapshot->'series'->>'sellerOrganisationNumber','kind',p_kind,'amountOre',p_amount::text,'paymentIdentifier',p_identifier,'bankReference',p_reference,'bookedDate',p_date,'reason',p_reason,'createdAt',at_time,'createdBy',auth.uid(),'reversesEntryId',p_reverses,'replacesEntryId',p_replaces);
 insert into private.advertising_payment_entries(id,sequence,company_id,invoice_id,invoice_number,invoice_source_hash,seller_organisation_number,kind,amount_ore,payment_identifier,bank_reference,booked_date,reason,created_at,created_by,reverses_entry_id,replaces_entry_id,canonical_snapshot,source_hash)
 values(entry_id,seq,p_invoice.company_id,p_invoice.id,p_invoice.invoice_number,p_invoice.source_hash,p_invoice.snapshot->'series'->>'sellerOrganisationNumber',p_kind,p_amount,p_identifier,p_reference,p_date,p_reason,at_time,auth.uid(),p_reverses,p_replaces,s::text,encode(sha256(convert_to(s::text,'UTF8')),'hex')) returning * into r;return r;
end $$;
create function private.advertising_payment_result(p_entry private.advertising_payment_entries,p_request uuid,p_token text) returns jsonb language sql set search_path='' as $$
 select jsonb_build_object('entry',private.advertising_payment_entry_json(p_entry),'receipt',jsonb_build_object('entryId',p_entry.id,'companyId',p_entry.company_id,'invoiceId',p_entry.invoice_id,'actorUserId',auth.uid(),'requestId',p_request,'sourceHash',p_entry.source_hash,'reviewToken',p_token));
$$;
revoke all on function private.advertising_payment_entry_json(private.advertising_payment_entries),private.advertising_payment_document(uuid,uuid),private.advertising_payment_text(text,integer),private.advertising_payment_insert(private.advertising_issued_invoices,text,bigint,text,text,date,text,uuid,uuid),private.advertising_payment_result(private.advertising_payment_entries,uuid,text) from public,anon,authenticated,service_role;
commit;
