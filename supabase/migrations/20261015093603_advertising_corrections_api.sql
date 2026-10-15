begin;
create function public.get_platform_advertising_corrections(p_company_id uuid,p_month text) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_corrections_read(p_company_id,p_month,true);$$;
create function public.list_advertising_corrections(p_company_id uuid,p_month text) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_corrections_read(p_company_id,p_month,false);$$;
create function public.create_advertising_reduction(p_company_id uuid,p_month text,p_publication_id uuid,p_amount_ore text,p_reason text,p_expected_review_token text,p_review_acknowledged boolean,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.create_advertising_reduction(p_company_id,p_month,p_publication_id,p_amount_ore,p_reason,p_expected_review_token,p_review_acknowledged,p_request_id);$$;
revoke all on function public.get_platform_advertising_corrections(uuid,text),public.list_advertising_corrections(uuid,text),public.create_advertising_reduction(uuid,text,uuid,text,text,text,boolean,uuid) from public,anon,service_role;
grant execute on function public.get_platform_advertising_corrections(uuid,text),public.list_advertising_corrections(uuid,text),public.create_advertising_reduction(uuid,text,uuid,text,text,text,boolean,uuid) to authenticated;
commit;
