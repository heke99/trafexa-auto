begin;
create function public.get_platform_advertising_receivables(p_filter text,p_cursor jsonb default null) returns jsonb language sql security invoker set search_path='' as $$select private.get_advertising_receivables(p_filter,p_cursor)$$;
revoke all on function public.get_platform_advertising_receivables(text,jsonb) from public,anon,service_role;
grant execute on function public.get_platform_advertising_receivables(text,jsonb) to authenticated;
commit;
