begin;
-- A manual record of an externally completed purchase. This does not create a
-- native purchase signature, transfer title, execute payment or query a lender.
alter table private.trade_in_versions add constraint trade_in_versions_company_identity unique(company_id,id);
create table private.trade_in_acquisitions(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),deal_id uuid not null,
 offer_id uuid not null,trade_in_id uuid not null,signing_id uuid not null,vehicle_id uuid not null,stock_item_id uuid not null,
 source jsonb not null,acquired_on date not null check(acquired_on>=date '1900-01-01'),
 purchase_agreement_reference text not null check(length(purchase_agreement_reference) between 2 and 160 and purchase_agreement_reference=btrim(purchase_agreement_reference) and purchase_agreement_reference !~ '[[:cntrl:]]'),
 debt_confirmed_ore bigint not null check(debt_confirmed_ore between 0 and 999999999999),debt_confirmed_on date not null check(debt_confirmed_on>=date '1900-01-01'),
 debt_evidence_reference text not null check(length(debt_evidence_reference) between 2 and 160 and debt_evidence_reference=btrim(debt_evidence_reference) and debt_evidence_reference !~ '[[:cntrl:]]'),
 fuel text not null check(fuel in('petrol','diesel','electric','hybrid','other')),gearbox text not null check(gearbox in('automatic','manual')),
 asking_price_ore bigint not null check(asking_price_ore between 1 and 999999999999),purchase_price_ore bigint not null check(purchase_price_ore between 1 and 999999999999),
 attestation_version text not null check(attestation_version='2026-10-15'),created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 unique(company_id,id),unique(company_id,deal_id),unique(company_id,offer_id),unique(company_id,trade_in_id),unique(stock_item_id),unique(vehicle_id),
 foreign key(company_id,deal_id) references public.deals(company_id,id),foreign key(company_id,offer_id) references public.offers(company_id,id),
 foreign key(company_id,trade_in_id) references private.trade_in_versions(company_id,id),foreign key(company_id,signing_id) references private.contract_signings(company_id,id),
 foreign key(company_id,vehicle_id) references public.vehicles(company_id,id),foreign key(company_id,stock_item_id) references public.stock_items(company_id,id),
 check(jsonb_typeof(source)='object' and source ?& array['companyId','dealId','offerId','offerVersion','tradeInId','tradeInVersion','sellerCustomerId','signingId','signingDocumentSha256','signingRevision','offerSnapshot','sourceSha256'] and source->>'sourceSha256' ~ '^[a-f0-9]{64}$' and source->>'companyId'=company_id::text and source->>'dealId'=deal_id::text
  and source->>'offerId'=offer_id::text and source->>'tradeInId'=trade_in_id::text and source->>'signingId'=signing_id::text
  and source->>'sourceSha256'=encode(sha256(convert_to((source-'sourceSha256')::text,'UTF8')),'hex'))
);
create index trade_in_acquisition_signing on private.trade_in_acquisitions(company_id,signing_id);
create index trade_in_acquisition_actor on private.trade_in_acquisitions(created_by);
create table private.trade_in_acquisition_audit(
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,company_id uuid not null,deal_id uuid not null,
 acquisition_id uuid not null,payload jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(actor_user_id,request_id),
 foreign key(company_id,deal_id) references public.deals(company_id,id),foreign key(company_id,acquisition_id) references private.trade_in_acquisitions(company_id,id)
);
create index trade_in_acquisition_audit_deal on private.trade_in_acquisition_audit(company_id,deal_id);
create index trade_in_acquisition_audit_acquisition on private.trade_in_acquisition_audit(company_id,acquisition_id);
alter table private.trade_in_acquisitions enable row level security;
alter table private.trade_in_acquisition_audit enable row level security;
revoke all on private.trade_in_acquisitions,private.trade_in_acquisition_audit from public,anon,authenticated,service_role;
create trigger trade_in_acquisition_immutable before update or delete on private.trade_in_acquisitions for each row execute function private.trade_in_immutable();
create trigger trade_in_acquisition_audit_immutable before update or delete on private.trade_in_acquisition_audit for each row execute function private.trade_in_immutable();

create function private.trade_in_acquisition_access(p_company_id uuid,p_write boolean) returns table(actor uuid,actor_role text)
language plpgsql security invoker set search_path='' as $$declare a uuid;r text;begin
 if current_setting('role',true) is distinct from 'authenticated' or auth.uid() is null or p_write is null then raise exception 'Private acquisition access denied' using errcode='42501';end if;
 select x.actor,x.actor_role into a,r from private.sale_contract_access(p_company_id,p_write)x;
 return query select a,r;
end$$;

create function private.trade_in_acquisition_json(t private.trade_in_acquisitions,a uuid) returns jsonb
language sql security invoker set search_path='' as $$select jsonb_build_object(
 'id',t.id,'companyId',t.company_id,'dealId',t.deal_id,'source',t.source,'vehicleId',t.vehicle_id,'stockItemId',t.stock_item_id,
 'acquiredOn',t.acquired_on,'purchaseAgreementReference',t.purchase_agreement_reference,'debtConfirmedOre',t.debt_confirmed_ore::text,
 'debtConfirmedOn',t.debt_confirmed_on,'debtEvidenceReference',t.debt_evidence_reference,'fuel',t.fuel,'gearbox',t.gearbox,
 'askingPriceOre',t.asking_price_ore::text,'purchasePriceOre',t.purchase_price_ore::text,'vatScheme','unknown','attestationVersion',t.attestation_version,
 'createdAt',t.created_at,'actorLabel',case when t.created_by=a then 'Du' else 'Kollega' end);$$;

-- Caller already holds company/member -> outbound stock -> deal. Native guard
-- then takes signing/draft SHARE locks without accessing Storage or a server key.
create function private.trade_in_acquisition_source(d public.deals,a uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.offers;t private.trade_in_versions;s private.contract_signings;draft private.sale_contract_drafts;
 safe jsonb;expected_trade jsonb;base jsonb;native_state jsonb;n integer;
begin
 select count(*) into n from private.offer_reviews r join public.offers x on x.company_id=r.company_id and x.id=r.offer_id
 where r.company_id=d.company_id and r.deal_id=d.id and r.status='accepted' and x.snapshot?'trade_in';
 if n=0 then return jsonb_build_object('source',null,'reason','no_accepted_trade_in');end if;
 if n<>1 then raise exception 'Ambiguous acquisition source' using errcode='40001';end if;
 select x.* into o from public.offers x join private.offer_reviews r on r.company_id=x.company_id and r.offer_id=x.id
 where r.company_id=d.company_id and r.deal_id=d.id and r.status='accepted' and x.snapshot?'trade_in'
 and x.deal_id=d.id and r.offer_version=x.version;
 if not found or jsonb_typeof(o.snapshot->'trade_in') is distinct from 'object'
 or coalesce(o.snapshot#>>'{trade_in,id}','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
  raise exception 'Acquisition offer source conflict' using errcode='40001';end if;
 select * into t from private.trade_in_versions where company_id=d.company_id and deal_id=d.id and id=(o.snapshot#>>'{trade_in,id}')::uuid;
 if not found or t.customer_id<>d.customer_id or o.snapshot#>>'{customer,id}' is distinct from t.customer_id::text
 or o.snapshot#>>'{company,id}' is distinct from d.company_id::text or o.snapshot->>'deal_id' is distinct from d.id::text
 or o.snapshot#>>'{stock,id}' is distinct from d.stock_item_id::text or o.snapshot->>'version' is distinct from o.version::text
 or o.snapshot->>'sale_price_ore' is distinct from t.sale_price_ore::text or not t.debt_known or t.debt_ore is null then
  raise exception 'Acquisition trade-in source conflict' using errcode='40001';end if;
 expected_trade:=jsonb_build_object('id',t.id,'version',t.version,'registration',t.registration,'make',t.make,'model',t.model,
 'model_year',t.model_year,'mileage_km',t.mileage_km,'value_ore',t.value_ore::text,'debt_known',true,'debt_ore',t.debt_ore::text,
 'net_trade_in_ore',(t.value_ore-t.debt_ore)::text,'amount_to_pay_ore',(t.sale_price_ore-t.value_ore+t.debt_ore)::text);
 safe:=private.offer_review_snapshot(o.snapshot);
 if safe->'trade_in' is distinct from expected_trade
 or upper(regexp_replace(t.registration,'[[:space:]]','','g')) !~ '^[A-Z0-9-]{2,15}$' or t.model_year not between 1900 and 2100 then
  raise exception 'Acquisition trade-in snapshot conflict' using errcode='40001';end if;
 select * into s from private.contract_signings where company_id=d.company_id and deal_id=d.id;
 if not found then return jsonb_build_object('source',null,'reason','contract_incomplete');end if;
 -- Native status/revision are derived from immutable receipts, not stored columns.
 native_state:=private.contract_signing_json(s,a,'finance');
 if native_state->>'status' is distinct from 'completed' or native_state->'revision' is distinct from to_jsonb(3) then return jsonb_build_object('source',null,'reason','contract_incomplete');end if;
 s:=private.require_contract_archive_source(s.id,d.company_id,a,false);
 select * into draft from private.sale_contract_drafts where company_id=d.company_id and deal_id=d.id and id=s.draft_id;
 if draft.offer_id<>o.id or draft.snapshot->'sourceOffer' is distinct from safe then raise exception 'Completed acquisition contract source conflict' using errcode='40001';end if;
 base:=jsonb_build_object('companyId',d.company_id,'dealId',d.id,'offerId',o.id,'offerVersion',o.version,'tradeInId',t.id,'tradeInVersion',t.version,
 'sellerCustomerId',t.customer_id,'signingId',s.id,'signingDocumentSha256',s.document_hash,'signingRevision',3,'offerSnapshot',safe);
 return jsonb_build_object('source',base||jsonb_build_object('sourceSha256',encode(sha256(convert_to(base::text,'UTF8')),'hex')),'reason',null);
end$$;

create function private.get_trade_in_acquisition(p_company_id uuid,p_deal_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid;r text;d public.deals;stock uuid;t private.trade_in_acquisitions;basis jsonb;src jsonb;why text;today date:=(clock_timestamp() at time zone 'Europe/Stockholm')::date;
begin
 select x.actor,x.actor_role into a,r from private.trade_in_acquisition_access(p_company_id,false)x;
 select * into t from private.trade_in_acquisitions where company_id=p_company_id and deal_id=p_deal_id;
 if found then return jsonb_build_object('actorId',a,'role',r,'companyId',p_company_id,'dealId',p_deal_id,'businessDate',today,'canAcquire',false,
  'reason','already_acquired','source',t.source,'acquisition',private.trade_in_acquisition_json(t,a));end if;
 select stock_item_id into stock from public.deals where company_id=p_company_id and id=p_deal_id;
 if not found then raise exception 'Acquisition deal access denied' using errcode='42501';end if;
 perform 1 from public.stock_items where company_id=p_company_id and id=stock for share;
 select * into d from public.deals where company_id=p_company_id and id=p_deal_id for share;
 if not found or d.stock_item_id<>stock then raise exception 'Acquisition deal conflict' using errcode='40001';end if;
 -- A writer may have committed while this reader waited on the deal.
 select * into t from private.trade_in_acquisitions where company_id=p_company_id and deal_id=p_deal_id;
 if found then return jsonb_build_object('actorId',a,'role',r,'companyId',p_company_id,'dealId',p_deal_id,'businessDate',today,'canAcquire',false,
  'reason','already_acquired','source',t.source,'acquisition',private.trade_in_acquisition_json(t,a));end if;
 if d.status not in('draft','reserved') then why:='deal_unavailable';
 else
  basis:=private.trade_in_acquisition_source(d,a);src:=basis->'source';why:=basis->>'reason';
  if src<>'null'::jsonb and exists(select 1 from public.vehicles where company_id=p_company_id
   and upper(regexp_replace(registration_number,'[[:space:]]','','g'))=upper(regexp_replace(src#>>'{offerSnapshot,trade_in,registration}','[[:space:]]','','g'))) then why:='vehicle_exists';end if;
 end if;
 return jsonb_build_object('actorId',a,'role',r,'companyId',p_company_id,'dealId',p_deal_id,'businessDate',today,
 'canAcquire',why is null and r in('owner','admin'),'reason',why,'source',src,'acquisition',null);
end$$;
create function public.get_trade_in_acquisition(p_company_id uuid,p_deal_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.get_trade_in_acquisition(p_company_id,p_deal_id);$$;

create function private.record_trade_in_acquisition(
 p_company_id uuid,p_deal_id uuid,p_expected_source_sha256 text,p_acquired_on date,p_purchase_agreement_reference text,
 p_debt_confirmed_ore bigint,p_debt_confirmed_on date,p_debt_evidence_reference text,p_fuel text,p_gearbox text,p_asking_price_ore bigint,
 p_purchase_confirmed boolean,p_received_confirmed boolean,p_debt_confirmed boolean,p_acknowledged boolean,p_attestation_version text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;old private.trade_in_acquisition_audit;t private.trade_in_acquisitions;d public.deals;stock uuid;
 p jsonb;basis jsonb;src jsonb;trade jsonb;registration text;vehicle uuid;new_stock uuid;today date:=(clock_timestamp() at time zone 'Europe/Stockholm')::date;
begin
 select x.actor,x.actor_role into a,r from private.trade_in_acquisition_access(p_company_id,true)x;
 if p_request_id is null then raise exception 'Acquisition request required' using errcode='22023';end if;
 p:=jsonb_build_object('companyId',p_company_id,'dealId',p_deal_id,'expectedSourceSha256',p_expected_source_sha256,'acquiredOn',p_acquired_on,
 'purchaseAgreementReference',p_purchase_agreement_reference,'debtConfirmedOre',p_debt_confirmed_ore::text,'debtConfirmedOn',p_debt_confirmed_on,
 'debtEvidenceReference',p_debt_evidence_reference,'fuel',p_fuel,'gearbox',p_gearbox,'askingPriceOre',p_asking_price_ore::text,
 'purchaseConfirmed',p_purchase_confirmed,'receivedConfirmed',p_received_confirmed,'debtConfirmed',p_debt_confirmed,'acknowledged',p_acknowledged,'attestationVersion',p_attestation_version);
 -- Fresh Auth/approval/company/membership precede historical replay. No current
 -- source/status/clock/duplicate predicate may invalidate an identical receipt.
 perform pg_advisory_xact_lock(hashtextextended(a::text||p_request_id::text,17));
 select * into old from private.trade_in_acquisition_audit where actor_user_id=a and request_id=p_request_id;
 if found then
  if old.payload is distinct from p or old.company_id is distinct from p_company_id or old.deal_id is distinct from p_deal_id then raise exception 'Acquisition request conflict' using errcode='40001';end if;
  select * into t from private.trade_in_acquisitions where company_id=p_company_id and id=old.acquisition_id;
  return jsonb_build_object('actorId',a,'role',r,'companyId',p_company_id,'dealId',p_deal_id,'requestId',p_request_id,'acquisition',private.trade_in_acquisition_json(t,a));
 end if;
 if p_expected_source_sha256 is null or p_expected_source_sha256 !~ '^[a-f0-9]{64}$'
 or p_acquired_on is null or p_acquired_on<date '1900-01-01' or p_acquired_on>today
 or p_debt_confirmed_on is null or p_debt_confirmed_on<date '1900-01-01' or p_debt_confirmed_on>today
 or p_purchase_agreement_reference is null or length(p_purchase_agreement_reference) not between 2 and 160 or p_purchase_agreement_reference<>btrim(p_purchase_agreement_reference) or p_purchase_agreement_reference ~ '[[:cntrl:]]'
 or p_debt_evidence_reference is null or length(p_debt_evidence_reference) not between 2 and 160 or p_debt_evidence_reference<>btrim(p_debt_evidence_reference) or p_debt_evidence_reference ~ '[[:cntrl:]]'
 or p_debt_confirmed_ore is null or p_debt_confirmed_ore not between 0 and 999999999999
 or p_fuel is null or p_fuel not in('petrol','diesel','electric','hybrid','other') or p_gearbox is null or p_gearbox not in('automatic','manual')
 or p_asking_price_ore is null or p_asking_price_ore not between 1 and 999999999999
 or p_purchase_confirmed is distinct from true or p_received_confirmed is distinct from true or p_debt_confirmed is distinct from true or p_acknowledged is distinct from true
 or p_attestation_version is distinct from '2026-10-15' then raise exception 'Invalid manual purchase attestation' using errcode='22023';end if;
 select stock_item_id into stock from public.deals where company_id=p_company_id and id=p_deal_id;
 if not found then raise exception 'Acquisition deal access denied' using errcode='42501';end if;
 perform 1 from public.stock_items where company_id=p_company_id and id=stock for share;
 select * into d from public.deals where company_id=p_company_id and id=p_deal_id for update;
 if not found or d.stock_item_id<>stock or d.status not in('draft','reserved')
 or exists(select 1 from private.trade_in_acquisitions where company_id=p_company_id and deal_id=p_deal_id) then raise exception 'Acquisition deal conflict' using errcode='40001';end if;
 basis:=private.trade_in_acquisition_source(d,a);src:=basis->'source';
 if src is null or src='null'::jsonb or basis->>'reason' is not null or src->>'sourceSha256' is distinct from p_expected_source_sha256 then raise exception 'Acquisition source conflict' using errcode='40001';end if;
 trade:=src#>'{offerSnapshot,trade_in}';
 if p_debt_confirmed_ore is distinct from(trade->>'debt_ore')::bigint then raise exception 'Manual debt confirmation conflict' using errcode='40001';end if;
 registration:=upper(regexp_replace(trade->>'registration','[[:space:]]','','g'));
 -- Same canonical identity as vehicles_company_normalized_registration_idx.
 -- The existing UNIQUE index also arbitrates manual/import/direct-RLS races.
 if exists(select 1 from public.vehicles where company_id=p_company_id and upper(regexp_replace(registration_number,'[[:space:]]','','g'))=registration) then raise exception 'Vehicle identity already exists' using errcode='23505';end if;
 insert into public.vehicles(company_id,registration_number,make,model,model_year,mileage_km,fuel,gearbox)
 values(p_company_id,registration,trade->>'make',trade->>'model',(trade->>'model_year')::integer,(trade->>'mileage_km')::integer,p_fuel,p_gearbox)returning id into vehicle;
 insert into public.stock_items(company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme,purchase_vat_ore,vat_basis_confirmed,acquired_on,status)
 values(p_company_id,vehicle,(trade->>'value_ore')::bigint,p_asking_price_ore,'unknown',null,false,p_acquired_on,'available')returning id into new_stock;
 insert into private.trade_in_acquisitions(company_id,deal_id,offer_id,trade_in_id,signing_id,vehicle_id,stock_item_id,source,acquired_on,purchase_agreement_reference,
 debt_confirmed_ore,debt_confirmed_on,debt_evidence_reference,fuel,gearbox,asking_price_ore,purchase_price_ore,attestation_version,created_by)
 values(p_company_id,p_deal_id,(src->>'offerId')::uuid,(src->>'tradeInId')::uuid,(src->>'signingId')::uuid,vehicle,new_stock,src,p_acquired_on,p_purchase_agreement_reference,
 p_debt_confirmed_ore,p_debt_confirmed_on,p_debt_evidence_reference,p_fuel,p_gearbox,p_asking_price_ore,(trade->>'value_ore')::bigint,p_attestation_version,a)returning * into t;
 insert into private.trade_in_acquisition_audit(actor_user_id,request_id,company_id,deal_id,acquisition_id,payload)values(a,p_request_id,p_company_id,p_deal_id,t.id,p);
 return jsonb_build_object('actorId',a,'role',r,'companyId',p_company_id,'dealId',p_deal_id,'requestId',p_request_id,'acquisition',private.trade_in_acquisition_json(t,a));
end$$;
create function public.record_trade_in_acquisition(
 p_company_id uuid,p_deal_id uuid,p_expected_source_sha256 text,p_acquired_on date,p_purchase_agreement_reference text,
 p_debt_confirmed_ore bigint,p_debt_confirmed_on date,p_debt_evidence_reference text,p_fuel text,p_gearbox text,p_asking_price_ore bigint,
 p_purchase_confirmed boolean,p_received_confirmed boolean,p_debt_confirmed boolean,p_acknowledged boolean,p_attestation_version text,p_request_id uuid
) returns jsonb language sql security invoker set search_path='' as $$select private.record_trade_in_acquisition(
 p_company_id,p_deal_id,p_expected_source_sha256,p_acquired_on,p_purchase_agreement_reference,p_debt_confirmed_ore,p_debt_confirmed_on,p_debt_evidence_reference,p_fuel,p_gearbox,p_asking_price_ore,
 p_purchase_confirmed,p_received_confirmed,p_debt_confirmed,p_acknowledged,p_attestation_version,p_request_id);$$;
revoke all on function private.trade_in_acquisition_access(uuid,boolean),private.trade_in_acquisition_json(private.trade_in_acquisitions,uuid),private.trade_in_acquisition_source(public.deals,uuid) from public,anon,authenticated,service_role;
revoke all on function private.get_trade_in_acquisition(uuid,uuid),public.get_trade_in_acquisition(uuid,uuid),private.record_trade_in_acquisition(uuid,uuid,text,date,text,bigint,date,text,text,text,bigint,boolean,boolean,boolean,boolean,text,uuid),public.record_trade_in_acquisition(uuid,uuid,text,date,text,bigint,date,text,text,text,bigint,boolean,boolean,boolean,boolean,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_trade_in_acquisition(uuid,uuid),public.get_trade_in_acquisition(uuid,uuid),private.record_trade_in_acquisition(uuid,uuid,text,date,text,bigint,date,text,text,text,bigint,boolean,boolean,boolean,boolean,text,uuid),public.record_trade_in_acquisition(uuid,uuid,text,date,text,bigint,date,text,text,text,bigint,boolean,boolean,boolean,boolean,text,uuid) to authenticated;
commit;
