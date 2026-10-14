-- Synthetic-only live smoke test. Roll back every application, identity and audit.
begin;
do $$begin
 if exists(select 1 from auth.users where id='ee140000-0000-4000-8000-000000000002')
 or exists(select 1 from private.demo_requests where request_id='ee140000-0000-4000-8000-000000000004')
 or exists(select 1 from private.web_application_erasure_tombstones where request_id='ee140000-0000-4000-8000-000000000006') then
 raise exception 'Fixture collision: abort without changing existing records';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at,is_anonymous) values('ee140000-0000-4000-8000-000000000002','web-admin-fixture@example.invalid',now(),false);
insert into private.platform_admins(user_id,created_by) values('ee140000-0000-4000-8000-000000000002','ee140000-0000-4000-8000-000000000002');
set local role anon;
select public.submit_web_application('ee140000-0000-4000-8000-000000000004','Test contact','web-admin-case@example.invalid','Fixture company','0701234567','5568554884',array['system'],'Rollback-only application','2026-10-14',true);
reset role;
create temporary table web_case_fixture(id uuid);
insert into web_case_fixture select id from private.demo_requests where request_id='ee140000-0000-4000-8000-000000000004';
grant select on web_case_fixture to authenticated;
select set_config('request.jwt.claim.sub','ee140000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$declare app uuid; detail jsonb; receipt jsonb;begin
 select id into strict app from web_case_fixture;
 detail:=public.get_platform_web_application(app);
 if detail->'application'->>'organisation_number'<>'5568554884' or detail->'application'->>'phone'<>'0701234567'
 or detail->'application'->>'privacy_version'<>'2026-10-14' then raise exception 'FAIL admin complete fields';end if;
 receipt:=public.set_platform_web_application_status(app,1,'contacted','Rollback-only contact','ee140000-0000-4000-8000-000000000005');
 if receipt->>'status'<>'contacted' or (receipt->>'version')::int<>2 then raise exception 'FAIL status CAS';end if;
 if receipt is distinct from public.set_platform_web_application_status(app,1,'contacted','Rollback-only contact','ee140000-0000-4000-8000-000000000005') then raise exception 'FAIL status exact retry';end if;
 receipt:=public.erase_platform_web_application(app,2,'no_longer_needed','ee140000-0000-4000-8000-000000000006');
 if (receipt->>'erased')::boolean is distinct from true then raise exception 'FAIL explicit erasure';end if;
 if receipt is distinct from public.erase_platform_web_application(app,2,'no_longer_needed','ee140000-0000-4000-8000-000000000006') then raise exception 'FAIL erasure exact retry';end if;
end$$;
reset role;
do $$begin
 if exists(select 1 from private.demo_requests where request_id='ee140000-0000-4000-8000-000000000004')
 or exists(select 1 from private.web_application_status_audit where application_id=(select id from web_case_fixture)) then raise exception 'FAIL application fields/history retained';end if;
end$$;
set local role anon;
do $$begin
 begin perform public.submit_web_application('ee140000-0000-4000-8000-000000000004','Test contact','web-admin-case@example.invalid','Fixture company','0701234567','5568554884',array['system'],'Rollback-only application','2026-10-14',true);
 raise exception 'FAIL erased nonce resurrected';exception when serialization_failure then null;end;
end$$;
reset role;
select 'PASS: admin details, status CAS, exact retry, explicit erasure and no resurrection' as result;
rollback;
