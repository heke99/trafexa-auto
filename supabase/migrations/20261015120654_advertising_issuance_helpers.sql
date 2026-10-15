begin;
create function private.advertising_invoice_series_json(p_row private.advertising_invoice_series) returns jsonb language plpgsql security invoker set search_path='' as $$
declare n integer;config jsonb;state jsonb;begin
 select next_number into n from private.advertising_invoice_counters where series_id=p_row.id;
 config:=p_row.configuration||jsonb_build_object('configurationHash',p_row.configuration_hash,'canonicalConfiguration',p_row.canonical_configuration);
 state:=jsonb_build_object('configuration',config,'reason',p_row.reason,'configuredAt',p_row.configured_at,'nextNumber',n::text);
 return config||jsonb_build_object('reason',p_row.reason,'configuredAt',p_row.configured_at,'nextNumber',n::text,'reviewToken',encode(sha256(convert_to(state::text,'UTF8')),'hex'),'canonicalSnapshot',state::text);
end $$;
create function private.advertising_issued_invoice_json(p_row private.advertising_issued_invoices) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'companyId',p_row.company_id,'month',p_row.month,'createdAt',p_row.created_at,'invoiceNumber',p_row.invoice_number,'invoiceDate',p_row.invoice_date,'dueDate',p_row.due_date,'sourceHash',p_row.source_hash,'canonicalSnapshot',p_row.canonical_snapshot,'snapshot',p_row.snapshot);
$$;
create function private.advertising_issued_source_outdated(p_row private.advertising_issued_invoices,p_platform boolean) returns boolean language sql security invoker set search_path='' as $$
 select private.advertising_financial_outdated(p_row.company_id,(p_row.snapshot->'assessment'->'snapshot'->'draft'->>'id')::uuid,p_row.snapshot->'assessment'->'snapshot'->'settings'->>'reviewToken',p_platform);
$$;
create function private.advertising_issuance_preview(p_company uuid,p_assessment jsonb,p_series jsonb,p_date date) returns jsonb language plpgsql security invoker set search_path='' as $$
declare dates jsonb;number text;seq text:=p_series->>'nextNumber';due date;source jsonb;
begin
 number:=(p_series->>'prefix')||'-'||(p_series->>'year')||'-'||lpad(seq,greatest(6,length(seq)),'0');
 due:=p_date+(p_assessment->'snapshot'->'settings'->'fields'->>'paymentDays')::integer;
 select coalesce(jsonb_agg(jsonb_build_object('publicationId',x->'publicationId','serviceDate',((x->>'publishedAt')::timestamptz at time zone 'Europe/Stockholm')::date) order by n),'[]') into dates from jsonb_array_elements(p_assessment->'snapshot'->'draft'->'snapshot'->'basis'->'original'->'items') with ordinality t(x,n);
 source:=jsonb_build_object('companyId',p_company,'month',p_assessment->'month','assessmentId',p_assessment->'id','assessmentSourceHash',p_assessment->>'sourceHash','seriesId',p_series->'id','seriesReviewToken',p_series->>'reviewToken','sequence',seq,'invoiceNumber',number,'invoiceDate',p_date,'dueDate',due,'serviceDates',dates);
 return jsonb_build_object('invoiceNumber',number,'sequence',seq,'invoiceDate',p_date,'dueDate',due,'serviceDates',dates,'assessmentSourceHash',p_assessment->>'sourceHash','seriesReviewToken',p_series->>'reviewToken','reviewToken',encode(sha256(convert_to(source::text,'UTF8')),'hex'),'canonicalSnapshot',source::text);
end $$;
revoke all on function private.advertising_invoice_series_json(private.advertising_invoice_series),private.advertising_issued_invoice_json(private.advertising_issued_invoices),private.advertising_issued_source_outdated(private.advertising_issued_invoices,boolean),private.advertising_issuance_preview(uuid,jsonb,jsonb,date) from public,anon,authenticated,service_role;
commit;
