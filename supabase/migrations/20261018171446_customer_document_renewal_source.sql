begin;
create function private.customer_document_renewal_source(c uuid,d uuid,ref uuid,k text,w boolean) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare a uuid;r text;em text;h text;v integer;st text;ds text;
begin
 if c is null or d is null or ref is null or k is null or k not in('offer_invitation','contract_invitation','contract_completed') then raise exception 'Invalid document scope' using errcode='22023';end if;
 if k='offer_invitation' then select actor,actor_role into a,r from private.customer_contact_access(c,w);
 else select actor,actor_role into a,r from private.sale_contract_access(c,w);end if;
 if w then select status into ds from public.deals where company_id=c and id=d for update;
 else select status into ds from public.deals where company_id=c and id=d for share;end if;
 if ds is null then raise exception 'Document source denied' using errcode='42501';end if;
 if k='offer_invitation' then
  select q.recipient_email,encode(sha256(convert_to(o.snapshot::text,'UTF8')),'hex'),q.offer_version,private.offer_review_json(q)->>'status'
  into em,h,v,st from private.offer_reviews q join public.offers o on o.company_id=q.company_id and o.id=q.offer_id
  where q.company_id=c and q.deal_id=d and q.id=ref for share of q,o;
 else
  select s.customer_email,s.document_hash,x.version,private.contract_signing_json(s,null,'customer')->>'status' into em,h,v,st
  from private.contract_signings s join private.sale_contract_drafts x on x.company_id=s.company_id and x.id=s.draft_id
  where s.company_id=c and s.deal_id=d and s.id=ref for share of s;
  if k='contract_invitation' and exists(select 1 from private.contract_party_signatures(ref)where party='customer') then st:='signed';end if;
 end if;
 if em is null then raise exception 'Document source denied' using errcode='42501';end if;
 return jsonb_build_object('companyId',c,'dealId',d,'referenceId',ref,'kind',k,'actorUserId',a,'actorRole',r,
  'recipientEmail',em,'documentHash',h,'documentVersion',v,'sourceCurrent',ds<>'cancelled' and st=case when k='contract_completed' then 'completed' else 'pending' end);
end$$;
revoke all on function private.customer_document_renewal_source(uuid,uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
-- Keep PR51 legacy-audit authorization, including a distinct renewing principal.
alter function private.guest_email_source(private.transactional_email_outbox)rename to guest_email_legacy_renewal_source;
create function private.guest_email_source(e private.transactional_email_outbox)returns private.guest_document_invitations
 language plpgsql security invoker set search_path=''as $$
declare saved private.customer_document_renewals;i private.guest_document_invitations;
begin
 select *into saved from private.customer_document_renewals where email_id=e.id;
 if saved.email_id is null then return private.guest_email_legacy_renewal_source(e);end if;
 i:=private.guest_email_original_source(e);
 if e.generation<=0 or i.dealer_actor_user_id<>saved.actor_user_id or i.company_id<>saved.company_id
 or i.document_hash is distinct from saved.receipt->>'documentHash' or i.document_version is distinct from(saved.receipt->>'documentVersion')::integer
 or e.recipient is distinct from saved.receipt->>'recipientEmail' or e.kind is distinct from saved.receipt->>'kind'
 or e.reference_id is distinct from(saved.receipt->>'referenceId')::uuid or e.generation is distinct from(saved.receipt->>'generation')::integer then
  raise exception 'Reviewed renewal source changed'using errcode='42501';end if;
 return i;
end$$;
revoke all on function private.guest_email_source(private.transactional_email_outbox),private.guest_email_legacy_renewal_source(private.transactional_email_outbox)from public,anon,authenticated,service_role;
commit;
