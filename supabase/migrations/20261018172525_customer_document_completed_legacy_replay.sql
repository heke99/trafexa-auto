-- Retain historical completed-link receipts created by the separately deployed
-- recovery flow. This changes no queue, source or grant and enables no new writes.
begin;
create or replace function private.renew_guest_document_invitation(p_company_id uuid,p_deal_id uuid,p_kind text,p_reference_id uuid,p_expected_email_id uuid,p_expected_generation integer,p_expected_document_hash text,p_request_id uuid)returns jsonb
 language plpgsql security definer set search_path=''as $$
declare src jsonb;old private.guest_invitation_renewal_audit;p jsonb;
begin
 if p_kind is null or p_kind not in('offer_invitation','contract_invitation','contract_completed')then raise exception 'Invitation kind denied'using errcode='42501';end if;
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
