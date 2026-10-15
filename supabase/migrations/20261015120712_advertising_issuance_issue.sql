begin;
create function private.issue_advertising_invoice(p_company uuid,p_month text,p_assessment uuid,p_assessment_hash text,p_series uuid,p_series_token text,p_token text,p_review boolean,p_service_review boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();request private.advertising_invoice_issue_requests;r private.advertising_issued_invoices;payload jsonb;page jsonb;preview jsonb;a jsonb;series jsonb;snapshot jsonb;lines jsonb;issued_at timestamptz;n integer;
begin
 perform private.advertising_invoice_context(p_company,true);
 if p_company is null or p_month is null or p_month !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' or p_assessment is null or p_assessment_hash is null or p_assessment_hash !~ '^[0-9a-f]{64}$' or p_series is null or p_series_token is null or p_series_token !~ '^[0-9a-f]{64}$' or p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_review is distinct from true or p_service_review is distinct from true or p_request is null then raise exception 'Explicit reviewed invoice issuance required' using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company,'month',p_month,'assessmentId',p_assessment,'expectedAssessmentSourceHash',p_assessment_hash,'expectedSeriesId',p_series,'expectedSeriesReviewToken',p_series_token,'expectedReviewToken',p_token,'reviewAcknowledged',p_review,'serviceDatesAcknowledged',p_service_review);
 select * into request from private.advertising_invoice_issue_requests where actor_user_id=actor and request_id=p_request;
 if found then
  if request.payload<>payload then raise exception 'Invoice issue request reused' using errcode='40001';end if;
  select * into r from private.advertising_issued_invoices where id=request.invoice_id and company_id=p_company;
 else
  select next_number into n from private.advertising_invoice_counters where series_id=p_series for update;
  if not found then raise exception 'Invoice series changed' using errcode='40001';end if;
  page:=private.advertising_issuance_page(p_company,p_month,p_assessment,true);a:=page->'assessment';series:=page->'series';preview:=page->'preview';
  if a->>'sourceHash'<>p_assessment_hash or (page->>'isOutdated')::boolean or page->'invoice'<>'null'::jsonb or series->>'id' is distinct from p_series::text or series->>'reviewToken' is distinct from p_series_token then raise exception 'Invoice source or series changed' using errcode='40001';end if;
  if (page->>'canIssue')::boolean is distinct from true or preview='null'::jsonb then raise exception 'Invoice prerequisites incomplete' using errcode='22023';end if;
  if preview->>'reviewToken'<>p_token then raise exception 'Invoice number or date changed' using errcode='40001';end if;
  issued_at:=clock_timestamp();if (issued_at at time zone 'Europe/Stockholm')::date<>(preview->>'invoiceDate')::date then raise exception 'Invoice date changed' using errcode='40001';end if;
  select jsonb_agg(x||jsonb_build_object('quantity',1,'serviceDate',(select d->'serviceDate' from jsonb_array_elements(preview->'serviceDates') d where d->>'publicationId'=x->>'publicationId')) order by ord) into lines from jsonb_array_elements(a->'snapshot'->'lines') with ordinality t(x,ord);
  snapshot:=jsonb_build_object('status','issued','currency','SEK','rendererVersion',1,'companyId',p_company,'month',p_month,'invoiceNumber',preview->>'invoiceNumber','invoiceDate',preview->'invoiceDate','dueDate',preview->'dueDate','sequence',n::text,'serviceDatesAcknowledged',true,'series',series-array['reason','configuredAt','nextNumber','reviewToken','canonicalSnapshot'],'assessment',a,'lines',lines,'netTotalOre',a->'snapshot'->'netTotalOre','vatTotalOre',a->'snapshot'->'vatTotalOre','grossTotalOre',a->'snapshot'->'grossTotalOre');
  insert into private.advertising_issued_invoices(company_id,month,assessment_id,series_id,sequence,invoice_number,invoice_date,due_date,snapshot,canonical_snapshot,source_hash,review_token,created_at,created_by) values(p_company,p_month,p_assessment,p_series,n,preview->>'invoiceNumber',(preview->>'invoiceDate')::date,(preview->>'dueDate')::date,snapshot,snapshot::text,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),p_token,issued_at,actor) returning * into r;
  update private.advertising_invoice_counters set next_number=n+1 where series_id=p_series;
  insert into private.advertising_invoice_issue_requests(actor_user_id,request_id,company_id,invoice_id,payload) values(actor,p_request,p_company,r.id,payload);
 end if;
 return jsonb_build_object('invoice',private.advertising_issued_invoice_json(r),'isSourceOutdated',private.advertising_issued_source_outdated(r,true),'receipt',jsonb_build_object('invoiceId',r.id,'companyId',r.company_id,'actorUserId',actor,'requestId',p_request,'assessmentId',r.assessment_id,'assessmentSourceHash',r.snapshot->'assessment'->>'sourceHash','seriesId',r.series_id,'sourceHash',r.source_hash,'invoiceNumber',r.invoice_number,'reviewToken',r.review_token));
end $$;
revoke all on function private.issue_advertising_invoice(uuid,text,uuid,text,uuid,text,text,boolean,boolean,uuid) from public,anon,service_role;
grant execute on function private.issue_advertising_invoice(uuid,text,uuid,text,uuid,text,text,boolean,boolean,uuid) to authenticated;
commit;
