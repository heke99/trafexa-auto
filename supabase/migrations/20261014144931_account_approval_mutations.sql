begin;
create function private.set_platform_account_access(p_user_id uuid,p_expected_version integer,p_status text,p_reason text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; a private.account_approvals%rowtype; u auth.users%rowtype; previous_status text; previous_version integer; payload jsonb; receipt jsonb; prior private.account_approval_audit%rowtype; changed boolean; begin
 actor:=private.account_approval_admin_identity();
 if p_user_id is null or p_user_id=actor or p_request_id is null or p_expected_version is null or p_expected_version<0 or p_expected_version=2147483647
  or p_status is null or p_status not in ('approved','rejected','suspended') or p_reason is null or p_reason<>btrim(p_reason) or length(p_reason) not between 2 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception 'Invalid account mutation' using errcode='22023';end if;
 select * into u from auth.users where id=p_user_id for update;
 if not found or u.email is null or coalesce(u.is_anonymous,false) or coalesce(u.is_sso_user,false) then raise exception 'Account missing' using errcode='P0002';end if;
 -- Every platform registry entry is protected, including suspended admins.
 perform 1 from private.platform_admins where user_id=p_user_id for share;
 if found then raise exception 'Platform registry is independently administered' using errcode='42501';end if;
 payload:=jsonb_build_object('userId',p_user_id,'expectedVersion',p_expected_version,'status',p_status,'reason',p_reason);
 select * into prior from private.account_approval_audit where actor_user_id=actor and request_id=p_request_id;
 if found then
  if prior.payload is distinct from payload then raise exception 'Request payload conflict' using errcode='40001';end if;
  if private.account_approval_admin_identity()<>actor then raise exception 'Admin changed' using errcode='42501';end if;
  return prior.receipt;
 end if;
 select * into a from private.account_approvals where user_id=p_user_id for update;
 previous_status:=coalesce(a.status,'pending');previous_version:=coalesce(a.version,0);
 if previous_version<>p_expected_version then raise exception 'Account version conflict' using errcode='40001';end if;
 if p_status='approved' and (u.email_confirmed_at is null or (u.banned_until is not null and u.banned_until>clock_timestamp()) or
  (select count(*) from auth.users x where lower(btrim(x.email))=lower(btrim(u.email)) and not coalesce(x.is_anonymous,false) and not coalesce(x.is_sso_user,false))<>1) then raise exception 'Verified unique account required' using errcode='42501';end if;
 changed:=previous_status<>p_status;
 if changed then
  insert into private.account_approvals(user_id,status,version,updated_by) values(p_user_id,p_status,previous_version+1,actor)
   on conflict(user_id) do update set status=excluded.status,version=excluded.version,updated_by=excluded.updated_by,updated_at=clock_timestamp() returning * into a;
 end if;
 receipt:=jsonb_build_object('actorUserId',actor,'userId',p_user_id,'requestId',p_request_id,'previousStatus',previous_status,'status',p_status,
 'version',previous_version+case when changed then 1 else 0 end,'changed',changed,'reason',p_reason,'createdAt',clock_timestamp());
 insert into private.account_approval_audit(actor_user_id,user_id,request_id,payload,receipt,reason) values(actor,p_user_id,p_request_id,payload,receipt,p_reason);
 if private.account_approval_admin_identity()<>actor then raise exception 'Admin changed' using errcode='42501';end if;
 return receipt;
exception when unique_violation then raise exception 'Account request conflict' using errcode='40001';
end $$;
revoke all on function private.set_platform_account_access(uuid,integer,text,text,uuid) from public,anon,service_role;
grant execute on function private.set_platform_account_access(uuid,integer,text,text,uuid) to authenticated;
create function public.set_platform_account_access(p_user_id uuid,p_expected_version integer,p_status text,p_reason text,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.set_platform_account_access(p_user_id,p_expected_version,p_status,p_reason,p_request_id);$$;
revoke all on function public.set_platform_account_access(uuid,integer,text,text,uuid) from public,anon,service_role;
grant execute on function public.set_platform_account_access(uuid,integer,text,text,uuid) to authenticated;
commit;
