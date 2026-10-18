-- Keep the existing invitation status and RPC signature; expose the independently
-- queued completed-contract email through the same dealer-scoped read boundary.
begin;
create or replace function private.get_contract_signing_delivery(
 p_company_id uuid,p_deal_id uuid,p_signing_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;s private.contract_signings;delivery_status text;completion_status text;
begin
 select actor,actor_role into a,r from private.sale_contract_access(p_company_id,false);
 select * into s from private.contract_signings
  where company_id=p_company_id and deal_id=p_deal_id and id=p_signing_id for share;
 if s.id is null then raise exception 'Signing delivery access denied' using errcode='42501';end if;
 select status into delivery_status from private.transactional_email_outbox
  where kind='contract_invitation' and reference_id=s.id and recipient=s.customer_email;
 select status into completion_status from private.transactional_email_outbox
  where kind='contract_completed' and reference_id=s.id and recipient=s.customer_email;
 return jsonb_build_object('companyId',s.company_id,'dealId',s.deal_id,'signingId',s.id,
  'actorUserId',a,'actorRole',r,'recipientEmail',s.customer_email,
  'status',delivery_status,'completionStatus',completion_status);
end $$;
-- CREATE OR REPLACE preserves the existing narrow grants. The public wrapper is
-- unchanged and this read neither claims a lease nor initiates any email send.
commit;
