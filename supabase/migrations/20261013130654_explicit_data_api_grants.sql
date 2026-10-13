-- Supabase may assign default privileges to newly created tables. Remove those first.
revoke all on public.companies,public.memberships,public.customers,public.leads,public.vehicles,public.stock_items,public.vehicle_costs,public.deals,public.offers,public.reservations,public.finance_partners,public.dealer_approvals,public.finance_applications,public.documents,public.activities,public.audit_events from anon,authenticated;
grant select on public.companies,public.memberships,public.customers,public.leads,public.vehicles,public.stock_items,public.vehicle_costs,public.deals,public.offers,public.reservations,public.finance_partners,public.dealer_approvals,public.finance_applications,public.documents,public.activities,public.audit_events to authenticated;
grant insert on public.customers,public.leads,public.vehicle_costs,public.documents,public.finance_applications,public.activities to authenticated;
grant update on public.customers,public.leads,public.vehicles,public.vehicle_costs to authenticated;
grant update(asking_price_ore,vat_scheme) on public.stock_items to authenticated;
