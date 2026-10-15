begin;
create function private.advertising_credit_page(p_company uuid,p_original uuid,p_platform boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare mr text;o private.advertising_issued_invoices;c private.advertising_credit_invoices;r private.advertising_invoice_series;series jsonb:=null;credit jsonb:=null;preview jsonb:=null;blockers jsonb:='[]';day date;yr integer;original jsonb;
begin
 mr:=private.advertising_invoice_context(p_company,p_platform);day:=(clock_timestamp() at time zone 'Europe/Stockholm')::date;yr:=extract(year from day)::integer;
 select * into o from private.advertising_issued_invoices where company_id=p_company and id=p_original;
 if not found then raise exception 'Original invoice missing' using errcode='42501';end if;
 original:=private.advertising_issued_invoice_json(o);
 select * into c from private.advertising_credit_invoices where company_id=p_company and original_invoice_id=p_original;
 if found then credit:=private.advertising_credit_json(c);blockers:=blockers||'["credit.exists"]'::jsonb;end if;
 if (o.snapshot->>'grossTotalOre')::numeric=0 then blockers:=blockers||'["credit.zeroAmount"]'::jsonb;end if;
 if mr='platform_admin' then
  select * into r from private.advertising_invoice_series where seller_organisation_number=o.snapshot->'series'->>'sellerOrganisationNumber' and year=yr;
  if not found then blockers:=blockers||'["series.unconfigured"]'::jsonb;
  else series:=private.advertising_invoice_series_json(r);if (series->>'nextNumber')::integer>999999999 then blockers:=blockers||'["series.exhausted"]'::jsonb;end if;end if;
 else blockers:=blockers||'["credit.adminOnly"]'::jsonb;end if;
 if o.invoice_date>day then blockers:=blockers||'["credit.dateBeforeOriginal"]'::jsonb;end if;
 if blockers='[]'::jsonb then preview:=private.advertising_credit_preview(p_company,original,series,day);end if;
 return jsonb_build_object('companyId',p_company,'actorUserId',auth.uid(),'actorRole',mr,'businessDate',day,'currentYear',yr,'originalInvoice',original,'series',series,'credit',credit,'preview',preview,'blockers',blockers,'canConfigureSeries',mr='platform_admin' and series is null and credit is null and (o.snapshot->>'grossTotalOre')::numeric>0 and o.invoice_date<=day,'canCredit',blockers='[]'::jsonb);
end $$;
create function private.get_advertising_credit_invoice(p_company uuid,p_id uuid,p_platform boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare mr text;r private.advertising_credit_invoices;begin
 mr:=private.advertising_invoice_context(p_company,p_platform);select * into r from private.advertising_credit_invoices where company_id=p_company and id=p_id;
 if not found then raise exception 'Credit invoice missing' using errcode='42501';end if;
 return jsonb_build_object('companyId',p_company,'actorUserId',auth.uid(),'actorRole',mr,'credit',private.advertising_credit_json(r));
end $$;
revoke all on function private.advertising_credit_page(uuid,uuid,boolean),private.get_advertising_credit_invoice(uuid,uuid,boolean) from public,anon,service_role;
grant execute on function private.advertising_credit_page(uuid,uuid,boolean),private.get_advertising_credit_invoice(uuid,uuid,boolean) to authenticated;
commit;
