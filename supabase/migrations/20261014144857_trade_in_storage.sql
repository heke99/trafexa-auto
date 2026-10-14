begin;
create table private.trade_in_versions(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,deal_id uuid not null,customer_id uuid not null,version integer not null check(version>0),
 registration text not null check(length(registration) between 2 and 15 and registration=upper(btrim(registration)) and registration !~ '[[:cntrl:]]'),
 make text not null check(length(make) between 2 and 160 and make=btrim(make) and make !~ '[[:cntrl:]]'),model text not null check(length(model) between 2 and 160 and model=btrim(model) and model !~ '[[:cntrl:]]'),
 model_year integer not null check(model_year between 1900 and 9999),mileage_km integer not null check(mileage_km between 0 and 2000000),
 condition_notes text not null check(length(condition_notes)<=2000 and condition_notes=btrim(condition_notes) and translate(condition_notes,E'\n\r\t','') !~ '[[:cntrl:]]'),
 equipment_notes text not null check(length(equipment_notes)<=2000 and equipment_notes=btrim(equipment_notes) and translate(equipment_notes,E'\n\r\t','') !~ '[[:cntrl:]]'),
 value_ore bigint not null check(value_ore between 1 and 999999999999),debt_known boolean not null,debt_ore bigint check(debt_ore between 0 and 999999999999),lender_name text check(length(lender_name) between 1 and 160 and lender_name=btrim(lender_name) and lender_name !~ '[[:cntrl:]]'),
 sale_price_ore bigint not null check(sale_price_ore between 1 and 999999999999),net_trade_in_ore bigint,amount_to_pay_ore bigint,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,deal_id) references public.deals(company_id,id),foreign key(company_id,customer_id) references public.customers(company_id,id),unique(company_id,deal_id,version),
 check((not debt_known and debt_ore is null and net_trade_in_ore is null and amount_to_pay_ore is null) or (debt_known and debt_ore is not null and net_trade_in_ore is not null and amount_to_pay_ore is not null and net_trade_in_ore=value_ore-debt_ore and amount_to_pay_ore=sale_price_ore-net_trade_in_ore))
);
create index trade_in_customer on private.trade_in_versions(company_id,customer_id);
create index trade_in_actor on private.trade_in_versions(created_by);
create table private.trade_in_audit(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),actor_user_id uuid not null references auth.users(id),request_id uuid not null,payload jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(actor_user_id,request_id));
create index trade_in_audit_company on private.trade_in_audit(company_id,created_at);
alter table private.trade_in_versions enable row level security;
alter table private.trade_in_audit enable row level security;
revoke all on private.trade_in_versions,private.trade_in_audit from public,anon,authenticated,service_role;
create function private.trade_in_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Immutable trade-in' using errcode='55000';end$$;
create trigger trade_in_immutable before update or delete on private.trade_in_versions for each row execute function private.trade_in_immutable();
create trigger trade_in_audit_immutable before update or delete on private.trade_in_audit for each row execute function private.trade_in_immutable();
create function private.trade_in_json(t private.trade_in_versions) returns jsonb language sql set search_path='' as $$select jsonb_build_object('id',t.id,'companyId',t.company_id,'dealId',t.deal_id,'customerId',t.customer_id,'version',t.version,'registration',t.registration,'make',t.make,'model',t.model,'modelYear',t.model_year,'mileageKm',t.mileage_km,'conditionNotes',t.condition_notes,'equipmentNotes',t.equipment_notes,'valueOre',t.value_ore::text,'debtKnown',t.debt_known,'debtOre',t.debt_ore::text,'lenderName',t.lender_name,'salePriceOre',t.sale_price_ore::text,'netTradeInOre',t.net_trade_in_ore::text,'amountToPayOre',t.amount_to_pay_ore::text,'createdAt',t.created_at,'createdBy',t.created_by);$$;
revoke all on function private.trade_in_immutable(),private.trade_in_json(private.trade_in_versions) from public,anon,authenticated,service_role;
commit;
