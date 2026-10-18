begin;
create function public.get_customer_document_renewal(p_company_id uuid,p_deal_id uuid,p_reference_id uuid,p_kind text) returns jsonb
 language sql security invoker set search_path='' as $$select private.get_customer_document_renewal(p_company_id,p_deal_id,p_reference_id,p_kind);$$;
create function public.renew_customer_document_link(p_company_id uuid,p_deal_id uuid,p_reference_id uuid,p_kind text,p_expected_email_id uuid,p_expected_invitation_id uuid,p_expected_generation integer,p_document_hash text,p_document_version integer,p_recipient_email text,p_review_token text,p_reason text,p_request_id uuid,p_allow_create boolean default false) returns jsonb
 language sql security invoker set search_path='' as $$select private.renew_customer_document_link(p_company_id,p_deal_id,p_reference_id,p_kind,p_expected_email_id,p_expected_invitation_id,p_expected_generation,p_document_hash,p_document_version,p_recipient_email,p_review_token,p_reason,p_request_id,p_allow_create);$$;
revoke all on function public.get_customer_document_renewal(uuid,uuid,uuid,text),public.renew_customer_document_link(uuid,uuid,uuid,text,uuid,uuid,integer,text,integer,text,text,text,uuid,boolean) from public,anon,service_role;
grant execute on function public.get_customer_document_renewal(uuid,uuid,uuid,text),public.renew_customer_document_link(uuid,uuid,uuid,text,uuid,uuid,integer,text,integer,text,text,text,uuid,boolean) to authenticated;
commit;
