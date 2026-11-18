begin;
-- Only a boolean about the caller's own active memberships is exposed. Tenant RLS is unchanged.
create function private.get_my_company_access_status() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; suspended boolean; begin
 select user_id into actor from private.company_team_identity();
 select exists(select 1 from public.memberships m join public.companies c on c.id=m.company_id
  where m.user_id=actor and m.status='active' and c.status='suspended') into suspended;
 if (select user_id from private.company_team_identity()) is distinct from actor then raise exception 'Actor changed' using errcode='42501';end if;
 return jsonb_build_object('actorUserId',actor,'hasSuspendedCompany',suspended);
end $$;
revoke all on function private.get_my_company_access_status() from public,anon,authenticated,service_role;
grant execute on function private.get_my_company_access_status() to authenticated;
create function public.get_my_company_access_status() returns jsonb language sql security invoker set search_path='' as $$select private.get_my_company_access_status()$$;
revoke all on function public.get_my_company_access_status() from public,anon,authenticated,service_role;
grant execute on function public.get_my_company_access_status() to authenticated;
-- Bind invitation pages to their actual database actor without broadening recipient access.
alter function private.list_my_company_invitations(uuid,integer) rename to list_my_company_invitations_actor_impl;
revoke all on function private.list_my_company_invitations_actor_impl(uuid,integer) from public,anon,authenticated,service_role;
create function private.list_my_company_invitations(p_page_key uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; result jsonb;begin
 select user_id into actor from private.company_team_identity();
 result:=private.list_my_company_invitations_actor_impl(p_page_key,p_limit);
 if (select user_id from private.company_team_identity()) is distinct from actor then raise exception 'Actor changed' using errcode='42501';end if;
 return result||jsonb_build_object('actorUserId',actor);
end $$;
revoke all on function private.list_my_company_invitations(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.list_my_company_invitations(uuid,integer) to authenticated;
commit;
