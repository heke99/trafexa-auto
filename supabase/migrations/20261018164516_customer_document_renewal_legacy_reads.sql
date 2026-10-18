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
  where kind='contract_invitation' and reference_id=s.id and recipient=s.customer_email order by delivery_generation desc limit 1;
 select status into completion_status from private.transactional_email_outbox
  where kind='contract_completed' and reference_id=s.id and recipient=s.customer_email order by delivery_generation desc limit 1;
 return jsonb_build_object('companyId',s.company_id,'dealId',s.deal_id,'signingId',s.id,
  'actorUserId',a,'actorRole',r,'recipientEmail',s.customer_email,
  'status',delivery_status,'completionStatus',completion_status);
end $$;
create or replace function private.get_offer_review_delivery(p_company_id uuid,p_deal_id uuid,p_review_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare a uuid;r text;q private.offer_reviews;s text;begin
 select actor,actor_role into a,r from private.customer_contact_access(p_company_id,false);
 select * into q from private.offer_reviews where company_id=p_company_id and deal_id=p_deal_id and id=p_review_id for share;
 if q.id is null then raise exception 'Offer delivery access denied' using errcode='42501';end if;
 select status into s from private.transactional_email_outbox where kind='offer_invitation' and reference_id=q.id and recipient=q.recipient_email order by delivery_generation desc limit 1;
 return jsonb_build_object('companyId',q.company_id,'dealId',q.deal_id,'reviewId',q.id,'actorUserId',a,'actorRole',r,'recipientEmail',q.recipient_email,'status',s);
end $$;
commit;
