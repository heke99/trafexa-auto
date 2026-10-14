begin;
create table private.purchase_condition_versions(id uuid primary key default gen_random_uuid(),company_id uuid not null,stock_id uuid not null,version integer not null check(version>0),snapshot jsonb not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),foreign key(company_id,stock_id) references public.stock_items(company_id,id),unique(company_id,stock_id,version));
create index purchase_condition_actor on private.purchase_condition_versions(created_by);
create table private.purchase_condition_audit(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),actor_user_id uuid not null references auth.users(id),request_id uuid not null,payload jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(actor_user_id,request_id));
create index purchase_condition_audit_company on private.purchase_condition_audit(company_id,created_at);
alter table private.purchase_condition_versions enable row level security;
alter table private.purchase_condition_audit enable row level security;
revoke all on private.purchase_condition_versions,private.purchase_condition_audit from public,anon,authenticated,service_role;
create function private.purchase_condition_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Immutable purchase/condition underlag' using errcode='55000';end$$;
create trigger purchase_condition_immutable before update or delete on private.purchase_condition_versions for each row execute function private.purchase_condition_immutable();
create trigger purchase_condition_audit_immutable before update or delete on private.purchase_condition_audit for each row execute function private.purchase_condition_immutable();
create function private.purchase_condition_access(p_company uuid) returns table(actor uuid,actor_role text) language plpgsql security invoker set search_path='' as $$declare a uuid;r text;begin
 select x.actor,x.actor_role into a,r from private.customer_contact_access(p_company,false)x;
 if r not in ('owner','admin','finance') then raise exception 'Private purchase access denied' using errcode='42501';end if;return query select a,r;end$$;
create function private.purchase_condition_json(p private.purchase_condition_versions) returns jsonb language sql set search_path='' as $$select p.snapshot||jsonb_build_object('id',p.id,'companyId',p.company_id,'stockId',p.stock_id,'version',p.version,'createdAt',p.created_at,'createdBy',p.created_by);$$;
create function private.purchase_condition_basis(s public.stock_items,v public.vehicles) returns jsonb language sql set search_path='' as $$select jsonb_build_object('purchasePriceOre',s.purchase_price_ore::text,'vatScheme',s.vat_scheme,'purchaseVatOre',s.purchase_vat_ore::text,'vatBasisConfirmed',s.vat_basis_confirmed,'calculationVersion',s.calculation_version::text,'vehicle',jsonb_build_object('id',v.id,'registration',v.registration_number,'make',v.make,'model',v.model,'modelYear',v.model_year,'mileageKm',v.mileage_km));$$;
create function private.purchase_condition_checks(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$declare k text;x jsonb;begin
 if p is null or jsonb_typeof(p)<>'object' or (select count(*) from jsonb_object_keys(p))<>6 or not p?&array['body','interior','engine','transmission','tyres','service'] then return false;end if;
 foreach k in array array['body','interior','engine','transmission','tyres','service'] loop
 x:=p->k;
 if jsonb_typeof(x)<>'object' or (select count(*) from jsonb_object_keys(x))<>2 or not x?&array['status','notes'] or jsonb_typeof(x->'status')<>'string' or x->>'status' not in ('unassessed','good','issues') or jsonb_typeof(x->'notes')<>'string' or length(x->>'notes')>1000 or (x->>'notes')<>btrim(x->>'notes') or translate(x->>'notes',E'\n\r\t','') ~ '[[:cntrl:]]' or (x->>'status'='issues' and length(x->>'notes')<2) then return false;end if;
 end loop;return true;
end$$;
revoke all on function private.purchase_condition_immutable(),private.purchase_condition_access(uuid),private.purchase_condition_json(private.purchase_condition_versions),private.purchase_condition_basis(public.stock_items,public.vehicles),private.purchase_condition_checks(jsonb) from public,anon,authenticated,service_role;
commit;
