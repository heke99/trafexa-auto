-- Restore the existing authenticated customer/dealer APIs. New email recipients
-- use document-scoped guest capabilities; no account is created for a buyer.
begin;

create or replace function private.enforce_approved_application_invitation() returns trigger
 language plpgsql security definer set search_path='' as $$
declare caller text:=coalesce(nullif(current_setting('role',true),'none'),session_user::text);
 item private.application_account_invitations; app private.demo_requests; actor uuid; u auth.users; receipt jsonb;
begin
 -- Explicit trusted database administration/fixture imports remain possible.
 -- SECURITY DEFINER current_user is deliberately never used to identify caller.
 if caller in ('postgres','supabase_admin') then return null;end if;
 select * into u from auth.users where id=new.id;
 if not found then return null;end if;
 if caller<>'supabase_auth_admin' or to_jsonb(u)->>'invited_at' is null
 or u.email is null or coalesce(u.is_anonymous,false) or coalesce(u.is_sso_user,false) then
  raise exception 'Registration requires an approved application invitation' using errcode='42501';end if;
 select actor_user_id into actor from private.application_account_invitations where email=lower(btrim(u.email)) and user_id is null;
 if actor is null then raise exception 'Approved application invitation required' using errcode='42501';end if;
 -- Same order as preparation: actual approver Auth, private admin registry, case,
 -- email lock, intent. Revocation, erasure and case changes serialize correctly.
 perform 1 from auth.users where id=actor and email_confirmed_at is not null and not coalesce(is_anonymous,false)
 and not coalesce(is_sso_user,false) and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception 'Approver unavailable' using errcode='42501';end if;
 perform 1 from private.platform_admins where user_id=actor and status='active' for share;
 if not found then raise exception 'Approver unavailable' using errcode='42501';end if;
 select d.* into app from private.demo_requests d join private.application_account_invitations i on i.application_id=d.id
 where i.email=lower(btrim(u.email)) for update of d;
 if not found or app.legacy or app.status='closed' then raise exception 'Approved application unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('trafexa-application-invite-email:'||lower(btrim(u.email)),0));
 select * into item from private.application_account_invitations where email=lower(btrim(u.email)) for update;
 if not found or item.user_id is not null or item.actor_user_id<>actor or item.application_version<>app.version
 or item.expires_at<=clock_timestamp() or lower(btrim(app.email))<>item.email
 or exists(select 1 from auth.users where id<>u.id and lower(btrim(email))=item.email) then
  raise exception 'Approved application invitation unavailable' using errcode='42501';end if;
 update private.application_account_invitations set user_id=u.id,consumed_at=clock_timestamp() where id=item.id returning * into item;
 insert into private.account_approvals(user_id,status,version,updated_by) values(u.id,'approved',1,item.actor_user_id);
 receipt:=jsonb_build_object('actorUserId',item.actor_user_id,'userId',u.id,'requestId',item.request_id,
 'previousStatus','pending','status','approved','version',1,'changed',true,'reason',item.reason,'createdAt',item.consumed_at);
 insert into private.account_approval_audit(actor_user_id,user_id,request_id,payload,receipt,reason)
 values(item.actor_user_id,u.id,item.request_id,jsonb_build_object('applicationId',item.application_id,'invitationId',item.id),receipt,item.reason);
 return null;
end $$;

create or replace function private.list_my_offer_reviews(p_page_key uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;e text;rows jsonb;n uuid;begin
 select user_id,email into a,e from private.company_team_identity(true);
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid limit' using errcode='22023';end if;
 if p_page_key is not null and not exists(select 1 from private.offer_reviews r join public.companies c on c.id=r.company_id and c.status='active' where r.id=p_page_key and r.recipient_email=e) then raise exception 'Cursor conflict' using errcode='40001';end if;
 select coalesce(jsonb_agg(private.offer_review_json(x,true) order by x.id desc),'[]') into rows from (select r.* from private.offer_reviews r join public.companies c on c.id=r.company_id and c.status='active' where r.recipient_email=e and (p_page_key is null or r.id<p_page_key) order by r.id desc limit p_limit)x;
 if jsonb_array_length(rows)=p_limit and exists(select 1 from private.offer_reviews r join public.companies c on c.id=r.company_id and c.status='active' where r.recipient_email=e and r.id<(rows->(p_limit-1)->>'id')::uuid) then n:=(rows->(p_limit-1)->>'id')::uuid;end if;
 return jsonb_build_object('actorUserId',a,'recipientEmail',e,'reviews',rows,'nextPageKey',n);end $$;

create or replace function private.respond_offer_review(p_review_id uuid,p_expected_version integer,p_decision text,p_responder_name text,p_reason text,p_ack_version text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;e text;r private.offer_reviews;scope_company uuid;scope_deal uuid;p jsonb;v jsonb;s text;begin
 select user_id,email into a,e from private.company_team_identity(true);
 select company_id,deal_id into scope_company,scope_deal from private.offer_reviews where id=p_review_id and recipient_email=e;
 if not found then raise exception 'Review access denied' using errcode='42501';end if;
 select status into s from public.companies where id=scope_company for share;
 if s is distinct from 'active' then raise exception 'Company access denied' using errcode='42501';end if;
 perform 1 from public.deals where company_id=scope_company and id=scope_deal for update;
 select * into r from private.offer_reviews where id=p_review_id and company_id=scope_company and deal_id=scope_deal and recipient_email=e for update;
 if not found then raise exception 'Review access denied' using errcode='42501';end if;
 if p_expected_version is null or p_expected_version<1 or p_decision is null or p_decision not in ('accepted','declined') or p_responder_name is null or p_responder_name<>btrim(p_responder_name) or length(p_responder_name) not between 2 and 160 or p_responder_name ~ '[[:cntrl:]]' or p_ack_version is distinct from '2026-10-14' or (p_decision='accepted' and p_reason is not null) or (p_decision='declined' and (p_reason is null or p_reason<>btrim(p_reason) or length(p_reason) not between 2 and 500 or p_reason ~ '[[:cntrl:]]')) then raise exception 'Invalid response' using errcode='22023';end if;
 p:=jsonb_build_object('action','respond','reviewId',p_review_id,'expectedVersion',p_expected_version,'decision',p_decision,'responderName',p_responder_name,'reason',p_reason,'ackVersion',p_ack_version,'recipientEmail',e);
 v:=private.offer_review_replay(a,p_request_id,p);if v is not null then return v;end if;
 if r.version<>p_expected_version or r.version=2147483647 or private.offer_review_json(r)->>'status'<>'pending' then raise exception 'Review conflict' using errcode='40001';end if;
 update private.offer_reviews set status=p_decision,version=version+1,decided_at=clock_timestamp(),responder_name=p_responder_name,reason=p_reason where id=r.id returning * into r;
 v:=jsonb_build_object('actorUserId',a,'requestId',p_request_id,'review',private.offer_review_json(r,true));
 insert into private.offer_review_audit(company_id,actor_user_id,request_id,payload,receipt)values(scope_company,a,p_request_id,p,v);return v;end $$;

create or replace function private.list_my_contract_signings(p_before_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;e text;rows jsonb;n uuid;begin
 select user_id,email into a,e from private.company_team_identity(true);
 if p_before_id is not null and not exists(select 1 from private.contract_signings s join public.companies c on c.id=s.company_id and c.status='active' where s.id=p_before_id and s.customer_email=e) then raise exception 'Cursor denied' using errcode='40001';end if;
 select coalesce(jsonb_agg(private.contract_signing_json(x,a,'customer') order by x.id desc),'[]') into rows from(select s.* from private.contract_signings s join public.companies c on c.id=s.company_id and c.status='active' where s.customer_email=e and(p_before_id is null or s.id<p_before_id) order by s.id desc limit 50)x;
 if jsonb_array_length(rows)=50 and exists(select 1 from private.contract_signings s join public.companies c on c.id=s.company_id and c.status='active' where s.customer_email=e and s.id<(rows->49->>'id')::uuid) then n:=(rows->49->>'id')::uuid;end if;
 return jsonb_build_object('actorUserId',a,'recipientEmail',e,'signings',rows,'nextBeforeId',n);end$$;

create or replace function private.get_contract_signing(p_signing_id uuid,p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;r text;e text;s private.contract_signings;begin
 if p_company_id is null then select user_id,email into a,e from private.company_team_identity(true);r:='customer';select * into s from private.contract_signings where id=p_signing_id and customer_email=e;
 else select actor,actor_role into a,r from private.sale_contract_access(p_company_id,false);select * into s from private.contract_signings where id=p_signing_id and company_id=p_company_id;end if;
 if s.id is null then raise exception 'Signing denied' using errcode='42501';end if;
 perform 1 from public.companies where id=s.company_id and status='active' for share;if not found then raise exception 'Company denied' using errcode='42501';end if;
 return jsonb_build_object('companyId',s.company_id,'actorUserId',a,'actorRole',r,'recipientEmail',e,'signing',private.contract_signing_json(s,a,r));end$$;

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
 select count(*) into n from private.contract_signatures where signing_id=s.id;
 if ds not in('draft','reserved') or 1+n<>p_expected_revision or exists(select 1 from private.contract_signatures x where x.signing_id=s.id and(x.party=v_party or x.actor_user_id=a)) then raise exception 'Signature conflict' using errcode='40001';end if;
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
 select count(*),count(distinct actor_user_id) into n,actors from private.contract_signatures
 where signing_id=s.id and document_hash=s.document_hash and consent_version='2026-10-14';
 if n<>2 or actors<>2 then raise exception 'Completed native signing required' using errcode='40001';end if;
 return s;
end$$;

create or replace function private.native_contract_storage_access(p_path text,p_write boolean,p_owner_id text) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();company uuid;signing uuid;e text;dealer boolean;s private.contract_signings;
begin
 if current_setting('role',true) is distinct from 'authenticated' or actor is null or p_write is null
  or p_path is null or p_path !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/native-contracts/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/v1/(signed-[a-f0-9]{64}\.pdf|evidence-[a-f0-9]{64}\.json)$' then return false;end if;
 company:=split_part(p_path,'/',1)::uuid;signing:=split_part(p_path,'/',3)::uuid;
 dealer:=exists(select 1 from public.memberships where company_id=company and user_id=actor and status='active' and role=any(case when p_write then array['owner','admin'] else array['owner','admin','finance'] end));
 if p_write and not dealer then return false;end if;
 s:=private.require_contract_archive_source(signing,case when dealer then company else null end,actor,p_write);
 if s.company_id<>company then return false;end if;
 perform private.require_native_contract_archive_bucket();
 if p_write then return p_owner_id=actor::text and not exists(select 1 from private.contract_signing_archives where signing_id=s.id);end if;
 if exists(select 1 from private.contract_signing_archives where company_id=company and signing_id=signing
  and(p_path=pdf_object_path or p_path=evidence_object_path)) then return true;end if;
 -- Only an authorized owner/admin uploader can recover their own unregistered
 -- object after an uncertain upload; finance/customers cannot inspect orphans.
 return p_owner_id=actor::text and exists(select 1 from public.memberships where company_id=company and user_id=actor and status='active' and role in('owner','admin'));
exception when others then return false;
end$$;

-- Retire the unused account-based invitation endpoints. Migration history is
-- retained; none of these RPCs can be used by clients or the delivery worker.
revoke all on function public.get_customer_portal_access(),private.get_customer_portal_access(),public.activate_customer_contract_account(uuid),private.activate_customer_contract_account(uuid),public.prepare_customer_contract_invitation(uuid,uuid),public.current_customer_contract_invitation(uuid,uuid,uuid),public.bind_customer_contract_invitation(uuid,uuid,uuid,text),public.begin_customer_contract_invitation_send(uuid,uuid) from public,anon,authenticated,service_role;
commit;
