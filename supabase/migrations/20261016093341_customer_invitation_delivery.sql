begin;
alter table private.transactional_email_outbox drop constraint transactional_email_outbox_kind_check;
alter table private.transactional_email_outbox add constraint transactional_email_outbox_kind_check check(kind in('application_received','application_admin','account_approved','offer_invitation','contract_invitation','contract_completed','contract_completed_company'));
alter table private.transactional_email_outbox add column customer_ciphertext text check(customer_ciphertext is null or length(customer_ciphertext) between 32 and 16384),
 add column customer_provider_started_at timestamptz;

-- Offer publication persists its notice in the same transaction. The existing
-- audit row is authoritative for the sender; never accept a browser recipient.
create function private.offer_customer_email_event() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.payload->>'action'='publish' then
  perform private.enqueue_transactional_email('offer_invitation',q.id,q.recipient_email)
  from private.offer_reviews q where q.id=(new.receipt#>>'{review,id}')::uuid and q.company_id=new.company_id;
 end if;return new;end $$;
revoke all on function private.offer_customer_email_event() from public,anon,authenticated,service_role;
create trigger offer_customer_transactional_email after insert on private.offer_review_audit for each row execute function private.offer_customer_email_event();

alter function private.transactional_email_recipient_current(private.transactional_email_outbox) rename to transactional_email_recipient_dealer_base;
create function private.transactional_email_recipient_current(e private.transactional_email_outbox) returns boolean language plpgsql security definer set search_path='' as $$
declare i private.customer_portal_invitations;safe private.transactional_email_outbox;sender uuid;cid uuid;
begin
 if e.kind='offer_invitation' then
  select q.company_id,a.actor_user_id into cid,sender from private.offer_reviews q join private.offer_review_audit a
   on a.company_id=q.company_id and a.payload->>'action'='publish' and a.receipt#>>'{review,id}'=q.id::text
   where q.id=e.reference_id and q.recipient_email=e.recipient limit 1;
  if cid is null then return false;end if;
  i.email_id:=e.id;i.kind:=e.kind;i.reference_id:=e.reference_id;i.company_id:=cid;i.dealer_actor_user_id:=sender;i.email:=e.recipient;
  return private.customer_portal_invitation_source_current(i);
 end if;
 if e.kind='contract_completed' and e.recipient_user_id is not null then
  if private.customer_portal_account(e.recipient_user_id,false)<>e.recipient then return false;end if;
  safe:=e;safe.recipient_user_id:=null;
  return private.transactional_email_recipient_dealer_base(safe);
 end if;
 return private.transactional_email_recipient_dealer_base(e);
exception when insufficient_privilege then return false;
end $$;
revoke all on function private.transactional_email_recipient_current(private.transactional_email_outbox),private.transactional_email_recipient_dealer_base(private.transactional_email_outbox) from public,anon,authenticated,service_role;

create or replace function public.claim_transactional_email(p_kind text default null,p_reference uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.transactional_email_outbox;l uuid:=gen_random_uuid();customer boolean;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 -- Before the provider-start marker there was no external attempt. A crash in
 -- Auth generation may safely reuse the same user, token/body and queue item.
 update private.transactional_email_outbox set status=case when kind in('offer_invitation','contract_invitation') and customer_provider_started_at is null then 'pending' else 'unknown' end,
  lease_id=null,lease_until=null,updated_at=clock_timestamp() where status='processing' and lease_until<clock_timestamp();
 for e in select * from private.transactional_email_outbox where status='pending' and attempts<5
  and(p_kind is null or kind=p_kind) and(p_reference is null or reference_id=p_reference) order by created_at,id for update skip locked limit 20 loop
  if not private.transactional_email_recipient_current(e) then
   update private.transactional_email_outbox set status='cancelled',updated_at=clock_timestamp() where id=e.id;continue;
  end if;
  customer:=e.kind in('offer_invitation','contract_invitation');
  update private.transactional_email_outbox set first_attempt_at=case when customer then first_attempt_at else coalesce(first_attempt_at,clock_timestamp()) end,
   status='processing',lease_id=l,lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+case when customer then 0 else 1 end,updated_at=clock_timestamp() where id=e.id;
  return jsonb_build_object('id',e.id,'kind',e.kind,'reference',e.reference_id,'recipient',e.recipient,'createdAt',coalesce(e.first_attempt_at,clock_timestamp()),'leaseId',l);
 end loop;return null;
end $$;

create function private.customer_invitation_delivery_state(p_email_id uuid,p_lease_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare e private.transactional_email_outbox;i private.customer_portal_invitations;u auth.users;
begin
 select * into e from private.transactional_email_outbox where id=p_email_id for update;
 if e.id is null or e.kind not in('offer_invitation','contract_invitation') or e.status<>'processing' or e.lease_id is distinct from p_lease_id
  or e.lease_until<=clock_timestamp() or not private.transactional_email_recipient_current(e) then raise exception 'Customer delivery unavailable' using errcode='42501';end if;
 select * into i from private.customer_portal_invitations where email_id=e.id for update;
 if i.id is null or not private.customer_portal_invitation_source_current(i) then raise exception 'Customer source unavailable' using errcode='42501';end if;
 if i.user_id is not null then select * into u from auth.users where id=i.user_id for share;end if;
 return jsonb_build_object('emailId',e.id,'leaseId',e.lease_id,'referenceId',e.reference_id,'kind',e.kind,'recipient',e.recipient,
  'mode',case when u.email_confirmed_at is not null then 'existing' else 'invite' end,'invitationId',i.id,'userId',i.user_id,
  'ciphertext',e.customer_ciphertext,'firstAttemptAt',e.first_attempt_at);
end $$;
revoke all on function private.customer_invitation_delivery_state(uuid,uuid) from public,anon,authenticated,service_role;

create function public.prepare_customer_contract_invitation(p_email_id uuid,p_lease_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.transactional_email_outbox;i private.customer_portal_invitations;sender uuid;cid uuid;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 select * into e from private.transactional_email_outbox where id=p_email_id for update;
 if e.id is null or e.kind not in('offer_invitation','contract_invitation') or e.status<>'processing' or e.lease_id is distinct from p_lease_id
  or e.lease_until<=clock_timestamp() or not private.transactional_email_recipient_current(e) then raise exception 'Customer delivery unavailable' using errcode='42501';end if;
 -- Preserve any historical ambiguity from the earlier generic renderer.
 if e.attempts>0 and e.customer_ciphertext is null then raise exception 'Historical delivery requires review' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended('trafexa-customer-invite-email:'||e.recipient,0));
 -- Two dealers may publish offers for the same new recipient concurrently.
 -- A second Auth invite would rotate the first email's one-time token. Wait
 -- for that recipient to activate instead of sending an immediately stale link.
 if not exists(select 1 from auth.users where lower(btrim(email))=e.recipient and email_confirmed_at is not null)
  and exists(select 1 from private.customer_portal_invitations other where other.email=e.recipient and other.email_id<>e.id
   and(other.user_id is not null or other.expires_at>clock_timestamp()) and private.customer_portal_invitation_source_current(other)) then
  raise exception 'Customer activation already pending' using errcode='40001';
 end if;
 select * into i from private.customer_portal_invitations where email_id=e.id for update;
 if i.id is null then
  if e.kind='contract_invitation' then select company_id,created_by into cid,sender from private.contract_signings where id=e.reference_id and customer_email=e.recipient;
  else select q.company_id,a.actor_user_id into cid,sender from private.offer_reviews q join private.offer_review_audit a
   on a.company_id=q.company_id and a.payload->>'action'='publish' and a.receipt#>>'{review,id}'=q.id::text
   where q.id=e.reference_id and q.recipient_email=e.recipient limit 1;end if;
  if sender is null or cid is null then raise exception 'Customer source unavailable' using errcode='42501';end if;
  insert into private.customer_portal_invitations(email_id,kind,reference_id,company_id,dealer_actor_user_id,email)
   values(e.id,e.kind,e.reference_id,cid,sender,e.recipient) returning * into i;
 elsif i.user_id is null and i.expires_at<=clock_timestamp() and e.customer_ciphertext is null then
  update private.customer_portal_invitations set expires_at=clock_timestamp()+interval '15 minutes' where id=i.id returning * into i;
 end if;
 if i.user_id is null then perform private.adopt_unverified_customer_portal_account(i.id);end if;
 return private.customer_invitation_delivery_state(e.id,p_lease_id);
end $$;
create function public.current_customer_contract_invitation(p_email_id uuid,p_lease_id uuid,p_invitation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 v:=private.customer_invitation_delivery_state(p_email_id,p_lease_id);
 if(v->>'invitationId')::uuid is distinct from p_invitation_id then raise exception 'Invitation scope changed' using errcode='42501';end if;
 return v;
end $$;
create function public.bind_customer_contract_invitation(p_email_id uuid,p_lease_id uuid,p_invitation_id uuid,p_ciphertext text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;e private.transactional_email_outbox;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 v:=public.current_customer_contract_invitation(p_email_id,p_lease_id,p_invitation_id);
 if v->>'userId' is null or p_ciphertext is null or length(p_ciphertext) not between 32 and 16384 or p_ciphertext ~ '[[:cntrl:]]' then raise exception 'Invalid customer payload' using errcode='22023';end if;
 select * into e from private.transactional_email_outbox where id=p_email_id for update;
 if e.customer_ciphertext is not null and e.customer_ciphertext<>p_ciphertext then raise exception 'Frozen customer payload changed' using errcode='40001';end if;
 update private.transactional_email_outbox set customer_ciphertext=p_ciphertext,updated_at=clock_timestamp() where id=e.id;
 return private.customer_invitation_delivery_state(e.id,p_lease_id);
end $$;
create function public.begin_customer_contract_invitation_send(p_email_id uuid,p_lease_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;e private.transactional_email_outbox;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 v:=private.customer_invitation_delivery_state(p_email_id,p_lease_id);
 select * into e from private.transactional_email_outbox where id=p_email_id for update;
 if e.customer_ciphertext is null or e.customer_provider_started_at is not null or e.attempts>=5 or(e.first_attempt_at is not null and e.first_attempt_at<=clock_timestamp()-interval '23 hours') then raise exception 'Customer send unavailable' using errcode='40001';end if;
 update private.transactional_email_outbox set first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),customer_provider_started_at=clock_timestamp(),attempts=attempts+1,updated_at=clock_timestamp() where id=e.id returning * into e;
 return jsonb_build_object('ok',true,'firstAttemptAt',e.first_attempt_at);
end $$;
revoke all on function public.prepare_customer_contract_invitation(uuid,uuid),public.current_customer_contract_invitation(uuid,uuid,uuid),public.bind_customer_contract_invitation(uuid,uuid,uuid,text),public.begin_customer_contract_invitation_send(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.prepare_customer_contract_invitation(uuid,uuid),public.current_customer_contract_invitation(uuid,uuid,uuid),public.bind_customer_contract_invitation(uuid,uuid,uuid,text),public.begin_customer_contract_invitation_send(uuid,uuid) to service_role;
create or replace function public.finish_transactional_email(p_id uuid,p_lease_id uuid,p_status text,p_provider_id text default null) returns boolean language plpgsql security definer set search_path='' as $$begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 if p_status not in('accepted','rejected','unknown','pending','cancelled') or(p_status='accepted' and(p_provider_id is null or p_provider_id !~ '^[a-zA-Z0-9_-]{1,100}$')) then raise exception 'Invalid result' using errcode='22023';end if;
 update private.transactional_email_outbox set status=case when p_status='pending' and attempts>=5 then 'rejected' else p_status end,
  provider_id=p_provider_id,customer_provider_started_at=case when p_status='pending' then null else customer_provider_started_at end,
  lease_id=null,lease_until=null,updated_at=clock_timestamp() where id=p_id and lease_id=p_lease_id and status='processing';return found;
end $$;
commit;
