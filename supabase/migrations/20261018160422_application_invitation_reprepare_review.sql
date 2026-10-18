begin;
create function private.reprepare_platform_application_invitation(p_invitation_id uuid,p_expected_application_version integer,p_expected_version integer,p_reason text,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid;app private.demo_requests;item private.application_account_invitations;delivery private.application_invitation_deliveries;
 prior private.application_invitation_preparation_history;payload jsonb;previous jsonb;old_delivery uuid;receipt jsonb;
begin
 actor:=private.account_approval_admin_identity();
 if p_invitation_id is null or p_request_id is null or p_expected_application_version is null or p_expected_application_version<1
 or p_expected_version is null or p_expected_version<=p_expected_application_version
 or p_reason is null or p_reason<>btrim(p_reason) or length(p_reason) not between 2 and 500 or p_reason ~ '[[:cntrl:]]' then
  raise exception 'Invalid fresh invitation review' using errcode='22023';end if;
 payload:=jsonb_build_object('invitationId',p_invitation_id,'previousVersion',p_expected_application_version,'expectedVersion',p_expected_version,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended('trafexa-application-invite-request:'||actor::text||':'||p_request_id::text,0));
 select d.* into app from private.demo_requests d join private.application_account_invitations i on i.application_id=d.id where i.id=p_invitation_id for update of d;
 if not found then raise exception 'Application unavailable' using errcode='P0002';end if;
 if app.legacy or app.status='closed' or app.version<>p_expected_version then raise exception 'Fresh review conflict' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended('trafexa-application-invite-email:'||lower(btrim(app.email)),0));
 select * into item from private.application_account_invitations where id=p_invitation_id for update;
 if item.actor_user_id<>actor or item.email<>lower(btrim(app.email)) then raise exception 'Original approver required' using errcode='42501';end if;
 select * into prior from private.application_invitation_preparation_history where actor_user_id=actor and request_id=p_request_id;
 if found then
  if prior.request_payload is distinct from payload then raise exception 'Fresh review nonce conflict' using errcode='40001';end if;
  return prior.receipt;
 end if;
 if item.user_id is not null or item.application_version<>p_expected_application_version or item.request_id=p_request_id
 or exists(select 1 from private.application_invitation_preparation_history where actor_user_id=actor and previous_request_id=p_request_id)
 or exists(select 1 from private.application_account_invitations where actor_user_id=actor and request_id=p_request_id)
 or exists(select 1 from auth.users where lower(btrim(email))=item.email) then raise exception 'Unconsumed invitation review conflict' using errcode='40001';end if;
 select * into delivery from private.application_invitation_deliveries where invitation_id=item.id for update;
 if found and (delivery.ciphertext is not null or delivery.attempt_count<>0 or delivery.state not in ('pending','generating')
 or delivery.state='generating' and delivery.lease_until>clock_timestamp()) then raise exception 'Generation still in progress' using errcode='40001';end if;
 previous:=private.application_account_invitation_json(item);old_delivery:=delivery.delivery_id;
 if delivery.invitation_id is not null then
  insert into private.application_invitation_delivery_history(delivery_id,invitation_id,actor_user_id,state,lease_id,lease_until,first_attempt_at,attempt_count,provider_id,created_at,updated_at)
  values(delivery.delivery_id,item.id,actor,'unknown',delivery.lease_id,delivery.lease_until,null,0,null,delivery.created_at,delivery.updated_at);
  update private.application_invitation_deliveries set delivery_id=gen_random_uuid(),state='pending',lease_id=null,lease_until=null,
   created_at=clock_timestamp(),updated_at=clock_timestamp() where invitation_id=item.id returning * into delivery;
 end if;
 update private.application_account_invitations set application_version=app.version,request_id=p_request_id,reason=p_reason,
  request_payload=jsonb_build_object('applicationId',app.id,'expectedVersion',app.version,'reason',p_reason),
  created_at=clock_timestamp(),expires_at=clock_timestamp()+interval '15 minutes' where id=item.id returning * into item;
 receipt:=jsonb_build_object('invitation',private.application_account_invitation_json(item),'deliveryId',delivery.delivery_id,'previousApplicationVersion',p_expected_application_version);
 insert into private.application_invitation_preparation_history(invitation_id,actor_user_id,previous_request_id,request_id,previous_approval,previous_delivery_id,request_payload,receipt)
 values(item.id,actor,(previous->>'requestId')::uuid,p_request_id,previous,old_delivery,payload,receipt);
 return receipt;
end$$;
revoke all on function private.reprepare_platform_application_invitation(uuid,integer,integer,text,uuid) from public,anon,service_role;
grant execute on function private.reprepare_platform_application_invitation(uuid,integer,integer,text,uuid) to authenticated;
commit;
