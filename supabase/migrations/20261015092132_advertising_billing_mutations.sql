begin;
create function private.save_advertising_channel_rate(p_company uuid,p_channel text,p_unit text,p_expected integer,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();existing private.advertising_channel_rates;r private.advertising_channel_rates;v integer;payload jsonb;
begin
 perform private.advertising_billing_context(p_company,true);
 if p_channel is null or p_channel not in ('blocket','wayke') or p_unit is null or p_unit !~ '^(0|[1-9][0-9]{0,18})$' or p_unit::numeric>9223372036854775807 or p_expected is null or p_expected<0 or p_expected>=2147483647 or p_request is null then raise exception 'Invalid rate' using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company,'channel',p_channel,'unitPriceOre',p_unit,'expectedVersion',p_expected);
 select * into existing from private.advertising_channel_rates where created_by=actor and request_id=p_request;
 if found then
  if existing.payload<>payload then raise exception 'Request reused' using errcode='40001';end if;r:=existing;
 else
  select coalesce(max(version),0) into v from private.advertising_channel_rates where company_id=p_company and channel=p_channel;
  if v<>p_expected then raise exception 'Rate changed' using errcode='40001';end if;
  insert into private.advertising_channel_rates(company_id,channel,version,unit_price_ore,created_by,request_id,payload) values(p_company,p_channel,v+1,p_unit::bigint,actor,p_request,payload) returning * into r;
 end if;
 return jsonb_build_object('companyId',r.company_id,'actorUserId',actor,'requestId',r.request_id,'id',r.id,'channel',r.channel,'version',r.version,'unitPriceOre',r.unit_price_ore::text,'effectiveAt',r.effective_at);
end $$;
create function private.reconcile_advertising_billing(p_company uuid,p_month text,p_channel text,p_unit text,p_token text,p_reason text,p_review boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();existing private.advertising_billing_reviews;page jsonb;payload jsonb;ids uuid[];ps timestamptz;pe timestamptz;
begin
 perform private.advertising_billing_context(p_company,true);
 if p_channel is null or p_channel not in ('blocket','wayke') or p_unit is null or p_unit !~ '^(0|[1-9][0-9]{0,18})$' or p_unit::numeric>9223372036854775807 or p_month is null or p_month !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' or p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_review is distinct from true or p_request is null or p_reason is null or length(p_reason) not between 1 and 500 or p_reason<>btrim(p_reason) or p_reason ~ '[[:cntrl:]]' then raise exception 'Invalid reconciliation' using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company,'month',p_month,'channel',p_channel,'unitPriceOre',p_unit,'expectedReviewToken',p_token,'reason',p_reason,'reviewAcknowledged',p_review);
 select * into existing from private.advertising_billing_reviews where actor_user_id=actor and request_id=p_request;
 if found then
  if existing.payload<>payload then raise exception 'Request reused' using errcode='40001';end if;
  return private.advertising_billing_read(p_company,p_month,true);
 end if;
 page:=private.advertising_billing_read(p_company,p_month,true);
 if page->>'reviewToken'<>p_token or page->'locked'<>'null'::jsonb then raise exception 'Period changed or locked' using errcode='40001';end if;
 ps:=(page->>'periodStart')::timestamptz;pe:=(page->>'periodEnd')::timestamptz;
 select array_agg(p.id order by p.id) into ids from private.advertising_publications p left join private.advertising_publication_prices pp on pp.publication_id=p.id where p.company_id=p_company and p.channel=p_channel and p.first_published_at>=ps and p.first_published_at<pe and pp.publication_id is null;
 if coalesce(cardinality(ids),0)=0 then raise exception 'No unpriced publications' using errcode='40001';end if;
 insert into private.advertising_publication_prices(publication_id,unit_price_ore,source,created_by,reason) select unnest(ids),p_unit::bigint,'review',actor,p_reason;
 insert into private.advertising_billing_reviews(company_id,month,channel,actor_user_id,request_id,payload,publication_ids) values(p_company,p_month,p_channel,actor,p_request,payload,ids);
 return private.advertising_billing_read(p_company,p_month,true);
end $$;
revoke all on function private.save_advertising_channel_rate(uuid,text,text,integer,uuid),private.reconcile_advertising_billing(uuid,text,text,text,text,text,boolean,uuid) from public,anon,service_role;
grant execute on function private.save_advertising_channel_rate(uuid,text,text,integer,uuid),private.reconcile_advertising_billing(uuid,text,text,text,text,text,boolean,uuid) to authenticated;
commit;
