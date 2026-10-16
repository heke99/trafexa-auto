-- Customer portal access is separate from approval to operate a dealer account.
-- Trusted server invite evidence alone can establish a recipient-only portal marker.
begin;
create table private.customer_portal_accounts(
 user_id uuid primary key references auth.users(id),email text not null,
 enabled boolean not null default true,created_at timestamptz not null default clock_timestamp(),
 check(email=lower(btrim(email)) and length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);
create table private.customer_portal_invitations(
 id uuid primary key default gen_random_uuid(),email_id uuid not null unique references private.transactional_email_outbox(id),
 kind text not null check(kind in('offer_invitation','contract_invitation')),reference_id uuid not null,
 company_id uuid not null references public.companies(id),dealer_actor_user_id uuid not null references auth.users(id),
 email text not null check(email=lower(btrim(email)) and length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 user_id uuid references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '15 minutes',consumed_at timestamptz,
 check((user_id is null and consumed_at is null) or(user_id is not null and consumed_at is not null))
);
create index customer_portal_invitation_email on private.customer_portal_invitations(email,created_at desc);
create index customer_portal_invitation_user on private.customer_portal_invitations(user_id);
alter table private.customer_portal_accounts enable row level security;
alter table private.customer_portal_invitations enable row level security;
revoke all on private.customer_portal_accounts,private.customer_portal_invitations from public,anon,authenticated,service_role;

create function private.customer_portal_access(p_user uuid,p_lock boolean) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare u auth.users;a text;platform text;marker private.customer_portal_accounts;approved boolean;enabled boolean;
begin
 if p_lock then select * into u from auth.users where id=p_user for share;
 else select * into u from auth.users where id=p_user;end if;
 if u.id is null or u.email is null or u.email_confirmed_at is null or coalesce(u.is_anonymous,false) or coalesce(u.is_sso_user,false)
 or(u.banned_until is not null and u.banned_until>clock_timestamp())
 or(select count(*) from auth.users where lower(btrim(email))=lower(btrim(u.email)))<>1 then
  raise exception 'Verified unique customer account required' using errcode='42501';end if;
 if p_lock then
  select status into a from private.account_approvals where user_id=u.id for share;
  select status into platform from private.platform_admins where user_id=u.id for share;
  select * into marker from private.customer_portal_accounts where user_id=u.id for share;
 else
  select status into a from private.account_approvals where user_id=u.id;
  select status into platform from private.platform_admins where user_id=u.id;
  select * into marker from private.customer_portal_accounts where user_id=u.id;
 end if;
 if a in('rejected','suspended') then raise exception 'Customer account access denied' using errcode='42501';end if;
 approved:=a='approved' or platform='active';
 enabled:=coalesce(approved,false) or coalesce(marker.enabled and marker.email=lower(btrim(u.email)),false);
 return jsonb_build_object('userId',u.id,'email',lower(btrim(u.email)),'enabled',enabled,
  'customerOnly',coalesce(marker.enabled and marker.email=lower(btrim(u.email)),false) and not coalesce(approved,false));
end $$;
create function private.customer_portal_account(p_user uuid,p_lock boolean) returns text
 language plpgsql security invoker set search_path='' as $$declare a jsonb;begin
 a:=private.customer_portal_access(p_user,p_lock);
 if a->>'enabled'<>'true' then raise exception 'Customer portal access required' using errcode='42501';end if;
 return a->>'email';end $$;
create function private.customer_portal_identity(p_lock boolean default false) returns table(user_id uuid,email text)
 language plpgsql security invoker set search_path='' as $$declare actor uuid:=auth.uid();e text;begin
 if current_setting('role',true) is distinct from 'authenticated' or actor is null then raise exception 'Authenticated customer required' using errcode='42501';end if;
 e:=private.customer_portal_account(actor,p_lock);return query select actor,e;end $$;
create function private.get_customer_portal_access() returns jsonb language plpgsql security definer set search_path='' as $$begin
 if current_setting('role',true) is distinct from 'authenticated' or auth.uid() is null then raise exception 'Authenticated customer required' using errcode='42501';end if;
 return private.customer_portal_access(auth.uid(),true);end $$;
create function public.get_customer_portal_access() returns jsonb language sql security invoker set search_path='' as $$select private.get_customer_portal_access();$$;
revoke all on function private.customer_portal_access(uuid,boolean),private.customer_portal_account(uuid,boolean),private.customer_portal_identity(boolean) from public,anon,authenticated,service_role;
revoke all on function private.get_customer_portal_access(),public.get_customer_portal_access() from public,anon,authenticated,service_role;
grant execute on function private.get_customer_portal_access(),public.get_customer_portal_access() to authenticated;

-- Caller is a trusted private domain function. Validate the current sender and source,
-- never client metadata, client-supplied recipient fields or provider credentials.
create function private.customer_portal_invitation_source_current(i private.customer_portal_invitations) returns boolean
 language plpgsql security invoker set search_path='' as $$
declare actor_email text;r text;approval text;
begin
 if not exists(select 1 from private.transactional_email_outbox e where e.id=i.email_id and e.kind=i.kind and e.reference_id=i.reference_id and e.recipient=i.email and e.status<>'cancelled') then return false;end if;
 actor_email:=private.company_team_account(i.dealer_actor_user_id,true);
 select status into approval from private.account_approvals where user_id=i.dealer_actor_user_id for share;
 if approval in('rejected','suspended') then return false;end if;
 perform 1 from public.companies where id=i.company_id and status='active' for share;if not found then return false;end if;
 select role into r from public.memberships where company_id=i.company_id and user_id=i.dealer_actor_user_id and status='active' for share;
 if r is null or r<>all(case when i.kind='offer_invitation' then array['owner','admin','sales'] else array['owner','admin'] end) then return false;end if;
 if i.kind='contract_invitation' then
  perform 1 from private.contract_signings s join public.deals d on d.company_id=s.company_id and d.id=s.deal_id
   where s.id=i.reference_id and s.company_id=i.company_id and s.created_by=i.dealer_actor_user_id and s.customer_email=i.email and d.status in('draft','reserved')
   and not exists(select 1 from private.contract_signatures g where g.signing_id=s.id and g.party='customer') for share of s,d;
  return found;
 elsif i.kind='offer_invitation' then
  perform 1 from private.offer_reviews q join public.deals d on d.company_id=q.company_id and d.id=q.deal_id
   where q.id=i.reference_id and q.company_id=i.company_id and q.recipient_email=i.email
   and exists(select 1 from private.offer_review_audit a where a.company_id=q.company_id and a.actor_user_id=i.dealer_actor_user_id and a.payload->>'action'='publish' and a.receipt->'review'->>'id'=q.id::text)
   and private.offer_review_json(q)->>'status'='pending' for share of q,d;
  return found;
 end if;
 return false;
exception when insufficient_privilege then return false;
end $$;

create function private.bind_customer_portal_invitation(p_invitation uuid,p_user uuid) returns void
 language plpgsql security invoker set search_path='' as $$
declare i private.customer_portal_invitations;u auth.users;a text;marker private.customer_portal_accounts;
begin
 select * into i from private.customer_portal_invitations where id=p_invitation;
 if i.id is null or i.expires_at<=clock_timestamp() or not private.customer_portal_invitation_source_current(i) then raise exception 'Customer invitation unavailable' using errcode='42501';end if;
 if exists(select 1 from private.application_account_invitations where email=i.email and user_id is null) then raise exception 'Application invitation requires its own approval flow' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('trafexa-customer-invite-email:'||i.email,0));
 select * into u from auth.users where id=p_user for update;
 if u.id is null or lower(btrim(u.email)) is distinct from i.email or coalesce(u.is_anonymous,false) or coalesce(u.is_sso_user,false)
 or(u.banned_until is not null and u.banned_until>clock_timestamp())
 or(select count(*) from auth.users where lower(btrim(email))=i.email)<>1 then raise exception 'Customer invitation account unavailable' using errcode='42501';end if;
 select status into a from private.account_approvals where user_id=u.id for share;
 if a in('rejected','suspended') then raise exception 'Customer invitation account unavailable' using errcode='42501';end if;
 select * into i from private.customer_portal_invitations where id=p_invitation for update;
 if i.expires_at<=clock_timestamp() or(i.user_id is not null and i.user_id<>u.id) then raise exception 'Customer invitation already bound' using errcode='40001';end if;
 select * into marker from private.customer_portal_accounts where user_id=u.id for update;
 if marker.user_id is not null and (not marker.enabled or marker.email<>i.email) then raise exception 'Customer portal marker disabled or changed' using errcode='42501';end if;
 insert into private.customer_portal_accounts(user_id,email,enabled) values(u.id,i.email,true) on conflict(user_id) do nothing;
 update private.customer_portal_invitations set user_id=u.id,consumed_at=coalesce(consumed_at,clock_timestamp()) where id=i.id;
end $$;

create function private.adopt_unverified_customer_portal_account(p_invitation uuid) returns void
 language plpgsql security invoker set search_path='' as $$
declare i private.customer_portal_invitations;u auth.users;a text;email_only boolean;
begin
 select * into i from private.customer_portal_invitations where id=p_invitation;
 if i.id is null or i.expires_at<=clock_timestamp() or not private.customer_portal_invitation_source_current(i) then raise exception 'Customer invitation unavailable' using errcode='42501';end if;
 if exists(select 1 from private.application_account_invitations where email=i.email and user_id is null) then raise exception 'Application invitation requires its own approval flow' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('trafexa-customer-invite-email:'||i.email,0));
 select * into u from auth.users where lower(btrim(email))=i.email for update;
 if u.id is null then return;end if;
 if (select count(*) from auth.users where lower(btrim(email))=i.email)<>1 then raise exception 'Customer invitation account unavailable' using errcode='42501';end if;
 if u.email_confirmed_at is not null then perform private.bind_customer_portal_invitation(i.id,u.id);return;end if;
 select status into a from private.account_approvals where user_id=u.id for share;
 if a in('approved','rejected','suspended') or to_jsonb(u)->>'last_sign_in_at' is not null or not(to_jsonb(u)?'encrypted_password')
 or coalesce(u.is_anonymous,false) or coalesce(u.is_sso_user,false) or(u.banned_until is not null and u.banned_until>clock_timestamp())
 or exists(select 1 from private.platform_admins where user_id=u.id)
 or exists(select 1 from private.application_account_invitations where user_id=u.id or email=i.email)
 or to_regclass('auth.identities') is null then raise exception 'Existing customer account requires separate review' using errcode='23505';end if;
 execute 'select count(*)>0 and bool_and(provider=''email'') from auth.identities where user_id=$1' into email_only using u.id;
 if email_only is distinct from true then raise exception 'Existing customer account requires separate review' using errcode='23505';end if;
 execute 'update auth.users set encrypted_password=null where id=$1' using u.id;
 if to_regclass('auth.refresh_tokens') is not null then execute 'delete from auth.refresh_tokens where user_id::text=$1' using u.id::text;end if;
 if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id=$1' using u.id;end if;
 perform private.bind_customer_portal_invitation(i.id,u.id);
end $$;
revoke all on function private.customer_portal_invitation_source_current(private.customer_portal_invitations),private.bind_customer_portal_invitation(uuid,uuid),private.adopt_unverified_customer_portal_account(uuid) from public,anon,authenticated,service_role;

create or replace function private.enforce_approved_application_invitation() returns trigger
 language plpgsql security definer set search_path='' as $$
declare caller text:=coalesce(nullif(current_setting('role',true),'none'),session_user::text);
 item private.application_account_invitations; app private.demo_requests; actor uuid; u auth.users; receipt jsonb; customer_item private.customer_portal_invitations;
begin
 -- Explicit trusted database administration/fixture imports remain possible.
 -- SECURITY DEFINER current_user is deliberately never used to identify caller.
 if caller in ('postgres','supabase_admin') then return null;end if;
 select * into u from auth.users where id=new.id;
 if not found then return null;end if;
 if caller<>'supabase_auth_admin' or to_jsonb(u)->>'invited_at' is null
 or u.email is null or coalesce(u.is_anonymous,false) or coalesce(u.is_sso_user,false) then
  raise exception 'Registration requires an approved application invitation' using errcode='42501';end if;
 -- An application intent always retains the original superadmin approval path.
 -- Only a separate trusted customer intent can create recipient-only access.
 if not exists(select 1 from private.application_account_invitations where email=lower(btrim(u.email))) then
  select * into customer_item from private.customer_portal_invitations
   where email=lower(btrim(u.email)) and user_id is null and expires_at>clock_timestamp()
   order by created_at desc,id desc limit 1;
  if customer_item.id is null then raise exception 'Trusted customer invitation required' using errcode='42501';end if;
  perform private.bind_customer_portal_invitation(customer_item.id,u.id);
  return null;
 end if;
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
revoke all on function private.enforce_approved_application_invitation() from public,anon,authenticated,service_role;

create function private.activate_customer_contract_account(p_invitation_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();access jsonb;i private.customer_portal_invitations;signing uuid;destination text;
begin
 if current_setting('role',true) is distinct from 'authenticated' or actor is null then raise exception 'Verified customer required' using errcode='42501';end if;
 select * into i from private.customer_portal_invitations where id=p_invitation_id and user_id=actor;
 -- Invitation sender/source locks precede target Auth, as in preparation and binding.
 if i.id is null or not private.customer_portal_invitation_source_current(i) then raise exception 'Customer activation unavailable' using errcode='42501';end if;
 access:=private.customer_portal_access(actor,true);
 if access->>'enabled'<>'true' then raise exception 'Customer portal access required' using errcode='42501';end if;
 select * into i from private.customer_portal_invitations where id=p_invitation_id and user_id=actor and email=access->>'email' for share;
 if i.id is null
 or not exists(select 1 from private.customer_portal_accounts where user_id=actor and email=i.email and enabled for share) then
  raise exception 'Customer activation unavailable' using errcode='42501';end if;
 if i.kind='contract_invitation' then signing:=i.reference_id;destination:='/my-contracts?contract='||signing::text;
 else signing:=null;destination:='/my-offers';end if;
 return jsonb_build_object('userId',actor,'signingId',signing,'nextPath',destination);
end $$;
create function public.activate_customer_contract_account(p_invitation_id uuid) returns jsonb
 language sql security invoker set search_path='' as $$select private.activate_customer_contract_account(p_invitation_id);$$;
revoke all on function private.activate_customer_contract_account(uuid),public.activate_customer_contract_account(uuid) from public,anon,authenticated,service_role;
grant execute on function private.activate_customer_contract_account(uuid),public.activate_customer_contract_account(uuid) to authenticated;

create or replace function private.list_my_offer_reviews(p_page_key uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;e text;rows jsonb;n uuid;begin
 select user_id,email into a,e from private.customer_portal_identity(true);
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid limit' using errcode='22023';end if;
 if p_page_key is not null and not exists(select 1 from private.offer_reviews r join public.companies c on c.id=r.company_id and c.status='active' where r.id=p_page_key and r.recipient_email=e) then raise exception 'Cursor conflict' using errcode='40001';end if;
 select coalesce(jsonb_agg(private.offer_review_json(x,true) order by x.id desc),'[]') into rows from (select r.* from private.offer_reviews r join public.companies c on c.id=r.company_id and c.status='active' where r.recipient_email=e and (p_page_key is null or r.id<p_page_key) order by r.id desc limit p_limit)x;
 if jsonb_array_length(rows)=p_limit and exists(select 1 from private.offer_reviews r join public.companies c on c.id=r.company_id and c.status='active' where r.recipient_email=e and r.id<(rows->(p_limit-1)->>'id')::uuid) then n:=(rows->(p_limit-1)->>'id')::uuid;end if;
 return jsonb_build_object('actorUserId',a,'recipientEmail',e,'reviews',rows,'nextPageKey',n);end $$;

create or replace function private.respond_offer_review(p_review_id uuid,p_expected_version integer,p_decision text,p_responder_name text,p_reason text,p_ack_version text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;e text;r private.offer_reviews;scope_company uuid;scope_deal uuid;p jsonb;v jsonb;s text;begin
 select user_id,email into a,e from private.customer_portal_identity(true);
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
 select user_id,email into a,e from private.customer_portal_identity(true);
 if p_before_id is not null and not exists(select 1 from private.contract_signings s join public.companies c on c.id=s.company_id and c.status='active' where s.id=p_before_id and s.customer_email=e) then raise exception 'Cursor denied' using errcode='40001';end if;
 select coalesce(jsonb_agg(private.contract_signing_json(x,a,'customer') order by x.id desc),'[]') into rows from(select s.* from private.contract_signings s join public.companies c on c.id=s.company_id and c.status='active' where s.customer_email=e and(p_before_id is null or s.id<p_before_id) order by s.id desc limit 50)x;
 if jsonb_array_length(rows)=50 and exists(select 1 from private.contract_signings s join public.companies c on c.id=s.company_id and c.status='active' where s.customer_email=e and s.id<(rows->49->>'id')::uuid) then n:=(rows->49->>'id')::uuid;end if;
 return jsonb_build_object('actorUserId',a,'recipientEmail',e,'signings',rows,'nextBeforeId',n);end$$;
create or replace function private.get_contract_signing(p_signing_id uuid,p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;r text;e text;s private.contract_signings;begin
 if p_company_id is null then select user_id,email into a,e from private.customer_portal_identity(true);r:='customer';select * into s from private.contract_signings where id=p_signing_id and customer_email=e;
 else select actor,actor_role into a,r from private.sale_contract_access(p_company_id,false);select * into s from private.contract_signings where id=p_signing_id and company_id=p_company_id;end if;
 if s.id is null then raise exception 'Signing denied' using errcode='42501';end if;
 perform 1 from public.companies where id=s.company_id and status='active' for share;if not found then raise exception 'Company denied' using errcode='42501';end if;
 return jsonb_build_object('companyId',s.company_id,'actorUserId',a,'actorRole',r,'recipientEmail',e,'signing',private.contract_signing_json(s,a,r));end$$;

create or replace function private.sign_contract(p_signing_id uuid,p_company_id uuid,p_expected_revision integer,p_document_hash text,p_full_name text,p_strokes jsonb,p_acknowledged boolean,p_consent_version text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;r text;e text;s private.contract_signings;v_party text;p jsonb;receipt jsonb;n integer;ds text;customer_actor uuid;company_actor uuid;company_email text;begin
 if p_company_id is null then select user_id,email into a,e from private.customer_portal_identity(true);r:='customer';v_party:='customer';select * into s from private.contract_signings where id=p_signing_id and customer_email=e;
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
 if p_company_id is null then e:=private.customer_portal_account(p_actor_user_id,true);
 else e:=private.company_team_account(p_actor_user_id,true);end if;
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
 dealer:=private.has_account_access() and exists(select 1 from public.memberships where company_id=company and user_id=actor and status='active' and role=any(case when p_write then array['owner','admin'] else array['owner','admin','finance'] end));
 if p_write and not dealer then return false;end if;
 s:=private.require_contract_archive_source(signing,case when dealer then company else null end,actor,p_write);
 if s.company_id<>company then return false;end if;
 perform private.require_native_contract_archive_bucket();
 if p_write then return p_owner_id=actor::text and not exists(select 1 from private.contract_signing_archives where signing_id=s.id);end if;
 if exists(select 1 from private.contract_signing_archives where company_id=company and signing_id=signing
  and(p_path=pdf_object_path or p_path=evidence_object_path)) then return true;end if;
 -- Only an authorized owner/admin uploader can recover their own unregistered
 -- object after an uncertain upload; finance/customers cannot inspect orphans.
 return dealer and p_owner_id=actor::text and exists(select 1 from public.memberships where company_id=company and user_id=actor and status='active' and role in('owner','admin'));
exception when others then return false;
end$$;
commit;
