-- Synthetic collision-checked rollback only. No email, provider or inventory side effect.
begin;
-- BEGIN BRANCH FIXTURES
do $$begin
 if exists(select 1 from auth.users where id::text like 'fd180000-0000-4000-8000-%')or exists(select 1 from public.companies where id::text like 'fd180000-0000-4000-8000-%')then raise exception 'Branches fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at,is_anonymous)values
 ('fd180000-0000-4000-8000-000000000001','branches-owner@fixture.invalid',now(),false),
 ('fd180000-0000-4000-8000-000000000002','branches-admin@fixture.invalid',now(),false),
 ('fd180000-0000-4000-8000-000000000003','branches-second-admin@fixture.invalid',now(),false),
 ('fd180000-0000-4000-8000-000000000004','branches-foreign@fixture.invalid',now(),false),
 ('fd180000-0000-4000-8000-000000000005','branches-sales@fixture.invalid',now(),false),
 ('fd180000-0000-4000-8000-000000000006','branches-finance@fixture.invalid',now(),false),
 ('fd180000-0000-4000-8000-000000000007','branches-viewer@fixture.invalid',now(),false),
 ('fd180000-0000-4000-8000-000000000008','branches-pending@fixture.invalid',now(),false);
insert into private.account_approvals(user_id,status,updated_by)select id,case when id='fd180000-0000-4000-8000-000000000008' then 'pending' else 'approved' end,'fd180000-0000-4000-8000-000000000001'from auth.users where id::text like 'fd180000-0000-4000-8000-%';
insert into public.companies(id,name,organisation_number,created_by)values
 ('fd180000-0000-4000-8000-000000000101','Branches fixture A','5568554884','fd180000-0000-4000-8000-000000000001'),
 ('fd180000-0000-4000-8000-000000000102','Branches fixture B','5568554884','fd180000-0000-4000-8000-000000000004');
insert into public.memberships(id,company_id,user_id,role)values
 ('fd180000-0000-4000-8000-000000000201','fd180000-0000-4000-8000-000000000101','fd180000-0000-4000-8000-000000000001','owner'),
 ('fd180000-0000-4000-8000-000000000202','fd180000-0000-4000-8000-000000000101','fd180000-0000-4000-8000-000000000002','admin'),
 ('fd180000-0000-4000-8000-000000000203','fd180000-0000-4000-8000-000000000101','fd180000-0000-4000-8000-000000000003','admin'),
 ('fd180000-0000-4000-8000-000000000204','fd180000-0000-4000-8000-000000000102','fd180000-0000-4000-8000-000000000004','owner'),
 ('fd180000-0000-4000-8000-000000000205','fd180000-0000-4000-8000-000000000101','fd180000-0000-4000-8000-000000000005','sales'),
 ('fd180000-0000-4000-8000-000000000206','fd180000-0000-4000-8000-000000000101','fd180000-0000-4000-8000-000000000006','finance'),
 ('fd180000-0000-4000-8000-000000000207','fd180000-0000-4000-8000-000000000101','fd180000-0000-4000-8000-000000000007','viewer'),
 ('fd180000-0000-4000-8000-000000000208','fd180000-0000-4000-8000-000000000101','fd180000-0000-4000-8000-000000000008','owner');
-- END BRANCH FIXTURES
create temporary table branch_proof(k text primary key,v jsonb);grant select,insert on branch_proof to authenticated;
set local role authenticated;set local request.jwt.claim.sub='fd180000-0000-4000-8000-000000000001';
insert into branch_proof values('created',public.save_company_branch('fd180000-0000-4000-8000-000000000101','fd180000-0000-4000-8000-000000000301',0,'{"code":"stockholm","name":"Stockholm Åäö","addressLine1":"Bilvägen 1","postalCode":"11122","city":"Stockholm","publicEmail":null,"publicPhone":null}',true,'fd180000-0000-4000-8000-000000000901'));
insert into branch_proof values('archived',public.set_company_branch_status('fd180000-0000-4000-8000-000000000101','fd180000-0000-4000-8000-000000000301',1,'archived','Granskad filialstängning',true,'fd180000-0000-4000-8000-000000000902'));
do $$declare r jsonb;begin
 r:=public.save_company_branch('fd180000-0000-4000-8000-000000000101','fd180000-0000-4000-8000-000000000301',0,'{"code":"stockholm","name":"Stockholm Åäö","addressLine1":"Bilvägen 1","postalCode":"11122","city":"Stockholm","publicEmail":null,"publicPhone":null}',true,'fd180000-0000-4000-8000-000000000901');
 if r is distinct from(select v from branch_proof where k='created')then raise exception 'Historical branch receipt changed';end if;
 if jsonb_array_length(public.list_company_branches('fd180000-0000-4000-8000-000000000101','active')->'branches')<>0 then raise exception 'Archived branch remained active';end if;
 if jsonb_array_length(public.list_company_branches('fd180000-0000-4000-8000-000000000101','archived')->'branches')<>1 then raise exception 'Archived branch missing';end if;
end$$;
set local request.jwt.claim.sub='fd180000-0000-4000-8000-000000000002';
insert into branch_proof values('reactivated',public.set_company_branch_status('fd180000-0000-4000-8000-000000000101','fd180000-0000-4000-8000-000000000301',2,'active','Butiken öppnar igen',true,'fd180000-0000-4000-8000-000000000903'));
do $$begin if(public.list_company_branches('fd180000-0000-4000-8000-000000000101','active')->'branches'->0->>'version')::integer<>3 then raise exception 'Wrong branch version';end if;end$$;
reset role;
do $$begin
 if(select count(*)from private.company_branch_audit where company_id='fd180000-0000-4000-8000-000000000101')<>3 then raise exception 'Wrong branch audit count';end if;
 if exists(select 1 from public.stock_items where company_id='fd180000-0000-4000-8000-000000000101')or exists(select 1 from private.advertising_connections where company_id='fd180000-0000-4000-8000-000000000101')then raise exception 'Unexpected external scope';end if;
end$$;
rollback;
