begin;
create function private.advertising_credit_json(p_row private.advertising_credit_invoices) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'companyId',p_row.company_id,'originalInvoiceId',p_row.original_invoice_id,'createdAt',p_row.created_at,'creditNumber',p_row.credit_number,'creditDate',p_row.credit_date,'sourceHash',p_row.source_hash,'canonicalSnapshot',p_row.canonical_snapshot,'snapshot',p_row.snapshot);
$$;
create function private.advertising_credit_preview(p_company uuid,p_original jsonb,p_series jsonb,p_date date) returns jsonb language plpgsql security invoker set search_path='' as $$
declare number text;seq text:=p_series->>'nextNumber';source jsonb;
begin
 number:=(p_series->>'prefix')||'-'||(p_series->>'year')||'-'||lpad(seq,greatest(6,length(seq)),'0');
 source:=jsonb_build_object('companyId',p_company,'originalInvoiceId',p_original->'id','originalSourceHash',p_original->>'sourceHash','seriesId',p_series->'id','seriesReviewToken',p_series->>'reviewToken','sequence',seq,'creditNumber',number,'creditDate',p_date);
 return jsonb_build_object('creditNumber',number,'sequence',seq,'creditDate',p_date,'originalSourceHash',p_original->>'sourceHash','seriesReviewToken',p_series->>'reviewToken','reviewToken',encode(sha256(convert_to(source::text,'UTF8')),'hex'),'canonicalSnapshot',source::text);
end $$;
revoke all on function private.advertising_credit_json(private.advertising_credit_invoices),private.advertising_credit_preview(uuid,jsonb,jsonb,date) from public,anon,authenticated,service_role;
commit;
