-- Offertunderlag are immutable snapshots. Prices and customer details are read
-- from tenant-owned rows, never accepted from the caller. No signing or finance
-- submission takes place here.
alter table public.offers add constraint offers_company_id_id_key unique(company_id,id);
revoke insert,update,delete on public.offers from public,anon,authenticated;

create function private.reject_offer_mutation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 raise exception 'Offer versions are immutable; create a new version' using errcode='55000';
end $$;
revoke all on function private.reject_offer_mutation() from public,anon,authenticated;
create trigger immutable_offer before update or delete on public.offers
for each row execute function private.reject_offer_mutation();
create trigger audit_offer_create after insert on public.offers
for each row execute function private.record_audit();

-- Receipts have the same lifetime as their offer, so an old retry cannot create
-- another version. The key is scoped to the actor, company and deal.
create table private.offer_submissions (
 company_id uuid not null references public.companies(id),
 user_id uuid not null references auth.users(id),
 deal_id uuid not null,
 submission_id uuid not null,
 payload jsonb not null,
 offer_id uuid not null,
 created_at timestamptz not null default now(),
 primary key(company_id,user_id,deal_id,submission_id),
 foreign key(company_id,deal_id) references public.deals(company_id,id),
 foreign key(company_id,offer_id) references public.offers(company_id,id)
);
create index offer_submissions_user_idx on private.offer_submissions(user_id);
create index offer_submissions_offer_idx on private.offer_submissions(company_id,offer_id);
create index offer_submissions_deal_idx on private.offer_submissions(company_id,deal_id);
alter table private.offer_submissions enable row level security;
revoke all on private.offer_submissions from public,anon,authenticated;
create policy no_direct_offer_receipts on private.offer_submissions
for all to anon,authenticated using(false) with check(false);

create function private.create_offer_version(company uuid,deal uuid,submission uuid,terms text,valid_until date,gross_confirmed boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid();
 d public.deals;
 previous private.offer_submissions;
 request_payload jsonb;
 document_snapshot jsonb;
 next_version integer;
 result uuid;
 issued_at timestamptz:=now();
 today date:=(now() at time zone 'Europe/Stockholm')::date;
 vat_ore bigint;
begin
 if actor is null or not private.has_company_role(company,array['owner','admin','sales']) then
  raise exception 'Access denied' using errcode='42501';
 end if;
 if gross_confirmed is distinct from true then
  raise exception 'Confirm that the deal price is the total price including any VAT' using errcode='22023';
 end if;
 if submission is null or terms is null or length(terms)>2000
  or translate(terms,chr(9)||chr(10)||chr(13),'') ~ '[[:cntrl:]]'
  or valid_until is null then
  raise exception 'Invalid offer terms or expiry' using errcode='22023';
 end if;
 request_payload:=jsonb_build_object('terms',terms,'valid_until',valid_until,'gross_confirmed',gross_confirmed);
 -- A deal lock serializes version allocation and repeated submissions. Related
 -- source rows are read in one statement below, without conflicting stock locks.
 select * into d from public.deals where id=deal and company_id=company for update;
 if not found then raise exception 'Deal unavailable' using errcode='P0002'; end if;
 select * into previous from private.offer_submissions r
 where r.company_id=company and r.user_id=actor and r.deal_id=deal and r.submission_id=submission;
 if found then
  if previous.payload!=request_payload then raise exception 'Offer submission payload changed' using errcode='22023'; end if;
  return previous.offer_id;
 end if;
 -- Replays are resolved before the moving date check, even after expiry.
 if valid_until<today or valid_until>today+90 then
  raise exception 'Offer expiry must be within 90 days' using errcode='22023';
 end if;
 if d.status not in ('draft','reserved') then raise exception 'Deal unavailable' using errcode='P0002'; end if;
 if d.sale_price_ore not between 1 and 999999999999 then
  raise exception 'Offer price is out of bounds' using errcode='22023';
 end if;
 select coalesce(max(o.version),0)+1 into next_version from public.offers o where o.company_id=company and o.deal_id=deal;
 -- Standard Swedish VAT is 25% of net price. Stored gross prices are in öre;
 -- division by five rounds VAT to the nearest öre without floating point.
 vat_ore:=(d.sale_price_ore+2)/5;
 select jsonb_build_object(
  'schema_version',1,'document_type','offer','version',next_version,'deal_id',d.id,
  'issued_at',issued_at,'valid_until',valid_until,'terms',terms,'currency','SEK',
  'sale_price_ore',d.sale_price_ore::text,'price_basis','gross',
  'company',jsonb_build_object('id',c.id,'name',c.name,'organisation_number',c.organisation_number),
  'customer',jsonb_build_object('id',cu.id,'kind',cu.kind,'name',cu.name,'email',cu.email,'phone',cu.phone,'address',cu.address),
  'stock',jsonb_build_object('id',s.id,'vat_scheme',s.vat_scheme),
  'vehicle',jsonb_build_object('id',v.id,'registration_number',v.registration_number,'vin',v.vin,'make',v.make,'model',v.model,
   'model_year',v.model_year,'mileage_km',v.mileage_km,'fuel',v.fuel,'gearbox',v.gearbox),
  'vat',jsonb_build_object('rate_percent',case when s.vat_scheme='standard' then 25 else null end,
   'amount_ore',case when s.vat_scheme='standard' then vat_ore::text else null end,
   'net_price_ore',case when s.vat_scheme='standard' then (d.sale_price_ore-vat_ore)::text else null end)
 ) into document_snapshot
 from public.companies c
 join public.customers cu on cu.company_id=c.id and cu.id=d.customer_id
 join public.stock_items s on s.company_id=c.id and s.id=d.stock_item_id
 join public.vehicles v on v.company_id=c.id and v.id=s.vehicle_id
 where c.id=company and c.status='active';
 if document_snapshot is null then raise exception 'Offer source unavailable' using errcode='P0002'; end if;
 -- Bound document source text as well as submitted terms; nothing is truncated.
 if length(document_snapshot#>>'{company,name}') not between 2 and 160
  or (document_snapshot#>>'{company,organisation_number}') !~ '^[0-9]{10}$'
  or length(document_snapshot#>>'{customer,name}') not between 2 and 160
  or length(document_snapshot#>>'{vehicle,registration_number}') not between 2 and 15
  or length(document_snapshot#>>'{vehicle,make}') not between 1 and 160
  or length(document_snapshot#>>'{vehicle,model}') not between 1 and 160
  or coalesce(length(document_snapshot#>>'{vehicle,vin}'),0)>100
  or coalesce(length(document_snapshot#>>'{customer,email}'),0)>254
  or coalesce(length(document_snapshot#>>'{customer,phone}'),0)>60
  or coalesce(length(document_snapshot#>>'{customer,address}'),0)>500 then
  raise exception 'Offer source text exceeds document limits' using errcode='22023';
 end if;
 insert into public.offers(company_id,deal_id,version,snapshot,created_at)
 values(company,deal,next_version,document_snapshot,issued_at) returning id into result;
 insert into private.offer_submissions(company_id,user_id,deal_id,submission_id,payload,offer_id)
 values(company,actor,deal,submission,request_payload,result);
 return result;
end $$;
revoke all on function private.create_offer_version(uuid,uuid,uuid,text,date,boolean) from public,anon;
grant execute on function private.create_offer_version(uuid,uuid,uuid,text,date,boolean) to authenticated;
create function public.create_offer_version(company uuid,deal uuid,submission uuid,terms text,valid_until date,gross_confirmed boolean)
returns uuid language sql security invoker set search_path='' as $$
 select private.create_offer_version(company,deal,submission,terms,valid_until,gross_confirmed);
$$;
revoke all on function public.create_offer_version(uuid,uuid,uuid,text,date,boolean) from public,anon;
grant execute on function public.create_offer_version(uuid,uuid,uuid,text,date,boolean) to authenticated;
