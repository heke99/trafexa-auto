begin;
create function private.issue_advertising_credit_invoice(p_company uuid,p_original uuid,p_hash text,p_series uuid,p_series_token text,p_token text,p_reason text,p_review boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();request private.advertising_credit_requests;r private.advertising_credit_invoices;payload jsonb;page jsonb;preview jsonb;o jsonb;series jsonb;snapshot jsonb;issued_at timestamptz;n integer;
begin
 perform private.advertising_invoice_context(p_company,true);
 if p_original is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_series is null or p_series_token is null or p_series_token !~ '^[0-9a-f]{64}$' or p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_reason is null or length(p_reason) not between 1 and 500 or p_reason<>btrim(p_reason) or p_reason ~ '[[:cntrl:]]' or p_reason ~ ('['||chr(128)||'-'||chr(159)||']') or not private.advertising_issued_text_supported(p_reason) or p_review is distinct from true or p_request is null then raise exception 'Explicit reviewed full credit required' using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company,'originalInvoiceId',p_original,'expectedOriginalSourceHash',p_hash,'expectedSeriesId',p_series,'expectedSeriesReviewToken',p_series_token,'expectedReviewToken',p_token,'reason',p_reason,'reviewAcknowledged',p_review);
 select * into request from private.advertising_credit_requests where actor_user_id=actor and request_id=p_request;
 if found then
  if request.payload<>payload then raise exception 'Credit request reused' using errcode='40001';end if;
  select * into r from private.advertising_credit_invoices where id=request.credit_id and company_id=p_company;
 else
  select next_number into n from private.advertising_invoice_counters where series_id=p_series for update;
  if not found then raise exception 'Credit series changed' using errcode='40001';end if;
  page:=private.advertising_credit_page(p_company,p_original,true);o:=page->'originalInvoice';series:=page->'series';preview:=page->'preview';
  if o->>'sourceHash'<>p_hash or page->'credit'<>'null'::jsonb or series->>'id' is distinct from p_series::text or series->>'reviewToken' is distinct from p_series_token then raise exception 'Credit source or series changed' using errcode='40001';end if;
  if (page->>'canCredit')::boolean is distinct from true or preview='null'::jsonb then raise exception 'Credit prerequisites incomplete' using errcode='22023';end if;
  if preview->>'reviewToken'<>p_token then raise exception 'Credit number or date changed' using errcode='40001';end if;
  issued_at:=clock_timestamp();if (issued_at at time zone 'Europe/Stockholm')::date<>(preview->>'creditDate')::date then raise exception 'Credit date changed' using errcode='40001';end if;
  snapshot:=jsonb_build_object('status','credited','documentType','full_credit','direction','credit','currency','SEK','rendererVersion',1,'companyId',p_company,'originalInvoiceId',p_original,'creditNumber',preview->>'creditNumber','creditDate',preview->'creditDate','sequence',n::text,'reason',p_reason,'series',series-array['reason','configuredAt','nextNumber','reviewToken','canonicalSnapshot'],'originalInvoice',o,'lines',o->'snapshot'->'lines','netTotalOre',o->'snapshot'->'netTotalOre','vatTotalOre',o->'snapshot'->'vatTotalOre','grossTotalOre',o->'snapshot'->'grossTotalOre');
  insert into private.advertising_credit_invoices(company_id,original_invoice_id,series_id,sequence,credit_number,credit_date,snapshot,canonical_snapshot,source_hash,review_token,created_at,created_by) values(p_company,p_original,p_series,n,preview->>'creditNumber',(preview->>'creditDate')::date,snapshot,snapshot::text,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),p_token,issued_at,actor) returning * into r;
  update private.advertising_invoice_counters set next_number=n+1 where series_id=p_series;
  insert into private.advertising_credit_requests(actor_user_id,request_id,company_id,credit_id,payload) values(actor,p_request,p_company,r.id,payload);
 end if;
 return jsonb_build_object('credit',private.advertising_credit_json(r),'receipt',jsonb_build_object('creditId',r.id,'companyId',r.company_id,'actorUserId',actor,'requestId',p_request,'originalInvoiceId',r.original_invoice_id,'originalSourceHash',r.snapshot->'originalInvoice'->>'sourceHash','seriesId',r.series_id,'sourceHash',r.source_hash,'creditNumber',r.credit_number,'reviewToken',r.review_token));
end $$;
revoke all on function private.issue_advertising_credit_invoice(uuid,uuid,text,uuid,text,text,text,boolean,uuid) from public,anon,service_role;
grant execute on function private.issue_advertising_credit_invoice(uuid,uuid,text,uuid,text,text,text,boolean,uuid) to authenticated;
commit;
