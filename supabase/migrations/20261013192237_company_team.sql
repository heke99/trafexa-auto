-- Company personnel administration. No owner transfer, bearer tokens or email sending.
-- The only externally callable privileged functions are narrow private implementations
-- behind authenticated public invoker RPCs. Authorization always reads Auth/DB records.
begin;
alter table public.companies add column team_version integer not null default 1 check(team_version>0);
alter table public.memberships add column version integer not null default 1 check(version>0);

create table private.company_team_invitations (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 email text not null check(email=lower(btrim(email)) and length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 role text not null check(role in ('admin','sales','finance','viewer')),
 status text not null default 'pending' check(status in ('pending','accepted','revoked','expired')),
 version integer not null default 1 check(version>0),
 invited_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '7 days',
 accepted_by uuid references auth.users(id), accepted_at timestamptz,
 check(expires_at>created_at),
 check((status='accepted' and accepted_by is not null and accepted_at is not null) or
       (status<>'accepted' and accepted_by is null and accepted_at is null))
);
create unique index company_team_invitation_pending_email on private.company_team_invitations(company_id,email) where status='pending';
create index company_team_invitation_company_page on private.company_team_invitations(company_id,id);
create index company_team_invitation_email_page on private.company_team_invitations(email,id) where status='pending';
create index company_team_invitation_inviter on private.company_team_invitations(invited_by);
create index company_team_invitation_acceptor on private.company_team_invitations(accepted_by) where accepted_by is not null;
create index memberships_company_page on public.memberships(company_id,id);

create table private.company_team_audit (
 id uuid primary key default gen_random_uuid(),
 actor_user_id uuid not null references auth.users(id), company_id uuid not null references public.companies(id),
 request_id uuid not null, action text not null check(action in ('invite','revoke','update_member','accept')),
 payload jsonb not null, receipt jsonb not null, previous_value jsonb, current_value jsonb not null,
 reason text check(length(reason) between 1 and 500 and reason=btrim(reason) and reason !~ '[[:cntrl:]]'),
 created_at timestamptz not null default clock_timestamp(), unique(actor_user_id,request_id)
);
create index company_team_audit_company on private.company_team_audit(company_id,created_at desc);
alter table private.company_team_invitations enable row level security;
alter table private.company_team_audit enable row level security;
revoke all on private.company_team_invitations,private.company_team_audit from public,anon,authenticated,service_role;
create function private.reject_company_team_audit_mutation() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Company team audit is immutable' using errcode='55000'; end $$;
revoke all on function private.reject_company_team_audit_mutation() from public,anon,authenticated,service_role;
create trigger immutable_company_team_audit before update or delete on private.company_team_audit
 for each row execute function private.reject_company_team_audit_mutation();

-- Helpers are NOT client executable; private entrypoints call them as their owner.
create function private.company_team_account(p_user_id uuid,p_lock boolean) returns text
 language plpgsql security invoker set search_path='' as $$
declare u auth.users%rowtype;
begin
 if p_lock then select * into u from auth.users where id=p_user_id for share;
 else select * into u from auth.users where id=p_user_id; end if;
 if not found or u.email_confirmed_at is null or coalesce(u.is_anonymous,false) or coalesce(u.is_sso_user,false)
  or (u.banned_until is not null and u.banned_until>clock_timestamp()) or u.email is null
  or (select count(*) from auth.users x where lower(btrim(x.email))=lower(btrim(u.email))
       and not coalesce(x.is_sso_user,false) and not coalesce(x.is_anonymous,false))<>1 then
  raise exception 'Verified unique account required' using errcode='42501'; end if;
 return lower(btrim(u.email));
end $$;
create function private.company_team_identity(p_lock boolean default false) returns table(user_id uuid,email text)
 language plpgsql security invoker set search_path='' as $$
begin
 if current_setting('role',true)<>'authenticated' or auth.uid() is null then
  raise exception 'Verified authentication required' using errcode='42501'; end if;
 return query select auth.uid(),private.company_team_account(auth.uid(),p_lock);
end $$;
create function private.company_team_manager(p_company_id uuid,p_actor uuid,p_lock boolean default true) returns text
 language plpgsql security invoker set search_path='' as $$
declare r text; s text;
begin
 if p_lock then
  select c.status into s from public.companies c where c.id=p_company_id for update;
 else select c.status into s from public.companies c where c.id=p_company_id; end if;
 if s is distinct from 'active' then raise exception 'Company access denied' using errcode='42501'; end if;
 if p_lock then
  select m.role into r from public.memberships m where m.company_id=p_company_id and m.user_id=p_actor and m.status='active' for update;
 else select m.role into r from public.memberships m where m.company_id=p_company_id and m.user_id=p_actor and m.status='active'; end if;
 if r is null or r not in ('owner','admin') then raise exception 'Team access denied' using errcode='42501'; end if;
 if p_lock then
  perform 1 from private.company_team_identity(true) x where x.user_id=p_actor;
  if not found then raise exception 'Actor account changed' using errcode='42501'; end if;
 end if;
 return r;
end $$;
create function private.company_team_replay(p_actor uuid,p_request uuid,p_payload jsonb) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare a private.company_team_audit%rowtype;
begin
 if p_request is null then raise exception 'Request UUID required' using errcode='22023'; end if;
 select * into a from private.company_team_audit where actor_user_id=p_actor and request_id=p_request;
 if found then
  if a.payload is distinct from p_payload then raise exception 'Request payload conflict' using errcode='40001'; end if;
  return a.receipt;
 end if;
 return null;
end $$;
create function private.company_team_member_json(m public.memberships) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('id',m.id,'userId',m.user_id,'email',u.email,'role',m.role,'status',m.status,'version',m.version,'createdAt',m.created_at)
 from auth.users u where u.id=m.user_id;
$$;
create function private.company_team_invitation_json(i private.company_team_invitations) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('id',i.id,'email',i.email,'role',i.role,
  'status',case when i.status='pending' and i.expires_at<=clock_timestamp() then 'expired' else i.status end,
  'version',i.version,'expiresAt',i.expires_at,'createdAt',i.created_at);
$$;

create function private.list_company_team(p_company_id uuid,p_members_page_key uuid,p_invitations_page_key uuid,p_limit integer)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; r text; members jsonb; invites jsonb; nm uuid; ni uuid;
begin
 select user_id into actor from private.company_team_identity();
 r:=private.company_team_manager(p_company_id,actor,false);
 if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'Limit must be 1..50' using errcode='22023'; end if;
 select coalesce(jsonb_agg(private.company_team_member_json(m) order by m.id),'[]') into members
 from (select * from public.memberships where company_id=p_company_id and (p_members_page_key is null or id>p_members_page_key) order by id limit p_limit) m;
 select coalesce(jsonb_agg(private.company_team_invitation_json(i) order by i.id),'[]') into invites
 from (select * from private.company_team_invitations where company_id=p_company_id and (p_invitations_page_key is null or id>p_invitations_page_key) order by id limit p_limit) i;
 if jsonb_array_length(members)=p_limit and exists(select 1 from public.memberships where company_id=p_company_id and id>(members->(p_limit-1)->>'id')::uuid) then nm:=(members->(p_limit-1)->>'id')::uuid; end if;
 if jsonb_array_length(invites)=p_limit and exists(select 1 from private.company_team_invitations where company_id=p_company_id and id>(invites->(p_limit-1)->>'id')::uuid) then ni:=(invites->(p_limit-1)->>'id')::uuid; end if;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',actor,'actorRole',r,'teamVersion',(select team_version from public.companies where id=p_company_id),
 'members',members,'invitations',invites,'nextMembersPageKey',nm,'nextInvitationsPageKey',ni);
end $$;

create function private.create_company_invitation(p_company_id uuid,p_email text,p_role text,p_expected_team_version integer,p_request_id uuid)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; actor_email text; r text; payload jsonb; receipt jsonb; i private.company_team_invitations%rowtype; tv integer; e text; old_expired jsonb;
begin
 select user_id,email into actor,actor_email from private.company_team_identity(true);
 r:=private.company_team_manager(p_company_id,actor);
 e:=lower(btrim(p_email));
 if e is null or length(e) not between 3 and 254 or e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or p_role is null or p_role not in ('admin','sales','finance','viewer') or p_expected_team_version is null or p_expected_team_version<1 then
  raise exception 'Invalid invitation' using errcode='22023'; end if;
 if (r='admin' and p_role='admin') or e=actor_email then raise exception 'Invitation role denied' using errcode='42501'; end if;
 payload:=jsonb_build_object('action','invite','companyId',p_company_id,'email',e,'role',p_role,'expectedTeamVersion',p_expected_team_version);
 receipt:=private.company_team_replay(actor,p_request_id,payload); if receipt is not null then return receipt; end if;
 select team_version into tv from public.companies where id=p_company_id;
 if tv<>p_expected_team_version then raise exception 'Team version conflict' using errcode='40001'; end if;
 if exists(select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.company_id=p_company_id and lower(btrim(u.email))=e) then
  raise exception 'Existing membership cannot be invited' using errcode='42501'; end if;
 if exists(select 1 from private.company_team_invitations where company_id=p_company_id and email=e and status='pending' and expires_at>clock_timestamp()) then
  raise exception 'Pending invitation exists' using errcode='40001'; end if;
 if (select count(*) from private.company_team_invitations where company_id=p_company_id and status='pending' and expires_at>clock_timestamp())>=50 then
  raise exception 'Pending invitation limit reached' using errcode='22023'; end if;
 select to_jsonb(previous) into old_expired from private.company_team_invitations previous where company_id=p_company_id and email=e and status='pending' and expires_at<=clock_timestamp();
 update private.company_team_invitations set status='expired',version=version+1 where company_id=p_company_id and email=e and status='pending' and expires_at<=clock_timestamp();
 insert into private.company_team_invitations(company_id,email,role,invited_by) values(p_company_id,e,p_role,actor) returning * into i;
 update public.companies set team_version=team_version+1 where id=p_company_id returning team_version into tv;
 receipt:=jsonb_build_object('companyId',p_company_id,'teamVersion',tv,'actorUserId',actor,'requestId',p_request_id,'invitation',private.company_team_invitation_json(i));
 insert into private.company_team_audit(actor_user_id,company_id,request_id,action,payload,receipt,previous_value,current_value)
 values(actor,p_company_id,p_request_id,'invite',payload,receipt,old_expired,jsonb_build_object('invitation',to_jsonb(i),'expiredInvitation',case when old_expired is null then null else old_expired||jsonb_build_object('status','expired','version',(old_expired->>'version')::integer+1) end)); return receipt;
exception when unique_violation then raise exception 'Invitation request conflict' using errcode='40001';
end $$;

create function private.revoke_company_invitation(p_company_id uuid,p_invitation_id uuid,p_expected_version integer,p_reason text,p_request_id uuid)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; r text; payload jsonb; receipt jsonb; i private.company_team_invitations%rowtype; old_i jsonb; tv integer;
begin
 select user_id into actor from private.company_team_identity(true);
 r:=private.company_team_manager(p_company_id,actor);
 select * into i from private.company_team_invitations where company_id=p_company_id and id=p_invitation_id for update;
 if not found or (r='admin' and i.role='admin') then raise exception 'Invitation access denied' using errcode='42501'; end if;
 if p_reason is null or length(p_reason) not between 1 and 500 or p_reason<>btrim(p_reason) or p_reason ~ '[[:cntrl:]]'
  or p_expected_version is null or p_expected_version<1 then raise exception 'Reason/version required' using errcode='22023'; end if;
 payload:=jsonb_build_object('action','revoke','companyId',p_company_id,'invitationId',p_invitation_id,'expectedVersion',p_expected_version,'reason',p_reason);
 receipt:=private.company_team_replay(actor,p_request_id,payload); if receipt is not null then return receipt; end if;
 if i.version<>p_expected_version or i.status<>'pending' then raise exception 'Invitation version conflict' using errcode='40001'; end if;
 old_i:=to_jsonb(i);
 update private.company_team_invitations set status='revoked',version=version+1 where id=i.id returning * into i;
 update public.companies set team_version=team_version+1 where id=p_company_id returning team_version into tv;
 receipt:=jsonb_build_object('companyId',p_company_id,'teamVersion',tv,'actorUserId',actor,'requestId',p_request_id,'invitation',private.company_team_invitation_json(i));
 insert into private.company_team_audit(actor_user_id,company_id,request_id,action,payload,receipt,previous_value,current_value,reason)
 values(actor,p_company_id,p_request_id,'revoke',payload,receipt,old_i,to_jsonb(i),p_reason); return receipt;
exception when unique_violation then raise exception 'Invitation request conflict' using errcode='40001';
end $$;

create function private.update_company_team_member(p_company_id uuid,p_membership_id uuid,p_expected_version integer,p_role text,p_status text,p_reason text,p_request_id uuid)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; r text; payload jsonb; receipt jsonb; m public.memberships%rowtype; old_m jsonb; tv integer;
begin
 select user_id into actor from private.company_team_identity(true);
 r:=private.company_team_manager(p_company_id,actor);
 select * into m from public.memberships where company_id=p_company_id and id=p_membership_id for update;
 if not found or m.user_id=actor or m.role='owner' or (r='admin' and (m.role='admin' or p_role='admin')) then
  raise exception 'Member mutation denied' using errcode='42501'; end if;
 if p_role is null or p_role not in ('admin','sales','finance','viewer') or p_status is null or p_status not in ('active','suspended')
  or p_expected_version is null or p_expected_version<1 or p_reason is null or length(p_reason) not between 1 and 500
  or p_reason<>btrim(p_reason) or p_reason ~ '[[:cntrl:]]' then raise exception 'Invalid member mutation' using errcode='22023'; end if;
 payload:=jsonb_build_object('action','update_member','companyId',p_company_id,'membershipId',p_membership_id,'expectedVersion',p_expected_version,'role',p_role,'status',p_status,'reason',p_reason);
 receipt:=private.company_team_replay(actor,p_request_id,payload); if receipt is not null then return receipt; end if;
 if m.version<>p_expected_version then raise exception 'Member version conflict' using errcode='40001'; end if;
 old_m:=to_jsonb(m);
 if m.role<>p_role or m.status<>p_status then
  update public.memberships set role=p_role,status=p_status,version=version+1 where id=m.id returning * into m;
  update public.companies set team_version=team_version+1 where id=p_company_id;
 end if;
 select team_version into tv from public.companies where id=p_company_id;
 receipt:=jsonb_build_object('companyId',p_company_id,'teamVersion',tv,'actorUserId',actor,'requestId',p_request_id,'member',private.company_team_member_json(m));
 insert into private.company_team_audit(actor_user_id,company_id,request_id,action,payload,receipt,previous_value,current_value,reason)
 values(actor,p_company_id,p_request_id,'update_member',payload,receipt,old_m,to_jsonb(m),p_reason); return receipt;
exception when unique_violation then raise exception 'Member request conflict' using errcode='40001';
end $$;

create function private.list_my_company_invitations(p_page_key uuid,p_limit integer) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid; e text; items jsonb; next_key uuid;
begin
 select user_id,email into actor,e from private.company_team_identity();
 if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'Limit must be 1..50' using errcode='22023'; end if;
 -- Eligibility is identical to acceptance: expired/revoked/inactive inviter/company
 -- and an already existing membership do not create an actionable invitation.
 select coalesce(jsonb_agg(j order by id),'[]') into items from (
  select i.id,jsonb_build_object('id',i.id,'companyId',i.company_id,'companyName',c.name,'role',i.role,'status','pending','version',i.version,'expiresAt',i.expires_at,'createdAt',i.created_at) j
  from private.company_team_invitations i join public.companies c on c.id=i.company_id
   join public.memberships m on m.company_id=i.company_id and m.user_id=i.invited_by
   join auth.users inviter on inviter.id=i.invited_by
  where i.email=e and i.status='pending' and i.expires_at>clock_timestamp() and c.status='active' and m.status='active'
   and (m.role='owner' or (m.role='admin' and i.role<>'admin'))
   and inviter.email is not null and inviter.email_confirmed_at is not null and not coalesce(inviter.is_anonymous,false) and not coalesce(inviter.is_sso_user,false)
   and (inviter.banned_until is null or inviter.banned_until<=clock_timestamp())
   and (select count(*) from auth.users x where lower(btrim(x.email))=lower(btrim(inviter.email)) and not coalesce(x.is_sso_user,false) and not coalesce(x.is_anonymous,false))=1
   and not exists(select 1 from public.memberships own where own.company_id=i.company_id and own.user_id=actor)
   and (p_page_key is null or i.id>p_page_key) order by i.id limit p_limit+1
 ) x;
 if jsonb_array_length(items)>p_limit then
  next_key:=(items->(p_limit-1)->>'id')::uuid; items:=items-(p_limit);
 end if;
 return jsonb_build_object('invitations',items,'nextPageKey',next_key);
end $$;

create function private.accept_company_invitation(p_invitation_id uuid,p_expected_version integer,p_request_id uuid)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; e text; cid uuid; s text; inviter_role text; payload jsonb; receipt jsonb;
 i private.company_team_invitations%rowtype; m public.memberships%rowtype; old_i jsonb; tv integer;
begin
 select user_id,email into actor,e from private.company_team_identity(true);
 select company_id into cid from private.company_team_invitations where id=p_invitation_id and email=e;
 if cid is null then raise exception 'Invitation access denied' using errcode='42501'; end if;
 -- Consistent company-first locking serializes accept/revoke/member mutations.
 select status into s from public.companies where id=cid for update;
 if s<>'active' then raise exception 'Company access denied' using errcode='42501'; end if;
 select * into i from private.company_team_invitations where id=p_invitation_id and company_id=cid for update;
 if i.email<>e then raise exception 'Invitation account denied' using errcode='42501'; end if;
 select role into inviter_role from public.memberships where company_id=cid and user_id=i.invited_by and status='active' for update;
 if inviter_role is null or not (inviter_role='owner' or (inviter_role='admin' and i.role<>'admin')) then
  raise exception 'Inviter authorization revoked' using errcode='42501'; end if;
 perform private.company_team_account(i.invited_by,true);
 if p_expected_version is null or p_expected_version<1 then raise exception 'Version required' using errcode='22023'; end if;
 payload:=jsonb_build_object('action','accept','companyId',cid,'invitationId',p_invitation_id,'expectedVersion',p_expected_version);
 receipt:=private.company_team_replay(actor,p_request_id,payload);
 if receipt is not null then
  select * into m from public.memberships where id=(receipt->>'membershipId')::uuid and company_id=cid and user_id=actor for update;
  if not found or m.status<>'active' then raise exception 'Membership no longer active' using errcode='42501'; end if;
  return receipt;
 end if;
 if i.version<>p_expected_version or i.status<>'pending' or i.expires_at<=clock_timestamp() then raise exception 'Invitation version/expiry conflict' using errcode='40001'; end if;
 perform 1 from public.memberships where company_id=cid and user_id=actor for update;
 if found then raise exception 'Existing membership cannot accept invitation' using errcode='42501'; end if;
 -- Recheck actual Auth identity after all relevant row locks.
 perform 1 from private.company_team_identity(true) x where x.user_id=actor and x.email=e;
 if not found then raise exception 'Invitation account changed' using errcode='42501'; end if;
 if i.expires_at<=clock_timestamp() then raise exception 'Invitation expired' using errcode='40001'; end if;
 old_i:=to_jsonb(i);
 insert into public.memberships(company_id,user_id,role) values(cid,actor,i.role) returning * into m;
 update private.company_team_invitations set status='accepted',accepted_by=actor,accepted_at=clock_timestamp(),version=version+1 where id=i.id returning * into i;
 update public.companies set team_version=team_version+1 where id=cid returning team_version into tv;
 receipt:=jsonb_build_object('companyId',cid,'teamVersion',tv,'actorUserId',actor,'requestId',p_request_id,'invitationId',i.id,'membershipId',m.id,'userId',actor,'role',m.role,'status',m.status,'version',m.version);
 insert into private.company_team_audit(actor_user_id,company_id,request_id,action,payload,receipt,previous_value,current_value)
 values(actor,cid,p_request_id,'accept',payload,receipt,old_i,jsonb_build_object('invitation',to_jsonb(i),'member',to_jsonb(m))); return receipt;
exception when unique_violation then raise exception 'Invitation acceptance conflict' using errcode='40001';
end $$;

revoke all on function private.company_team_identity(boolean) from public,anon,authenticated,service_role;
revoke all on function private.company_team_account(uuid,boolean) from public,anon,authenticated,service_role;

revoke all on function private.company_team_manager(uuid,uuid,boolean) from public,anon,authenticated,service_role;

revoke all on function private.company_team_replay(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

revoke all on function private.company_team_member_json(public.memberships) from public,anon,authenticated,service_role;

revoke all on function private.company_team_invitation_json(private.company_team_invitations) from public,anon,authenticated,service_role;

revoke all on function private.list_company_team(uuid,uuid,uuid,integer) from public,anon,service_role;
grant execute on function private.list_company_team(uuid,uuid,uuid,integer) to authenticated;
create function public.list_company_team(p_company_id uuid,p_members_page_key uuid default null,p_invitations_page_key uuid default null,p_limit integer default 50) returns jsonb language sql security invoker set search_path='' as $$
 select private.list_company_team(p_company_id,p_members_page_key,p_invitations_page_key,p_limit);
$$;
revoke all on function public.list_company_team(uuid,uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.list_company_team(uuid,uuid,uuid,integer) to authenticated;

revoke all on function private.create_company_invitation(uuid,text,text,integer,uuid) from public,anon,service_role;
grant execute on function private.create_company_invitation(uuid,text,text,integer,uuid) to authenticated;
create function public.create_company_invitation(p_company_id uuid,p_email text,p_role text,p_expected_team_version integer,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$
 select private.create_company_invitation(p_company_id,p_email,p_role,p_expected_team_version,p_request_id);
$$;
revoke all on function public.create_company_invitation(uuid,text,text,integer,uuid) from public,anon,service_role;
grant execute on function public.create_company_invitation(uuid,text,text,integer,uuid) to authenticated;

revoke all on function private.revoke_company_invitation(uuid,uuid,integer,text,uuid) from public,anon,service_role;
grant execute on function private.revoke_company_invitation(uuid,uuid,integer,text,uuid) to authenticated;
create function public.revoke_company_invitation(p_company_id uuid,p_invitation_id uuid,p_expected_version integer,p_reason text,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$
 select private.revoke_company_invitation(p_company_id,p_invitation_id,p_expected_version,p_reason,p_request_id);
$$;
revoke all on function public.revoke_company_invitation(uuid,uuid,integer,text,uuid) from public,anon,service_role;
grant execute on function public.revoke_company_invitation(uuid,uuid,integer,text,uuid) to authenticated;

revoke all on function private.update_company_team_member(uuid,uuid,integer,text,text,text,uuid) from public,anon,service_role;
grant execute on function private.update_company_team_member(uuid,uuid,integer,text,text,text,uuid) to authenticated;
create function public.update_company_team_member(p_company_id uuid,p_membership_id uuid,p_expected_version integer,p_role text,p_status text,p_reason text,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$
 select private.update_company_team_member(p_company_id,p_membership_id,p_expected_version,p_role,p_status,p_reason,p_request_id);
$$;
revoke all on function public.update_company_team_member(uuid,uuid,integer,text,text,text,uuid) from public,anon,service_role;
grant execute on function public.update_company_team_member(uuid,uuid,integer,text,text,text,uuid) to authenticated;

revoke all on function private.list_my_company_invitations(uuid,integer) from public,anon,service_role;
grant execute on function private.list_my_company_invitations(uuid,integer) to authenticated;
create function public.list_my_company_invitations(p_page_key uuid default null,p_limit integer default 50) returns jsonb language sql security invoker set search_path='' as $$
 select private.list_my_company_invitations(p_page_key,p_limit);
$$;
revoke all on function public.list_my_company_invitations(uuid,integer) from public,anon,service_role;
grant execute on function public.list_my_company_invitations(uuid,integer) to authenticated;

revoke all on function private.accept_company_invitation(uuid,integer,uuid) from public,anon,service_role;
grant execute on function private.accept_company_invitation(uuid,integer,uuid) to authenticated;
create function public.accept_company_invitation(p_invitation_id uuid,p_expected_version integer,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$
 select private.accept_company_invitation(p_invitation_id,p_expected_version,p_request_id);
$$;
revoke all on function public.accept_company_invitation(uuid,integer,uuid) from public,anon,service_role;
grant execute on function public.accept_company_invitation(uuid,integer,uuid) to authenticated;

-- Existing companies/memberships Data API grants and RLS policies are unchanged.
commit;
