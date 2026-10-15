begin;
create function private.create_advertising_reduction(p_company uuid,p_month text,p_publication uuid,p_amount text,p_reason text,p_token text,p_review boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();r private.advertising_billing_reductions;payload jsonb;page jsonb;closed private.advertising_billing_periods;item jsonb;used numeric;price numeric;
begin
 perform private.advertising_billing_context(p_company,true);
 if p_month is null or p_month !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' or p_publication is null or p_amount is null or p_amount !~ '^[1-9][0-9]{0,18}$' or p_amount::numeric>9223372036854775807 or p_reason is null or length(p_reason) not between 1 and 500 or p_reason<>btrim(p_reason) or p_reason ~ '[[:cntrl:]]' or p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_review is distinct from true or p_request is null then raise exception 'Invalid reduction' using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company,'month',p_month,'publicationId',p_publication,'amountOre',p_amount,'reason',p_reason,'expectedReviewToken',p_token,'reviewAcknowledged',p_review);
 select * into r from private.advertising_billing_reductions where created_by=actor and request_id=p_request;
 if found then
  if r.payload<>payload then raise exception 'Request reused' using errcode='40001';end if;
 else
  page:=private.advertising_corrections_read(p_company,p_month,true);
  if page->>'reviewToken'<>p_token then raise exception 'Corrections changed' using errcode='40001';end if;
  select * into closed from private.advertising_billing_periods where company_id=p_company and month=p_month;
  if not found then raise exception 'Locked original required' using errcode='22023';end if;
  select x into item from jsonb_array_elements(closed.snapshot->'items') x where x->>'publicationId'=p_publication::text;
  if item is null then raise exception 'Original publication required' using errcode='22023';end if;
  price:=(item->>'unitPriceOre')::numeric;
  select coalesce(sum(amount_ore::numeric),0) into used from private.advertising_billing_reductions where period_id=closed.id and publication_id=p_publication;
  if (select count(*) from private.advertising_billing_reductions where period_id=closed.id)>=2000 then raise exception 'Reduction limit reached' using errcode='22023';end if;
  if price is null or p_amount::numeric>price-used then raise exception 'Reduction exceeds remaining amount' using errcode='22023';end if;
  insert into private.advertising_billing_reductions(company_id,period_id,publication_id,amount_ore,reason,created_by,request_id,payload) values(p_company,closed.id,p_publication,p_amount::bigint,p_reason,actor,p_request,payload) returning * into r;
 end if;
 return jsonb_build_object('page',private.advertising_corrections_read(p_company,p_month,true),'receipt',jsonb_build_object('id',r.id,'companyId',r.company_id,'actorUserId',actor,'requestId',r.request_id,'lockId',r.period_id,'publicationId',r.publication_id,'amountOre',r.amount_ore::text,'reason',r.reason));
end $$;
revoke all on function private.create_advertising_reduction(uuid,text,uuid,text,text,text,boolean,uuid) from public,anon,service_role;
grant execute on function private.create_advertising_reduction(uuid,text,uuid,text,text,text,boolean,uuid) to authenticated;
commit;
