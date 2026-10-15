-- Synthetic rollback proof only: never delivers email or calls external systems.
begin;
-- BEGIN OWNERSHIP FIXTURES
do $$begin
 if exists(select 1 from auth.users where id::text like 'fd170000-0000-4000-8000-%')or exists(select 1 from public.companies where id::text like 'fd170000-0000-4000-8000-%')then raise exception 'Ownership fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at,is_anonymous)values
 ('fd170000-0000-4000-8000-000000000001','ownership-owner@fixture.invalid',now(),false),
 ('fd170000-0000-4000-8000-000000000002','ownership-admin@fixture.invalid',now(),false),
 ('fd170000-0000-4000-8000-000000000003','ownership-second-admin@fixture.invalid',now(),false),
 ('fd170000-0000-4000-8000-000000000004','ownership-foreign@fixture.invalid',now(),false),
 ('fd170000-0000-4000-8000-000000000005','ownership-sales@fixture.invalid',now(),false);
insert into private.account_approvals(user_id,status,updated_by)select id,'approved','fd170000-0000-4000-8000-000000000001'from auth.users where id::text like 'fd170000-0000-4000-8000-%';
insert into public.companies(id,name,organisation_number,created_by)values
 ('fd170000-0000-4000-8000-000000000101','Ownership fixture A','5568554884','fd170000-0000-4000-8000-000000000001'),
 ('fd170000-0000-4000-8000-000000000102','Ownership fixture B','5568554884','fd170000-0000-4000-8000-000000000004');
insert into public.memberships(id,company_id,user_id,role)values
 ('fd170000-0000-4000-8000-000000000201','fd170000-0000-4000-8000-000000000101','fd170000-0000-4000-8000-000000000001','owner'),
 ('fd170000-0000-4000-8000-000000000202','fd170000-0000-4000-8000-000000000101','fd170000-0000-4000-8000-000000000002','admin'),
 ('fd170000-0000-4000-8000-000000000203','fd170000-0000-4000-8000-000000000101','fd170000-0000-4000-8000-000000000003','admin'),
 ('fd170000-0000-4000-8000-000000000204','fd170000-0000-4000-8000-000000000102','fd170000-0000-4000-8000-000000000004','owner'),
 ('fd170000-0000-4000-8000-000000000205','fd170000-0000-4000-8000-000000000101','fd170000-0000-4000-8000-000000000005','sales');
-- END OWNERSHIP FIXTURES
create temporary table ownership_proof(k text primary key,v jsonb);grant select,insert on ownership_proof to authenticated;
set local role authenticated;
set local request.jwt.claim.sub='fd170000-0000-4000-8000-000000000001';
insert into ownership_proof values('requested',public.request_company_ownership_transfer('fd170000-0000-4000-8000-000000000101','fd170000-0000-4000-8000-000000000202',1,1,1,'Granskad intern ägarroll',true,'2026-10-15','fd170000-0000-4000-8000-000000000901'));
do $$begin if(public.get_company_ownership_transfer('fd170000-0000-4000-8000-000000000101')->>'canCancel')::boolean is not true then raise exception 'Owner cancellation unavailable';end if;end$$;
set local request.jwt.claim.sub='fd170000-0000-4000-8000-000000000002';
insert into ownership_proof select 'accepted',public.accept_company_ownership_transfer('fd170000-0000-4000-8000-000000000101',(v->'transfer'->>'id')::uuid,1,2,true,'2026-10-15','fd170000-0000-4000-8000-000000000902')from ownership_proof where k='requested';
do $$begin if(public.get_company_ownership_transfer('fd170000-0000-4000-8000-000000000101')->>'actorRole')<>'owner'then raise exception 'Recipient not owner';end if;end$$;
set local request.jwt.claim.sub='fd170000-0000-4000-8000-000000000001';
do $$declare r jsonb;begin
 r:=public.request_company_ownership_transfer('fd170000-0000-4000-8000-000000000101','fd170000-0000-4000-8000-000000000202',1,1,1,'Granskad intern ägarroll',true,'2026-10-15','fd170000-0000-4000-8000-000000000901');
 if r is distinct from(select v from ownership_proof where k='requested')then raise exception 'Historical replay changed';end if;
end$$;
reset role;
do $$begin
 if(select count(*)from public.memberships where company_id='fd170000-0000-4000-8000-000000000101'and role='owner'and status='active')<>1 then raise exception 'Owner count changed';end if;
 if(select created_by from public.companies where id='fd170000-0000-4000-8000-000000000101')<>'fd170000-0000-4000-8000-000000000001'::uuid then raise exception 'Creator history changed';end if;
 if(select count(*)from private.company_ownership_audit where company_id='fd170000-0000-4000-8000-000000000101')<>2 then raise exception 'Wrong audit count';end if;
end$$;
rollback;
