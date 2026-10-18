begin;
create function public.reprepare_platform_application_invitation(p_invitation_id uuid,p_expected_application_version integer,p_expected_version integer,p_reason text,p_request_id uuid) returns jsonb
 language sql security invoker set search_path='' as $$select private.reprepare_platform_application_invitation(p_invitation_id,p_expected_application_version,p_expected_version,p_reason,p_request_id);$$;
revoke all on function public.reprepare_platform_application_invitation(uuid,integer,integer,text,uuid) from public,anon,service_role;
grant execute on function public.reprepare_platform_application_invitation(uuid,integer,integer,text,uuid) to authenticated;
commit;
