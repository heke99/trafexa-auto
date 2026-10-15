-- Synthetic fixture proof only. No external Auth API, delivery or customer records.
-- Every insert below is rolled back. Run cleanup read separately afterwards.
begin;
insert into auth.users(id,email,email_confirmed_at,is_anonymous,is_sso_user)
values('ea160000-0000-0000-0000-000000000901','invitation-proof-admin@example.invalid',now(),false,false);
insert into private.platform_admins(user_id,created_by)
values('ea160000-0000-0000-0000-000000000901','ea160000-0000-0000-0000-000000000901');
insert into private.demo_requests(id,request_id,name,email,company,phone,organisation_number,seeking,message,privacy_version,privacy_acknowledged_at,legacy)
values('ea160000-0000-0000-0000-000000000910','ea160000-0000-0000-0000-000000000911','Synthetic Invitation Proof','invitation-proof-recipient@example.invalid',
'Synthetic Invitation Proof','0701234567','5568554884',array['system'],'Synthetic invitation proof only','2026-10-14',now(),false);
set local role authenticated;
select set_config('request.jwt.claim.sub','ea160000-0000-0000-0000-000000000901',true);
do $$
declare invitation jsonb; replay jsonb; claim jsonb; busy jsonb;
begin
 invitation:=public.prepare_platform_application_invitation('ea160000-0000-0000-0000-000000000910',1,'Synthetic reviewed application','ea160000-0000-0000-0000-000000000930');
 if invitation->>'email'<>'invitation-proof-recipient@example.invalid' or invitation->>'status'<>'prepared' or invitation->>'userId' is not null then raise exception 'Invitation prepare proof failed';end if;
 replay:=public.prepare_platform_application_invitation('ea160000-0000-0000-0000-000000000910',1,'Synthetic reviewed application','ea160000-0000-0000-0000-000000000930');
 if invitation is distinct from replay then raise exception 'Invitation retry proof failed';end if;
 begin
  perform public.prepare_platform_application_invitation('ea160000-0000-0000-0000-000000000910',1,'Changed reason','ea160000-0000-0000-0000-000000000930');
  raise exception 'Changed nonce payload unexpectedly accepted';
 exception when serialization_failure then null;end;
 claim:=public.claim_platform_application_invitation_delivery((invitation->>'id')::uuid);
 busy:=public.claim_platform_application_invitation_delivery((invitation->>'id')::uuid);
 if claim->>'status'<>'generate' or busy->>'status'<>'busy' or claim->>'leaseId' is null then raise exception 'Invitation lease proof failed';end if;
 begin execute 'select ciphertext from private.application_invitation_deliveries';raise exception 'Browser ciphertext read unexpectedly accepted';exception when insufficient_privilege then null;end;
 begin
  perform public.get_platform_application_invitation_delivery((invitation->>'id')::uuid,(claim->>'leaseId')::uuid,'ea160000-0000-0000-0000-000000000901');
  raise exception 'Browser service RPC unexpectedly accepted';exception when insufficient_privilege then null;end;
end $$;
set local role service_role;
do $$begin
 begin execute 'select ciphertext from private.application_invitation_deliveries';raise exception 'Direct service ciphertext catalog unexpectedly accepted';exception when insufficient_privilege then null;end;
 begin perform public.get_platform_application_invitation('ea160000-0000-0000-0000-000000000910');raise exception 'Service administrator read unexpectedly accepted';exception when insufficient_privilege then null;end;
end $$;
set local role anon;
do $$begin
 begin perform public.get_platform_application_invitation('ea160000-0000-0000-0000-000000000910');raise exception 'Anonymous administrator read unexpectedly accepted';exception when insufficient_privilege then null;end;
end $$;
set local role postgres;
select jsonb_build_object('proof','PASS','preparedIntent',count(*)=1,'noRecipientAccount',not exists(select 1 from auth.users where email='invitation-proof-recipient@example.invalid')) result
from private.application_account_invitations where application_id='ea160000-0000-0000-0000-000000000910';
rollback;
