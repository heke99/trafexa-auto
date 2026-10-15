begin;
create function private.advertising_issuance_page(p_company uuid,p_month text,p_assessment uuid,p_platform boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare mr text;detail jsonb;a jsonb;r private.advertising_invoice_series;i private.advertising_issued_invoices;series jsonb:=null;invoice jsonb:=null;preview jsonb:=null;blockers jsonb:='[]';day date;yr integer;rows integer;unsupported boolean;outdated boolean;
begin
 mr:=private.advertising_invoice_context(p_company,p_platform);day:=(clock_timestamp() at time zone 'Europe/Stockholm')::date;yr:=extract(year from day)::integer;
 detail:=private.get_advertising_financial_assessment(p_company,p_assessment,p_platform);a:=detail->'assessment';outdated:=(detail->>'isOutdated')::boolean;
 if p_month is null or a->>'month'<>p_month then raise exception 'Wrong invoice period' using errcode='22023';end if;
 rows:=jsonb_array_length(a->'snapshot'->'draft'->'snapshot'->'basis'->'original'->'items');
 unsupported:=exists(select 1 from (select value from jsonb_each_text(a->'snapshot'->'draft'->'snapshot'->'buyerProfile'->'fields') union all select value from jsonb_each_text(a->'snapshot'->'draft'->'snapshot'->'sellerProfile'->'fields')) t where value is not null and not private.advertising_issued_text_supported(value));
 select * into i from private.advertising_issued_invoices where company_id=p_company and month=p_month;
 if found then invoice:=jsonb_build_object('id',i.id,'createdAt',i.created_at,'invoiceNumber',i.invoice_number,'invoiceDate',i.invoice_date,'dueDate',i.due_date,'sourceHash',i.source_hash,'assessmentId',i.assessment_id,'isSourceOutdated',private.advertising_issued_source_outdated(i,p_platform));end if;
 if outdated then blockers:=blockers||'["assessment.outdated"]'::jsonb;end if;
 if invoice is not null then blockers:=blockers||'["invoice.exists"]'::jsonb;end if;
 if rows=0 then blockers:=blockers||'["serviceDates.empty"]'::jsonb;end if;
 if mr='platform_admin' then
  select * into r from private.advertising_invoice_series where seller_organisation_number=a->'snapshot'->'draft'->'snapshot'->'sellerProfile'->'fields'->>'organisationNumber' and year=yr;
  if not found then blockers:=blockers||'["series.unconfigured"]'::jsonb;
  else
   series:=private.advertising_invoice_series_json(r);
   if (series->>'nextNumber')::integer>999999999 then blockers:=blockers||'["series.exhausted"]'::jsonb;end if;
   if not private.advertising_issued_text_supported(r.seller_registered_seat) then unsupported:=true;end if;
  end if;
 else blockers:=blockers||'["issuance.adminOnly"]'::jsonb;end if;
 if unsupported then blockers:=blockers||'["pdf.unsupported_text"]'::jsonb;end if;
 if (a->'snapshot'->>'vatTotalOre')::numeric<>trunc(((a->'snapshot'->>'netTotalOre')::numeric*25+50)/100) then blockers:=blockers||'["vat.roundingMismatch"]'::jsonb;end if;
 if blockers='[]'::jsonb then preview:=private.advertising_issuance_preview(p_company,a,series,day);end if;
 return jsonb_build_object('companyId',p_company,'actorUserId',auth.uid(),'actorRole',mr,'month',p_month,'currentYear',yr,'businessDate',day,'assessment',a,'isOutdated',outdated,'series',series,'invoice',invoice,'preview',preview,'blockers',blockers,'canConfigureSeries',mr='platform_admin' and series is null and not outdated and rows>0,'canIssue',blockers='[]'::jsonb);
end $$;
create function private.get_advertising_issued_invoice(p_company uuid,p_id uuid,p_platform boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare mr text;r private.advertising_issued_invoices;begin
 mr:=private.advertising_invoice_context(p_company,p_platform);select * into r from private.advertising_issued_invoices where company_id=p_company and id=p_id;
 if not found then raise exception 'Issued invoice missing' using errcode='42501';end if;
 return jsonb_build_object('companyId',p_company,'actorUserId',auth.uid(),'actorRole',mr,'invoice',private.advertising_issued_invoice_json(r),'isSourceOutdated',private.advertising_issued_source_outdated(r,p_platform));
end $$;
revoke all on function private.advertising_issuance_page(uuid,text,uuid,boolean),private.get_advertising_issued_invoice(uuid,uuid,boolean) from public,anon,service_role;
grant execute on function private.advertising_issuance_page(uuid,text,uuid,boolean),private.get_advertising_issued_invoice(uuid,uuid,boolean) to authenticated;
commit;
