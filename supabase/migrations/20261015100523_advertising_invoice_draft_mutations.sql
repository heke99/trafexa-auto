begin;
create function private.advertising_invoice_draft_json(p_draft private.advertising_invoice_drafts) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('id',p_draft.id,'companyId',p_draft.company_id,'month',p_draft.month,'version',p_draft.version,'createdAt',p_draft.created_at,'sourceHash',p_draft.source_hash,'snapshot',p_draft.snapshot,'canonicalSnapshot',p_draft.canonical_snapshot);
$$;
create function private.create_advertising_invoice_draft(p_company uuid,p_month text,p_buyer integer,p_seller integer,p_token text,p_review boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();request private.advertising_invoice_requests;draft private.advertising_invoice_drafts;payload jsonb;source jsonb;v integer;
begin
 perform private.advertising_invoice_context(p_company,true);
 if p_month is null or p_month !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' or p_buyer is null or p_buyer<0 or p_seller is null or p_seller<0 or p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_review is distinct from true or p_request is null then raise exception 'Invalid invoice draft request' using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company,'month',p_month,'expectedBuyerVersion',p_buyer,'expectedSellerVersion',p_seller,'expectedReviewToken',p_token,'reviewAcknowledged',p_review);
 select * into request from private.advertising_invoice_requests where actor_user_id=actor and request_id=p_request;
 if found then
  if request.payload<>payload then raise exception 'Invoice request reused' using errcode='40001';end if;
  select * into draft from private.advertising_invoice_drafts where id=request.draft_id and company_id=p_company;
 else
  source:=private.advertising_invoice_source(p_company,p_month,true);
  if (source->'buyerProfile'->>'version')::integer<>p_buyer or (source->'sellerProfile'->>'version')::integer<>p_seller or source->>'sourceHash'<>p_token then raise exception 'Invoice source changed' using errcode='40001';end if;
  if source->'basis'->'original'='null'::jsonb then raise exception 'Locked original required' using errcode='22023';end if;
  select * into draft from private.advertising_invoice_drafts where company_id=p_company and month=p_month and source_hash=source->>'sourceHash';
  if not found then
   select coalesce(max(version),0) into v from private.advertising_invoice_drafts where company_id=p_company and month=p_month;
   if v>=100 then raise exception 'Invoice draft history limit reached' using errcode='22023';end if;
   insert into private.advertising_invoice_drafts(company_id,month,version,snapshot,canonical_snapshot,source_hash,created_by) values(p_company,p_month,v+1,source->'snapshot',source->>'canonicalSnapshot',source->>'sourceHash',actor) returning * into draft;
  end if;
  insert into private.advertising_invoice_requests(actor_user_id,request_id,company_id,draft_id,payload) values(actor,p_request,p_company,draft.id,payload);
 end if;
 source:=private.advertising_invoice_source(p_company,p_month,true);
 return jsonb_build_object('draft',private.advertising_invoice_draft_json(draft),'isOutdated',draft.source_hash<>source->>'sourceHash','receipt',jsonb_build_object('draftId',draft.id,'companyId',draft.company_id,'actorUserId',actor,'requestId',p_request,'sourceHash',draft.source_hash));
end $$;
revoke all on function private.advertising_invoice_draft_json(private.advertising_invoice_drafts) from public,anon,authenticated,service_role;
revoke all on function private.create_advertising_invoice_draft(uuid,text,integer,integer,text,boolean,uuid) from public,anon,service_role;
grant execute on function private.create_advertising_invoice_draft(uuid,text,integer,integer,text,boolean,uuid) to authenticated;
commit;
