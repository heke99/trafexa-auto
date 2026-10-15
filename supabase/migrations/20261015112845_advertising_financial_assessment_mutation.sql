begin;
create function private.create_advertising_financial_assessment(p_company uuid,p_month text,p_draft uuid,p_draft_hash text,p_settings integer,p_settings_token text,p_token text,p_review boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();request private.advertising_financial_requests;r private.advertising_financial_assessments;settings_row private.advertising_financial_settings;payload jsonb;source jsonb;snapshot jsonb;preview jsonb;detail jsonb;settings jsonb;v integer;
begin
 perform private.advertising_invoice_context(p_company,true);
 if p_company is null or p_month is null or p_month !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' or p_draft is null or p_draft_hash is null or p_draft_hash !~ '^[0-9a-f]{64}$' or p_settings is null or p_settings<0 or p_settings_token is null or p_settings_token !~ '^[0-9a-f]{64}$' or p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_review is distinct from true or p_request is null then raise exception 'Invalid assessment request' using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company,'month',p_month,'draftId',p_draft,'expectedDraftSourceHash',p_draft_hash,'expectedSettingsVersion',p_settings,'expectedSettingsReviewToken',p_settings_token,'expectedReviewToken',p_token,'reviewAcknowledged',p_review);
 select * into request from private.advertising_financial_requests where actor_user_id=actor and request_id=p_request;
 if found then
  if request.payload<>payload then raise exception 'Assessment request reused' using errcode='40001';end if;
  select * into r from private.advertising_financial_assessments where id=request.assessment_id and company_id=p_company;
 else
  settings:=private.advertising_financial_settings_current(p_company);detail:=private.get_advertising_invoice_draft(p_company,p_draft,true);
  if (settings->>'version')::integer<>p_settings or settings->>'reviewToken'<>p_settings_token or detail->'draft'->>'sourceHash'<>p_draft_hash or detail->'draft'->>'month'<>p_month or (detail->>'isOutdated')::boolean then raise exception 'Assessment source changed' using errcode='40001';end if;
  source:=private.advertising_financial_source(p_company,p_draft,true);preview:=source->'preview';
  if source->>'reviewToken'<>p_token then raise exception 'Assessment review changed' using errcode='40001';end if;
  if preview->'blockers'<>'[]'::jsonb or preview->'vatTotalOre'='null'::jsonb or preview->'grossTotalOre'='null'::jsonb then raise exception 'Complete financial review required' using errcode='22023';end if;
  select * into settings_row from private.advertising_financial_settings where company_id=p_company and version=p_settings;
  if not found then raise exception 'Saved financial settings required' using errcode='22023';end if;
  select * into r from private.advertising_financial_assessments where company_id=p_company and draft_id=p_draft and settings_id=settings_row.id and calculation_version=1;
  if not found then
   select coalesce(max(version),0) into v from private.advertising_financial_assessments where company_id=p_company and month=p_month;
   if v>=100 then raise exception 'Assessment history limit reached' using errcode='22023';end if;
   snapshot:=jsonb_build_object('status','reviewed_draft','currency','SEK','calculationVersion',1,'companyId',p_company,'month',p_month,'sourceReviewToken',p_token,'sourceCanonicalSnapshot',source->>'reviewCanonicalSnapshot','draft',source->'draft','settings',source->'settings','lines',preview->'lines','netTotalOre',preview->'netTotalOre','vatTotalOre',preview->'vatTotalOre','grossTotalOre',preview->'grossTotalOre');
   insert into private.advertising_financial_assessments(company_id,month,version,draft_id,settings_id,snapshot,canonical_snapshot,source_hash,source_token,created_by) values(p_company,p_month,v+1,p_draft,settings_row.id,snapshot,snapshot::text,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),p_token,actor) returning * into r;
  end if;
  insert into private.advertising_financial_requests(actor_user_id,request_id,company_id,assessment_id,payload) values(actor,p_request,p_company,r.id,payload);
 end if;
 return jsonb_build_object('assessment',private.advertising_financial_assessment_json(r),'isOutdated',private.advertising_financial_outdated(p_company,r.draft_id,r.snapshot->'settings'->>'reviewToken',true),'receipt',jsonb_build_object('assessmentId',r.id,'companyId',r.company_id,'actorUserId',actor,'requestId',p_request,'sourceHash',r.source_hash,'sourceReviewToken',r.source_token,'draftId',r.draft_id,'draftSourceHash',r.snapshot->'draft'->>'sourceHash','settingsVersion',r.snapshot->'settings'->'version','settingsReviewToken',r.snapshot->'settings'->>'reviewToken'));
end $$;
revoke all on function private.create_advertising_financial_assessment(uuid,text,uuid,text,integer,text,text,boolean,uuid) from public,anon,service_role;
grant execute on function private.create_advertising_financial_assessment(uuid,text,uuid,text,integer,text,text,boolean,uuid) to authenticated;
commit;
