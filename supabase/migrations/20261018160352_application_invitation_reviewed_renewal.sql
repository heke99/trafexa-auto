begin;
create function private.renew_platform_application_invitation(p_invitation_id uuid,p_expected_delivery_id uuid,p_expected_version integer,p_reason text,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid;app private.demo_requests;item private.application_account_invitations;delivery private.application_invitation_deliveries;
 prior private.application_invitation_renewals;payload jsonb;receipt jsonb;generation uuid:=gen_random_uuid();
begin
 actor:=private.account_approval_admin_identity();
 if p_invitation_id is null or p_expected_delivery_id is null or p_request_id is null or p_expected_version is null or p_expected_version<1
 or p_reason is null or p_reason<>btrim(p_reason) or length(p_reason) not between 2 and 500 or p_reason ~ '[[:cntrl:]]' then
  raise exception 'Invalid reviewed renewal' using errcode='22023';end if;
 payload:=jsonb_build_object('invitationId',p_invitation_id,'expectedDeliveryId',p_expected_delivery_id,'expectedVersion',p_expected_version,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended('trafexa-application-invite-renew:'||actor::text||':'||p_request_id::text,0));
 select d.* into app from private.demo_requests d join private.application_account_invitations i on i.application_id=d.id where i.id=p_invitation_id for update of d;
 if not found then raise exception 'Application unavailable' using errcode='P0002';end if;
 select * into item from private.application_account_invitations where id=p_invitation_id for update;
 select * into prior from private.application_invitation_renewals where actor_user_id=actor and request_id=p_request_id;
 if found then
  if prior.request_payload is distinct from payload then raise exception 'Renewal request conflict' using errcode='40001';end if;
  return prior.receipt;
 end if;
 item:=private.application_invitation_delivery_context(p_invitation_id,actor);
 if app.version<>p_expected_version or item.user_id is null then raise exception 'Renewal review conflict' using errcode='40001';end if;
 -- Context locks actual Auth and approval. Re-read verified state after that wait;
 -- an activated or revoked account can never receive a regenerated invite.
 if not exists(select 1 from auth.users where id=item.user_id and email_confirmed_at is null) then
  raise exception 'Account already verified' using errcode='40001';end if;
 select * into delivery from private.application_invitation_deliveries where invitation_id=item.id for update;
 if not found or delivery.delivery_id<>p_expected_delivery_id
 or (delivery.state in ('generating','sending') and delivery.lease_until>clock_timestamp())
 or not (delivery.state in ('sent','rejected','unknown') or delivery.state='sending' and delivery.lease_until<=clock_timestamp()
  or delivery.state='pending' and delivery.ciphertext is not null and (delivery.attempt_count>=5 or delivery.first_attempt_at<=clock_timestamp()-interval '23 hours')) then
  raise exception 'Delivery renewal conflict' using errcode='40001';end if;
 insert into private.application_invitation_delivery_history(delivery_id,invitation_id,actor_user_id,state,lease_id,lease_until,first_attempt_at,attempt_count,provider_id,created_at,updated_at)
 values(delivery.delivery_id,item.id,actor,case when delivery.state='sending' or delivery.state='pending' then 'unknown' else delivery.state end,
  delivery.lease_id,delivery.lease_until,delivery.first_attempt_at,delivery.attempt_count,delivery.provider_id,delivery.created_at,delivery.updated_at);
 update private.application_invitation_deliveries set delivery_id=generation,state='pending',lease_id=null,lease_until=null,ciphertext=null,
  first_attempt_at=null,attempt_count=0,provider_id=null,created_at=clock_timestamp(),updated_at=clock_timestamp() where invitation_id=item.id;
 receipt:=jsonb_build_object('invitation',private.application_account_invitation_json(item),'deliveryId',generation,
  'previousDeliveryId',p_expected_delivery_id,'requestId',p_request_id,'reason',p_reason,'applicationVersion',app.version);
 insert into private.application_invitation_renewals(actor_user_id,request_id,invitation_id,previous_delivery_id,delivery_id,application_version,reason,request_payload,receipt)
 values(actor,p_request_id,item.id,p_expected_delivery_id,generation,app.version,p_reason,payload,receipt);
 return receipt;
end$$;
revoke all on function private.renew_platform_application_invitation(uuid,uuid,integer,text,uuid) from public,anon,service_role;
grant execute on function private.renew_platform_application_invitation(uuid,uuid,integer,text,uuid) to authenticated;
create function public.renew_platform_application_invitation(p_invitation_id uuid,p_expected_delivery_id uuid,p_expected_version integer,p_reason text,p_request_id uuid) returns jsonb
 language sql security invoker set search_path='' as $$select private.renew_platform_application_invitation(p_invitation_id,p_expected_delivery_id,p_expected_version,p_reason,p_request_id);$$;
revoke all on function public.renew_platform_application_invitation(uuid,uuid,integer,text,uuid) from public,anon,service_role;
grant execute on function public.renew_platform_application_invitation(uuid,uuid,integer,text,uuid) to authenticated;
commit;
