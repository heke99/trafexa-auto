-- Reviewed renewal of completed read-only links and controlled recovery of
-- expired, known pending guest mail. Never recover unknown provider outcomes.
begin;
alter table private.transactional_email_outbox drop constraint transactional_email_renewable_kind;
alter table private.transactional_email_outbox add constraint transactional_email_renewable_kind check(generation=0 or kind in('offer_invitation','contract_invitation','contract_completed'));

create or replace function private.guest_invitation_renewal_review(p_company_id uuid,p_deal_id uuid,p_kind text,p_reference_id uuid,p_write boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a uuid;r text;v_recipient text;h text;v integer;e private.transactional_email_outbox;i private.guest_document_invitations;s private.contract_signings;q private.offer_reviews;valid boolean:=false;ds text;w boolean;expired boolean;recoverable boolean;
begin
 if p_kind in('contract_invitation','contract_completed') then select actor,actor_role into a,r from private.sale_contract_access(p_company_id,p_write);
 elsif p_kind='offer_invitation' then select actor,actor_role into a,r from private.customer_contact_access(p_company_id,p_write);
 else raise exception 'Invitation kind denied' using errcode='42501';end if;
 if p_write then select status into ds from public.deals where company_id=p_company_id and id=p_deal_id for update;
 else select status into ds from public.deals where company_id=p_company_id and id=p_deal_id for share;end if;
 if ds is null or ds='cancelled' then raise exception 'Invitation deal denied' using errcode='42501';end if;
 if p_kind in('contract_invitation','contract_completed') then
  select * into s from private.contract_signings where company_id=p_company_id and deal_id=p_deal_id and id=p_reference_id for share;
  if s.id is null then raise exception 'Invitation source denied' using errcode='42501';end if;
  v_recipient:=s.customer_email;h:=s.document_hash;select version into v from private.sale_contract_drafts where id=s.draft_id;
 else
  select * into q from private.offer_reviews where company_id=p_company_id and deal_id=p_deal_id and id=p_reference_id for share;
  if q.id is null then raise exception 'Invitation source denied' using errcode='42501';end if;
  v_recipient:=q.recipient_email;v:=q.offer_version;select encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') into h from public.offers where id=q.offer_id and company_id=p_company_id;
 end if;
 select * into e from private.transactional_email_outbox where kind=p_kind and reference_id=p_reference_id and recipient=v_recipient order by generation desc limit 1;
 if e.id is not null then
  select * into i from private.guest_document_invitations where email_id=e.id;
  begin perform private.guest_email_source(e);valid:=true;exception when insufficient_privilege then valid:=false;end;
 end if;
 w:=r=any(case when p_kind='offer_invitation' then array['owner','admin','sales'] else array['owner','admin'] end);
 expired:=coalesce(w and valid and i.id is not null and i.revoked_at is null and i.expires_at<=clock_timestamp() and i.document_hash=h and i.document_version=v,false);
 recoverable:=coalesce(expired and e.status='pending' and((e.attempts=0 and e.first_attempt_at is null) or(e.attempts>0 and e.first_attempt_at is not null)) and e.lease_id is null and e.lease_until is null and e.provider_id is null and e.customer_provider_started_at is null
  and((i.token_hash is not null and e.customer_ciphertext is not null) or(i.token_hash is null and e.customer_ciphertext is null and e.attempts=0 and e.first_attempt_at is null)),false);
 return jsonb_build_object('companyId',p_company_id,'dealId',p_deal_id,'kind',p_kind,'referenceId',p_reference_id,'actorUserId',a,'actorRole',r,'recipientEmail',v_recipient,'documentHash',h,'documentVersion',v,
  'emailId',e.id,'generation',coalesce(e.generation,0),'status',e.status,'invitationId',i.id,'expiresAt',i.expires_at,'canWrite',w,
  'canRenew',coalesce(expired and e.status='accepted' and i.token_hash is not null,false),'canRecoverPending',recoverable);
end $$;

create or replace function private.renew_guest_document_invitation(p_company_id uuid,p_deal_id uuid,p_kind text,p_reference_id uuid,p_expected_email_id uuid,p_expected_generation integer,p_expected_document_hash text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;review jsonb;p jsonb;old private.guest_invitation_renewal_audit;e private.transactional_email_outbox;receipt jsonb;
begin
 if p_kind in('contract_invitation','contract_completed') then select actor,actor_role into a,r from private.sale_contract_access(p_company_id,true);
 elsif p_kind='offer_invitation' then select actor,actor_role into a,r from private.customer_contact_access(p_company_id,true);
 else raise exception 'Invitation kind denied' using errcode='42501';end if;
 if p_request_id is null or p_expected_email_id is null or p_expected_generation is null or p_expected_generation<0 or p_expected_document_hash is null or p_expected_document_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid renewal review' using errcode='22023';end if;
 -- Acquire request and old outbox BEFORE source locks, matching worker order.
 perform pg_advisory_xact_lock(hashtextextended('trafexa-guest-renewal:'||a::text||p_request_id::text,0));
 perform 1 from private.transactional_email_outbox queued where queued.id=p_expected_email_id and queued.kind=p_kind and queued.reference_id=p_reference_id
  and case when p_kind in('contract_invitation','contract_completed') then exists(select 1 from private.contract_signings s where s.id=p_reference_id and s.company_id=p_company_id and s.deal_id=p_deal_id and s.customer_email=queued.recipient)
   else exists(select 1 from private.offer_reviews q where q.id=p_reference_id and q.company_id=p_company_id and q.deal_id=p_deal_id and q.recipient_email=queued.recipient) end for update;
 if not found then raise exception 'Renewal delivery denied' using errcode='42501';end if;
 review:=private.guest_invitation_renewal_review(p_company_id,p_deal_id,p_kind,p_reference_id,true);
 p:=jsonb_build_object('companyId',p_company_id,'dealId',p_deal_id,'kind',p_kind,'referenceId',p_reference_id,'expectedEmailId',p_expected_email_id,'expectedGeneration',p_expected_generation,'documentHash',p_expected_document_hash);
 select * into old from private.guest_invitation_renewal_audit where actor_user_id=a and request_id=p_request_id;
 if old.email_id is not null then
  if old.payload is distinct from p then raise exception 'Renewal request changed' using errcode='40001';end if;
  if old.receipt->>'actorRole' is distinct from r then raise exception 'Renewal actor role changed' using errcode='42501';end if;
  return old.receipt;
 end if;
 if review->>'emailId' is distinct from p_expected_email_id::text or (review->>'generation')::integer is distinct from p_expected_generation or review->>'documentHash' is distinct from p_expected_document_hash or not(coalesce((review->>'canRenew')::boolean,false) or coalesce((review->>'canRecoverPending')::boolean,false)) then raise exception 'Renewal review changed' using errcode='40001';end if;
 -- The old outbox row is already locked before source locks. Cancel only a
 -- known, unleased pending generation; never change accepted/unknown history.
 if (review->>'canRecoverPending')::boolean then
  update private.transactional_email_outbox set status='cancelled',updated_at=clock_timestamp() where id=p_expected_email_id and status='pending' and lease_id is null and lease_until is null and provider_id is null and customer_provider_started_at is null;
  if not found then raise exception 'Pending recovery changed' using errcode='40001';end if;
 end if;
 insert into private.transactional_email_outbox(kind,reference_id,recipient,generation) values(p_kind,p_reference_id,review->>'recipientEmail',p_expected_generation+1) returning * into e;
 receipt:=jsonb_build_object('companyId',p_company_id,'dealId',p_deal_id,'kind',p_kind,'referenceId',p_reference_id,'actorUserId',a,'actorRole',r,'recipientEmail',review->>'recipientEmail','documentHash',review->>'documentHash','documentVersion',(review->>'documentVersion')::integer,'requestId',p_request_id,'emailId',e.id,'generation',e.generation,'expectedEmailId',p_expected_email_id,'expectedGeneration',p_expected_generation);
 insert into private.guest_invitation_renewal_audit(actor_user_id,request_id,company_id,email_id,payload,receipt) values(a,p_request_id,p_company_id,e.id,p,receipt);
 return receipt;
end $$;

create or replace function public.claim_transactional_email_exact(p_email_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare e private.transactional_email_outbox;l uuid:=gen_random_uuid();begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 select * into e from private.transactional_email_outbox where id=p_email_id and kind in('offer_invitation','contract_invitation','contract_completed') for update skip locked;
 if e.id is null then return null;end if;
 if e.status='processing' and e.lease_until<clock_timestamp() then
  update private.transactional_email_outbox set status=case when customer_provider_started_at is null then 'pending' else 'unknown' end,lease_id=null,lease_until=null,updated_at=clock_timestamp() where id=e.id returning * into e;
 end if;
 if e.status<>'pending' or e.attempts>=5 then return null;end if;
 if not private.transactional_email_recipient_current(e) then update private.transactional_email_outbox set status='cancelled',updated_at=clock_timestamp() where id=e.id;return null;end if;
 update private.transactional_email_outbox set status='processing',lease_id=l,lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp() where id=e.id;
 return jsonb_build_object('id',e.id,'kind',e.kind,'reference',e.reference_id,'recipient',e.recipient,'createdAt',coalesce(e.first_attempt_at,clock_timestamp()),'leaseId',l);
end $$;

-- CREATE OR REPLACE retains the existing narrow authenticated/service grants.
commit;
