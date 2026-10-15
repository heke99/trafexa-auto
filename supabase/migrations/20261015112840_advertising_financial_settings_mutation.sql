begin;
create function private.save_advertising_financial_settings(p_company uuid,p_fields jsonb,p_expected integer,p_review boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();r private.advertising_financial_settings;f jsonb;payload jsonb;snapshot jsonb;v integer;
begin
 perform private.advertising_invoice_context(p_company,true);f:=private.advertising_financial_fields(p_fields,true);
 if p_company is null or p_expected is null or p_expected<0 or p_expected>=2147483647 or p_review is distinct from true or p_request is null then raise exception 'Invalid financial review' using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company,'fields',f,'expectedVersion',p_expected,'reviewAcknowledged',p_review);
 select * into r from private.advertising_financial_settings where created_by=actor and request_id=p_request;
 if found then if r.payload<>payload then raise exception 'Financial settings request reused' using errcode='40001';end if;
 else
  select coalesce(max(version),0) into v from private.advertising_financial_settings where company_id=p_company;
  if v<>p_expected then raise exception 'Financial settings changed' using errcode='40001';end if;
  snapshot:=jsonb_build_object('companyId',p_company,'version',v+1,'fields',f);
  insert into private.advertising_financial_settings(company_id,version,fields,canonical_snapshot,review_token,created_by,request_id,payload) values(p_company,v+1,f,snapshot::text,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),actor,p_request,payload) returning * into r;
 end if;
 return jsonb_build_object('settings',jsonb_build_object('companyId',r.company_id,'version',r.version,'fields',r.fields,'reviewToken',r.review_token,'canonicalSnapshot',r.canonical_snapshot,'updatedAt',r.created_at),'receipt',jsonb_build_object('settingsId',r.id,'companyId',r.company_id,'actorUserId',actor,'requestId',r.request_id));
end $$;
revoke all on function private.save_advertising_financial_settings(uuid,jsonb,integer,boolean,uuid) from public,anon,service_role;
grant execute on function private.save_advertising_financial_settings(uuid,jsonb,integer,boolean,uuid) to authenticated;
commit;
