begin;
-- Explicitly reviewed store fees are genuine services, never synthetic publications.
create table private.advertising_store_fees (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 store_id uuid not null, period_id uuid not null, program_version integer not null,
 month text not null check(month ~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$'),
 service_date date not null, amount_ore bigint not null check(amount_ore>=0),
 program_monthly_fee_ore bigint not null check(program_monthly_fee_ore>=0), amount_override_acknowledged boolean not null,
 store_name text not null, agreement_reference text not null, reason text not null,
 program_basis jsonb not null, program_review_token text not null,
 reviewed_by uuid not null references auth.users(id), reviewed_at timestamptz not null default clock_timestamp(),
 request_id uuid not null, payload jsonb not null,
 foreign key(store_id,period_id,program_version) references private.advertising_program_revisions(store_id,period_id,version),
 unique(store_id,month,program_review_token), unique(reviewed_by,request_id)
);
alter table private.advertising_store_fees enable row level security;
revoke all on private.advertising_store_fees from public,anon,authenticated,service_role;
create trigger immutable_advertising_store_fee before update or delete on private.advertising_store_fees for each row execute function private.advertising_immutable();
create function private.advertising_store_fee_json(f private.advertising_store_fees) returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('feeId',f.id,'storeId',f.store_id,'storeName',f.store_name,'periodId',f.period_id,'programVersion',f.program_version,'agreementReference',f.agreement_reference,'serviceDate',f.service_date,'unitPriceOre',f.amount_ore::text,'reason',f.reason,'programMonthlyFeeOre',f.program_monthly_fee_ore::text,'amountOverrideAcknowledged',f.amount_override_acknowledged,'programBasis',f.program_basis,'programReviewToken',f.program_review_token);
$$;
create function private.advertising_store_month_program_basis(p_company uuid,p_store uuid,p_month text) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('periodId',r.period_id,'version',r.version,'agreementReference',r.agreement_reference,'confirmedStart',r.confirmed_start,'confirmedEnd',r.confirmed_end,'contractEnd',r.contract_end,'monthlyFeeOre',r.monthly_fee_ore::text,'partialMonthRule',r.partial_month_rule) order by r.period_id),'[]'::jsonb)
 from private.advertising_program_stores s join (select distinct on(store_id,period_id) * from private.advertising_program_revisions order by store_id,period_id,version desc) r on r.store_id=s.id
 where s.company_id=p_company and s.id=p_store and not r.cancelled and coalesce(r.confirmed_start,r.desired_start)<((p_month||'-01')::date+interval '1 month')::date and coalesce(r.confirmed_end,'infinity'::date)>(p_month||'-01')::date;
$$;
revoke all on function private.advertising_store_month_program_basis(uuid,uuid,text) from public,anon,authenticated,service_role;
create function private.review_advertising_store_fee(p_company_id uuid,p_store_id uuid,p_month text,p_period_id uuid,p_program_version integer,p_amount_ore text,p_service_date date,p_reason text,p_review_acknowledged boolean,p_request_id uuid,p_amount_override_acknowledged boolean default false,p_expected_program_review_token text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();r private.advertising_program_revisions;s private.advertising_program_stores;f private.advertising_store_fees;payload jsonb;ms date;me date;partial boolean;basis jsonb;basis_token text;b jsonb;corrective_zero boolean;
begin
 perform private.advertising_billing_context(p_company_id,true);
 if p_month is null or p_month !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' or p_request_id is null or p_amount_override_acknowledged is null or p_review_acknowledged is distinct from true or p_amount_ore is null or p_amount_ore !~ '^(0|[1-9][0-9]{0,18})$' or p_amount_ore::numeric>9223372036854775807 or p_reason is null or p_reason<>btrim(p_reason) or length(p_reason) not between 1 and 500 or p_reason ~ '[[:cntrl:]]' or not private.advertising_issued_text_supported(p_reason) then raise exception 'Explicit valid store fee review required' using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company_id,'storeId',p_store_id,'month',p_month,'periodId',p_period_id,'programVersion',p_program_version,'amountOre',p_amount_ore,'serviceDate',p_service_date,'reason',p_reason,'reviewAcknowledged',p_review_acknowledged,'amountOverrideAcknowledged',p_amount_override_acknowledged,'expectedProgramReviewToken',p_expected_program_review_token);
 select * into f from private.advertising_store_fees where reviewed_by=actor and request_id=p_request_id;
 if found then if f.payload<>payload then raise exception 'Store fee request reused' using errcode='40001';end if;return private.advertising_store_fee_json(f);end if;
 if exists(select 1 from private.advertising_billing_periods where company_id=p_company_id and month=p_month) then raise exception 'Billing period is locked' using errcode='40001';end if;
 select * into s from private.advertising_program_stores where id=p_store_id and company_id=p_company_id for share;
 if not found then raise exception 'Store unavailable' using errcode='42501';end if;
 select * into r from private.advertising_program_revisions where store_id=p_store_id and period_id=p_period_id order by version desc limit 1;
 if not found or r.version is distinct from p_program_version then raise exception 'Program review changed' using errcode='40001';end if;
 ms:=(p_month||'-01')::date;me:=(ms+interval '1 month')::date;
 basis:=private.advertising_store_month_program_basis(p_company_id,p_store_id,p_month);basis_token:=encode(sha256(convert_to(basis::text,'UTF8')),'hex');
 corrective_zero:=basis='[]'::jsonb and p_amount_ore='0' and p_amount_override_acknowledged and p_expected_program_review_token is not null and r.period_id=(select z.period_id from private.advertising_store_fees z where z.store_id=p_store_id and z.month=p_month order by z.reviewed_at desc,z.id desc limit 1);
 corrective_zero:=coalesce(corrective_zero,false);
 if p_service_date is null or p_service_date<ms or p_service_date>=me or r.monthly_fee_ore is null or (not corrective_zero and (r.cancelled or r.confirmed_start is null or r.confirmed_start>=me or coalesce(r.confirmed_end,'infinity'::date)<=ms)) then raise exception 'Confirmed priced program and service date required' using errcode='22023';end if;
 if basis='[]'::jsonb and not corrective_zero then raise exception 'An excluded monthly period only permits an explicit corrective zero decision' using errcode='22023';end if;
 if p_expected_program_review_token is not null and p_expected_program_review_token<>basis_token then raise exception 'Monthly program basis changed' using errcode='40001';end if;
 if (jsonb_array_length(basis)>1 or p_amount_override_acknowledged) and p_expected_program_review_token is null then raise exception 'Explicit complete monthly program review required' using errcode='22023';end if;
 if jsonb_array_length(basis)>1 and not p_amount_override_acknowledged then raise exception 'Multiple program periods require an explicit monthly fee decision' using errcode='22023';end if;
 for b in select value from jsonb_array_elements(basis) loop
  if b->>'confirmedStart' is null or b->>'monthlyFeeOre' is null then raise exception 'Every monthly program period needs confirmed start and customer fee' using errcode='22023';end if;
  if ((b->>'confirmedStart')::date>ms or coalesce((b->>'confirmedEnd')::date,(b->>'contractEnd')::date,'infinity'::date)<me) and b->>'partialMonthRule' is null then raise exception 'Partial month rule requires a decision before fee review' using errcode='22023';end if;
  if b->>'contractEnd' is not null and (b->>'contractEnd')::date<me and b->>'confirmedEnd' is null and not p_amount_override_acknowledged then raise exception 'Unconfirmed program end requires an explicit monthly fee decision' using errcode='22023';end if;
 end loop;
 if not corrective_zero and not exists(select 1 from jsonb_array_elements(basis) x where (x->>'confirmedStart')::date<=p_service_date and coalesce((x->>'confirmedEnd')::date,'infinity'::date)>p_service_date) then raise exception 'Service date must belong to a confirmed program period' using errcode='22023';end if;
 partial:=r.confirmed_start>ms or coalesce(r.confirmed_end,r.contract_end,'infinity'::date)<me;
 if not corrective_zero and partial and r.partial_month_rule is null then raise exception 'Partial month rule requires a decision before fee review' using errcode='22023';end if;
 if not p_amount_override_acknowledged and (p_amount_ore::numeric>r.monthly_fee_ore or ((not partial or r.partial_month_rule='full') and p_amount_ore::numeric<>r.monthly_fee_ore)) then raise exception 'Fee amount does not match the reviewed program rule' using errcode='22023';end if;
 if exists(select 1 from private.advertising_store_fees where store_id=p_store_id and month=p_month and program_review_token=basis_token) then raise exception 'Store fee already reviewed for this program revision and month' using errcode='40001';end if;
 insert into private.advertising_store_fees(company_id,store_id,period_id,program_version,month,program_basis,program_review_token,service_date,amount_ore,program_monthly_fee_ore,amount_override_acknowledged,store_name,agreement_reference,reason,reviewed_by,request_id,payload) values(p_company_id,p_store_id,p_period_id,p_program_version,p_month,basis,basis_token,p_service_date,p_amount_ore::bigint,r.monthly_fee_ore,p_amount_override_acknowledged,s.store_name,r.agreement_reference,p_reason,actor,p_request_id,payload) returning * into f;
 return private.advertising_store_fee_json(f);
end $$;
create function public.review_advertising_store_fee(p_company_id uuid,p_store_id uuid,p_month text,p_period_id uuid,p_program_version integer,p_amount_ore text,p_service_date date,p_reason text,p_review_acknowledged boolean,p_request_id uuid,p_amount_override_acknowledged boolean default false,p_expected_program_review_token text default null) returns jsonb language sql security invoker set search_path='' as $$select private.review_advertising_store_fee(p_company_id,p_store_id,p_month,p_period_id,p_program_version,p_amount_ore,p_service_date,p_reason,p_review_acknowledged,p_request_id,p_amount_override_acknowledged,p_expected_program_review_token);$$;
revoke all on function private.advertising_store_fee_json(private.advertising_store_fees) from public,anon,authenticated,service_role;
revoke all on function private.review_advertising_store_fee(uuid,uuid,text,uuid,integer,text,date,text,boolean,uuid,boolean,text),public.review_advertising_store_fee(uuid,uuid,text,uuid,integer,text,date,text,boolean,uuid,boolean,text) from public,anon,service_role;
grant execute on function private.review_advertising_store_fee(uuid,uuid,text,uuid,integer,text,date,text,boolean,uuid,boolean,text),public.review_advertising_store_fee(uuid,uuid,text,uuid,integer,text,date,text,boolean,uuid,boolean,text) to authenticated;
create or replace function private.advertising_billing_read(p_company uuid,p_month text,p_platform boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare mr text;ps timestamptz;pe timestamptz;tracking timestamptz;items jsonb;rates jsonb;total numeric;n bigint;unpriced bigint;snapshot jsonb;token text;closed private.advertising_billing_periods;fees jsonb;candidates jsonb;fee_total numeric;fee_required boolean;
begin
 mr:=private.advertising_billing_context(p_company,p_platform);
 if p_month is null or p_month !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' then raise exception 'Invalid month' using errcode='22023';end if;
 ps:=(p_month||'-01')::date::timestamp at time zone 'Europe/Stockholm';
 pe:=((p_month||'-01')::date+interval '1 month')::timestamp at time zone 'Europe/Stockholm';
 select started_at into tracking from private.advertising_usage_tracking;
 select count(*),count(*) filter(where pp.publication_id is null),coalesce(sum(pp.unit_price_ore::numeric),0) into n,unpriced,total
 from private.advertising_publications p left join private.advertising_publication_prices pp on pp.publication_id=p.id where p.company_id=p_company and p.first_published_at>=ps and p.first_published_at<pe;
 if n>2000 or total>9223372036854775807 then raise exception 'Billing period too large' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('publicationId',p.id,'listingId',p.listing_id,'channel',p.channel,'publishedAt',p.first_published_at,'unitPriceOre',pp.unit_price_ore::text,'priceSource',pp.source,'rateVersion',r.version)||case when pp.source='program' then jsonb_build_object('program',jsonb_build_object('storeId',pp.program_store_id,'storeName',st.store_name,'periodId',pp.program_period_id,'version',pp.program_version,'agreementReference',pr.agreement_reference)) else '{}'::jsonb end order by p.first_published_at,p.id),'[]') into items
 from private.advertising_publications p left join private.advertising_publication_prices pp on pp.publication_id=p.id left join private.advertising_channel_rates r on r.id=pp.rate_id
 left join private.advertising_program_stores st on st.id=pp.program_store_id left join private.advertising_program_revisions pr on pr.store_id=pp.program_store_id and pr.period_id=pp.program_period_id and pr.version=pp.program_version
 where p.company_id=p_company and p.first_published_at>=ps and p.first_published_at<pe;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'channel',r.channel,'version',r.version,'unitPriceOre',r.unit_price_ore::text,'effectiveAt',r.effective_at) order by r.channel),'[]') into rates from (select distinct on(channel) * from private.advertising_channel_rates where company_id=p_company order by channel,version desc) r;
 snapshot:=jsonb_build_object('companyId',p_company,'month',p_month,'periodStart',ps,'periodEnd',pe,'trackingStartedAt',tracking,'coverage',case when tracking<=ps then 'full' else 'partial' end,'items',items,'count',n,'unpricedCount',unpriced,'totalOre',case when unpriced=0 then total::text else null end,'legacyPublishedJobs',(select coalesce(sum(initial_job_count),0) from private.advertising_legacy_publications where company_id=p_company));
 select coalesce(jsonb_agg(private.advertising_store_fee_json(f) order by f.store_id),'[]'::jsonb),coalesce(sum(f.amount_ore::numeric),0) into fees,fee_total from (select distinct on(store_id) * from private.advertising_store_fees where company_id=p_company and month=p_month order by store_id,reviewed_at desc,id desc) f;
 if n+jsonb_array_length(fees)>2000 or total+fee_total>9223372036854775807 then raise exception 'Billing period too large' using errcode='22023';end if;
 if fees<>'[]'::jsonb then snapshot:=snapshot||jsonb_build_object('storeFees',fees,'totalOre',case when unpriced=0 then (total+fee_total)::text else null end);end if;
 select coalesce(jsonb_agg(jsonb_build_object('storeId',s.id,'storeName',s.store_name,'periodId',r.period_id,'programVersion',r.version,'agreementReference',r.agreement_reference,'monthlyFeeOre',r.monthly_fee_ore::text,'partialMonthRule',r.partial_month_rule,'confirmedStart',r.confirmed_start,'confirmedEnd',r.confirmed_end,'programPeriods',private.advertising_store_month_program_basis(p_company,s.id,p_month),'programReviewToken',encode(sha256(convert_to(private.advertising_store_month_program_basis(p_company,s.id,p_month)::text,'UTF8')),'hex'),'reviewed',exists(select 1 from private.advertising_store_fees f where f.id=(select z.id from private.advertising_store_fees z where z.store_id=s.id and z.month=p_month order by z.reviewed_at desc,z.id desc limit 1) and f.program_review_token=encode(sha256(convert_to(private.advertising_store_month_program_basis(p_company,s.id,p_month)::text,'UTF8')),'hex'))) order by s.id,r.period_id),'[]'::jsonb) into candidates
 from private.advertising_program_stores s join (select distinct on(store_id,period_id) * from private.advertising_program_revisions order by store_id,period_id,version desc) r on r.store_id=s.id
 where s.company_id=p_company and ((not r.cancelled and coalesce(r.confirmed_start,r.desired_start)<((p_month||'-01')::date+interval '1 month')::date and coalesce(r.confirmed_end,'infinity'::date)>(p_month||'-01')::date)
 or (private.advertising_store_month_program_basis(p_company,s.id,p_month)='[]'::jsonb and r.period_id=(select z.period_id from private.advertising_store_fees z where z.store_id=s.id and z.month=p_month order by z.reviewed_at desc,z.id desc limit 1)));
 fee_required:=exists(select 1 from jsonb_array_elements(candidates)c where c->>'reviewed'='false');
 token:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
 select * into closed from private.advertising_billing_periods where company_id=p_company and month=p_month;
 return snapshot||jsonb_build_object('actorUserId',auth.uid(),'actorRole',mr,'ended',clock_timestamp()>=pe,'rates',rates,'reviewToken',token,'hasChangesSinceLock',closed.id is not null and closed.review_token<>token,'storeFeeCandidates',candidates,'feeReviewRequired',fee_required,
 'locked',case when closed.id is null then null else jsonb_build_object('id',closed.id,'lockedAt',closed.locked_at,'totalOre',closed.snapshot->'totalOre','count',closed.snapshot->'count','items',closed.snapshot->'items','reviewToken',closed.review_token,'partialCoverageAcknowledged',closed.partial_coverage_acknowledged,'companyId',closed.snapshot->'companyId','month',closed.snapshot->'month','periodStart',closed.snapshot->'periodStart','periodEnd',closed.snapshot->'periodEnd','trackingStartedAt',closed.snapshot->'trackingStartedAt','coverage',closed.snapshot->'coverage','legacyPublishedJobs',closed.snapshot->'legacyPublishedJobs','canonicalSnapshot',closed.canonical_snapshot)||case when closed.snapshot ? 'storeFees' then jsonb_build_object('storeFees',closed.snapshot->'storeFees') else '{}'::jsonb end end);
end $$;
create or replace function private.lock_advertising_billing_period(p_company uuid,p_month text,p_token text,p_review boolean,p_partial boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if coalesce((page->>'feeReviewRequired')::boolean,false) then raise exception 'Review the monthly store fees before closing this period' using errcode='22023';end if;
 if (page->>'ended')::boolean is distinct from true or (page->>'trackingStartedAt')::timestamptz>=(page->>'periodEnd')::timestamptz or (page->>'unpricedCount')::bigint<>0 or (page->>'coverage'='partial' and not p_partial) then raise exception 'Period cannot close' using errcode='22023';end if;
 snapshot:=page-array['actorUserId','actorRole','ended','rates','reviewToken','locked','hasChangesSinceLock','storeFeeCandidates','feeReviewRequired'];
 insert into private.advertising_billing_periods(company_id,month,snapshot,canonical_snapshot,review_token,partial_coverage_acknowledged,locked_by,request_id,payload) values(p_company,p_month,snapshot,snapshot::text,p_token,p_partial,actor,p_request,payload);
 return private.advertising_billing_read(p_company,p_month,true);
end $$;
revoke all on function private.lock_advertising_billing_period(uuid,text,text,boolean,boolean,uuid) from public,anon,service_role;
grant execute on function private.lock_advertising_billing_period(uuid,text,text,boolean,boolean,uuid) to authenticated;
create or replace function private.advertising_corrections_read(p_company uuid,p_month text,p_platform boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare mr text;closed private.advertising_billing_periods;original jsonb:=null;adjustments jsonb:='[]';snapshot jsonb;total numeric:=0;n bigint;
begin
 mr:=private.advertising_billing_context(p_company,p_platform);
 if p_month is null or p_month !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' then raise exception 'Invalid month' using errcode='22023';end if;
 select * into closed from private.advertising_billing_periods where company_id=p_company and month=p_month;
 if found then
  original:=jsonb_build_object('id',closed.id,'lockedAt',closed.locked_at,'totalOre',closed.snapshot->'totalOre','count',closed.snapshot->'count','items',closed.snapshot->'items','reviewToken',closed.review_token,'partialCoverageAcknowledged',closed.partial_coverage_acknowledged,'companyId',closed.snapshot->'companyId','month',closed.snapshot->'month','periodStart',closed.snapshot->'periodStart','periodEnd',closed.snapshot->'periodEnd','trackingStartedAt',closed.snapshot->'trackingStartedAt','coverage',closed.snapshot->'coverage','legacyPublishedJobs',closed.snapshot->'legacyPublishedJobs','canonicalSnapshot',closed.canonical_snapshot)||case when closed.snapshot ? 'storeFees' then jsonb_build_object('storeFees',closed.snapshot->'storeFees') else '{}'::jsonb end;
  select count(*),coalesce(sum(amount_ore::numeric),0) into n,total from private.advertising_billing_reductions where period_id=closed.id and company_id=p_company;
  if n>2000 or total>(closed.snapshot->>'totalOre')::numeric then raise exception 'Invalid reduction total' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'publicationId',publication_id,'amountOre',amount_ore::text,'reason',reason,'createdAt',created_at,'createdBy','Superadmin') order by created_at,id),'[]') into adjustments from private.advertising_billing_reductions where period_id=closed.id and company_id=p_company;
 end if;
 snapshot:=jsonb_build_object('companyId',p_company,'month',p_month,'originalId',closed.id,'originalReviewToken',closed.review_token,'adjustments',adjustments,'reductionTotalOre',total::text,'netTotalOre',case when closed.id is null then null else ((closed.snapshot->>'totalOre')::numeric-total)::text end);
 return snapshot||jsonb_build_object('original',original,'actorUserId',auth.uid(),'actorRole',mr,'reviewToken',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),'canonicalSnapshot',snapshot::text);
end $$;
revoke all on function private.advertising_corrections_read(uuid,text,boolean) from public,anon,service_role;
grant execute on function private.advertising_corrections_read(uuid,text,boolean) to authenticated;
create or replace function private.advertising_financial_preview_v2(p_draft jsonb,p_fields jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare source jsonb:=p_draft->'snapshot';b jsonb;s jsonb;item jsonb;lines jsonb:='[]';fees jsonb:='[]';combined jsonb;has_fees boolean:=false;blockers jsonb:='[]';v text;vat_ready boolean;original numeric;reduction numeric;net numeric;tax numeric;gross numeric;net_total numeric:=0;tax_total numeric:=0;gross_total numeric:=0;
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
  if vat_ready then tax:=div(net*25,100);gross:=net+tax;if gross>9223372036854775807 then raise exception 'Financial row overflow' using errcode='22023';end if;else tax:=null;gross:=null;end if;
  net_total:=net_total+net;tax_total:=tax_total+coalesce(tax,0);gross_total:=gross_total+coalesce(gross,0);
  lines:=lines||jsonb_build_array(jsonb_build_object('publicationId',item->'publicationId','listingId',item->'listingId','channel',item->'channel','originalOre',original::text,'reductionOre',reduction::text,'netOre',net::text,'vatOre',tax::text,'grossOre',gross::text)||case when item ? 'program' then jsonb_build_object('program',item->'program') else '{}'::jsonb end);
 end loop;
 for item in select value from jsonb_array_elements(coalesce(source->'basis'->'original'->'storeFees','[]'::jsonb)) loop
  has_fees:=true;original:=(item->>'unitPriceOre')::numeric;net:=original;reduction:=0;
  if vat_ready then tax:=div(net*25,100);gross:=net+tax;else tax:=null;gross:=null;end if;
  net_total:=net_total+net;tax_total:=tax_total+coalesce(tax,0);gross_total:=gross_total+coalesce(gross,0);
  fees:=fees||jsonb_build_array((item-array['unitPriceOre'])||jsonb_build_object('originalOre',original::text,'reductionOre','0','netOre',net::text,'vatOre',tax::text,'grossOre',gross::text));
 end loop;
 if net_total<>(source->'basis'->>'netTotalOre')::numeric or net_total>9223372036854775807 or tax_total>9223372036854775807 or gross_total>9223372036854775807 then raise exception 'Financial total overflow' using errcode='22023';end if;
 if vat_ready then
  tax_total:=div(net_total*25+50,100);
  combined:=lines||fees;
  with ranked as (
   select value,ordinality,row_number() over(order by mod((value->>'netOre')::numeric*25,100) desc,coalesce(value->>'publicationId',value->>'feeId')::uuid asc) as rank
   from jsonb_array_elements(combined) with ordinality
  ), allocated as (
   select value,ordinality,(value->>'vatOre')::numeric+case when rank<=tax_total-(select coalesce(sum((x->>'vatOre')::numeric),0) from jsonb_array_elements(combined)x) then 1 else 0 end as vat from ranked
  ) select coalesce(jsonb_agg(value||jsonb_build_object('vatOre',vat::text,'grossOre',((value->>'netOre')::numeric+vat)::text) order by ordinality),'[]'::jsonb) into combined from allocated;
  select coalesce(jsonb_agg(value order by n),'[]'::jsonb) into lines from jsonb_array_elements(combined) with ordinality t(value,n) where value ? 'publicationId';
  select coalesce(jsonb_agg(value order by n),'[]'::jsonb) into fees from jsonb_array_elements(combined) with ordinality t(value,n) where value ? 'feeId';
  gross_total:=net_total+tax_total;
  if tax_total>9223372036854775807 or gross_total>9223372036854775807 or exists(select 1 from jsonb_array_elements(combined)x where (x->>'grossOre')::numeric>9223372036854775807) then raise exception 'Allocated financial overflow' using errcode='22023';end if;
 end if;
 return jsonb_build_object('lines',lines,'netTotalOre',net_total::text,'vatTotalOre',case when vat_ready then tax_total::text else null end,'grossTotalOre',case when vat_ready then gross_total::text else null end,'blockers',blockers)||case when has_fees then jsonb_build_object('storeFeeLines',fees) else '{}'::jsonb end;
end $$;
revoke all on function private.advertising_financial_preview_v2(jsonb,jsonb) from public,anon,authenticated,service_role;
create or replace function private.create_advertising_financial_assessment_v2(p_company uuid,p_month text,p_draft uuid,p_draft_hash text,p_settings integer,p_settings_token text,p_token text,p_review boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();request private.advertising_financial_requests;r private.advertising_financial_assessments;settings_row private.advertising_financial_settings;payload jsonb;source jsonb;snapshot jsonb;preview jsonb;detail jsonb;settings jsonb;v integer;
begin
 perform private.advertising_invoice_context(p_company,true);
 if p_company is null or p_month is null or p_month !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' or p_draft is null or p_draft_hash is null or p_draft_hash !~ '^[0-9a-f]{64}$' or p_settings is null or p_settings<0 or p_settings_token is null or p_settings_token !~ '^[0-9a-f]{64}$' or p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_review is distinct from true or p_request is null then raise exception 'Invalid assessment request' using errcode='22023';end if;
 payload:=jsonb_build_object('calculationVersion',2,'companyId',p_company,'month',p_month,'draftId',p_draft,'expectedDraftSourceHash',p_draft_hash,'expectedSettingsVersion',p_settings,'expectedSettingsReviewToken',p_settings_token,'expectedReviewToken',p_token,'reviewAcknowledged',p_review);
 select * into request from private.advertising_financial_requests where actor_user_id=actor and request_id=p_request;
 if found then
  if request.payload<>payload then raise exception 'Assessment request reused' using errcode='40001';end if;
  select * into r from private.advertising_financial_assessments where id=request.assessment_id and company_id=p_company;
 else
  settings:=private.advertising_financial_settings_current(p_company);detail:=private.get_advertising_invoice_draft(p_company,p_draft,true);
  if (settings->>'version')::integer<>p_settings or settings->>'reviewToken'<>p_settings_token or detail->'draft'->>'sourceHash'<>p_draft_hash or detail->'draft'->>'month'<>p_month or (detail->>'isOutdated')::boolean then raise exception 'Assessment source changed' using errcode='40001';end if;
  source:=private.advertising_financial_source_v2(p_company,p_draft,true);preview:=source->'preview';
  if source->>'reviewToken'<>p_token then raise exception 'Assessment review changed' using errcode='40001';end if;
  if preview->'blockers'<>'[]'::jsonb or preview->'vatTotalOre'='null'::jsonb or preview->'grossTotalOre'='null'::jsonb then raise exception 'Complete financial review required' using errcode='22023';end if;
  select * into settings_row from private.advertising_financial_settings where company_id=p_company and version=p_settings;
  if not found then raise exception 'Saved financial settings required' using errcode='22023';end if;
  select * into r from private.advertising_financial_assessments where company_id=p_company and draft_id=p_draft and settings_id=settings_row.id and calculation_version=2;
  if not found then
   select coalesce(max(version),0) into v from private.advertising_financial_assessments where company_id=p_company and month=p_month;
   if v>=100 then raise exception 'Assessment history limit reached' using errcode='22023';end if;
   snapshot:=jsonb_build_object('status','reviewed_draft','currency','SEK','calculationVersion',2,'companyId',p_company,'month',p_month,'sourceReviewToken',p_token,'sourceCanonicalSnapshot',source->>'reviewCanonicalSnapshot','draft',source->'draft','settings',source->'settings','lines',preview->'lines','netTotalOre',preview->'netTotalOre','vatTotalOre',preview->'vatTotalOre','grossTotalOre',preview->'grossTotalOre')||case when preview ? 'storeFeeLines' then jsonb_build_object('storeFeeLines',preview->'storeFeeLines') else '{}'::jsonb end;
   insert into private.advertising_financial_assessments(company_id,month,version,draft_id,settings_id,calculation_version,snapshot,canonical_snapshot,source_hash,source_token,created_by) values(p_company,p_month,v+1,p_draft,settings_row.id,2,snapshot,snapshot::text,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),p_token,actor) returning * into r;
  end if;
  insert into private.advertising_financial_requests(actor_user_id,request_id,company_id,assessment_id,payload) values(actor,p_request,p_company,r.id,payload);
 end if;
 return jsonb_build_object('assessment',private.advertising_financial_assessment_json(r),'isOutdated',private.advertising_financial_outdated(p_company,r.draft_id,r.snapshot->'settings'->>'reviewToken',true),'receipt',jsonb_build_object('assessmentId',r.id,'companyId',r.company_id,'actorUserId',actor,'requestId',p_request,'sourceHash',r.source_hash,'sourceReviewToken',r.source_token,'draftId',r.draft_id,'draftSourceHash',r.snapshot->'draft'->>'sourceHash','settingsVersion',r.snapshot->'settings'->'version','settingsReviewToken',r.snapshot->'settings'->>'reviewToken'));
end $$;
revoke all on function private.create_advertising_financial_assessment_v2(uuid,text,uuid,text,integer,text,text,boolean,uuid) from public,anon,service_role;
grant execute on function private.create_advertising_financial_assessment_v2(uuid,text,uuid,text,integer,text,text,boolean,uuid) to authenticated;
create or replace function private.advertising_issuance_preview(p_company uuid,p_assessment jsonb,p_series jsonb,p_date date) returns jsonb language plpgsql security invoker set search_path='' as $$
declare dates jsonb;fee_dates jsonb;number text;seq text:=p_series->>'nextNumber';due date;source jsonb;
begin
 number:=(p_series->>'prefix')||'-'||(p_series->>'year')||'-'||lpad(seq,greatest(6,length(seq)),'0');
 due:=p_date+(p_assessment->'snapshot'->'settings'->'fields'->>'paymentDays')::integer;
 select coalesce(jsonb_agg(jsonb_build_object('publicationId',x->'publicationId','serviceDate',((x->>'publishedAt')::timestamptz at time zone 'Europe/Stockholm')::date) order by n),'[]') into dates from jsonb_array_elements(p_assessment->'snapshot'->'draft'->'snapshot'->'basis'->'original'->'items') with ordinality t(x,n);
 source:=jsonb_build_object('companyId',p_company,'month',p_assessment->'month','assessmentId',p_assessment->'id','assessmentSourceHash',p_assessment->>'sourceHash','seriesId',p_series->'id','seriesReviewToken',p_series->>'reviewToken','sequence',seq,'invoiceNumber',number,'invoiceDate',p_date,'dueDate',due,'serviceDates',dates);
 if p_assessment->'snapshot' ? 'storeFeeLines' then
 select coalesce(jsonb_agg(jsonb_build_object('feeId',x->'feeId','serviceDate',x->'serviceDate') order by n),'[]'::jsonb) into fee_dates from jsonb_array_elements(p_assessment->'snapshot'->'storeFeeLines') with ordinality t(x,n);
 source:=source||jsonb_build_object('storeFeeServiceDates',fee_dates);end if;
 return jsonb_build_object('invoiceNumber',number,'sequence',seq,'invoiceDate',p_date,'dueDate',due,'serviceDates',dates,'assessmentSourceHash',p_assessment->>'sourceHash','seriesReviewToken',p_series->>'reviewToken','reviewToken',encode(sha256(convert_to(source::text,'UTF8')),'hex'),'canonicalSnapshot',source::text)||case when fee_dates is not null then jsonb_build_object('storeFeeServiceDates',fee_dates) else '{}'::jsonb end;
end $$;
create or replace function private.advertising_issuance_page(p_company uuid,p_month text,p_assessment uuid,p_platform boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare mr text;detail jsonb;a jsonb;r private.advertising_invoice_series;i private.advertising_issued_invoices;series jsonb:=null;invoice jsonb:=null;preview jsonb:=null;blockers jsonb:='[]';day date;yr integer;rows integer;unsupported boolean;outdated boolean;
begin
 mr:=private.advertising_invoice_context(p_company,p_platform);day:=(clock_timestamp() at time zone 'Europe/Stockholm')::date;yr:=extract(year from day)::integer;
 detail:=private.get_advertising_financial_assessment(p_company,p_assessment,p_platform);a:=detail->'assessment';outdated:=(detail->>'isOutdated')::boolean;
 if p_month is null or a->>'month'<>p_month then raise exception 'Wrong invoice period' using errcode='22023';end if;
 rows:=jsonb_array_length(a->'snapshot'->'draft'->'snapshot'->'basis'->'original'->'items')+jsonb_array_length(coalesce(a->'snapshot'->'storeFeeLines','[]'::jsonb));
 unsupported:=exists(select 1 from (select value from jsonb_each_text(a->'snapshot'->'draft'->'snapshot'->'buyerProfile'->'fields') union all select value from jsonb_each_text(a->'snapshot'->'draft'->'snapshot'->'sellerProfile'->'fields')) t where value is not null and not private.advertising_issued_text_supported(value));
 select * into i from private.advertising_issued_invoices where company_id=p_company and month=p_month;
 if found then invoice:=jsonb_build_object('id',i.id,'createdAt',i.created_at,'invoiceNumber',i.invoice_number,'invoiceDate',i.invoice_date,'dueDate',i.due_date,'sourceHash',i.source_hash,'assessmentId',i.assessment_id,'isSourceOutdated',private.advertising_issued_source_outdated(i,p_platform));end if;
 if outdated then blockers:=blockers||'["assessment.outdated"]'::jsonb;end if;
 if invoice is not null then blockers:=blockers||'["invoice.exists"]'::jsonb;end if;
 if rows=0 then blockers:=blockers||'["serviceDates.empty"]'::jsonb;end if;
 if exists(select 1 from jsonb_array_elements(a->'snapshot'->'lines') l where l ? 'program' and (not private.advertising_issued_text_supported(l->'program'->>'storeName') or not private.advertising_issued_text_supported(l->'program'->>'agreementReference'))) then unsupported:=true;end if;
 if exists(select 1 from jsonb_array_elements(coalesce(a->'snapshot'->'storeFeeLines','[]'::jsonb)) f where not private.advertising_issued_text_supported(f->>'storeName') or not private.advertising_issued_text_supported(f->>'agreementReference') or not private.advertising_issued_text_supported(f->>'reason')) then unsupported:=true;end if;
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
 if (a->'snapshot'->>'vatTotalOre')::numeric<>div((a->'snapshot'->>'netTotalOre')::numeric*25+50,100) then blockers:=blockers||'["vat.roundingMismatch"]'::jsonb;end if;
 if blockers='[]'::jsonb then preview:=private.advertising_issuance_preview(p_company,a,series,day);end if;
 return jsonb_build_object('companyId',p_company,'actorUserId',auth.uid(),'actorRole',mr,'month',p_month,'currentYear',yr,'businessDate',day,'assessment',a,'isOutdated',outdated,'series',series,'invoice',invoice,'preview',preview,'blockers',blockers,'canConfigureSeries',mr='platform_admin' and series is null and not outdated and rows>0,'canIssue',blockers='[]'::jsonb);
end $$;
create or replace function private.issue_advertising_invoice(p_company uuid,p_month text,p_assessment uuid,p_assessment_hash text,p_series uuid,p_series_token text,p_token text,p_review boolean,p_service_review boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();request private.advertising_invoice_issue_requests;r private.advertising_issued_invoices;payload jsonb;page jsonb;preview jsonb;a jsonb;series jsonb;snapshot jsonb;lines jsonb;issued_at timestamptz;n integer;
begin
 perform private.advertising_invoice_context(p_company,true);
 if p_company is null or p_month is null or p_month !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' or p_assessment is null or p_assessment_hash is null or p_assessment_hash !~ '^[0-9a-f]{64}$' or p_series is null or p_series_token is null or p_series_token !~ '^[0-9a-f]{64}$' or p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_review is distinct from true or p_service_review is distinct from true or p_request is null then raise exception 'Explicit reviewed invoice issuance required' using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company,'month',p_month,'assessmentId',p_assessment,'expectedAssessmentSourceHash',p_assessment_hash,'expectedSeriesId',p_series,'expectedSeriesReviewToken',p_series_token,'expectedReviewToken',p_token,'reviewAcknowledged',p_review,'serviceDatesAcknowledged',p_service_review);
 select * into request from private.advertising_invoice_issue_requests where actor_user_id=actor and request_id=p_request;
 if found then
  if request.payload<>payload then raise exception 'Invoice issue request reused' using errcode='40001';end if;
  select * into r from private.advertising_issued_invoices where id=request.invoice_id and company_id=p_company;
 else
  select next_number into n from private.advertising_invoice_counters where series_id=p_series for update;
  if not found then raise exception 'Invoice series changed' using errcode='40001';end if;
  page:=private.advertising_issuance_page(p_company,p_month,p_assessment,true);a:=page->'assessment';series:=page->'series';preview:=page->'preview';
  if a->>'sourceHash'<>p_assessment_hash or (page->>'isOutdated')::boolean or page->'invoice'<>'null'::jsonb or series->>'id' is distinct from p_series::text or series->>'reviewToken' is distinct from p_series_token then raise exception 'Invoice source or series changed' using errcode='40001';end if;
  if (page->>'canIssue')::boolean is distinct from true or preview='null'::jsonb then raise exception 'Invoice prerequisites incomplete' using errcode='22023';end if;
  if preview->>'reviewToken'<>p_token then raise exception 'Invoice number or date changed' using errcode='40001';end if;
  issued_at:=clock_timestamp();if (issued_at at time zone 'Europe/Stockholm')::date<>(preview->>'invoiceDate')::date then raise exception 'Invoice date changed' using errcode='40001';end if;
  select coalesce(jsonb_agg(x||jsonb_build_object('quantity',1,'serviceDate',(select d->'serviceDate' from jsonb_array_elements(preview->'serviceDates') d where d->>'publicationId'=x->>'publicationId')) order by ord),'[]'::jsonb) into lines from jsonb_array_elements(a->'snapshot'->'lines') with ordinality t(x,ord);
  snapshot:=jsonb_build_object('status','issued','currency','SEK','rendererVersion',1,'companyId',p_company,'month',p_month,'invoiceNumber',preview->>'invoiceNumber','invoiceDate',preview->'invoiceDate','dueDate',preview->'dueDate','sequence',n::text,'serviceDatesAcknowledged',true,'series',series-array['reason','configuredAt','nextNumber','reviewToken','canonicalSnapshot'],'assessment',a,'lines',lines,'netTotalOre',a->'snapshot'->'netTotalOre','vatTotalOre',a->'snapshot'->'vatTotalOre','grossTotalOre',a->'snapshot'->'grossTotalOre')||case when a->'snapshot' ? 'storeFeeLines' then jsonb_build_object('storeFeeLines',(select jsonb_agg(f||jsonb_build_object('quantity',1) order by fee_ord) from jsonb_array_elements(a->'snapshot'->'storeFeeLines') with ordinality t(f,fee_ord))) else '{}'::jsonb end;
  insert into private.advertising_issued_invoices(company_id,month,assessment_id,series_id,sequence,invoice_number,invoice_date,due_date,snapshot,canonical_snapshot,source_hash,review_token,created_at,created_by) values(p_company,p_month,p_assessment,p_series,n,preview->>'invoiceNumber',(preview->>'invoiceDate')::date,(preview->>'dueDate')::date,snapshot,snapshot::text,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),p_token,issued_at,actor) returning * into r;
  update private.advertising_invoice_counters set next_number=n+1 where series_id=p_series;
  insert into private.advertising_invoice_issue_requests(actor_user_id,request_id,company_id,invoice_id,payload) values(actor,p_request,p_company,r.id,payload);
 end if;
 return jsonb_build_object('invoice',private.advertising_issued_invoice_json(r),'isSourceOutdated',private.advertising_issued_source_outdated(r,true),'receipt',jsonb_build_object('invoiceId',r.id,'companyId',r.company_id,'actorUserId',actor,'requestId',p_request,'assessmentId',r.assessment_id,'assessmentSourceHash',r.snapshot->'assessment'->>'sourceHash','seriesId',r.series_id,'sourceHash',r.source_hash,'invoiceNumber',r.invoice_number,'reviewToken',r.review_token));
end $$;
revoke all on function private.issue_advertising_invoice(uuid,text,uuid,text,uuid,text,text,boolean,boolean,uuid) from public,anon,service_role;
grant execute on function private.issue_advertising_invoice(uuid,text,uuid,text,uuid,text,text,boolean,boolean,uuid) to authenticated;
create or replace function private.issue_advertising_credit_invoice(p_company uuid,p_original uuid,p_hash text,p_series uuid,p_series_token text,p_token text,p_reason text,p_review boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();request private.advertising_credit_requests;r private.advertising_credit_invoices;payload jsonb;page jsonb;preview jsonb;o jsonb;series jsonb;snapshot jsonb;issued_at timestamptz;n integer;
begin
 perform private.advertising_invoice_context(p_company,true);
 if p_original is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_series is null or p_series_token is null or p_series_token !~ '^[0-9a-f]{64}$' or p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_reason is null or length(p_reason) not between 1 and 500 or p_reason<>btrim(p_reason) or p_reason ~ '[[:cntrl:]]' or p_reason ~ ('['||chr(128)||'-'||chr(159)||']') or not private.advertising_issued_text_supported(p_reason) or p_review is distinct from true or p_request is null then raise exception 'Explicit reviewed full credit required' using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company,'originalInvoiceId',p_original,'expectedOriginalSourceHash',p_hash,'expectedSeriesId',p_series,'expectedSeriesReviewToken',p_series_token,'expectedReviewToken',p_token,'reason',p_reason,'reviewAcknowledged',p_review);
 select * into request from private.advertising_credit_requests where actor_user_id=actor and request_id=p_request;
 if found then
  if request.payload<>payload then raise exception 'Credit request reused' using errcode='40001';end if;
  select * into r from private.advertising_credit_invoices where id=request.credit_id and company_id=p_company;
 else
  select next_number into n from private.advertising_invoice_counters where series_id=p_series for update;
  if not found then raise exception 'Credit series changed' using errcode='40001';end if;
  page:=private.advertising_credit_page(p_company,p_original,true);o:=page->'originalInvoice';series:=page->'series';preview:=page->'preview';
  if o->>'sourceHash'<>p_hash or page->'credit'<>'null'::jsonb or series->>'id' is distinct from p_series::text or series->>'reviewToken' is distinct from p_series_token then raise exception 'Credit source or series changed' using errcode='40001';end if;
  if (page->>'canCredit')::boolean is distinct from true or preview='null'::jsonb then raise exception 'Credit prerequisites incomplete' using errcode='22023';end if;
  if preview->>'reviewToken'<>p_token then raise exception 'Credit number or date changed' using errcode='40001';end if;
  issued_at:=clock_timestamp();if (issued_at at time zone 'Europe/Stockholm')::date<>(preview->>'creditDate')::date then raise exception 'Credit date changed' using errcode='40001';end if;
  snapshot:=jsonb_build_object('status','credited','documentType','full_credit','direction','credit','currency','SEK','rendererVersion',1,'companyId',p_company,'originalInvoiceId',p_original,'creditNumber',preview->>'creditNumber','creditDate',preview->'creditDate','sequence',n::text,'reason',p_reason,'series',series-array['reason','configuredAt','nextNumber','reviewToken','canonicalSnapshot'],'originalInvoice',o,'lines',o->'snapshot'->'lines','netTotalOre',o->'snapshot'->'netTotalOre','vatTotalOre',o->'snapshot'->'vatTotalOre','grossTotalOre',o->'snapshot'->'grossTotalOre')||case when o->'snapshot' ? 'storeFeeLines' then jsonb_build_object('storeFeeLines',o->'snapshot'->'storeFeeLines') else '{}'::jsonb end;
  insert into private.advertising_credit_invoices(company_id,original_invoice_id,series_id,sequence,credit_number,credit_date,snapshot,canonical_snapshot,source_hash,review_token,created_at,created_by) values(p_company,p_original,p_series,n,preview->>'creditNumber',(preview->>'creditDate')::date,snapshot,snapshot::text,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),p_token,issued_at,actor) returning * into r;
  update private.advertising_invoice_counters set next_number=n+1 where series_id=p_series;
  insert into private.advertising_credit_requests(actor_user_id,request_id,company_id,credit_id,payload) values(actor,p_request,p_company,r.id,payload);
 end if;
 return jsonb_build_object('credit',private.advertising_credit_json(r),'receipt',jsonb_build_object('creditId',r.id,'companyId',r.company_id,'actorUserId',actor,'requestId',p_request,'originalInvoiceId',r.original_invoice_id,'originalSourceHash',r.snapshot->'originalInvoice'->>'sourceHash','seriesId',r.series_id,'sourceHash',r.source_hash,'creditNumber',r.credit_number,'reviewToken',r.review_token));
end $$;
revoke all on function private.issue_advertising_credit_invoice(uuid,uuid,text,uuid,text,text,text,boolean,uuid) from public,anon,service_role;
grant execute on function private.issue_advertising_credit_invoice(uuid,uuid,text,uuid,text,text,text,boolean,uuid) to authenticated;
create or replace function private.configure_advertising_invoice_series(p_company uuid,p_assessment uuid,p_hash text,p_year integer,p_prefix text,p_first text,p_seat text,p_reason text,p_review boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();r private.advertising_invoice_series;detail jsonb;a jsonb;payload jsonb;config jsonb;series_id uuid;org text;yr integer;
begin
 perform private.advertising_invoice_context(p_company,true);
 if p_assessment is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_year is null or p_prefix is null or p_prefix !~ '^[A-Z0-9]{2,12}$' or p_first is null or p_first !~ '^[1-9][0-9]{0,8}$' or p_seat is null or length(p_seat) not between 1 and 160 or p_seat<>btrim(p_seat) or p_reason is null or length(p_reason) not between 1 and 500 or p_reason<>btrim(p_reason) or (p_seat||p_reason) ~ '[[:cntrl:]]' or (p_seat||p_reason) ~ ('['||chr(128)||'-'||chr(159)||']') or not private.advertising_issued_text_supported(p_seat) or p_review is distinct from true or p_request is null then raise exception 'Invalid invoice series configuration' using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company,'assessmentId',p_assessment,'expectedAssessmentSourceHash',p_hash,'year',p_year,'prefix',p_prefix,'firstNumber',p_first,'sellerRegisteredSeat',p_seat,'reason',p_reason,'reviewAcknowledged',p_review);
 select * into r from private.advertising_invoice_series where configured_by=actor and request_id=p_request;
 if found then if r.payload<>payload then raise exception 'Series request reused' using errcode='40001';end if;
 else
  detail:=private.get_advertising_financial_assessment(p_company,p_assessment,true);a:=detail->'assessment';yr:=extract(year from clock_timestamp() at time zone 'Europe/Stockholm')::integer;
  if a->>'sourceHash'<>p_hash or (detail->>'isOutdated')::boolean then raise exception 'Assessment changed' using errcode='40001';end if;
  if p_year<>yr or jsonb_array_length(a->'snapshot'->'draft'->'snapshot'->'basis'->'original'->'items')+jsonb_array_length(coalesce(a->'snapshot'->'storeFeeLines','[]'::jsonb))=0 then raise exception 'Current invoice year and service rows required' using errcode='22023';end if;
  org:=a->'snapshot'->'draft'->'snapshot'->'sellerProfile'->'fields'->>'organisationNumber';
  if exists(select 1 from private.advertising_invoice_series where (seller_organisation_number=org and year=p_year) or (prefix=p_prefix and year=p_year)) then raise exception 'Invoice series already configured' using errcode='40001';end if;
  series_id:=gen_random_uuid();config:=jsonb_build_object('id',series_id,'sellerOrganisationNumber',org,'year',p_year,'prefix',p_prefix,'firstNumber',p_first,'sellerRegisteredSeat',p_seat);
  insert into private.advertising_invoice_series(id,seller_organisation_number,year,prefix,first_number,seller_registered_seat,reason,configuration,canonical_configuration,configuration_hash,configured_by,company_id,request_id,payload) values(series_id,org,p_year,p_prefix,p_first::integer,p_seat,p_reason,config,config::text,encode(sha256(convert_to(config::text,'UTF8')),'hex'),actor,p_company,p_request,payload) returning * into r;
  insert into private.advertising_invoice_counters(series_id,next_number) values(r.id,r.first_number);
 end if;
 return jsonb_build_object('series',private.advertising_invoice_series_json(r),'receipt',jsonb_build_object('seriesId',r.id,'companyId',p_company,'actorUserId',actor,'requestId',p_request,'assessmentId',p_assessment,'assessmentSourceHash',p_hash,'configurationHash',r.configuration_hash));
end $$;
revoke all on function private.configure_advertising_invoice_series(uuid,uuid,text,integer,text,text,text,text,boolean,uuid) from public,anon,service_role;
grant execute on function private.configure_advertising_invoice_series(uuid,uuid,text,integer,text,text,text,text,boolean,uuid) to authenticated;
create or replace function private.advertising_financial_preview(p_draft jsonb,p_fields jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare source jsonb:=p_draft->'snapshot';b jsonb;s jsonb;item jsonb;lines jsonb:='[]';fees jsonb:='[]';combined jsonb;has_fees boolean:=false;blockers jsonb:='[]';v text;vat_ready boolean;original numeric;reduction numeric;net numeric;tax numeric;gross numeric;net_total numeric:=0;tax_total numeric:=0;gross_total numeric:=0;
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
  lines:=lines||jsonb_build_array(jsonb_build_object('publicationId',item->'publicationId','listingId',item->'listingId','channel',item->'channel','originalOre',original::text,'reductionOre',reduction::text,'netOre',net::text,'vatOre',tax::text,'grossOre',gross::text)||case when item ? 'program' then jsonb_build_object('program',item->'program') else '{}'::jsonb end);
 end loop;
 for item in select value from jsonb_array_elements(coalesce(source->'basis'->'original'->'storeFees','[]'::jsonb)) loop
  has_fees:=true;original:=(item->>'unitPriceOre')::numeric;net:=original;reduction:=0;
  if vat_ready then tax:=div(net*25+50,100);gross:=net+tax;else tax:=null;gross:=null;end if;
  net_total:=net_total+net;tax_total:=tax_total+coalesce(tax,0);gross_total:=gross_total+coalesce(gross,0);
  fees:=fees||jsonb_build_array((item-array['unitPriceOre'])||jsonb_build_object('originalOre',original::text,'reductionOre','0','netOre',net::text,'vatOre',tax::text,'grossOre',gross::text));
 end loop;
 if net_total<>(source->'basis'->>'netTotalOre')::numeric or net_total>9223372036854775807 or tax_total>9223372036854775807 or gross_total>9223372036854775807 then raise exception 'Financial total overflow' using errcode='22023';end if;
 return jsonb_build_object('lines',lines,'netTotalOre',net_total::text,'vatTotalOre',case when vat_ready then tax_total::text else null end,'grossTotalOre',case when vat_ready then gross_total::text else null end,'blockers',blockers)||case when has_fees then jsonb_build_object('storeFeeLines',fees) else '{}'::jsonb end;
end $$;
revoke all on function private.advertising_financial_preview(jsonb,jsonb) from public,anon,authenticated,service_role;
create or replace function private.create_advertising_financial_assessment(p_company uuid,p_month text,p_draft uuid,p_draft_hash text,p_settings integer,p_settings_token text,p_token text,p_review boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
   snapshot:=jsonb_build_object('status','reviewed_draft','currency','SEK','calculationVersion',1,'companyId',p_company,'month',p_month,'sourceReviewToken',p_token,'sourceCanonicalSnapshot',source->>'reviewCanonicalSnapshot','draft',source->'draft','settings',source->'settings','lines',preview->'lines','netTotalOre',preview->'netTotalOre','vatTotalOre',preview->'vatTotalOre','grossTotalOre',preview->'grossTotalOre')||case when preview ? 'storeFeeLines' then jsonb_build_object('storeFeeLines',preview->'storeFeeLines') else '{}'::jsonb end;
   insert into private.advertising_financial_assessments(company_id,month,version,draft_id,settings_id,snapshot,canonical_snapshot,source_hash,source_token,created_by) values(p_company,p_month,v+1,p_draft,settings_row.id,snapshot,snapshot::text,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),p_token,actor) returning * into r;
  end if;
  insert into private.advertising_financial_requests(actor_user_id,request_id,company_id,assessment_id,payload) values(actor,p_request,p_company,r.id,payload);
 end if;
 return jsonb_build_object('assessment',private.advertising_financial_assessment_json(r),'isOutdated',private.advertising_financial_outdated(p_company,r.draft_id,r.snapshot->'settings'->>'reviewToken',true),'receipt',jsonb_build_object('assessmentId',r.id,'companyId',r.company_id,'actorUserId',actor,'requestId',p_request,'sourceHash',r.source_hash,'sourceReviewToken',r.source_token,'draftId',r.draft_id,'draftSourceHash',r.snapshot->'draft'->>'sourceHash','settingsVersion',r.snapshot->'settings'->'version','settingsReviewToken',r.snapshot->'settings'->>'reviewToken'));
end $$;
revoke all on function private.create_advertising_financial_assessment(uuid,text,uuid,text,integer,text,text,boolean,uuid) from public,anon,service_role;
grant execute on function private.create_advertising_financial_assessment(uuid,text,uuid,text,integer,text,text,boolean,uuid) to authenticated;
commit;
