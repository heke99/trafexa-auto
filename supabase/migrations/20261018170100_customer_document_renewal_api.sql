begin;
create function public.get_customer_document_renewal(p_company_id uuid,p_deal_id uuid,p_reference_id uuid,p_kind text) returns jsonb
 language sql security invoker set search_path='' as $$select private.get_customer_document_renewal(p_company_id,p_deal_id,p_reference_id,p_kind);$$;
create function public.renew_customer_document_link(p_company_id uuid,p_deal_id uuid,p_reference_id uuid,p_kind text,p_expected_email_id uuid,p_expected_invitation_id uuid,p_expected_generation integer,p_document_hash text,p_document_version integer,p_recipient_email text,p_review_token text,p_reason text,p_request_id uuid,p_allow_create boolean default false) returns jsonb
 language sql security invoker set search_path='' as $$select private.renew_customer_document_link(p_company_id,p_deal_id,p_reference_id,p_kind,p_expected_email_id,p_expected_invitation_id,p_expected_generation,p_document_hash,p_document_version,p_recipient_email,p_review_token,p_reason,p_request_id,p_allow_create);$$;
revoke all on function public.get_customer_document_renewal(uuid,uuid,uuid,text),public.renew_customer_document_link(uuid,uuid,uuid,text,uuid,uuid,integer,text,integer,text,text,text,uuid,boolean) from public,anon,service_role;
grant execute on function public.get_customer_document_renewal(uuid,uuid,uuid,text),public.renew_customer_document_link(uuid,uuid,uuid,text,uuid,uuid,integer,text,integer,text,text,text,uuid,boolean) to authenticated;
-- Old PR51 writes are superseded. Historical requests remain independently readable
-- under fresh dealer authorization; they can never enqueue another generation.
create or replace function private.renew_guest_document_invitation(p_company_id uuid,p_deal_id uuid,p_kind text,p_reference_id uuid,p_expected_email_id uuid,p_expected_generation integer,p_expected_document_hash text,p_request_id uuid)returns jsonb
 language plpgsql security definer set search_path=''as $$
declare src jsonb;old private.guest_invitation_renewal_audit;p jsonb;
begin
 if p_kind is null or p_kind not in('offer_invitation','contract_invitation')then raise exception 'Invitation kind denied'using errcode='42501';end if;
 src:=private.customer_document_renewal_source(p_company_id,p_deal_id,p_reference_id,p_kind,true);
 if p_request_id is null or p_expected_email_id is null or p_expected_generation is null or p_expected_generation<0
 or p_expected_document_hash is null or p_expected_document_hash!~'^[a-f0-9]{64}$'then raise exception 'Invalid historical review'using errcode='22023';end if;
 p:=jsonb_build_object('companyId',p_company_id,'dealId',p_deal_id,'kind',p_kind,'referenceId',p_reference_id,
 'expectedEmailId',p_expected_email_id,'expectedGeneration',p_expected_generation,'documentHash',p_expected_document_hash);
 select *into old from private.guest_invitation_renewal_audit where actor_user_id=(src->>'actorUserId')::uuid and request_id=p_request_id;
 if old.email_id is null or old.payload is distinct from p then raise exception 'Use reviewed document renewal'using errcode='40001';end if;
 return old.receipt;
end$$;
commit;
