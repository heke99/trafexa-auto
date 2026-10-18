begin;
create function private.renew_customer_document_link(p_company_id uuid,p_deal_id uuid,p_reference_id uuid,p_kind text,p_expected_email_id uuid,p_expected_invitation_id uuid,p_expected_generation integer,p_document_hash text,p_document_version integer,p_recipient_email text,p_review_token text,p_reason text,p_request_id uuid,p_allow_create boolean default false) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare src jsonb;v jsonb;p jsonb;receipt jsonb;prior private.customer_document_renewals;
 e private.transactional_email_outbox;n private.transactional_email_outbox;i private.guest_document_invitations;j private.guest_document_invitations;a uuid;
begin
 src:=private.customer_document_renewal_source(p_company_id,p_deal_id,p_reference_id,p_kind,true);a:=(src->>'actorUserId')::uuid;
 if p_expected_email_id is null or p_expected_invitation_id is null or p_expected_generation is null or p_expected_generation<0 or p_expected_generation>=2147483647
 or p_document_hash is null or p_document_hash!~'^[a-f0-9]{64}$' or p_review_token is null or p_review_token!~'^[a-f0-9]{64}$'
 or p_document_version is null or p_document_version<1 or p_request_id is null or p_recipient_email is null
 or p_reason is null or p_reason<>btrim(p_reason) or length(p_reason)not between 2 and 500 or p_reason~'[[:cntrl:]]' then raise exception 'Invalid reviewed renewal' using errcode='22023';end if;
 p:=jsonb_build_object('source',jsonb_build_object('companyId',p_company_id,'dealId',p_deal_id,'referenceId',p_reference_id,'kind',p_kind,'actorUserId',a),'emailId',p_expected_email_id,'invitationId',p_expected_invitation_id,'generation',p_expected_generation,
 'documentHash',p_document_hash,'documentVersion',p_document_version,'recipientEmail',p_recipient_email,'reviewToken',p_review_token,'reason',p_reason);
 -- Fresh scope authorization precedes replay; historical eligibility does not.
 perform pg_advisory_xact_lock(hashtextextended('trafexa-document-renewal:'||a::text||':'||p_request_id::text,0));
 select * into prior from private.customer_document_renewals where actor_user_id=a and request_id=p_request_id;
 if found then if prior.request_payload is distinct from p then raise exception 'Reviewed nonce conflict' using errcode='40001';end if;return prior.receipt;end if;
 if p_allow_create is distinct from true then return null;end if;
 -- NOWAIT avoids inversion against legacy outbox-first workers.
 begin select * into e from private.transactional_email_outbox where id=p_expected_email_id for update nowait;
 exception when lock_not_available then raise exception 'Delivery busy' using errcode='40001';end;
 select * into i from private.guest_document_invitations where id=p_expected_invitation_id and email_id=e.id for update;
 if e.id is null or i.id is null or i.dealer_actor_user_id<>a or e.kind<>p_kind or e.reference_id<>p_reference_id or e.recipient<>p_recipient_email
 or e.generation<>p_expected_generation or i.document_hash<>p_document_hash or i.document_version<>p_document_version
 or i.company_id<>p_company_id or i.recipient_email<>p_recipient_email or i.revoked_at is not null or i.expires_at>clock_timestamp()
 or (e.status not in('accepted','rejected') and not(e.status in('pending','processing') and e.attempts=0 and e.first_attempt_at is null and e.customer_provider_started_at is null and e.provider_id is null and (e.status='pending' and e.lease_id is null or e.status='processing' and e.lease_until<=clock_timestamp())))or not private.customer_document_email_latest(e) then raise exception 'Reviewed link conflict' using errcode='40001';end if;
 v:=private.customer_document_renewal_lifecycle(src);
 if v->>'reviewToken' is distinct from p_review_token or v->>'canRenew'<>'true' then raise exception 'Document review changed' using errcode='40001';end if;
 insert into private.transactional_email_outbox(kind,reference_id,recipient,generation)
 values(e.kind,e.reference_id,e.recipient,e.generation+1) returning * into n;
 insert into private.guest_document_invitations(email_id,kind,reference_id,company_id,dealer_actor_user_id,recipient_email,document_hash,document_version)
 values(n.id,i.kind,i.reference_id,i.company_id,i.dealer_actor_user_id,i.recipient_email,i.document_hash,i.document_version) returning * into j;
 update private.guest_document_invitations set revoked_at=clock_timestamp()where id=i.id;
 if e.status in('pending','processing')then update private.transactional_email_outbox set status='cancelled',lease_id=null,lease_until=null,updated_at=clock_timestamp()where id=e.id;end if;
 receipt:=(src-'sourceCurrent')||jsonb_build_object('requestId',p_request_id,'previousEmailId',e.id,'previousInvitationId',i.id,
 'emailId',n.id,'invitationId',j.id,'generation',n.generation,'reason',p_reason,'reviewToken',p_review_token,'expiresAt',j.expires_at);
 insert into private.customer_document_renewals(actor_user_id,request_id,company_id,deal_id,previous_email_id,previous_invitation_id,email_id,invitation_id,request_payload,receipt)
 values(a,p_request_id,p_company_id,p_deal_id,e.id,i.id,n.id,j.id,p,receipt);
 return receipt;
end$$;
revoke all on function private.renew_customer_document_link(uuid,uuid,uuid,text,uuid,uuid,integer,text,integer,text,text,text,uuid,boolean) from public,anon,service_role;
grant execute on function private.renew_customer_document_link(uuid,uuid,uuid,text,uuid,uuid,integer,text,integer,text,text,text,uuid,boolean) to authenticated;
commit;
