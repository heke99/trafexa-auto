begin;
create function private.advertising_payment_page(p_company uuid,p_invoice uuid,p_before text,p_platform boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare mr text;doc private.advertising_issued_invoices;credit jsonb;gross numeric;due numeric;paid numeric;outstanding numeric;surplus numeric;latest bigint;n numeric;entries jsonb;next_cursor text;state jsonb;day date;begin
 mr:=private.advertising_invoice_context(p_company,p_platform);doc:=private.advertising_payment_document(p_company,p_invoice);day:=(clock_timestamp() at time zone 'Europe/Stockholm')::date;
 if p_before is not null and (p_before !~ '^[1-9][0-9]{0,18}$' or p_before::numeric>9223372036854775807) then raise exception 'Invalid payment cursor' using errcode='22023';end if;
 gross:=(doc.snapshot->>'grossTotalOre')::numeric;
 select jsonb_build_object('id',c.id,'creditNumber',c.credit_number,'sourceHash',c.source_hash,'grossTotalOre',c.snapshot->>'grossTotalOre') into credit from private.advertising_credit_invoices c where c.company_id=p_company and c.original_invoice_id=p_invoice;
 due:=case when credit is null then gross else 0 end;
 select coalesce(sum(case when e.kind='receipt' then e.amount_ore::numeric else -e.amount_ore::numeric end),0),coalesce(max(e.sequence),0),count(*)::numeric into paid,latest,n from private.advertising_payment_entries e where e.company_id=p_company and e.invoice_id=p_invoice;
 outstanding:=greatest(due-paid,0);surplus:=greatest(paid-due,0);
 select coalesce(jsonb_agg(private.advertising_payment_entry_json(e) order by e.sequence desc),'[]') into entries from (select * from private.advertising_payment_entries e where e.company_id=p_company and e.invoice_id=p_invoice and (p_before is null or e.sequence<p_before::bigint) order by e.sequence desc limit 50)e;
 if jsonb_array_length(entries)=50 and exists(select 1 from private.advertising_payment_entries e where e.company_id=p_company and e.invoice_id=p_invoice and e.sequence<(entries->49->>'sequence')::bigint) then next_cursor:=entries->49->>'sequence';end if;
 state:=jsonb_build_object('companyId',p_company,'invoiceId',p_invoice,'invoiceSourceHash',doc.source_hash,'creditSourceHash',credit->>'sourceHash','latestSequence',latest::text,'entryCount',n::text,'businessDate',day,'receivableOre',due::text,'receivedOre',paid::text);
 return jsonb_build_object('companyId',p_company,'invoiceId',p_invoice,'invoiceNumber',doc.invoice_number,'invoiceSourceHash',doc.source_hash,'actorUserId',auth.uid(),'actorRole',mr,'currency','SEK','businessDate',day,'grossTotalOre',gross::text,'credit',credit,'receivableOre',due::text,'receivedOre',paid::text,'outstandingOre',outstanding::text,'surplusOre',surplus::text,'status',case when credit is not null then 'credited' when surplus>0 then 'overpaid' when outstanding=0 then 'settled' when paid>0 then 'partial' else 'unpaid' end,'entries',entries,'nextBeforeSequence',next_cursor,'latestSequence',latest::text,'entryCount',n::text,'reviewToken',encode(sha256(convert_to(state::text,'UTF8')),'hex'),'canonicalReview',state::text,'canWrite',mr='platform_admin');
end $$;
create function private.lookup_advertising_payment(p_company uuid,p_invoice uuid,p_identifier text) returns jsonb language plpgsql security definer set search_path='' as $$
declare doc private.advertising_issued_invoices;r private.advertising_payment_entries;begin
 perform private.advertising_invoice_context(p_company,true);doc:=private.advertising_payment_document(p_company,p_invoice);
 if p_identifier is null or p_identifier !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' then raise exception 'Invalid payment identifier' using errcode='22023';end if;
 select * into r from private.advertising_payment_entries e where e.seller_organisation_number=doc.snapshot->'series'->>'sellerOrganisationNumber' and e.payment_identifier=p_identifier and e.kind='receipt' order by e.sequence desc limit 1;
 return jsonb_build_object('companyId',p_company,'invoiceId',p_invoice,'actorUserId',auth.uid(),'paymentIdentifier',p_identifier,'entry',case when r.id is null then null else private.advertising_payment_entry_json(r) end);
end $$;
revoke all on function private.advertising_payment_page(uuid,uuid,text,boolean),private.lookup_advertising_payment(uuid,uuid,text) from public,anon,service_role;
grant execute on function private.advertising_payment_page(uuid,uuid,text,boolean),private.lookup_advertising_payment(uuid,uuid,text) to authenticated;
commit;
