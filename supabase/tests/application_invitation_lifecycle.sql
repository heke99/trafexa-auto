-- Rollback-only synthetic deployment proof. No recipient Auth account, Auth API,
-- token generation, encrypted payload, provider request or external mail.
-- Run application_invitation_lifecycle_cleanup.sql separately afterwards.
begin;
insert into auth.users(id,email,email_confirmed_at,is_anonymous,is_sso_user)
values('ee180000-0000-4000-8000-000000009901','lifecycle-proof-admin@example.invalid',now(),false,false);
insert into private.platform_admins(user_id,created_by)
values('ee180000-0000-4000-8000-000000009901','ee180000-0000-4000-8000-000000009901');
insert into private.demo_requests(id,request_id,name,email,company,phone,organisation_number,seeking,message,privacy_version,privacy_acknowledged_at,legacy)
values('ee180000-0000-4000-8000-000000009910','ee180000-0000-4000-8000-000000009911','Synthetic Lifecycle Proof',
'lifecycle-proof-recipient@example.invalid','Synthetic Lifecycle Proof','0701234567','5568554884',array['system'],'Synthetic rollback-only lifecycle proof','test',now(),false);
set local role authenticated;
select set_config('request.jwt.claim.sub','ee180000-0000-4000-8000-000000009901',true);
do $$declare i jsonb;d jsonb;r jsonb;begin
 i:=public.prepare_platform_application_invitation('ee180000-0000-4000-8000-000000009910',1,'Synthetic original review','ee180000-0000-4000-8000-000000009930');
 d:=public.claim_platform_application_invitation_delivery_v2((i->>'id')::uuid,null);
 perform set_config('trafexa.lifecycle_proof.invitation',i->>'id',true);
 perform set_config('trafexa.lifecycle_proof.old_delivery',d->>'deliveryId',true);
 perform set_config('trafexa.lifecycle_proof.old_lease',d->>'leaseId',true);
 r:=public.get_platform_application_invitation('ee180000-0000-4000-8000-000000009910');
 if d->>'deliveryId'<>i->>'id' or r#>>'{lifecycle,delivery,state}'<>'generating'
 or r#>>'{lifecycle,delivery,canRetry}'<>'false' or r#>>'{lifecycle,account,emailVerified}' is not null
 or r::text like '%ciphertext%' or r::text like '%leaseId%' then raise exception 'Lifecycle scope/read proof failed';end if;
end$$;
set local role postgres;
update private.demo_requests set status='contacted',version=2 where id='ee180000-0000-4000-8000-000000009910';
set local role authenticated;
do $$begin
 begin
  perform public.reprepare_platform_application_invitation(current_setting('trafexa.lifecycle_proof.invitation')::uuid,1,2,'Synthetic fresh review','ee180000-0000-4000-8000-000000009931');
  raise exception 'Live generation was incorrectly superseded';
 exception when serialization_failure then null;end;
end$$;
set local role postgres;
update private.application_invitation_deliveries set lease_until=clock_timestamp()-interval '1 second'
where invitation_id=current_setting('trafexa.lifecycle_proof.invitation')::uuid;
set local role authenticated;
do $$declare r jsonb;s jsonb;begin
 r:=public.reprepare_platform_application_invitation(current_setting('trafexa.lifecycle_proof.invitation')::uuid,1,2,'Synthetic fresh review','ee180000-0000-4000-8000-000000009931');
 s:=public.reprepare_platform_application_invitation(current_setting('trafexa.lifecycle_proof.invitation')::uuid,1,2,'Synthetic fresh review','ee180000-0000-4000-8000-000000009931');
 if r is distinct from s or r#>>'{invitation,applicationVersion}'<>'2' or r->>'deliveryId'=current_setting('trafexa.lifecycle_proof.old_delivery') then raise exception 'Fresh reviewed preparation proof failed';end if;
 begin
  perform public.claim_platform_application_invitation_delivery_v2(current_setting('trafexa.lifecycle_proof.invitation')::uuid,current_setting('trafexa.lifecycle_proof.old_delivery')::uuid);
  raise exception 'Old generation was incorrectly leased';
 exception when serialization_failure then null;end;
 begin execute 'select previous_approval from private.application_invitation_preparation_history';raise exception 'Browser read private review audit';exception when insufficient_privilege then null;end;
end$$;
set local role service_role;
do $$begin
 begin
  perform public.get_platform_application_invitation_delivery(current_setting('trafexa.lifecycle_proof.invitation')::uuid,current_setting('trafexa.lifecycle_proof.old_lease')::uuid,'ee180000-0000-4000-8000-000000009901');
  raise exception 'Old worker lease was incorrectly resumed';
 exception when serialization_failure then null;end;
 begin perform public.get_platform_application_invitation('ee180000-0000-4000-8000-000000009910');raise exception 'Service acquired administrator read';exception when insufficient_privilege then null;end;
end$$;
set local role postgres;
do $$begin
 if not exists(select 1 from private.application_invitation_preparation_history where invitation_id=current_setting('trafexa.lifecycle_proof.invitation')::uuid and previous_approval->>'applicationVersion'='1' and previous_approval->>'reason'='Synthetic original review')
 or not exists(select 1 from private.application_invitation_deliveries where invitation_id=current_setting('trafexa.lifecycle_proof.invitation')::uuid and state='pending' and lease_id is null and ciphertext is null and attempt_count=0)
 or exists(select 1 from auth.users where email='lifecycle-proof-recipient@example.invalid') then raise exception 'Audit/fencing/no-account proof failed';end if;
end$$;
select jsonb_build_object('proof','PASS','syntheticOnly',true,'recipientAccountCreated',false,'providerCalled',false) result;
rollback;
