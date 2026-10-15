begin;
create function private.lock_advertising_billing_period(p_company uuid,p_month text,p_token text,p_review boolean,p_partial boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();existing private.advertising_billing_periods;page jsonb;payload jsonb;snapshot jsonb;
begin
 perform private.advertising_billing_context(p_company,true);
 if p_month is null or p_month !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' or p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_review is distinct from true or p_partial is null or p_request is null then raise exception 'Invalid close' using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company,'month',p_month,'expectedReviewToken',p_token,'reviewAcknowledged',p_review,'partialCoverageAcknowledged',p_partial);
 select * into existing from private.advertising_billing_periods where locked_by=actor and request_id=p_request;
 if found then
  if existing.payload<>payload then raise exception 'Request reused' using errcode='40001';end if;
  return private.advertising_billing_read(p_company,p_month,true);
 end if;
 page:=private.advertising_billing_read(p_company,p_month,true);
 if page->>'reviewToken'<>p_token or page->'locked'<>'null'::jsonb then raise exception 'Period changed or locked' using errcode='40001';end if;
 if (page->>'ended')::boolean is distinct from true or (page->>'trackingStartedAt')::timestamptz>=(page->>'periodEnd')::timestamptz or (page->>'unpricedCount')::bigint<>0 or (page->>'coverage'='partial' and not p_partial) then raise exception 'Period cannot close' using errcode='22023';end if;
 snapshot:=page-array['actorUserId','actorRole','ended','rates','reviewToken','locked','hasChangesSinceLock'];
 insert into private.advertising_billing_periods(company_id,month,snapshot,canonical_snapshot,review_token,partial_coverage_acknowledged,locked_by,request_id,payload) values(p_company,p_month,snapshot,snapshot::text,p_token,p_partial,actor,p_request,payload);
 return private.advertising_billing_read(p_company,p_month,true);
end $$;
revoke all on function private.lock_advertising_billing_period(uuid,text,text,boolean,boolean,uuid) from public,anon,service_role;
grant execute on function private.lock_advertising_billing_period(uuid,text,text,boolean,boolean,uuid) to authenticated;
commit;
