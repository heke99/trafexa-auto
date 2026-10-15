begin;
create function private.prepare_platform_application_invitation(p_application_id uuid,p_expected_version integer,p_reason text,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid; app private.demo_requests; item private.application_account_invitations; payload jsonb;
begin
 actor:=private.account_approval_admin_identity();
 if p_application_id is null or p_request_id is null or p_expected_version is null or p_expected_version<1
 or p_reason is null or p_reason<>btrim(p_reason) or length(p_reason) not between 2 and 500 or p_reason ~ '[[:cntrl:]]' then
  raise exception 'Invalid application invitation' using errcode='22023';end if;
 payload:=jsonb_build_object('applicationId',p_application_id,'expectedVersion',p_expected_version,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended('trafexa-application-invite-request:'||actor::text||':'||p_request_id::text,0));
 select * into app from private.demo_requests where id=p_application_id for update;
 if not found then raise exception 'Application unavailable' using errcode='P0002';end if;
 if app.legacy or app.status='closed' or app.version<>p_expected_version then raise exception 'Application invitation conflict' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended('trafexa-application-invite-email:'||lower(btrim(app.email)),0));
 select * into item from private.application_account_invitations where actor_user_id=actor and request_id=p_request_id for update;
 if found then
  if item.request_payload is distinct from payload then raise exception 'Application invitation conflict' using errcode='40001';end if;
  if item.user_id is null and item.expires_at<=clock_timestamp() then
   update private.application_account_invitations set expires_at=clock_timestamp()+interval '15 minutes' where id=item.id returning * into item;
  end if;
 else
  if exists(select 1 from private.application_account_invitations where application_id=app.id or email=lower(btrim(app.email))) then
   raise exception 'Application invitation conflict' using errcode='40001';end if;
  insert into private.application_account_invitations(application_id,application_version,actor_user_id,request_id,email,name,reason,request_payload)
  values(app.id,app.version,actor,p_request_id,lower(btrim(app.email)),app.name,p_reason,payload) returning * into item;
  perform private.adopt_unverified_application_account(item.id);
  select * into item from private.application_account_invitations where id=item.id;
 end if;
 return private.application_account_invitation_json(item);
end $$;
revoke all on function private.prepare_platform_application_invitation(uuid,integer,text,uuid) from public,anon,service_role;
grant execute on function private.prepare_platform_application_invitation(uuid,integer,text,uuid) to authenticated;
create function public.prepare_platform_application_invitation(p_application_id uuid,p_expected_version integer,p_reason text,p_request_id uuid) returns jsonb
 language sql security invoker set search_path='' as $$select private.prepare_platform_application_invitation(p_application_id,p_expected_version,p_reason,p_request_id);$$;
revoke all on function public.prepare_platform_application_invitation(uuid,integer,text,uuid) from public,anon,service_role;
grant execute on function public.prepare_platform_application_invitation(uuid,integer,text,uuid) to authenticated;
create function private.get_platform_application_invitation(p_application_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare item private.application_account_invitations;
begin
 perform private.account_approval_admin_identity();
 if p_application_id is null then raise exception 'Invalid application' using errcode='22023';end if;
 if not exists(select 1 from private.demo_requests where id=p_application_id) then raise exception 'Application unavailable' using errcode='P0002';end if;
 select * into item from private.application_account_invitations where application_id=p_application_id;
 return jsonb_build_object('applicationId',p_application_id,'invitation',case when found then private.application_account_invitation_json(item) else null end);
end $$;
revoke all on function private.get_platform_application_invitation(uuid) from public,anon,service_role;
grant execute on function private.get_platform_application_invitation(uuid) to authenticated;
create function public.get_platform_application_invitation(p_application_id uuid) returns jsonb
 language sql security invoker set search_path='' as $$select private.get_platform_application_invitation(p_application_id);$$;
revoke all on function public.get_platform_application_invitation(uuid) from public,anon,service_role;
grant execute on function public.get_platform_application_invitation(uuid) to authenticated;
commit;
