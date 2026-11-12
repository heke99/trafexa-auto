-- Exactly-once creation for the app's cost-request protocol. Legacy direct
-- table INSERT remains a separate explicit write API; no value-based dedupe.
begin;
create table private.vehicle_cost_creation_requests (
 actor_user_id uuid not null references auth.users(id),
 request_id uuid not null,
 company_id uuid not null references public.companies(id),
 cost_id uuid not null references public.vehicle_costs(id),
 payload jsonb not null,
 receipt jsonb not null,
 primary key(actor_user_id,request_id),
 check(receipt->>'actorId'=actor_user_id::text and receipt->>'requestId'=request_id::text
   and receipt->>'companyId'=company_id::text and receipt->>'recordId'=cost_id::text
   and receipt->>'kind'='vehicle_cost')
);
alter table private.vehicle_cost_creation_requests enable row level security;
revoke all on private.vehicle_cost_creation_requests from public,anon,authenticated,service_role;
create function private.vehicle_cost_creation_request_immutable() returns trigger
language plpgsql set search_path='' as $$begin
 raise exception 'Cost creation receipts are immutable' using errcode='55000';
end$$;
revoke all on function private.vehicle_cost_creation_request_immutable() from public,anon,authenticated,service_role;
create trigger vehicle_cost_creation_request_immutable before update or delete on private.vehicle_cost_creation_requests
 for each row execute function private.vehicle_cost_creation_request_immutable();

create function private.create_vehicle_cost_request(p_company_id uuid,p_request_id uuid,p_stock_item_id uuid,p_category text,p_description text,p_amount_ore bigint,p_incurred_on date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;actor_role text;payload jsonb;prior private.vehicle_cost_creation_requests;cost public.vehicle_costs;saved jsonb;
begin
 -- This verifies current Auth, approval, active company and owner/admin role,
 -- locking identity and company before the request lookup and financial write.
 select x.actor,x.actor_role into actor,actor_role from private.internal_inventory_scope(p_company_id,true)x;
 if p_request_id is null or p_stock_item_id is null or p_category is null
 or p_category not in('repair','transport','inspection','finance','other')
 or p_description is null or length(p_description) not between 1 and 500
 or p_description<>btrim(p_description) or p_description ~ '[[:cntrl:]]'
 or p_description ~ ('['||chr(128)||'-'||chr(159)||']')
 or p_amount_ore is null or p_amount_ore not between 0 and 999999999999
 or p_incurred_on is null or p_incurred_on<'0001-01-01'::date or p_incurred_on>'9999-12-31'::date then
 raise exception 'Reviewed cost input required' using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company_id,'stockItemId',p_stock_item_id,'category',p_category,'description',p_description,'amountOre',p_amount_ore::text,'incurredOn',p_incurred_on);
 select * into prior from private.vehicle_cost_creation_requests where actor_user_id=actor and request_id=p_request_id;
 if found then
  if prior.company_id<>p_company_id or prior.payload<>payload then raise exception 'Cost request reused with different input' using errcode='40001';end if;
  return prior.receipt;
 end if;
 perform 1 from public.stock_items where company_id=p_company_id and id=p_stock_item_id for update;
 if not found then raise exception 'Stock item unavailable' using errcode='42501';end if;
 insert into public.vehicle_costs(company_id,stock_item_id,category,description,amount_ore,incurred_on)
 values(p_company_id,p_stock_item_id,p_category,p_description,p_amount_ore,p_incurred_on) returning * into cost;
 saved:=jsonb_build_object('companyId',p_company_id,'actorId',actor,'requestId',p_request_id,'kind','vehicle_cost','recordId',cost.id,
   'stockItemId',cost.stock_item_id,'category',cost.category,'description',cost.description,'amountOre',cost.amount_ore::text,'incurredOn',cost.incurred_on,'createdAt',cost.created_at);
 insert into private.vehicle_cost_creation_requests(actor_user_id,request_id,company_id,cost_id,payload,receipt)
 values(actor,p_request_id,p_company_id,cost.id,payload,saved);
 return saved;
end$$;
revoke all on function private.create_vehicle_cost_request(uuid,uuid,uuid,text,text,bigint,date) from public,anon,authenticated,service_role;
grant execute on function private.create_vehicle_cost_request(uuid,uuid,uuid,text,text,bigint,date) to authenticated;
create function public.create_vehicle_cost_request(p_company_id uuid,p_request_id uuid,p_stock_item_id uuid,p_category text,p_description text,p_amount_ore bigint,p_incurred_on date)
returns jsonb language sql security invoker set search_path='' as $$
 select private.create_vehicle_cost_request(p_company_id,p_request_id,p_stock_item_id,p_category,p_description,p_amount_ore,p_incurred_on)
$$;
revoke all on function public.create_vehicle_cost_request(uuid,uuid,uuid,text,text,bigint,date) from public,anon,authenticated,service_role;
grant execute on function public.create_vehicle_cost_request(uuid,uuid,uuid,text,text,bigint,date) to authenticated;
commit;
