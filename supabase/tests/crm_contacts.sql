-- Rollback-only smoke contract. Dedicated synthetic fixtures, no real customer data.
begin;
do $$ begin
 if exists(select 1 from auth.users where id='ee140000-0000-4000-8000-000000000001')
 or exists(select 1 from public.companies where id='ee140000-0000-4000-8000-000000000002')
 or exists(select 1 from public.customers where id='ee140000-0000-4000-8000-000000000003') then
 raise exception 'CRM smoke fixture collision'; end if;
end $$;
insert into auth.users(id,email,email_confirmed_at) values('ee140000-0000-4000-8000-000000000001','crm-smoke-ee140000@example.invalid',now());
insert into public.companies(id,name,organisation_number,created_by) values('ee140000-0000-4000-8000-000000000002','CRM Rollback Fixture','9914000001','ee140000-0000-4000-8000-000000000001');
insert into public.memberships(company_id,user_id,role) values('ee140000-0000-4000-8000-000000000002','ee140000-0000-4000-8000-000000000001','owner');
insert into public.customers(id,company_id,name) values('ee140000-0000-4000-8000-000000000003','ee140000-0000-4000-8000-000000000002','CRM Fixture Customer');
set local role authenticated;
select set_config('request.jwt.claim.sub','ee140000-0000-4000-8000-000000000001',true);
do $$ declare receipt jsonb; replay jsonb; page jsonb; changed jsonb; begin
 receipt:=public.create_customer_contact('ee140000-0000-4000-8000-000000000002','ee140000-0000-4000-8000-000000000003','call',date '2026-10-01','Rollback contact',date '2026-10-02','ee140000-0000-4000-8000-000000000004');
 replay:=public.create_customer_contact('ee140000-0000-4000-8000-000000000002','ee140000-0000-4000-8000-000000000003','call',date '2026-10-01','Rollback contact',date '2026-10-02','ee140000-0000-4000-8000-000000000004');
 if replay is distinct from receipt or receipt->'contact'->>'createdBy'<>'ee140000-0000-4000-8000-000000000001' then raise exception 'CRM replay/actor failed'; end if;
 page:=public.list_customer_follow_ups('ee140000-0000-4000-8000-000000000002');
 if jsonb_array_length(page->'contacts')<>1 or page->'contacts'->0->>'customerName'<>'CRM Fixture Customer' then raise exception 'CRM due list failed'; end if;
 changed:=public.update_customer_follow_up('ee140000-0000-4000-8000-000000000002','ee140000-0000-4000-8000-000000000003',(receipt->'contact'->>'id')::uuid,1,'done','Contact completed','ee140000-0000-4000-8000-000000000005');
 if changed->'contact'->>'version'<>'2' then raise exception 'CRM CAS failed'; end if;
 page:=public.list_customer_follow_ups('ee140000-0000-4000-8000-000000000002');
 if jsonb_array_length(page->'contacts')<>0 then raise exception 'CRM done remained pending'; end if;
end $$;
select 'PASS: scoped contact creation, exact retry, due followup and audited CAS completion' as result;
rollback;
