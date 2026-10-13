-- Lifecycle writes only through authorized transaction functions.
revoke insert on public.vehicles,public.stock_items from authenticated;
create policy deny_direct_demo_access on private.demo_requests for all to anon,authenticated using(false) with check(false);
create index companies_creator_idx on public.companies(created_by);
create index leads_customer_idx on public.leads(company_id,customer_id);
create index deals_customer_idx on public.deals(company_id,customer_id);
create index deals_stock_idx on public.deals(company_id,stock_item_id);
create index deals_creator_idx on public.deals(created_by);
create index reservations_stock_company_idx on public.reservations(company_id,stock_item_id);
create index reservations_creator_idx on public.reservations(created_by);
create index finance_applications_deal_idx on public.finance_applications(company_id,deal_id);
create index finance_applications_creator_idx on public.finance_applications(created_by);
create index activities_customer_idx on public.activities(company_id,customer_id);
create index activities_deal_idx on public.activities(company_id,deal_id);
create index activities_creator_idx on public.activities(created_by);
create index audit_actor_idx on public.audit_events(actor_user_id);
