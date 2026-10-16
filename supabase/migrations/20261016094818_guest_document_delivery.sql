-- Account-free document mail delivery; customer capability links never invoke Auth.
begin;
create function private.guest_email_source(e private.transactional_email_outbox) returns private.guest_document_invitations language plpgsql security invoker set search_path='' as $$declare i private.guest_document_invitations;begin
 i.email_id:=e.id;i.kind:=e.kind;i.reference_id:=e.reference_id;i.recipient_email:=e.recipient;
 if e.kind='offer_invitation' then
  select q.company_id,a.actor_user_id,encode(sha256(convert_to(o.snapshot::text,'UTF8')),'hex'),q.offer_version into i.company_id,i.dealer_actor_user_id,i.document_hash,i.document_version
  from private.offer_reviews q join public.offers o on o.company_id=q.company_id and o.id=q.offer_id join private.offer_review_audit a on a.company_id=q.company_id and a.payload->>'action'='publish' and a.receipt#>>'{review,id}'=q.id::text
  where q.id=e.reference_id and q.recipient_email=e.recipient and private.offer_review_json(q)->>'status'='pending' limit 1;
 else
  select s.company_id,s.created_by,s.document_hash,d.version into i.company_id,i.dealer_actor_user_id,i.document_hash,i.document_version
  from private.contract_signings s join private.sale_contract_drafts d on d.id=s.draft_id where s.id=e.reference_id and s.customer_email=e.recipient
  and case when e.kind='contract_completed' then private.contract_signing_json(s,null,'customer')->>'status'='completed'
   else private.contract_signing_json(s,null,'customer')->>'status'='pending' and not exists(select 1 from private.contract_party_signatures(s.id) where party='customer') end;
 end if;
 if i.company_id is null or not private.guest_document_source_current(i,false) then raise exception 'Guest invitation unavailable' using errcode='42501';end if;return i;
end $$;
revoke all on function private.guest_email_source(private.transactional_email_outbox) from public,anon,authenticated,service_role;
create or replace function private.transactional_email_recipient_current(e private.transactional_email_outbox) returns boolean language plpgsql security definer set search_path='' as $$begin
 if e.kind in('offer_invitation','contract_invitation','contract_completed') then perform private.guest_email_source(e);return true;end if;
 if e.kind='contract_completed_company' then return exists(select 1 from private.contract_signings s join public.companies c on c.id=s.company_id and c.status='active' join public.deals d on d.company_id=s.company_id and d.id=s.deal_id and d.status<>'cancelled'
  join private.contract_signatures x on x.signing_id=s.id and x.party='company' join public.memberships m on m.company_id=s.company_id and m.user_id=x.actor_user_id and m.status='active' and m.role in('owner','admin')
  where s.id=e.reference_id and x.actor_user_id=e.recipient_user_id and private.contract_signing_json(s,null,'customer')->>'status'='completed'
  and private.company_team_account(x.actor_user_id,false)=e.recipient);end if;
 return private.transactional_email_recipient_dealer_base(e);
exception when insufficient_privilege then return false;end $$;

create function private.guest_delivery_state(p_email_id uuid,p_lease_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$declare e private.transactional_email_outbox;i private.guest_document_invitations;begin
 select * into e from private.transactional_email_outbox where id=p_email_id for update;
 if e.id is null or e.kind not in('offer_invitation','contract_invitation','contract_completed') or e.status<>'processing' or e.lease_id is distinct from p_lease_id or e.lease_until<=clock_timestamp() then raise exception 'Guest delivery unavailable' using errcode='42501';end if;
 perform private.guest_email_source(e);
 select * into i from private.guest_document_invitations where email_id=e.id for update;
 if i.id is null or i.expires_at<=clock_timestamp() or not private.guest_document_source_current(i,false) then raise exception 'Guest delivery unavailable' using errcode='42501';end if;
 return jsonb_build_object('emailId',e.id,'leaseId',e.lease_id,'referenceId',e.reference_id,'kind',e.kind,'recipient',e.recipient,'mode','guest','invitationId',i.id,'userId',null,'expiresAt',i.expires_at,'ciphertext',e.customer_ciphertext,'firstAttemptAt',e.first_attempt_at);
end $$;
revoke all on function private.guest_delivery_state(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function public.prepare_customer_contract_invitation(p_email_id uuid,p_lease_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare e private.transactional_email_outbox;i private.guest_document_invitations;candidate private.guest_document_invitations;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 select * into e from private.transactional_email_outbox where id=p_email_id for update;
 if e.id is null or e.kind not in('offer_invitation','contract_invitation','contract_completed') or e.status<>'processing' or e.lease_id is distinct from p_lease_id or e.lease_until<=clock_timestamp() then raise exception 'Guest delivery unavailable' using errcode='42501';end if;
 candidate:=private.guest_email_source(e);
 if e.attempts>0 and not exists(select 1 from private.guest_document_invitations where email_id=e.id) then raise exception 'Historical delivery requires review' using errcode='40001';end if;
 -- A new source has an independent token; never rotate a previously mailed capability.
 perform pg_advisory_xact_lock(hashtextextended('trafexa-guest-email:'||e.recipient,0));
 select * into i from private.guest_document_invitations where email_id=e.id for update;
 if i.id is null then
  if e.customer_ciphertext is not null then raise exception 'Historical account payload requires review' using errcode='40001';end if;
  insert into private.guest_document_invitations(email_id,kind,reference_id,company_id,dealer_actor_user_id,recipient_email,document_hash,document_version)
  values(e.id,e.kind,e.reference_id,candidate.company_id,candidate.dealer_actor_user_id,e.recipient,candidate.document_hash,candidate.document_version) returning * into i;
 end if;
 return private.guest_delivery_state(e.id,p_lease_id);
end $$;
create or replace function public.current_customer_contract_invitation(p_email_id uuid,p_lease_id uuid,p_invitation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare v jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 v:=private.guest_delivery_state(p_email_id,p_lease_id);if v->>'invitationId' is distinct from p_invitation_id::text then raise exception 'Guest invitation unavailable' using errcode='42501';end if;return v;end $$;
-- The older account-payload binder is deliberately unavailable to every runtime role.
revoke all on function public.bind_customer_contract_invitation(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.bind_guest_document_invitation(p_email_id uuid,p_lease_id uuid,p_invitation_id uuid,p_token_sha256 text,p_ciphertext text) returns jsonb language plpgsql security definer set search_path='' as $$declare v jsonb;i private.guest_document_invitations;e private.transactional_email_outbox;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 v:=public.current_customer_contract_invitation(p_email_id,p_lease_id,p_invitation_id);
 if p_token_sha256 is null or p_token_sha256 !~ '^[a-f0-9]{64}$' or p_ciphertext is null or length(p_ciphertext) not between 32 and 16384 or p_ciphertext ~ '[[:cntrl:]]' then raise exception 'Invalid guest payload' using errcode='22023';end if;
 select * into i from private.guest_document_invitations where id=p_invitation_id for update;select * into e from private.transactional_email_outbox where id=p_email_id for update;
 if(i.token_hash is not null and i.token_hash<>p_token_sha256) or(e.customer_ciphertext is not null and e.customer_ciphertext<>p_ciphertext) then raise exception 'Frozen guest payload changed' using errcode='40001';end if;
 update private.guest_document_invitations set token_hash=p_token_sha256 where id=i.id;
 update private.transactional_email_outbox set customer_ciphertext=p_ciphertext,updated_at=clock_timestamp() where id=e.id;
 return private.guest_delivery_state(e.id,p_lease_id);
end $$;
create or replace function public.begin_customer_contract_invitation_send(p_email_id uuid,p_lease_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare v jsonb;e private.transactional_email_outbox;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 v:=private.guest_delivery_state(p_email_id,p_lease_id);select * into e from private.transactional_email_outbox where id=p_email_id for update;
 if e.customer_ciphertext is null or not exists(select 1 from private.guest_document_invitations where email_id=e.id and token_hash is not null) or e.customer_provider_started_at is not null or e.attempts>=5 or(e.first_attempt_at is not null and e.first_attempt_at<=clock_timestamp()-interval '23 hours') then raise exception 'Guest send unavailable' using errcode='40001';end if;
 update private.transactional_email_outbox set first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),customer_provider_started_at=clock_timestamp(),attempts=attempts+1,updated_at=clock_timestamp() where id=e.id returning * into e;
 return jsonb_build_object('ok',true,'firstAttemptAt',e.first_attempt_at);end $$;
revoke all on function public.bind_guest_document_invitation(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.bind_guest_document_invitation(uuid,uuid,uuid,text,text) to service_role;

create or replace function public.claim_transactional_email(p_kind text default null,p_reference uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.transactional_email_outbox;l uuid:=gen_random_uuid();customer boolean;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 -- Before the provider-start marker there was no external attempt. A crash in
 -- preparing a capability may safely reuse the same frozen token/body and queue item.
 update private.transactional_email_outbox set status=case when kind in('offer_invitation','contract_invitation','contract_completed') and customer_provider_started_at is null then 'pending' else 'unknown' end,
  lease_id=null,lease_until=null,updated_at=clock_timestamp() where status='processing' and lease_until<clock_timestamp();
 for e in select * from private.transactional_email_outbox where status='pending' and attempts<5
  and(p_kind is null or kind=p_kind) and(p_reference is null or reference_id=p_reference) order by created_at,id for update skip locked limit 20 loop
  if not private.transactional_email_recipient_current(e) then
   update private.transactional_email_outbox set status='cancelled',updated_at=clock_timestamp() where id=e.id;continue;
  end if;
  customer:=e.kind in('offer_invitation','contract_invitation','contract_completed');
  update private.transactional_email_outbox set first_attempt_at=case when customer then first_attempt_at else coalesce(first_attempt_at,clock_timestamp()) end,
   status='processing',lease_id=l,lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+case when customer then 0 else 1 end,updated_at=clock_timestamp() where id=e.id;
  return jsonb_build_object('id',e.id,'kind',e.kind,'reference',e.reference_id,'recipient',e.recipient,'createdAt',coalesce(e.first_attempt_at,clock_timestamp()),'leaseId',l);
 end loop;return null;
end $$;

revoke all on function public.prepare_customer_contract_invitation(uuid,uuid),public.current_customer_contract_invitation(uuid,uuid,uuid),public.bind_guest_document_invitation(uuid,uuid,uuid,text,text),public.begin_customer_contract_invitation_send(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.prepare_customer_contract_invitation(uuid,uuid),public.current_customer_contract_invitation(uuid,uuid,uuid),public.bind_guest_document_invitation(uuid,uuid,uuid,text,text),public.begin_customer_contract_invitation_send(uuid,uuid) to service_role;
commit;
