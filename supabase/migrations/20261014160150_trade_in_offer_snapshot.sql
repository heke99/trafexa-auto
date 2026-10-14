begin;
create function private.offer_base_snapshot(d public.deals,next_version integer,terms text,valid_until date,issued_at timestamptz) returns jsonb language plpgsql security invoker set search_path='' as $$
declare document_snapshot jsonb;vat_ore bigint:=(d.sale_price_ore+2)/5;begin
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
 where c.id=d.company_id and c.status='active';
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
 return document_snapshot;end$$;
revoke all on function private.offer_base_snapshot(public.deals,integer,text,date,timestamptz) from public,anon,authenticated,service_role;
commit;
