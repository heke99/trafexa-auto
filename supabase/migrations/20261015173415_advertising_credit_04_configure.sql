begin;
create function private.configure_advertising_credit_series(p_company uuid,p_original uuid,p_hash text,p_year integer,p_prefix text,p_first text,p_seat text,p_reason text,p_review boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();r private.advertising_invoice_series;o private.advertising_issued_invoices;payload jsonb;config jsonb;series_id uuid;org text;yr integer;
begin
 perform private.advertising_invoice_context(p_company,true);
 if p_original is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_year is null or p_prefix is null or p_prefix !~ '^[A-Z0-9]{2,12}$' or p_first is null or p_first !~ '^[1-9][0-9]{0,8}$' or p_seat is null or length(p_seat) not between 1 and 160 or p_seat<>btrim(p_seat) or p_reason is null or length(p_reason) not between 1 and 500 or p_reason<>btrim(p_reason) or (p_seat||p_reason) ~ '[[:cntrl:]]' or (p_seat||p_reason) ~ ('['||chr(128)||'-'||chr(159)||']') or not private.advertising_issued_text_supported(p_seat) or p_review is distinct from true or p_request is null then raise exception 'Invalid credit series configuration' using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company,'originalInvoiceId',p_original,'expectedOriginalSourceHash',p_hash,'year',p_year,'prefix',p_prefix,'firstNumber',p_first,'sellerRegisteredSeat',p_seat,'reason',p_reason,'reviewAcknowledged',p_review);
 select * into r from private.advertising_invoice_series where configured_by=actor and request_id=p_request;
 if found then if r.payload<>payload then raise exception 'Series request reused' using errcode='40001';end if;
 else
  select * into o from private.advertising_issued_invoices where id=p_original and company_id=p_company;
  if not found then raise exception 'Original invoice missing' using errcode='42501';end if;
  if o.source_hash<>p_hash then raise exception 'Original source changed' using errcode='40001';end if;
  yr:=extract(year from clock_timestamp() at time zone 'Europe/Stockholm')::integer;
  if p_year<>yr or o.invoice_date>(clock_timestamp() at time zone 'Europe/Stockholm')::date or (o.snapshot->>'grossTotalOre')::numeric=0 or exists(select 1 from private.advertising_credit_invoices where original_invoice_id=p_original) then raise exception 'Current credit year and uncredited invoice required' using errcode='22023';end if;
  org:=o.snapshot->'series'->>'sellerOrganisationNumber';
  if exists(select 1 from private.advertising_invoice_series where (seller_organisation_number=org and year=p_year) or (prefix=p_prefix and year=p_year)) then raise exception 'Invoice series already configured' using errcode='40001';end if;
  series_id:=gen_random_uuid();config:=jsonb_build_object('id',series_id,'sellerOrganisationNumber',org,'year',p_year,'prefix',p_prefix,'firstNumber',p_first,'sellerRegisteredSeat',p_seat);
  insert into private.advertising_invoice_series(id,seller_organisation_number,year,prefix,first_number,seller_registered_seat,reason,configuration,canonical_configuration,configuration_hash,configured_by,company_id,request_id,payload) values(series_id,org,p_year,p_prefix,p_first::integer,p_seat,p_reason,config,config::text,encode(sha256(convert_to(config::text,'UTF8')),'hex'),actor,p_company,p_request,payload) returning * into r;
  insert into private.advertising_invoice_counters(series_id,next_number) values(r.id,r.first_number);
 end if;
 return jsonb_build_object('series',private.advertising_invoice_series_json(r),'receipt',jsonb_build_object('seriesId',r.id,'companyId',p_company,'actorUserId',actor,'requestId',p_request,'originalInvoiceId',p_original,'originalSourceHash',p_hash,'configurationHash',r.configuration_hash));
end $$;
revoke all on function private.configure_advertising_credit_series(uuid,uuid,text,integer,text,text,text,text,boolean,uuid) from public,anon,service_role;
grant execute on function private.configure_advertising_credit_series(uuid,uuid,text,integer,text,text,text,text,boolean,uuid) to authenticated;
commit;
