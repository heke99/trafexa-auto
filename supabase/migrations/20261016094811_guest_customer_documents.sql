-- Personal document capabilities. No buyer Auth account, membership or approval.
begin;
create table private.guest_document_invitations(
 id uuid primary key default gen_random_uuid(),email_id uuid not null unique references private.transactional_email_outbox(id),
 kind text not null check(kind in('offer_invitation','contract_invitation','contract_completed')),reference_id uuid not null,
 company_id uuid not null references public.companies(id),dealer_actor_user_id uuid not null references auth.users(id),
 recipient_email text not null,document_hash text not null check(document_hash ~ '^[a-f0-9]{64}$'),document_version integer not null check(document_version>0),
 token_hash text unique check(token_hash is null or token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '7 days',revoked_at timestamptz,
 check(expires_at>created_at and expires_at<=created_at+interval '7 days'),
 check(recipient_email=lower(btrim(recipient_email)) and length(recipient_email) between 3 and 254 and recipient_email !~ '[[:space:][:cntrl:]]' and recipient_email ~ '^[^@]+@[^@]+\.[^@]+$')
);
create table private.guest_contract_signatures(
 signing_id uuid primary key references private.contract_signings(id),invitation_id uuid not null unique references private.guest_document_invitations(id),
 full_name text not null check(length(full_name) between 2 and 160 and full_name=btrim(full_name) and full_name !~ '[[:cntrl:]]'),
 document_hash text not null check(document_hash ~ '^[a-f0-9]{64}$'),consent_version text not null check(consent_version='2026-10-14'),
 signed_at timestamptz not null default clock_timestamp()
);
create table private.guest_document_audit(
 invitation_id uuid not null references private.guest_document_invitations(id),request_id uuid not null,payload jsonb not null,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(invitation_id,request_id)
);
alter table private.guest_document_invitations enable row level security;
alter table private.guest_contract_signatures enable row level security;
alter table private.guest_document_audit enable row level security;
revoke all on private.guest_document_invitations,private.guest_contract_signatures,private.guest_document_audit from public,anon,authenticated,service_role;
create trigger guest_signature_immutable before update or delete on private.guest_contract_signatures for each row execute function private.sale_contract_immutable();
create trigger guest_document_audit_immutable before update or delete on private.guest_document_audit for each row execute function private.sale_contract_immutable();
create function private.guest_invitation_immutable() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' or(to_jsonb(new)-array['token_hash','revoked_at']) is distinct from(to_jsonb(old)-array['token_hash','revoked_at'])
 or(old.token_hash is not null and new.token_hash is distinct from old.token_hash)
 or(old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then raise exception 'Immutable guest capability' using errcode='55000';end if;return new;end $$;
create trigger guest_invitation_immutable before update or delete on private.guest_document_invitations for each row execute function private.guest_invitation_immutable();
revoke all on function private.guest_invitation_immutable() from public,anon,authenticated,service_role;

-- One logical party representation; historical authenticated JSON stays unchanged.
create function private.contract_party_signatures(p_signing_id uuid) returns table(party text,actor_user_id uuid,full_name text,document_hash text,consent_version text,strokes jsonb,signed_at timestamptz,guest_invitation_id uuid,recipient_email text)
 language sql stable security invoker set search_path='' as $$
 select x.party,x.actor_user_id,x.full_name,x.document_hash,x.consent_version,x.strokes,x.signed_at,null::uuid,null::text from private.contract_signatures x where x.signing_id=p_signing_id
 union all
 select 'customer',null::uuid,x.full_name,x.document_hash,x.consent_version,'[]'::jsonb,x.signed_at,x.invitation_id,i.recipient_email
 from private.guest_contract_signatures x join private.guest_document_invitations i on i.id=x.invitation_id
 where x.signing_id=p_signing_id and i.kind='contract_invitation' and i.reference_id=x.signing_id and i.document_hash=x.document_hash
 $$;
revoke all on function private.contract_party_signatures(uuid) from public,anon,authenticated,service_role;

-- Source locks precede capability locks; mutations take the deal UPDATE lock
-- immediately, avoiding shared-lock upgrades between simultaneous approvals.
create function private.guest_document_source_current(i private.guest_document_invitations,p_write boolean) returns boolean
 language plpgsql security invoker set search_path='' as $$declare r text;d uuid;h text;v integer;em text;st text;
begin
 if i.revoked_at is not null or not exists(select 1 from private.transactional_email_outbox e where e.id=i.email_id and e.kind=i.kind and e.reference_id=i.reference_id and e.recipient=i.recipient_email and e.status<>'cancelled') then return false;end if;
 perform private.company_team_account(i.dealer_actor_user_id,true);
 perform 1 from public.companies where id=i.company_id and status='active' for share;if not found then return false;end if;
 select role into r from public.memberships where company_id=i.company_id and user_id=i.dealer_actor_user_id and status='active' for share;
 if r is null or r<>all(case when i.kind='offer_invitation' then array['owner','admin','sales'] else array['owner','admin'] end) then return false;end if;
 if i.kind='offer_invitation' then
  select q.deal_id into d from private.offer_reviews q where q.id=i.reference_id and q.company_id=i.company_id;
 else select s.deal_id into d from private.contract_signings s where s.id=i.reference_id and s.company_id=i.company_id and s.created_by=i.dealer_actor_user_id;end if;
 if d is null then return false;end if;
 if p_write then select status into st from public.deals where company_id=i.company_id and id=d for update;
 else select status into st from public.deals where company_id=i.company_id and id=d for share;end if;
 if st is null or st='cancelled' then return false;end if;
 if i.kind='offer_invitation' then
  select encode(sha256(convert_to(o.snapshot::text,'UTF8')),'hex'),q.offer_version,q.recipient_email,private.offer_review_json(q)->>'status' into h,v,em,st
  from private.offer_reviews q join public.offers o on o.company_id=q.company_id and o.id=q.offer_id
  where q.id=i.reference_id and q.company_id=i.company_id and exists(select 1 from private.offer_review_audit a where a.company_id=q.company_id and a.actor_user_id=i.dealer_actor_user_id and a.payload->>'action'='publish' and a.receipt#>>'{review,id}'=q.id::text) for share of q;
  if st not in('pending','accepted','declined') then return false;end if;
 else
  select s.document_hash,x.version,s.customer_email,private.contract_signing_json(s,null,'customer')->>'status' into h,v,em,st
  from private.contract_signings s join private.sale_contract_drafts x on x.id=s.draft_id and x.company_id=s.company_id
  where s.id=i.reference_id and s.company_id=i.company_id for share of s;
  if st not in('pending','completed') or(i.kind='contract_completed' and st<>'completed') then return false;end if;
 end if;
 return coalesce(h=i.document_hash and v=i.document_version and em=i.recipient_email,false);
exception when insufficient_privilege then return false;
end $$;
revoke all on function private.guest_document_source_current(private.guest_document_invitations,boolean) from public,anon,authenticated,service_role;

create function private.require_guest_document(p_invitation_id uuid,p_token_hash text,p_write boolean) returns private.guest_document_invitations
 language plpgsql security invoker set search_path='' as $$declare i private.guest_document_invitations;
begin
 if current_setting('role',true) is distinct from 'service_role' or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Document unavailable' using errcode='42501';end if;
 select * into i from private.guest_document_invitations where id=p_invitation_id and token_hash=p_token_hash and revoked_at is null and expires_at>clock_timestamp();
 if i.id is null or private.guest_document_source_current(i,p_write) is distinct from true then raise exception 'Document unavailable' using errcode='42501';end if;
 if p_write then select * into i from private.guest_document_invitations where id=i.id and token_hash=p_token_hash and revoked_at is null and expires_at>clock_timestamp() for update;
 else select * into i from private.guest_document_invitations where id=i.id and token_hash=p_token_hash and revoked_at is null and expires_at>clock_timestamp() for share;end if;
 if i.id is null then raise exception 'Document unavailable' using errcode='42501';end if;return i;
end $$;
create function private.guest_document_json(i private.guest_document_invitations) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('invitationId',i.id,'kind',i.kind,'referenceId',i.reference_id,'companyId',i.company_id,'recipientEmail',i.recipient_email,'expiresAt',i.expires_at,'documentHash',i.document_hash,'documentVersion',i.document_version,
 'document',case when i.kind='offer_invitation' then(select private.offer_review_json(q,true) from private.offer_reviews q where q.id=i.reference_id)
 else(select private.contract_signing_json(s,null,'customer') from private.contract_signings s where s.id=i.reference_id)end)
 $$;
revoke all on function private.require_guest_document(uuid,text,boolean),private.guest_document_json(private.guest_document_invitations) from public,anon,authenticated,service_role;
create function public.get_guest_customer_document(p_invitation_id uuid,p_token_hash text) returns jsonb language plpgsql security definer set search_path='' as $$declare i private.guest_document_invitations;begin
 i:=private.require_guest_document(p_invitation_id,p_token_hash,false);return private.guest_document_json(i);end $$;
revoke all on function public.get_guest_customer_document(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_guest_customer_document(uuid,text) to service_role;

create or replace function private.contract_signing_json(s private.contract_signings,a uuid,r text) returns jsonb language sql set search_path='' as $$
 select jsonb_build_object('id',s.id,'companyId',s.company_id,'dealId',s.deal_id,'draftId',s.draft_id,'draftVersion',d.version,'documentHash',s.document_hash,'canonicalContent',s.canonical_content,'draft',private.sale_contract_draft_json(d),'customerEmail',s.customer_email,'createdAt',s.created_at,
 'revision',1+q.n,'status',case when q.n=2 then 'completed' when c.status<>'active' or b.status not in('draft','reserved') then 'unavailable' else 'pending' end,
 'completedAt',case when q.n=2 then q.completed end,'customerSignature',q.customer,'companySignature',q.company,
 'party',case when r='customer' then 'customer' when r in('owner','admin') then 'company' end,
 'canSign',q.n<2 and c.status='active' and b.status in('draft','reserved') and not exists(select 1 from private.contract_party_signatures(s.id) z where (z.actor_user_id=a or z.party=case when r='customer' then 'customer' else 'company' end)) and r in('customer','owner','admin'))
 from private.sale_contract_drafts d join public.companies c on c.id=s.company_id join public.deals b on b.company_id=s.company_id and b.id=s.deal_id,
 lateral(select count(*)::integer n,max(x.signed_at) completed,
 max(case when x.party='customer' then (jsonb_build_object('party',x.party,'fullName',x.full_name,'signedAt',x.signed_at,'documentHash',x.document_hash,'consentVersion',x.consent_version,'strokes',x.strokes)||case when x.guest_invitation_id is not null then jsonb_build_object('authenticationMethod','email_link','approvalMethod','typed_name','guestInvitationId',x.guest_invitation_id,'recipientEmail',x.recipient_email) else '{}'::jsonb end)::text end)::jsonb customer,
 max(case when x.party='company' then (jsonb_build_object('party',x.party,'fullName',x.full_name,'signedAt',x.signed_at,'documentHash',x.document_hash,'consentVersion',x.consent_version,'strokes',x.strokes)||case when x.guest_invitation_id is not null then jsonb_build_object('authenticationMethod','email_link','approvalMethod','typed_name','guestInvitationId',x.guest_invitation_id,'recipientEmail',x.recipient_email) else '{}'::jsonb end)::text end)::jsonb company
 from private.contract_party_signatures(s.id) x)q where d.id=s.draft_id;
$$;

create or replace function private.sign_contract(p_signing_id uuid,p_company_id uuid,p_expected_revision integer,p_document_hash text,p_full_name text,p_strokes jsonb,p_acknowledged boolean,p_consent_version text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;r text;e text;s private.contract_signings;v_party text;p jsonb;receipt jsonb;n integer;ds text;customer_actor uuid;company_actor uuid;company_email text;begin
 if p_company_id is null then select user_id,email into a,e from private.company_team_identity(true);r:='customer';v_party:='customer';select * into s from private.contract_signings where id=p_signing_id and customer_email=e;
 else select actor,actor_role into a,r from private.sale_contract_access(p_company_id,true);v_party:='company';select * into s from private.contract_signings where id=p_signing_id and company_id=p_company_id;end if;
 if s.id is null then raise exception 'Signing denied' using errcode='42501';end if;
 perform 1 from public.companies where id=s.company_id and status='active' for share;if not found then raise exception 'Company denied' using errcode='42501';end if;
 select status into ds from public.deals where company_id=s.company_id and id=s.deal_id for update;
 select * into s from private.contract_signings where id=s.id for update;
 if p_expected_revision is null or p_expected_revision not between 1 and 2 or p_document_hash is distinct from s.document_hash or p_full_name is null or p_full_name<>btrim(p_full_name) or length(p_full_name) not between 2 and 160 or p_full_name ~ '[[:cntrl:]]' or p_acknowledged is distinct from true or p_consent_version is distinct from '2026-10-14' or not private.contract_signature_valid(p_strokes) then raise exception 'Invalid signature acknowledgement' using errcode='22023';end if;
 p:=jsonb_build_object('operation','signContract','signingId',s.id,'companyId',p_company_id,'party',v_party,'expectedRevision',p_expected_revision,'documentHash',p_document_hash,'fullName',p_full_name,'strokes',p_strokes,'acknowledged',true,'consentVersion',p_consent_version);
 receipt:=private.contract_signing_replay(a,p_request_id,p);if receipt is not null then return receipt;end if;
 select count(*) into n from private.contract_party_signatures(s.id);
 if ds not in('draft','reserved') or 1+n<>p_expected_revision or exists(select 1 from private.contract_party_signatures(s.id) x where (x.party=v_party or x.actor_user_id=a)) then raise exception 'Signature conflict' using errcode='40001';end if;
 insert into private.contract_signatures(signing_id,party,actor_user_id,full_name,document_hash,consent_version,strokes)values(s.id,v_party,a,p_full_name,s.document_hash,p_consent_version,p_strokes);
 if n=1 then
 select actor_user_id into customer_actor from private.contract_signatures where signing_id=s.id and contract_signatures.party='customer';
 perform private.enqueue_transactional_email('contract_completed',s.id,s.customer_email,customer_actor);
 select x.actor_user_id,u.email into company_actor,company_email from private.contract_signatures x join auth.users u on u.id=x.actor_user_id where x.signing_id=s.id and x.party='company';
 perform private.enqueue_transactional_email('contract_completed_company',s.id,company_email,company_actor);
 end if;
 receipt:=jsonb_build_object('companyId',s.company_id,'actorUserId',a,'actorRole',r,'recipientEmail',e,'requestId',p_request_id,'signing',private.contract_signing_json(s,a,r));
 insert into private.contract_signing_audit(actor_user_id,request_id,payload,receipt)values(a,p_request_id,p,receipt);return receipt;
end$$;

create function private.guest_document_replay(p_invitation_id uuid,p_request_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare a private.guest_document_audit;begin
 if p_request_id is null then raise exception 'Request required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('trafexa-guest-request:'||p_invitation_id::text||p_request_id::text,0));
 select * into a from private.guest_document_audit where invitation_id=p_invitation_id and request_id=p_request_id;
 if found then if a.payload is distinct from p_payload then raise exception 'Request changed' using errcode='40001';end if;return a.receipt;end if;return null;
end $$;
revoke all on function private.guest_document_replay(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.respond_guest_offer(p_invitation_id uuid,p_token_hash text,p_expected_version integer,p_decision text,p_full_name text,p_reason text,p_acknowledged boolean,p_ack_version text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.guest_document_invitations;q private.offer_reviews;p jsonb;receipt jsonb;begin
 i:=private.require_guest_document(p_invitation_id,p_token_hash,true);
 if i.kind<>'offer_invitation' then raise exception 'Document unavailable' using errcode='42501';end if;
 if p_expected_version is null or p_expected_version not between 1 and 2147483646 or p_decision is null or p_decision not in('accepted','declined')
 or p_full_name is null or length(p_full_name) not between 2 and 160 or p_full_name<>btrim(p_full_name) or p_full_name ~ '[[:cntrl:]]'
 or p_acknowledged is distinct from true or p_ack_version is distinct from '2026-10-14'
 or(p_decision='accepted' and p_reason is not null) or(p_decision='declined' and(p_reason is null or length(p_reason) not between 2 and 500 or p_reason<>btrim(p_reason) or p_reason ~ '[[:cntrl:]]')) then raise exception 'Explicit approval required' using errcode='22023';end if;
 p:=jsonb_build_object('operation','respondGuestOffer','expectedVersion',p_expected_version,'decision',p_decision,'fullName',p_full_name,'reason',p_reason,'acknowledged',true,'ackVersion',p_ack_version);
 receipt:=private.guest_document_replay(i.id,p_request_id,p);if receipt is not null then return receipt;end if;
 select * into q from private.offer_reviews where id=i.reference_id and company_id=i.company_id for update;
 if q.version<>p_expected_version or private.offer_review_json(q)->>'status'<>'pending' then raise exception 'Offer changed' using errcode='40001';end if;
 update private.offer_reviews set status=p_decision,version=version+1,decided_at=clock_timestamp(),responder_name=p_full_name,reason=p_reason where id=q.id;
 receipt:=private.guest_document_json(i)||jsonb_build_object('requestId',p_request_id);
 insert into private.guest_document_audit(invitation_id,request_id,payload,receipt)values(i.id,p_request_id,p,receipt);return receipt;
end $$;

create function public.sign_guest_contract(p_invitation_id uuid,p_token_hash text,p_expected_revision integer,p_document_hash text,p_full_name text,p_strokes jsonb,p_acknowledged boolean,p_consent_version text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.guest_document_invitations;s private.contract_signings;p jsonb;receipt jsonb;n integer;company_actor uuid;company_email text;begin
 i:=private.require_guest_document(p_invitation_id,p_token_hash,true);
 if i.kind<>'contract_invitation' then raise exception 'Document unavailable' using errcode='42501';end if;
 if p_expected_revision is null or p_expected_revision not between 1 and 2 or p_document_hash is distinct from i.document_hash
 or p_full_name is null or length(p_full_name) not between 2 and 160 or p_full_name<>btrim(p_full_name) or p_full_name ~ '[[:cntrl:]]'
 or p_strokes is distinct from '[]'::jsonb or p_acknowledged is distinct from true or p_consent_version is distinct from '2026-10-14' then raise exception 'Explicit document approval required' using errcode='22023';end if;
 p:=jsonb_build_object('operation','signGuestContract','expectedRevision',p_expected_revision,'documentHash',p_document_hash,'fullName',p_full_name,'strokes','[]'::jsonb,'acknowledged',true,'consentVersion',p_consent_version);
 receipt:=private.guest_document_replay(i.id,p_request_id,p);if receipt is not null then return receipt;end if;
 select * into s from private.contract_signings where id=i.reference_id and company_id=i.company_id for update;
 select count(*) into n from private.contract_party_signatures(s.id);
 if n+1<>p_expected_revision or n>=2 or exists(select 1 from private.contract_party_signatures(s.id) where party='customer') then raise exception 'Signing changed' using errcode='40001';end if;
 insert into private.guest_contract_signatures(signing_id,invitation_id,full_name,document_hash,consent_version)values(s.id,i.id,p_full_name,i.document_hash,p_consent_version);
 if n=1 then
  perform private.enqueue_transactional_email('contract_completed',s.id,s.customer_email,null);
  select x.actor_user_id,u.email into company_actor,company_email from private.contract_signatures x join auth.users u on u.id=x.actor_user_id where x.signing_id=s.id and x.party='company';
  perform private.enqueue_transactional_email('contract_completed_company',s.id,company_email,company_actor);
 end if;
 receipt:=private.guest_document_json(i)||jsonb_build_object('requestId',p_request_id);
 insert into private.guest_document_audit(invitation_id,request_id,payload,receipt)values(i.id,p_request_id,p,receipt);return receipt;
end $$;
revoke all on function public.respond_guest_offer(uuid,text,integer,text,text,text,boolean,text,uuid),public.sign_guest_contract(uuid,text,integer,text,text,jsonb,boolean,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.respond_guest_offer(uuid,text,integer,text,text,text,boolean,text,uuid),public.sign_guest_contract(uuid,text,integer,text,text,jsonb,boolean,text,uuid) to service_role;

create or replace function private.require_contract_archive_source(p_signing_id uuid,p_company_id uuid,p_actor_user_id uuid,p_write boolean)
returns private.contract_signings language plpgsql security invoker set search_path='' as $$
declare e text;r text;s private.contract_signings;d private.sale_contract_drafts;n integer;actors integer;
begin
 if p_actor_user_id is null or p_write is null or(p_write and p_company_id is null) then
  raise exception 'Native archive access denied' using errcode='42501';end if;
 e:=private.company_team_account(p_actor_user_id,true);
 select * into s from private.contract_signings where id=p_signing_id
 and(case when p_company_id is null then customer_email=e else company_id=p_company_id end);
 if not found then raise exception 'Native archive access denied' using errcode='42501';end if;
 perform 1 from public.companies where id=s.company_id and status='active' for share;
 if not found then raise exception 'Native archive access denied' using errcode='42501';end if;
 if p_company_id is not null then
  select role into r from public.memberships where company_id=s.company_id and user_id=p_actor_user_id and status='active' for share;
  if r is null or r not in('owner','admin','finance') or(p_write and r='finance') then
   raise exception 'Native archive access denied' using errcode='42501';end if;
 end if;
 -- Historical completed originals remain readable after a deal is cancelled/sold.
 perform 1 from public.deals where company_id=s.company_id and id=s.deal_id for share;
 if not found then raise exception 'Native archive source unavailable' using errcode='42501';end if;
 if p_write then select * into s from private.contract_signings where id=s.id for update;
 else select * into s from private.contract_signings where id=s.id for share;end if;
 select * into d from private.sale_contract_drafts where company_id=s.company_id and deal_id=s.deal_id and id=s.draft_id for share;
 if not found or s.canonical_content is distinct from jsonb_build_object('draftId',d.id,'companyId',d.company_id,'dealId',d.deal_id,'draftVersion',d.version,'content',d.snapshot)::text
  or s.document_hash is distinct from encode(sha256(convert_to(s.canonical_content,'UTF8')),'hex') then
  raise exception 'Native archive source conflict' using errcode='40001';end if;
 select count(*),count(distinct actor_user_id) into n,actors from private.contract_party_signatures(s.id)
 where document_hash=s.document_hash and consent_version='2026-10-14';
 if n<>2 or actors<>(case when exists(select 1 from private.guest_contract_signatures where signing_id=s.id) then 1 else 2 end)
 or not exists(select 1 from private.contract_party_signatures(s.id) where party='company' and actor_user_id is not null)
 or not exists(select 1 from private.contract_party_signatures(s.id) where party='customer') then raise exception 'Completed native signing required' using errcode='40001';end if;
 return s;
end$$;
create function public.get_guest_contract_archive(p_invitation_id uuid,p_token_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.guest_document_invitations;s private.contract_signings;a private.contract_signing_archives;
begin
 i:=private.require_guest_document(p_invitation_id,p_token_hash,false);
 if i.kind not in('contract_invitation','contract_completed') then raise exception 'Document unavailable' using errcode='42501';end if;
 -- The original immutable source proof uses the recorded real dealer actor;
 -- the guest capability remains the caller's sole authorization credential.
 s:=private.require_contract_archive_source(i.reference_id,i.company_id,i.dealer_actor_user_id,false);
 if s.document_hash<>i.document_hash then raise exception 'Document source changed' using errcode='40001';end if;
 perform private.require_native_contract_archive_bucket();
 select * into a from private.contract_signing_archives where company_id=i.company_id and signing_id=s.id;
 if a.id is not null and(a.document_content_sha256<>s.document_hash or a.signing_revision<>3 or a.draft_id<>s.draft_id or a.draft_version<>i.document_version) then raise exception 'Document original changed' using errcode='40001';end if;
 return jsonb_build_object('invitationId',i.id,'companyId',i.company_id,'signingId',s.id,'archive',case when a.id is null then null else private.contract_signing_archive_json(a) end);
end $$;
revoke all on function public.get_guest_contract_archive(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_guest_contract_archive(uuid,text) to service_role;
commit;
