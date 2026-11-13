begin;
-- Immutable manual evidence only: no bank transfer, lender instruction or assumed money.
alter table private.deal_payment_entries add column category text not null default 'customer_incoming' check(category in('customer_incoming','customer_payout','lender_payment'));
alter table private.deal_payment_entries drop constraint deal_payment_entries_amount_ore_check;
alter table private.deal_payment_entries add constraint deal_payment_entries_amount_ore_check check(amount_ore<>0 and abs(amount_ore)<=1999999999998);

create function private.trade_settlement_source(d public.deals,s private.contract_signings,c private.sale_contract_drafts,v private.contract_signing_archives,base jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t jsonb;csh bigint;val bigint;debt bigint;acq uuid;
begin
 t:=c.snapshot#>'{sourceOffer,trade_in}';
 if t is null then return jsonb_build_object('source',base,'blockedReason',null);end if;
 if jsonb_typeof(t)<>'object' or t->'debt_known' is distinct from 'true'::jsonb
 or coalesce(t->>'value_ore','')!~'^[1-9][0-9]{0,11}$' or coalesce(t->>'debt_ore','')!~'^(0|[1-9][0-9]{0,11})$'
 or coalesce(t->>'id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 or coalesce(t->>'version','')!~'^[1-9][0-9]{0,9}$' then return jsonb_build_object('source',null,'blockedReason','trade_in_settlement_unsupported');end if;
 val:=(t->>'value_ore')::bigint;debt:=(t->>'debt_ore')::bigint;csh:=d.sale_price_ore-val+debt;
 if t->>'net_trade_in_ore' is distinct from (val-debt)::text or t->>'amount_to_pay_ore' is distinct from csh::text then raise exception 'Signed settlement arithmetic conflict' using errcode='40001';end if;
 select x.id into acq from private.trade_in_acquisitions x where x.company_id=d.company_id and x.deal_id=d.id and x.signing_id=s.id and x.trade_in_id=(t->>'id')::uuid
 and x.source->>'signingDocumentSha256'=s.document_hash and x.source->>'tradeInVersion'=t->>'version'
 and x.source#>'{offerSnapshot,trade_in}'=t and x.debt_confirmed_ore=debt and x.purchase_price_ore=val
 and exists(select 1 from public.stock_items k where k.company_id=x.company_id and k.id=x.stock_item_id and k.vehicle_id=x.vehicle_id and k.purchase_price_ore=val);
 return jsonb_build_object('source',base||jsonb_build_object('documentHash',s.document_hash,'amountDueOre',greatest(csh,0)::text,'tradeIn',jsonb_build_object('tradeInId',t->>'id','tradeInVersion',(t->>'version')::integer,'salePriceOre',d.sale_price_ore::text,'valueOre',val::text,'debtOre',debt::text,'netCashOre',csh::text,'customerIncomingOre',greatest(csh,0)::text,'customerPayoutOre',greatest(-csh,0)::text,'lenderPaymentOre',debt::text,'acquisitionId',acq,'acquired',acq is not null)),'blockedReason',null);
end$$;
revoke all on function private.trade_settlement_source(public.deals,private.contract_signings,private.sale_contract_drafts,private.contract_signing_archives,jsonb) from public,anon,authenticated,service_role;
create or replace function private.deal_fulfilment_source(d public.deals,a uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare o public.offers;s private.contract_signings;c private.sale_contract_drafts;v private.contract_signing_archives;n integer;
begin
 if d.status not in('draft','reserved','completed')then return jsonb_build_object('source',null,'blockedReason','deal_unavailable');end if;
 if exists(select 1 from private.sale_contract_drafts x where x.company_id=d.company_id and x.deal_id=d.id and x.snapshot->>'sourceKind'='direct_deal') then
  select * into s from private.contract_signings where company_id=d.company_id and deal_id=d.id;
  if not found or(select count(*)from private.contract_party_signatures(s.id) where document_hash=s.document_hash and consent_version='2026-10-14')<>2 then return jsonb_build_object('source',null,'blockedReason','contract_required');end if;
  s:=private.require_contract_archive_source(s.id,d.company_id,a,false);
  select * into c from private.sale_contract_drafts where company_id=d.company_id and deal_id=d.id and id=s.draft_id;
  if c.offer_id is not null or c.snapshot->>'sourceKind' is distinct from 'direct_deal' or c.snapshot#>>'{sourceOffer,sale_price_ore}' is distinct from d.sale_price_ore::text or c.snapshot#>>'{sourceOffer,deal_id}' is distinct from d.id::text or c.snapshot#>>'{sourceOffer,company,id}' is distinct from d.company_id::text or c.snapshot#>>'{sourceOffer,customer,id}' is distinct from d.customer_id::text or c.snapshot#>>'{sourceOffer,stock,id}' is distinct from d.stock_item_id::text then raise exception 'Direct fulfilment source changed' using errcode='40001';end if;

  select *into v from private.contract_signing_archives where company_id=d.company_id and deal_id=d.id and signing_id=s.id and draft_id=c.id and document_content_sha256=s.document_hash and signing_revision=3;
  if not found then return jsonb_build_object('source',null,'blockedReason','original_required');end if;
  perform private.check_native_contract_archive_objects(v.pdf_object_path,v.pdf_bytes,v.evidence_object_path,v.evidence_bytes);
  return private.trade_settlement_source(d,s,c,v,jsonb_build_object('sourceKind','direct_deal','documentHash',s.document_hash,'offerId',null,'signingId',s.id,'archiveId',v.id,'amountDueOre',d.sale_price_ore::text));
 end if;

 select count(*)into n from private.offer_reviews where company_id=d.company_id and deal_id=d.id and status='accepted';
 if n<>1 then return jsonb_build_object('source',null,'blockedReason','accepted_offer_required');end if;
 select x.*into o from public.offers x join private.offer_reviews r on r.company_id=x.company_id and r.offer_id=x.id and r.offer_version=x.version
 where r.company_id=d.company_id and r.deal_id=d.id and r.status='accepted'and x.deal_id=d.id;
 if not found or o.snapshot->>'sale_price_ore' is distinct from d.sale_price_ore::text or o.snapshot->>'deal_id' is distinct from d.id::text
 or o.snapshot#>>'{company,id}'is distinct from d.company_id::text or o.snapshot#>>'{customer,id}'is distinct from d.customer_id::text
 or o.snapshot#>>'{stock,id}'is distinct from d.stock_item_id::text or d.sale_price_ore not between 1 and 999999999999 then raise exception 'Fulfilment source conflict'using errcode='40001';end if;
 -- No invented settlement of trade-in debt, lender payout or negative net cash.

 select *into s from private.contract_signings where company_id=d.company_id and deal_id=d.id;
 if not found or(select count(*)from private.contract_party_signatures(s.id) where document_hash=s.document_hash and consent_version='2026-10-14')<>2 then return jsonb_build_object('source',null,'blockedReason','contract_required');end if;
 s:=private.require_contract_archive_source(s.id,d.company_id,a,false);
 select *into c from private.sale_contract_drafts where company_id=d.company_id and deal_id=d.id and id=s.draft_id;
 if c.offer_id<>o.id or c.snapshot->'sourceOffer'is distinct from private.offer_review_snapshot(o.snapshot)then raise exception 'Fulfilment contract conflict'using errcode='40001';end if;
 select *into v from private.contract_signing_archives where company_id=d.company_id and deal_id=d.id and signing_id=s.id and draft_id=c.id and document_content_sha256=s.document_hash and signing_revision=3;
 if not found then return jsonb_build_object('source',null,'blockedReason','original_required');end if;
 perform private.check_native_contract_archive_objects(v.pdf_object_path,v.pdf_bytes,v.evidence_object_path,v.evidence_bytes);
 return private.trade_settlement_source(d,s,c,v,jsonb_build_object('offerId',o.id,'signingId',s.id,'archiveId',v.id,'amountDueOre',d.sale_price_ore::text));
end$$;

create or replace function private.deal_fulfilment_page(d public.deals,a uuid,r text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare source jsonb;items jsonb;paid bigint;version integer;delivery jsonb;ci bigint;co bigint;lp bigint;trade jsonb;
begin
 source:=private.deal_fulfilment_source(d,a);
 select count(*)::integer,coalesce(sum(amount_ore) filter(where category='customer_incoming'),0),coalesce(jsonb_agg(jsonb_build_object('category',category,'id',id,'amountOre',amount_ore::text,'bankReference',bank_reference,'bookedOn',booked_on::text,'reversalOf',reversal_of,'reason',reason,'actorLabel',case when actor_user_id=a then 'Du'else 'Kollega'end,'recordedAt',recorded_at)order by recorded_at,id),'[]')into version,paid,items from private.deal_payment_entries where company_id=d.company_id and deal_id=d.id;
 select coalesce(sum(amount_ore)filter(where category='customer_incoming'),0),coalesce(sum(amount_ore)filter(where category='customer_payout'),0),coalesce(sum(amount_ore)filter(where category='lender_payment'),0)into ci,co,lp from private.deal_payment_entries where company_id=d.company_id and deal_id=d.id;trade:=source#>'{source,tradeIn}';
 select jsonb_build_object('id',id,'deliveredAt',delivered_at,'actorLabel',case when actor_user_id=a then 'Du'else 'Kollega'end,'note',note)into delivery from private.deal_deliveries where company_id=d.company_id and deal_id=d.id;
 return source||jsonb_build_object('companyId',d.company_id,'dealId',d.id,'actorId',a,'role',r,'version',version+case when delivery is null then 0 else 1 end,
 'settlement',jsonb_build_object('customerIncomingOre',ci::text,'customerPayoutOre',co::text,'lenderPaymentOre',lp::text),'businessDate',(clock_timestamp()at time zone'Europe/Stockholm')::date::text,'entries',items,'registeredOre',paid::text,'delivery',delivery,
 'canDeliver',r in('owner','admin')and delivery is null and d.status='reserved'and source->'source'<>'null'::jsonb and ((trade is null and paid=d.sale_price_ore and co=0 and lp=0) or(trade is not null and trade->'acquired'='true'::jsonb and ci=(trade->>'customerIncomingOre')::bigint and co=(trade->>'customerPayoutOre')::bigint and lp=(trade->>'lenderPaymentOre')::bigint))
 and exists(select 1 from public.stock_items where company_id=d.company_id and id=d.stock_item_id and status='reserved')
 and exists(select 1 from public.reservations where company_id=d.company_id and deal_id=d.id and stock_item_id=d.stock_item_id and status='active'));
end$$;

create or replace function private.mutate_deal_fulfilment(p_company_id uuid,p_deal_id uuid,p_input jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid;r text;d public.deals;s public.stock_items;stock uuid;page jsonb;src jsonb;old private.deal_fulfilment_requests;entry private.deal_payment_entries;
 cat text;target bigint;trade jsonb;request uuid;op text;reason text;reference text;amount bigint;booked date;result uuid;version integer;today date:=(clock_timestamp()at time zone'Europe/Stockholm')::date;
begin
 select x.actor,x.actor_role into a,r from private.internal_inventory_scope(p_company_id,true)x;
 if r not in('owner','admin')then raise exception 'Fulfilment access denied'using errcode='42501';end if;
 if jsonb_typeof(p_input)is distinct from'object'or(p_input-array['companyId','dealId','requestId','expectedVersion','operation','amountOre','bankReference','bookedOn','reversalOf','reason','category','acknowledged','expectedDocumentHash'])<>'{}'::jsonb
 or p_input->>'companyId'is distinct from p_company_id::text or p_input->>'dealId'is distinct from p_deal_id::text
 or coalesce(p_input->>'requestId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 or jsonb_typeof(p_input->'expectedVersion')is distinct from'number'or coalesce(p_input->>'expectedVersion','')!~'^[0-9]{1,10}$'
 or(p_input->>'expectedVersion')::numeric>2147483646 then raise exception 'Invalid fulfilment input'using errcode='22023';end if;
 request:=(p_input->>'requestId')::uuid;op:=p_input->>'operation';reason:=p_input->>'reason';
 if op is null or op not in('payment','reverse','deliver')or reason is null or reason<>btrim(reason)or length(reason)not between 2 and 300 or reason~'[[:cntrl:]]'then raise exception 'Invalid fulfilment input'using errcode='22023';end if;
 select stock_item_id into stock from public.deals where company_id=p_company_id and id=p_deal_id;
 select *into s from public.stock_items where company_id=p_company_id and id=stock for update;
 if not found then raise exception 'Fulfilment access denied'using errcode='42501';end if;
 select *into d from public.deals where company_id=p_company_id and id=p_deal_id for update;
 if not found or d.stock_item_id<>stock then raise exception 'Fulfilment conflict'using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended(a::text||request::text,77));
 select *into old from private.deal_fulfilment_requests where actor_user_id=a and request_id=request;
 if found then if old.payload is distinct from p_input then raise exception 'Fulfilment request conflict'using errcode='40001';end if;return private.deal_fulfilment_page(d,a,r);end if;
 page:=private.deal_fulfilment_page(d,a,r);src:=page->'source';version:=(page->>'version')::integer;
 if version<>(p_input->>'expectedVersion')::integer or d.status not in('draft','reserved')or exists(select 1 from private.deal_deliveries where company_id=p_company_id and deal_id=p_deal_id)
 or src='null'::jsonb then raise exception 'Fulfilment agreement conflict'using errcode='40001';end if;
 trade:=src->'tradeIn';
 if trade is not null then if p_input->'acknowledged' is distinct from 'true'::jsonb or p_input->>'expectedDocumentHash' is distinct from src->>'documentHash' then raise exception 'Signed settlement review required' using errcode='40001';end if;elsif p_input?|array['category','acknowledged','expectedDocumentHash'] then raise exception 'Unexpected settlement fields' using errcode='22023';end if;
 if op='payment'then
  cat:=coalesce(p_input->>'category','customer_incoming');if cat not in('customer_incoming','customer_payout','lender_payment')or(trade is not null and not p_input?'category')then raise exception 'Settlement category required' using errcode='22023';end if;
  target:=case when trade is null then d.sale_price_ore else (trade->>(case cat when 'customer_incoming' then 'customerIncomingOre' when 'customer_payout' then 'customerPayoutOre' else 'lenderPaymentOre' end))::bigint end;
  if p_input?'reversalOf'or coalesce(p_input->>'amountOre','')!~'^[1-9][0-9]{0,12}$'or coalesce(p_input->>'bookedOn','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'then raise exception 'Invalid payment'using errcode='22023';end if;
  amount:=(p_input->>'amountOre')::bigint;booked:=(p_input->>'bookedOn')::date;reference:=p_input->>'bankReference';
  if reference is null or reference<>btrim(reference)or length(reference)not between 2 and 300 or reference~'[[:cntrl:]]'or booked>today or booked<date'2000-01-01'then raise exception 'Invalid payment'using errcode='22023';end if;
  if version>=498 or amount>1999999999998 or coalesce((select sum(amount_ore)from private.deal_payment_entries where company_id=p_company_id and deal_id=p_deal_id and deal_payment_entries.category=cat),0)+amount>target then raise exception 'Payment amount conflict'using errcode='40001';end if;
  insert into private.deal_payment_entries(company_id,deal_id,offer_id,direct_signing_id,category,amount_ore,bank_reference,booked_on,reason,actor_user_id)
  values(p_company_id,p_deal_id,(src->>'offerId')::uuid,case when src->>'sourceKind'='direct_deal' then(src->>'signingId')::uuid else null end,cat,amount,reference,booked,reason,a)returning id into result;
 elsif op='reverse'then
  if p_input?|array['amountOre','bankReference','bookedOn','category']or coalesce(p_input->>'reversalOf','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'then raise exception 'Invalid reversal'using errcode='22023';end if;
  select *into entry from private.deal_payment_entries where company_id=p_company_id and deal_id=p_deal_id and id=(p_input->>'reversalOf')::uuid and reversal_of is null;
  if not found or version>=499 or exists(select 1 from private.deal_payment_entries where reversal_of=entry.id)then raise exception 'Payment reversal conflict'using errcode='40001';end if;
  insert into private.deal_payment_entries(company_id,deal_id,offer_id,direct_signing_id,category,amount_ore,bank_reference,booked_on,reversal_of,reason,actor_user_id)
  values(p_company_id,p_deal_id,entry.offer_id,entry.direct_signing_id,entry.category,-entry.amount_ore,entry.bank_reference,today,entry.id,reason,a)returning id into result;
 else
  if p_input?|array['amountOre','bankReference','bookedOn','reversalOf','category']or page->'canDeliver'is distinct from'true'::jsonb or s.status<>'reserved'then raise exception 'Delivery requirements conflict'using errcode='40001';end if;
  insert into private.deal_deliveries(company_id,deal_id,stock_item_id,offer_id,signing_id,archive_id,amount_ore,note,actor_user_id)
  values(p_company_id,p_deal_id,stock,(src->>'offerId')::uuid,(src->>'signingId')::uuid,(src->>'archiveId')::uuid,d.sale_price_ore,reason,a)returning id into result;
  update public.reservations set status='released'where company_id=p_company_id and stock_item_id=stock and deal_id=p_deal_id and status='active';
  update public.stock_items set status='sold'where company_id=p_company_id and id=stock;
  update public.deals set status='completed'where company_id=p_company_id and id=p_deal_id;
  select *into d from public.deals where company_id=p_company_id and id=p_deal_id;
 end if;
 insert into private.deal_fulfilment_requests(actor_user_id,request_id,company_id,deal_id,payload,receipt)values(a,request,p_company_id,p_deal_id,p_input,jsonb_build_object('id',result,'operation',op,'manual',true));
 return private.deal_fulfilment_page(d,a,r);
end$$;
commit;
