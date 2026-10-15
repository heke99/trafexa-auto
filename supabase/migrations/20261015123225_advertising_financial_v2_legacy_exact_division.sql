begin;
create or replace function private.advertising_financial_preview(p_draft jsonb,p_fields jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare source jsonb:=p_draft->'snapshot';b jsonb;s jsonb;item jsonb;lines jsonb:='[]';blockers jsonb:='[]';v text;vat_ready boolean;original numeric;reduction numeric;net numeric;tax numeric;gross numeric;net_total numeric:=0;tax_total numeric:=0;gross_total numeric:=0;
begin
 b:=source->'buyerProfile';s:=source->'sellerProfile';
 for v in select jsonb_array_elements_text(b->'missingFields') loop blockers:=blockers||jsonb_build_array('buyer.'||v);end loop;
 for v in select jsonb_array_elements_text(s->'missingFields') loop blockers:=blockers||jsonb_build_array('seller.'||v);end loop;
 if p_fields->>'vatTreatment'<>'se_standard_25' then blockers:=blockers||'["vatTreatment"]'::jsonb;end if;
 if p_fields->>'sellerVatRegistered' is distinct from 'true' then blockers:=blockers||'["sellerVatRegistered"]'::jsonb;end if;
 if p_fields->>'sellerVatNumber' is null or p_fields->>'sellerVatNumber'<>'SE'||coalesce(s->'fields'->>'organisationNumber','')||'01' then blockers:=blockers||'["sellerVatNumber"]'::jsonb;end if;
 if b->'fields'->>'countryCode' is distinct from 'SE' or s->'fields'->>'countryCode' is distinct from 'SE' then blockers:=blockers||'["vat.domesticCountry"]'::jsonb;end if;
 if p_fields->>'paymentDays' is null then blockers:=blockers||'["paymentDays"]'::jsonb;end if;
 if p_fields->>'paymentMethod'='unresolved' then blockers:=blockers||'["paymentMethod"]'::jsonb;
 elsif not private.advertising_financial_account(p_fields->>'paymentMethod',p_fields->>'paymentAccount') then blockers:=blockers||'["paymentAccount"]'::jsonb;end if;
 if coalesce(length(p_fields->>'reason'),0)=0 then blockers:=blockers||'["settings.reason"]'::jsonb;end if;
 vat_ready:=p_fields->>'vatTreatment'='se_standard_25' and p_fields->>'sellerVatRegistered'='true' and p_fields->>'sellerVatNumber'='SE'||coalesce(s->'fields'->>'organisationNumber','')||'01' and b->'fields'->>'countryCode'='SE' and s->'fields'->>'countryCode'='SE';
 vat_ready:=coalesce(vat_ready,false);
 for item in select value from jsonb_array_elements(source->'basis'->'original'->'items') loop
  original:=(item->>'unitPriceOre')::numeric;
  select coalesce(sum((x->>'amountOre')::numeric),0) into reduction from jsonb_array_elements(source->'basis'->'adjustments') x where x->>'publicationId'=item->>'publicationId';
  net:=original-reduction;if net<0 or net>9223372036854775807 then raise exception 'Invalid net amount' using errcode='22023';end if;
  if vat_ready then tax:=div(net*25+50,100);gross:=net+tax;if gross>9223372036854775807 then raise exception 'Financial row overflow' using errcode='22023';end if;else tax:=null;gross:=null;end if;
  net_total:=net_total+net;tax_total:=tax_total+coalesce(tax,0);gross_total:=gross_total+coalesce(gross,0);
  lines:=lines||jsonb_build_array(jsonb_build_object('publicationId',item->'publicationId','listingId',item->'listingId','channel',item->'channel','originalOre',original::text,'reductionOre',reduction::text,'netOre',net::text,'vatOre',tax::text,'grossOre',gross::text));
 end loop;
 if net_total<>(source->'basis'->>'netTotalOre')::numeric or net_total>9223372036854775807 or tax_total>9223372036854775807 or gross_total>9223372036854775807 then raise exception 'Financial total overflow' using errcode='22023';end if;
 return jsonb_build_object('lines',lines,'netTotalOre',net_total::text,'vatTotalOre',case when vat_ready then tax_total::text else null end,'grossTotalOre',case when vat_ready then gross_total::text else null end,'blockers',blockers);
end $$;
revoke all on function private.advertising_financial_preview(jsonb,jsonb) from public,anon,authenticated,service_role;
commit;
