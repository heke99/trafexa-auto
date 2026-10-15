-- Manual reconciliation records attestations, never a bank verification.
begin;
alter table public.deals drop constraint deals_status_check;
alter table public.deals add constraint deals_status_check check(status in('draft','reserved','cancelled','completed'));
-- PostgREST callers cannot impersonate a lifecycle RPC with a client-set GUC.
-- Approved SECURITY DEFINER mutations execute as their trusted owner instead.
create function private.guard_deal_lifecycle_direct_update()returns trigger language plpgsql security invoker set search_path=''as $$begin
 if current_user='authenticated'and(new.status is distinct from old.status or(tg_table_name='deals'and old.status='completed'))then
  raise exception 'Use the authorized lifecycle operation'using errcode='42501';end if;return new;
end$$;
create trigger deal_lifecycle_direct_update before update on public.deals for each row execute function private.guard_deal_lifecycle_direct_update();
create trigger stock_lifecycle_direct_update before update on public.stock_items for each row execute function private.guard_deal_lifecycle_direct_update();
revoke all on function private.guard_deal_lifecycle_direct_update()from public,anon,authenticated,service_role;
create table private.deal_payment_entries(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,deal_id uuid not null,
 offer_id uuid not null,amount_ore bigint not null check(amount_ore<>0 and abs(amount_ore)<=999999999999),
 bank_reference text not null,booked_on date not null,reversal_of uuid unique references private.deal_payment_entries(id),
 reason text not null,actor_user_id uuid not null references auth.users(id),recorded_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,deal_id) references public.deals(company_id,id),foreign key(company_id,offer_id) references public.offers(company_id,id),
 check((amount_ore>0 and reversal_of is null)or(amount_ore<0 and reversal_of is not null)),
 check(length(bank_reference)between 2 and 300 and bank_reference=btrim(bank_reference)and bank_reference !~ '[[:cntrl:]]'),
 check(length(reason)between 2 and 300 and reason=btrim(reason)and reason !~ '[[:cntrl:]]')
);
create index deal_payment_entries_deal on private.deal_payment_entries(company_id,deal_id,recorded_at,id);
create index deal_payment_entries_actor on private.deal_payment_entries(actor_user_id);
create index deal_payment_entries_offer on private.deal_payment_entries(company_id,offer_id);
create unique index deal_payment_bank_reference on private.deal_payment_entries(company_id,bank_reference)where reversal_of is null;
create table private.deal_deliveries(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,deal_id uuid not null,stock_item_id uuid not null unique,
 offer_id uuid not null,signing_id uuid not null,archive_id uuid not null references private.contract_signing_archives(id),
 amount_ore bigint not null check(amount_ore>0),note text not null,actor_user_id uuid not null references auth.users(id),delivered_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,deal_id)references public.deals(company_id,id),foreign key(company_id,stock_item_id)references public.stock_items(company_id,id),
 foreign key(company_id,offer_id)references public.offers(company_id,id),foreign key(company_id,signing_id)references private.contract_signings(company_id,id),unique(company_id,deal_id),
 check(length(note)between 2 and 300 and note=btrim(note)and note !~ '[[:cntrl:]]')
);
create index deal_deliveries_actor on private.deal_deliveries(actor_user_id);
create index deal_deliveries_offer on private.deal_deliveries(company_id,offer_id);
create index deal_deliveries_signing on private.deal_deliveries(company_id,signing_id);
create index deal_deliveries_archive on private.deal_deliveries(archive_id);
create table private.deal_fulfilment_requests(
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,company_id uuid not null,deal_id uuid not null,
 payload jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(actor_user_id,request_id),
 foreign key(company_id,deal_id)references public.deals(company_id,id)
);
create index deal_fulfilment_requests_deal on private.deal_fulfilment_requests(company_id,deal_id);
alter table private.deal_payment_entries enable row level security;
alter table private.deal_deliveries enable row level security;
alter table private.deal_fulfilment_requests enable row level security;
revoke all on private.deal_payment_entries,private.deal_deliveries,private.deal_fulfilment_requests from public,anon,authenticated,service_role;
create trigger deal_payment_immutable before update or delete on private.deal_payment_entries for each row execute function private.sale_contract_immutable();
create trigger deal_delivery_immutable before update or delete on private.deal_deliveries for each row execute function private.sale_contract_immutable();
create trigger deal_fulfilment_request_immutable before update or delete on private.deal_fulfilment_requests for each row execute function private.sale_contract_immutable();

create function private.deal_fulfilment_source(d public.deals,a uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare o public.offers;s private.contract_signings;c private.sale_contract_drafts;v private.contract_signing_archives;n integer;
begin
 if d.status not in('draft','reserved','completed')then return jsonb_build_object('source',null,'blockedReason','deal_unavailable');end if;
 select count(*)into n from private.offer_reviews where company_id=d.company_id and deal_id=d.id and status='accepted';
 if n<>1 then return jsonb_build_object('source',null,'blockedReason','accepted_offer_required');end if;
 select x.*into o from public.offers x join private.offer_reviews r on r.company_id=x.company_id and r.offer_id=x.id and r.offer_version=x.version
 where r.company_id=d.company_id and r.deal_id=d.id and r.status='accepted'and x.deal_id=d.id;
 if not found or o.snapshot->>'sale_price_ore' is distinct from d.sale_price_ore::text or o.snapshot->>'deal_id' is distinct from d.id::text
 or o.snapshot#>>'{company,id}'is distinct from d.company_id::text or o.snapshot#>>'{customer,id}'is distinct from d.customer_id::text
 or o.snapshot#>>'{stock,id}'is distinct from d.stock_item_id::text or d.sale_price_ore not between 1 and 999999999999 then raise exception 'Fulfilment source conflict'using errcode='40001';end if;
 -- No invented settlement of trade-in debt, lender payout or negative net cash.
 if o.snapshot?'trade_in'then return jsonb_build_object('source',null,'blockedReason','trade_in_settlement_unsupported');end if;
 select *into s from private.contract_signings where company_id=d.company_id and deal_id=d.id;
 if not found or(select count(*)from private.contract_signatures where signing_id=s.id and document_hash=s.document_hash)<>2 then return jsonb_build_object('source',null,'blockedReason','contract_required');end if;
 s:=private.require_contract_archive_source(s.id,d.company_id,a,false);
 select *into c from private.sale_contract_drafts where company_id=d.company_id and deal_id=d.id and id=s.draft_id;
 if c.offer_id<>o.id or c.snapshot->'sourceOffer'is distinct from private.offer_review_snapshot(o.snapshot)then raise exception 'Fulfilment contract conflict'using errcode='40001';end if;
 select *into v from private.contract_signing_archives where company_id=d.company_id and deal_id=d.id and signing_id=s.id and draft_id=c.id and document_content_sha256=s.document_hash and signing_revision=3;
 if not found then return jsonb_build_object('source',null,'blockedReason','original_required');end if;
 perform private.check_native_contract_archive_objects(v.pdf_object_path,v.pdf_bytes,v.evidence_object_path,v.evidence_bytes);
 return jsonb_build_object('source',jsonb_build_object('offerId',o.id,'signingId',s.id,'archiveId',v.id,'amountDueOre',d.sale_price_ore::text),'blockedReason',null);
end$$;

create function private.deal_fulfilment_page(d public.deals,a uuid,r text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare source jsonb;items jsonb;paid bigint;version integer;delivery jsonb;
begin
 source:=private.deal_fulfilment_source(d,a);
 select count(*)::integer,coalesce(sum(amount_ore),0),coalesce(jsonb_agg(jsonb_build_object('id',id,'amountOre',amount_ore::text,'bankReference',bank_reference,'bookedOn',booked_on::text,'reversalOf',reversal_of,'reason',reason,'actorLabel',case when actor_user_id=a then 'Du'else 'Kollega'end,'recordedAt',recorded_at)order by recorded_at,id),'[]')into version,paid,items from private.deal_payment_entries where company_id=d.company_id and deal_id=d.id;
 select jsonb_build_object('id',id,'deliveredAt',delivered_at,'actorLabel',case when actor_user_id=a then 'Du'else 'Kollega'end,'note',note)into delivery from private.deal_deliveries where company_id=d.company_id and deal_id=d.id;
 return source||jsonb_build_object('companyId',d.company_id,'dealId',d.id,'actorId',a,'role',r,'version',version+case when delivery is null then 0 else 1 end,
 'businessDate',(clock_timestamp()at time zone'Europe/Stockholm')::date::text,'entries',items,'registeredOre',paid::text,'delivery',delivery,
 'canDeliver',r in('owner','admin')and delivery is null and d.status='reserved'and source->'source'<>'null'::jsonb and paid=d.sale_price_ore
 and exists(select 1 from public.stock_items where company_id=d.company_id and id=d.stock_item_id and status='reserved')
 and exists(select 1 from public.reservations where company_id=d.company_id and deal_id=d.id and stock_item_id=d.stock_item_id and status='active'));
end$$;

create function private.get_deal_fulfilment(p_company_id uuid,p_deal_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid;r text;d public.deals;stock uuid;
begin
 select x.actor,x.actor_role into a,r from private.internal_inventory_scope(p_company_id,false)x;
 if r not in('owner','admin','finance')then raise exception 'Fulfilment access denied'using errcode='42501';end if;
 select stock_item_id into stock from public.deals where company_id=p_company_id and id=p_deal_id;
 perform 1 from public.stock_items where company_id=p_company_id and id=stock for share;
 select *into d from public.deals where company_id=p_company_id and id=p_deal_id for share;
 if not found or d.stock_item_id is distinct from stock then raise exception 'Fulfilment access denied'using errcode='42501';end if;
 return private.deal_fulfilment_page(d,a,r);
end$$;

create function private.mutate_deal_fulfilment(p_company_id uuid,p_deal_id uuid,p_input jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid;r text;d public.deals;s public.stock_items;stock uuid;page jsonb;src jsonb;old private.deal_fulfilment_requests;entry private.deal_payment_entries;
 request uuid;op text;reason text;reference text;amount bigint;booked date;result uuid;version integer;today date:=(clock_timestamp()at time zone'Europe/Stockholm')::date;
begin
 select x.actor,x.actor_role into a,r from private.internal_inventory_scope(p_company_id,true)x;
 if r not in('owner','admin')then raise exception 'Fulfilment access denied'using errcode='42501';end if;
 if jsonb_typeof(p_input)is distinct from'object'or(p_input-array['companyId','dealId','requestId','expectedVersion','operation','amountOre','bankReference','bookedOn','reversalOf','reason'])<>'{}'::jsonb
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
 if op='payment'then
  if p_input?'reversalOf'or coalesce(p_input->>'amountOre','')!~'^[1-9][0-9]{0,11}$'or coalesce(p_input->>'bookedOn','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'then raise exception 'Invalid payment'using errcode='22023';end if;
  amount:=(p_input->>'amountOre')::bigint;booked:=(p_input->>'bookedOn')::date;reference:=p_input->>'bankReference';
  if reference is null or reference<>btrim(reference)or length(reference)not between 2 and 300 or reference~'[[:cntrl:]]'or booked>today or booked<date'2000-01-01'then raise exception 'Invalid payment'using errcode='22023';end if;
  if version>=498 or(page->>'registeredOre')::bigint+amount>d.sale_price_ore then raise exception 'Payment amount conflict'using errcode='40001';end if;
  insert into private.deal_payment_entries(company_id,deal_id,offer_id,amount_ore,bank_reference,booked_on,reason,actor_user_id)
  values(p_company_id,p_deal_id,(src->>'offerId')::uuid,amount,reference,booked,reason,a)returning id into result;
 elsif op='reverse'then
  if p_input?|array['amountOre','bankReference','bookedOn']or coalesce(p_input->>'reversalOf','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'then raise exception 'Invalid reversal'using errcode='22023';end if;
  select *into entry from private.deal_payment_entries where company_id=p_company_id and deal_id=p_deal_id and id=(p_input->>'reversalOf')::uuid and reversal_of is null;
  if not found or version>=499 or exists(select 1 from private.deal_payment_entries where reversal_of=entry.id)then raise exception 'Payment reversal conflict'using errcode='40001';end if;
  insert into private.deal_payment_entries(company_id,deal_id,offer_id,amount_ore,bank_reference,booked_on,reversal_of,reason,actor_user_id)
  values(p_company_id,p_deal_id,entry.offer_id,-entry.amount_ore,entry.bank_reference,today,entry.id,reason,a)returning id into result;
 else
  if p_input?|array['amountOre','bankReference','bookedOn','reversalOf']or page->'canDeliver'is distinct from'true'::jsonb or s.status<>'reserved'then raise exception 'Delivery requirements conflict'using errcode='40001';end if;
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
create function public.get_deal_fulfilment(p_company_id uuid,p_deal_id uuid)returns jsonb language sql security invoker set search_path=''as $$select private.get_deal_fulfilment(p_company_id,p_deal_id)$$;
create function public.mutate_deal_fulfilment(p_company_id uuid,p_deal_id uuid,p_input jsonb)returns jsonb language sql security invoker set search_path=''as $$select private.mutate_deal_fulfilment(p_company_id,p_deal_id,p_input)$$;
revoke all on function private.deal_fulfilment_source(public.deals,uuid),private.deal_fulfilment_page(public.deals,uuid,text),private.get_deal_fulfilment(uuid,uuid),private.mutate_deal_fulfilment(uuid,uuid,jsonb),public.get_deal_fulfilment(uuid,uuid),public.mutate_deal_fulfilment(uuid,uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function private.get_deal_fulfilment(uuid,uuid),private.mutate_deal_fulfilment(uuid,uuid,jsonb),public.get_deal_fulfilment(uuid,uuid),public.mutate_deal_fulfilment(uuid,uuid,jsonb)to authenticated;
commit;
