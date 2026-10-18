-- Rollback-only real PostgreSQL smoke test. All fixture UUIDs must be unused.
begin;
do $$begin
 if exists(select 1 from private.demo_requests where request_id='ee140000-0000-4000-8000-000000000001')
 or exists(select 1 from auth.users where id='ee140000-0000-4000-8000-000000000002') then
 raise exception 'Fixture collision: abort without changing existing records';end if;
end$$;
set local role anon;
select public.submit_web_application('ee140000-0000-4000-8000-000000000001','Test contact','web-fixture@example.invalid','Fixture company','+46 70 123 45 67','556016-0680',array['system','advertising'],'Rollback-only application','2026-10-18',true);
select public.submit_web_application('ee140000-0000-4000-8000-000000000001','Test contact','web-fixture@example.invalid','Fixture company','+46 70 123 45 67','165560160680',array['advertising','system'],'Rollback-only application','2026-10-18',true);
do $$begin
 begin perform public.submit_web_application('ee140000-0000-4000-8000-000000000003','Test contact','web-fixture@example.invalid','Fixture company','+46 70 123 45 67','5560160681',array['system'],'Rollback-only application','2026-10-18',true);
 raise exception 'FAIL checksum accepted';exception when invalid_parameter_value then null;end;
 begin perform public.submit_demo_request('Legacy contact','web-fixture@example.invalid','Fixture company',null,null);
 raise exception 'FAIL old intake accepted';exception when insufficient_privilege then null;end;
 begin perform public.list_platform_contact_requests(null,50);
 raise exception 'FAIL anonymous list accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$begin
 if (select count(*) from private.demo_requests where request_id='ee140000-0000-4000-8000-000000000001')<>1 then raise exception 'FAIL nonce replay duplicated';end if;
 if not exists(select 1 from private.demo_requests where request_id='ee140000-0000-4000-8000-000000000001' and not legacy
  and organisation_number='5560160680' and privacy_acknowledged_at is not null and privacy_version='2026-10-18'
  and seeking=array['advertising','system']::text[]) then raise exception 'FAIL required stored fields';end if;
end$$;
select 'PASS: web application required fields, direct RPC boundaries and atomic replay' as result;
rollback;
