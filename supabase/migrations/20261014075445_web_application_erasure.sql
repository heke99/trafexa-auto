create function private.erase_platform_web_application(p_application_id uuid,p_expected_version integer,p_reason text,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();item private.demo_requests;receipt private.web_application_erasure_tombstones;
begin
 perform 1 from auth.users u where u.id=actor and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
 and not coalesce(u.is_sso_user,false) and (u.banned_until is null or u.banned_until<=now()) for share;
 if not found or current_setting('role',true)<>'authenticated' then raise exception 'Platform administrator required' using errcode='42501';end if;
 perform 1 from private.platform_admins a where a.user_id=actor and a.status='active' for share;
 if not found then raise exception 'Platform administrator required' using errcode='42501';end if;
 if p_application_id is null or p_request_id is null or p_expected_version is null or p_expected_version<1
 or p_reason is null or p_reason not in ('rights_request','no_longer_needed') then raise exception 'Invalid erasure request' using errcode='22023';end if;
 -- Shares intake's ordering lock so an old anonymous nonce cannot resurrect PII.
 perform pg_advisory_xact_lock(97261013);
 select * into receipt from private.web_application_erasure_tombstones where actor_user_id=actor and request_id=p_request_id;
 if found then
  if receipt.application_id<>p_application_id or receipt.expected_version<>p_expected_version or receipt.reason<>p_reason then
   raise exception 'Application erasure conflict' using errcode='40001';end if;
 else
  select * into item from private.demo_requests where id=p_application_id for update;
  if not found then raise exception 'Application unavailable' using errcode='P0002';end if;
  if item.version<>p_expected_version then raise exception 'Application erasure conflict' using errcode='40001';end if;
  insert into private.web_application_erasure_tombstones(application_id,submission_request_id,actor_user_id,request_id,expected_version,reason)
   values(item.id,item.request_id,actor,p_request_id,p_expected_version,p_reason) returning * into receipt;
  delete from private.web_application_status_audit where application_id=item.id;
  delete from private.demo_requests where id=item.id;
 end if;
 return jsonb_build_object('application_id',receipt.application_id,'actor_user_id',receipt.actor_user_id,'request_id',receipt.request_id,
 'expected_version',receipt.expected_version,'erased',true,'reason',receipt.reason,'created_at',receipt.created_at);
end $$;
revoke all on function private.erase_platform_web_application(uuid,integer,text,uuid) from public,anon,service_role;
grant execute on function private.erase_platform_web_application(uuid,integer,text,uuid) to authenticated;
create function public.erase_platform_web_application(p_application_id uuid,p_expected_version integer,p_reason text,p_request_id uuid) returns jsonb
 language sql security invoker set search_path='' as $$select private.erase_platform_web_application(p_application_id,p_expected_version,p_reason,p_request_id);$$;
revoke all on function public.erase_platform_web_application(uuid,integer,text,uuid) from public,anon,service_role;
grant execute on function public.erase_platform_web_application(uuid,integer,text,uuid) to authenticated;

revoke execute on function public.submit_demo_request(text,text,text,text,text) from public,anon,authenticated,service_role;
revoke execute on function private.submit_demo_request(text,text,text,text,text) from public,anon,authenticated,service_role;
