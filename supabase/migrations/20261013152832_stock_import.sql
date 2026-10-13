-- Import receipts are internal. No browser/table writes are granted. A private
-- definer is needed only because both lifecycle tables and receipts forbid
-- direct inserts; it verifies the caller's current membership before any work.
create unique index vehicles_company_normalized_registration_idx on public.vehicles(company_id,upper(regexp_replace(registration_number,'[[:space:]]','','g')));

create function public.stock_import_duplicate_registrations(company uuid,registrations text[])
returns text[] language plpgsql security invoker set search_path='' as $$
declare result text[];
begin
 if auth.uid() is null or not private.has_company_role(company) then raise exception 'Access denied' using errcode='42501'; end if;
 if registrations is null or cardinality(registrations) not between 1 and 500 then raise exception 'Invalid import size' using errcode='22023'; end if;
 select coalesce(array_agg(upper(regexp_replace(v.registration_number,'[[:space:]]','','g'))),array[]::text[])
 into result from public.vehicles v where v.company_id=company
 and upper(regexp_replace(v.registration_number,'[[:space:]]','','g'))=any(registrations);
 return result;
end $$;
revoke all on function public.stock_import_duplicate_registrations(uuid,text[]) from public,anon;
grant execute on function public.stock_import_duplicate_registrations(uuid,text[]) to authenticated;
create table private.stock_import_batches (
 company_id uuid not null references public.companies(id),
 user_id uuid not null references auth.users(id),
 submission_id uuid not null,
 normalized_payload jsonb not null check(jsonb_typeof(normalized_payload)='array' and jsonb_array_length(normalized_payload) between 1 and 500),
 row_count integer not null check(row_count between 1 and 500),
 created_at timestamptz not null default now(),
 primary key(company_id,user_id,submission_id)
);
create index stock_import_batches_retention_idx on private.stock_import_batches(company_id,created_at);
create index stock_import_batches_user_idx on private.stock_import_batches(user_id);
alter table private.stock_import_batches enable row level security;
revoke all on private.stock_import_batches from public,anon,authenticated;
create policy no_direct_import_receipts on private.stock_import_batches for all to anon,authenticated using(false) with check(false);

create function private.import_stock_batch(company uuid,submission uuid,payload jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid();
 previous private.stock_import_batches;
 normalized jsonb:='[]'::jsonb;
 entry jsonb;
 row_data jsonb;
 registration text;
 imported integer;
begin
 if actor is null or not private.has_company_role(company,array['owner','admin','sales']) then
  raise exception 'Access denied' using errcode='42501';
 end if;
 if submission is null or payload is null or jsonb_typeof(payload)!='array' then
  raise exception 'Invalid import payload' using errcode='22023';
 end if;
 if jsonb_array_length(payload) not between 1 and 500 or octet_length(payload::text)>1048576 then
  raise exception 'Invalid import size' using errcode='22023';
 end if;
 for entry in select value from jsonb_array_elements(payload) loop
  if jsonb_typeof(entry)!='object'
   or (select count(*) from jsonb_object_keys(entry))!=10
   or not entry ?& array['registration_number','make','model','model_year','mileage_km','fuel','gearbox','purchase_price_ore','asking_price_ore','vat_scheme'] then
   raise exception 'Invalid import fields' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_each(entry) f where f.key in ('registration_number','make','model','fuel','gearbox','vat_scheme') and jsonb_typeof(f.value)!='string')
   or exists(select 1 from jsonb_each(entry) f where f.key in ('model_year','mileage_km','purchase_price_ore','asking_price_ore') and (jsonb_typeof(f.value)!='number' or f.value::text !~ '^[0-9]{1,12}$')) then
   raise exception 'Invalid import types' using errcode='22023';
  end if;
  registration:=upper(regexp_replace(btrim(entry->>'registration_number'),'[[:space:]]','','g'));
  if registration !~ '^[A-Z0-9-]{2,15}$'
   or length(btrim(entry->>'make')) not between 1 and 160
   or length(btrim(entry->>'model')) not between 1 and 160
   or (entry->>'make') ~ '[[:cntrl:]]' or (entry->>'model') ~ '[[:cntrl:]]'
   or (entry->>'model_year')::bigint not between 1900 and least(2100,extract(year from current_date)::integer+2)
   or (entry->>'mileage_km')::bigint not between 0 and 3000000
   or (entry->>'purchase_price_ore')::bigint not between 0 and 999999999999
   or (entry->>'asking_price_ore')::bigint not between 1 and 999999999999
   or (entry->>'fuel') not in ('petrol','diesel','electric','hybrid','other')
   or (entry->>'gearbox') not in ('automatic','manual')
   or (entry->>'vat_scheme') not in ('standard','vmb','unknown') then
   raise exception 'Invalid import values' using errcode='22023';
  end if;
  row_data:=jsonb_build_object(
   'registration_number',registration,'make',btrim(entry->>'make'),'model',btrim(entry->>'model'),
   'model_year',(entry->>'model_year')::integer,'mileage_km',(entry->>'mileage_km')::integer,
   'fuel',entry->>'fuel','gearbox',entry->>'gearbox','purchase_price_ore',(entry->>'purchase_price_ore')::bigint,
   'asking_price_ore',(entry->>'asking_price_ore')::bigint,'vat_scheme',entry->>'vat_scheme');
  normalized:=normalized||jsonb_build_array(row_data);
 end loop;
 imported:=jsonb_array_length(normalized);
 if (select count(distinct value->>'registration_number') from jsonb_array_elements(normalized))!=imported then
  raise exception 'Duplicate import registration' using errcode='23505';
 end if;
 -- Serialize imports per tenant. Uniqueness on vehicles protects races with
 -- manual creation too; a conflict rolls back every row and the receipt.
 perform pg_advisory_xact_lock(hashtextextended('stock_import:'||company::text,0));
 -- Idempotence is guaranteed for retained receipts (7 days), with at most 100
 -- batches per tenant. Expired retries still cannot duplicate vehicle identity.
 delete from private.stock_import_batches b where b.company_id=company and b.created_at<now()-interval '7 days';
 select * into previous from private.stock_import_batches b
  where b.company_id=company and b.user_id=actor and b.submission_id=submission;
 if found then
  if previous.normalized_payload!=normalized then raise exception 'Import submission payload changed' using errcode='22023'; end if;
  return previous.row_count;
 end if;
 if (select count(*) from private.stock_import_batches b where b.company_id=company)>=100 then
  raise exception 'Import limit reached' using errcode='54000';
 end if;
 if exists(select 1 from public.vehicles v join jsonb_array_elements(normalized) r on r.value->>'registration_number'=upper(regexp_replace(v.registration_number,'[[:space:]]','','g')) where v.company_id=company) then
  raise exception 'Registration already exists' using errcode='23505';
 end if;
 for entry in select value from jsonb_array_elements(normalized) loop
  perform private.create_stock(company,entry->>'registration_number',entry->>'make',entry->>'model',
   (entry->>'model_year')::integer,(entry->>'mileage_km')::integer,entry->>'fuel',entry->>'gearbox',
   (entry->>'purchase_price_ore')::bigint,(entry->>'asking_price_ore')::bigint,entry->>'vat_scheme');
 end loop;
 insert into private.stock_import_batches(company_id,user_id,submission_id,normalized_payload,row_count)
 values(company,actor,submission,normalized,imported);
 return imported;
end $$;
revoke all on function private.import_stock_batch(uuid,uuid,jsonb) from public,anon;
grant execute on function private.import_stock_batch(uuid,uuid,jsonb) to authenticated;
create function public.import_stock_batch(company uuid,submission uuid,payload jsonb)
returns integer language sql security invoker set search_path='' as $$
 select private.import_stock_batch(company,submission,payload);
$$;
revoke all on function public.import_stock_batch(uuid,uuid,jsonb) from public,anon;
grant execute on function public.import_stock_batch(uuid,uuid,jsonb) to authenticated;
