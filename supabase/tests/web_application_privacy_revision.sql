-- Rollback-only hosted proof: synthetic historical row, no Auth/account creation.
-- legacy=true intentionally avoids the transactional-email INSERT hook entirely.
-- Current-version positive insertion and genuine pre-upgrade replay are tested locally.
begin;
do $$begin
 if exists(select 1 from private.demo_requests where request_id in ('ec181800-0000-4000-8000-000000000901','ec181800-0000-4000-8000-000000000902') or email='policy-hosted-fixture@example.invalid')
 or exists(select 1 from private.transactional_email_outbox where reference_id in ('ec181800-0000-4000-8000-000000000901','ec181800-0000-4000-8000-000000000902'))
 or exists(select 1 from private.web_application_erasure_tombstones where submission_request_id in ('ec181800-0000-4000-8000-000000000901','ec181800-0000-4000-8000-000000000902')) then
 raise exception 'Fixture collision';end if;
end$$;
insert into private.demo_requests(request_id,name,email,company,phone,organisation_number,seeking,message,privacy_version,privacy_acknowledged_at,legacy)
values('ec181800-0000-4000-8000-000000000901','Historical Policy Fixture','policy-hosted-fixture@example.invalid','Policy Fixture AB','0701234567','5568554884',array['system'],'Historical notice replay fixture','2026-10-14','2026-10-14 12:00:00+00',true);
set local role anon;
do $$declare receipt jsonb;begin
 receipt:=public.submit_web_application('ec181800-0000-4000-8000-000000000901','Historical Policy Fixture','policy-hosted-fixture@example.invalid','Policy Fixture AB','0701234567','5568554884',array['system'],'Historical notice replay fixture','2026-10-14',true);
 if receipt is distinct from jsonb_build_object('request_id','ec181800-0000-4000-8000-000000000901','accepted',true) then raise exception 'Historical receipt mismatch';end if;
 begin
 perform public.submit_web_application('ec181800-0000-4000-8000-000000000902','Historical Policy Fixture','policy-hosted-fixture@example.invalid','Policy Fixture AB','0701234567','5568554884',array['system'],'Historical notice replay fixture','2026-10-14',true);
 raise exception 'Stale new request accepted';exception when invalid_parameter_value then null;end;
 begin
 perform public.submit_web_application('ec181800-0000-4000-8000-000000000901','Historical Policy Fixture','policy-hosted-fixture@example.invalid','Policy Fixture AB','0701234567','5568554884',array['system'],'Changed historical payload','2026-10-14',true);
 raise exception 'Historical payload changed';exception when serialization_failure then null;end;
end$$;
reset role;
do $$begin
 if (select count(*) from private.demo_requests where request_id in ('ec181800-0000-4000-8000-000000000901','ec181800-0000-4000-8000-000000000902'))<>1
 or not exists(select 1 from private.demo_requests where request_id='ec181800-0000-4000-8000-000000000901' and legacy and version=1 and privacy_version='2026-10-14' and privacy_acknowledged_at='2026-10-14 12:00:00+00')
 or exists(select 1 from private.transactional_email_outbox where reference_id in ('ec181800-0000-4000-8000-000000000901','ec181800-0000-4000-8000-000000000902')) then raise exception 'Historical state or no-email invariant failed';end if;
end$$;
select true as privacy_revision_proof_pass;
rollback;
