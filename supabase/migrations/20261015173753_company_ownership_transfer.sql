-- Two-party transfer of Trafexa company access, never legal company ownership.
begin;
create table private.company_ownership_transfers (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 from_membership_id uuid not null references public.memberships(id), to_membership_id uuid not null references public.memberships(id),
 from_member jsonb not null, to_member jsonb not null,
 status text not null default 'pending' check(status in('pending','accepted','cancelled','expired')),
 version integer not null default 1 check(version>0), team_version_at_request integer not null check(team_version_at_request>0),
 reason text not null check(private.company_store_text_valid(reason,1,500,false)),
 attestation_version text not null check(attestation_version='2026-10-15'),
 created_at timestamptz not null, expires_at timestamptz not null, resolved_at timestamptz,
 cancel_reason text check(cancel_reason is null or private.company_store_text_valid(cancel_reason,1,500,false)),
 check(from_membership_id<>to_membership_id), check(expires_at=created_at+interval '24 hours'),
 check((status='pending' and resolved_at is null and cancel_reason is null) or
 (status='accepted' and resolved_at is not null and cancel_reason is null) or
 (status='cancelled' and resolved_at is not null and cancel_reason is not null) or
 (status='expired' and resolved_at=expires_at and cancel_reason is null))
);
create unique index company_ownership_one_pending on private.company_ownership_transfers(company_id) where status='pending';
create index company_ownership_latest on private.company_ownership_transfers(company_id,created_at desc,id desc);
create index company_ownership_from on private.company_ownership_transfers(from_membership_id);
create index company_ownership_to on private.company_ownership_transfers(to_membership_id);
create table private.company_ownership_audit (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,
 action text not null check(action in('request','accept','cancel')),
 payload jsonb not null,receipt jsonb not null,previous_value jsonb,current_value jsonb not null,
 created_at timestamptz not null default clock_timestamp(),unique(actor_user_id,request_id)
);
create index company_ownership_audit_company on private.company_ownership_audit(company_id,created_at desc);
alter table private.company_ownership_transfers enable row level security;
alter table private.company_ownership_audit enable row level security;
revoke all on private.company_ownership_transfers,private.company_ownership_audit from public,anon,authenticated,service_role;
create function private.guard_company_ownership_transfer() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Ownership history is immutable' using errcode='55000';end if;
 if (to_jsonb(new)-array['status','version','resolved_at','cancel_reason']) is distinct from (to_jsonb(old)-array['status','version','resolved_at','cancel_reason'])
 or old.status<>'pending' or new.status not in('accepted','cancelled','expired') or new.version<>old.version+1 then
 raise exception 'Ownership terms are immutable' using errcode='55000';end if;return new;
end$$;
revoke all on function private.guard_company_ownership_transfer() from public,anon,authenticated,service_role;
create trigger guard_company_ownership_transfer before update or delete on private.company_ownership_transfers for each row execute function private.guard_company_ownership_transfer();
create trigger immutable_company_ownership_audit before update or delete on private.company_ownership_audit for each row execute function private.reject_company_team_audit_mutation();

create function private.company_ownership_member(m public.memberships) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('membershipId',m.id,'userId',m.user_id,'email',lower(btrim(u.email)),'version',m.version) from auth.users u where u.id=m.user_id;
$$;
create function private.company_ownership_eligible(p_user uuid) returns boolean language plpgsql security invoker set search_path='' as $$
begin perform private.company_team_account(p_user,false);return true;exception when insufficient_privilege then return false;end$$;
create function private.company_ownership_json(t private.company_ownership_transfers) returns jsonb language sql volatile security invoker set search_path='' as $$
 select jsonb_build_object('id',t.id,'companyId',t.company_id,'from',t.from_member,'to',t.to_member,
 'status',case when t.status='pending' and t.expires_at<=clock_timestamp() then 'expired' else t.status end,
 'version',t.version,'teamVersionAtRequest',t.team_version_at_request,'reason',t.reason,'attestationVersion',t.attestation_version,
 'createdAt',t.created_at,'expiresAt',t.expires_at,'resolvedAt',case when t.status='pending' and t.expires_at<=clock_timestamp() then t.expires_at else t.resolved_at end,'cancelReason',t.cancel_reason);
$$;
-- SHARE Auth locks are compatible with ordinary team calls. All cross-user Auth rows
-- are locked in UUID order before approval/platform rows, then company UPDATE and
-- membership UUID order. Company lock serializes old personnel RPCs and this flow.
create function private.company_ownership_lock(p_company uuid,p_other uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare a uuid;u uuid;s text;r text;
begin
 select user_id into a from private.company_team_identity(false);
 for u in select id from auth.users where id in(a,p_other) order by id for share loop null;end loop;
 perform 1 from private.account_approvals where user_id in(a,p_other) order by user_id for share;
 perform 1 from private.platform_admins where user_id in(a,p_other) order by user_id for share;
 perform private.company_team_account(a,true);
 select status into s from public.companies where id=p_company for update;
 if s is distinct from 'active' then raise exception 'Company access denied' using errcode='42501';end if;
 perform 1 from public.memberships where company_id=p_company order by id for update;
 select role into r from public.memberships where company_id=p_company and user_id=a and status='active';
 if r is null or r not in('owner','admin') then raise exception 'Ownership access denied' using errcode='42501';end if;
 perform private.company_team_account(a,true);return a;
end$$;
create function private.company_ownership_replay(p_actor uuid,p_request uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare old private.company_ownership_audit%rowtype;
begin
 if p_request is null then raise exception 'Request required' using errcode='22023';end if;
 select * into old from private.company_ownership_audit where actor_user_id=p_actor and request_id=p_request;
 if found then if old.payload is distinct from p_payload then raise exception 'Ownership request payload conflict' using errcode='40001';end if;return old.receipt;end if;return null;
end$$;

create function private.get_company_ownership_transfer(p_company_id uuid,p_page_key uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;c integer;tv integer;o public.memberships%rowtype;mine public.memberships%rowtype;t private.company_ownership_transfers%rowtype;items jsonb:='[]';next_key uuid;pending boolean;can_accept boolean:=false;blocked text;
begin
 select user_id into a from private.company_team_identity(true);
 perform 1 from public.companies where id=p_company_id for share;
 r:=private.company_team_manager(p_company_id,a,false);
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid page limit' using errcode='22023';end if;
 select team_version into tv from public.companies where id=p_company_id;
 select count(*) into c from public.memberships where company_id=p_company_id and role='owner' and status='active';
 if c=1 then select * into o from public.memberships where company_id=p_company_id and role='owner' and status='active';end if;
 select * into mine from public.memberships where company_id=p_company_id and user_id=a and status='active';
 select * into t from private.company_ownership_transfers where company_id=p_company_id order by created_at desc,id desc limit 1;
 pending:=coalesce(t.status='pending' and t.expires_at>clock_timestamp(),false);
 if r='owner' then
 select coalesce(jsonb_agg(private.company_ownership_member(m) order by m.id),'[]') into items from(
 select * from public.memberships where company_id=p_company_id and role='admin' and status='active' and (p_page_key is null or id>p_page_key) and private.company_ownership_eligible(user_id) order by id limit p_limit)m;
 if jsonb_array_length(items)=p_limit and exists(select 1 from public.memberships where company_id=p_company_id and role='admin' and status='active' and id>(items->(p_limit-1)->>'membershipId')::uuid and private.company_ownership_eligible(user_id)) then next_key:=(items->(p_limit-1)->>'membershipId')::uuid;end if;
 end if;
 if c=0 then blocked:='owner_missing';elsif c>1 then blocked:='multiple_owners';elsif pending then blocked:='pending_transfer';elsif r<>'owner' then blocked:='not_owner';end if;
 if pending and c=1 and mine.id=t.to_membership_id and mine.role='admin' and mine.version=(t.to_member->>'version')::integer and o.id=t.from_membership_id and o.version=(t.from_member->>'version')::integer then
 can_accept:=private.company_ownership_eligible(o.user_id) and private.company_ownership_eligible(mine.user_id);end if;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'teamVersion',tv,'serverNow',clock_timestamp(),
 'owner',case when c=1 then private.company_ownership_member(o) else null end,'candidates',items,'nextPageKey',next_key,'transfer',case when t.id is null then null else private.company_ownership_json(t) end,
 'canRequest',blocked is null,'canAccept',can_accept,'canCancel',pending and mine.id=t.from_membership_id and mine.role='owner','blockReason',blocked);
end$$;

create function private.request_company_ownership_transfer(p_company_id uuid,p_target_membership_id uuid,p_expected_owner_version integer,p_expected_target_version integer,p_expected_team_version integer,p_reason text,p_acknowledged boolean,p_attestation_version text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;target_user uuid;owner_m public.memberships%rowtype;target_m public.memberships%rowtype;t private.company_ownership_transfers%rowtype;payload jsonb;receipt jsonb;tv integer;c integer;stamp timestamptz;
begin
 select user_id into target_user from public.memberships where company_id=p_company_id and id=p_target_membership_id;
 a:=private.company_ownership_lock(p_company_id,target_user);
 if p_acknowledged is distinct from true or p_attestation_version is distinct from '2026-10-15' or not private.company_store_text_valid(p_reason,1,500,false) or p_expected_owner_version is null or p_expected_owner_version<1 or p_expected_target_version is null or p_expected_target_version<1 or p_expected_team_version is null or p_expected_team_version<1 then raise exception 'Invalid ownership review' using errcode='22023';end if;
 payload:=jsonb_build_object('action','request','companyId',p_company_id,'targetMembershipId',p_target_membership_id,'ownerVersion',p_expected_owner_version,'targetVersion',p_expected_target_version,'teamVersion',p_expected_team_version,'reason',p_reason,'acknowledged',p_acknowledged,'attestationVersion',p_attestation_version);
 receipt:=private.company_ownership_replay(a,p_request_id,payload);if receipt is not null then return receipt;end if;
 select * into owner_m from public.memberships where company_id=p_company_id and user_id=a and status='active';
 if owner_m.role<>'owner' then raise exception 'Owner required' using errcode='42501';end if;
 select * into target_m from public.memberships where company_id=p_company_id and id=p_target_membership_id;
 if target_m.id is null or target_m.role<>'admin' or target_m.status<>'active' or target_m.user_id=a then raise exception 'Target access denied' using errcode='42501';end if;
 perform private.company_team_account(target_m.user_id,true);
 select count(*) into c from public.memberships where company_id=p_company_id and role='owner' and status='active';
 select team_version into tv from public.companies where id=p_company_id;
 if c<>1 or tv<>p_expected_team_version or owner_m.version<>p_expected_owner_version or target_m.version<>p_expected_target_version then raise exception 'Ownership version conflict' using errcode='40001';end if;
 stamp:=clock_timestamp();
 update private.company_ownership_transfers set status='expired',version=version+1,resolved_at=expires_at where company_id=p_company_id and status='pending' and expires_at<=stamp;
 if exists(select 1 from private.company_ownership_transfers where company_id=p_company_id and status='pending') then raise exception 'Ownership pending conflict' using errcode='40001';end if;
 update public.companies set team_version=team_version+1 where id=p_company_id returning team_version into tv;
 insert into private.company_ownership_transfers(company_id,from_membership_id,to_membership_id,from_member,to_member,team_version_at_request,reason,attestation_version,created_at,expires_at)
 values(p_company_id,owner_m.id,target_m.id,private.company_ownership_member(owner_m),private.company_ownership_member(target_m),tv,p_reason,p_attestation_version,stamp,stamp+interval '24 hours')returning * into t;
 receipt:=jsonb_build_object('companyId',p_company_id,'actorUserId',a,'requestId',p_request_id,'teamVersion',tv,'transfer',private.company_ownership_json(t));
 insert into private.company_ownership_audit(company_id,actor_user_id,request_id,action,payload,receipt,current_value)values(p_company_id,a,p_request_id,'request',payload,receipt,to_jsonb(t));return receipt;
end$$;

create function private.resolve_company_ownership_transfer(p_action text,p_company_id uuid,p_transfer_id uuid,p_expected_version integer,p_expected_team_version integer,p_reason text,p_acknowledged boolean,p_attestation_version text,p_request_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a uuid;other_user uuid;t private.company_ownership_transfers%rowtype;old_t jsonb;from_m public.memberships%rowtype;to_m public.memberships%rowtype;payload jsonb;receipt jsonb;tv integer;c integer;
begin
 select * into t from private.company_ownership_transfers where company_id=p_company_id and id=p_transfer_id;
 if t.id is not null then other_user:=case when auth.uid()=(t.from_member->>'userId')::uuid then (t.to_member->>'userId')::uuid else (t.from_member->>'userId')::uuid end;end if;
 a:=private.company_ownership_lock(p_company_id,other_user);
 if p_action not in('accept','cancel') or p_acknowledged is distinct from true or p_attestation_version is distinct from '2026-10-15' or p_expected_version is null or p_expected_version<1 or p_expected_team_version is null or p_expected_team_version<1 or (p_action='cancel' and(not private.company_store_text_valid(p_reason,1,500,false)))then raise exception 'Invalid ownership review' using errcode='22023';end if;
 payload:=jsonb_build_object('action',p_action,'companyId',p_company_id,'transferId',p_transfer_id,'version',p_expected_version,'teamVersion',p_expected_team_version,'reason',p_reason,'acknowledged',p_acknowledged,'attestationVersion',p_attestation_version);
 receipt:=private.company_ownership_replay(a,p_request_id,payload);if receipt is not null then return receipt;end if;
 select * into t from private.company_ownership_transfers where company_id=p_company_id and id=p_transfer_id for update;
 if t.id is null then raise exception 'Ownership not found' using errcode='P0002';end if;
 select * into from_m from public.memberships where company_id=p_company_id and id=t.from_membership_id;
 select * into to_m from public.memberships where company_id=p_company_id and id=t.to_membership_id;
 if (p_action='accept' and (to_m.user_id is distinct from a or to_m.role<>'admin' or to_m.status<>'active'))or(p_action='cancel' and(from_m.user_id is distinct from a or from_m.role<>'owner' or from_m.status<>'active'))then raise exception 'Ownership party access denied' using errcode='42501';end if;
 select team_version into tv from public.companies where id=p_company_id;
 if t.version<>p_expected_version or tv<>p_expected_team_version or t.status<>'pending' or t.expires_at<=clock_timestamp()then raise exception 'Ownership version or expiry conflict' using errcode='40001';end if;
 if p_action='accept' then
 perform private.company_team_account(from_m.user_id,true);perform private.company_team_account(to_m.user_id,true);
 select count(*) into c from public.memberships where company_id=p_company_id and role='owner' and status='active';
 if c<>1 or from_m.role<>'owner' or from_m.status<>'active' or from_m.version<>(t.from_member->>'version')::integer or to_m.version<>(t.to_member->>'version')::integer then raise exception 'Ownership member conflict' using errcode='40001';end if;
 update public.memberships set role=case when id=from_m.id then 'admin' else 'owner' end,version=version+1 where id in(from_m.id,to_m.id) and company_id=p_company_id;
 end if;
 old_t:=to_jsonb(t);
 update private.company_ownership_transfers set status=case when p_action='accept' then 'accepted' else 'cancelled' end,version=version+1,resolved_at=clock_timestamp(),cancel_reason=case when p_action='cancel' then p_reason else null end where id=t.id returning * into t;
 update public.companies set team_version=team_version+1 where id=p_company_id returning team_version into tv;
 receipt:=jsonb_build_object('companyId',p_company_id,'actorUserId',a,'requestId',p_request_id,'teamVersion',tv,'transfer',private.company_ownership_json(t));
 insert into private.company_ownership_audit(company_id,actor_user_id,request_id,action,payload,receipt,previous_value,current_value)values(p_company_id,a,p_request_id,p_action,payload,receipt,old_t,jsonb_build_object('transfer',to_jsonb(t),'fromMembership',(select to_jsonb(m)from public.memberships m where id=from_m.id),'toMembership',(select to_jsonb(m)from public.memberships m where id=to_m.id)));return receipt;
end$$;
create function private.accept_company_ownership_transfer(p_company_id uuid,p_transfer_id uuid,p_expected_version integer,p_expected_team_version integer,p_acknowledged boolean,p_attestation_version text,p_request_id uuid)returns jsonb language sql security definer set search_path='' as $$select private.resolve_company_ownership_transfer('accept',p_company_id,p_transfer_id,p_expected_version,p_expected_team_version,null,p_acknowledged,p_attestation_version,p_request_id)$$;
create function private.cancel_company_ownership_transfer(p_company_id uuid,p_transfer_id uuid,p_expected_version integer,p_expected_team_version integer,p_reason text,p_acknowledged boolean,p_attestation_version text,p_request_id uuid)returns jsonb language sql security definer set search_path='' as $$select private.resolve_company_ownership_transfer('cancel',p_company_id,p_transfer_id,p_expected_version,p_expected_team_version,p_reason,p_acknowledged,p_attestation_version,p_request_id)$$;

revoke all on function private.company_ownership_member(public.memberships),private.company_ownership_eligible(uuid),private.company_ownership_json(private.company_ownership_transfers),private.company_ownership_lock(uuid,uuid),private.company_ownership_replay(uuid,uuid,jsonb),private.resolve_company_ownership_transfer(text,uuid,uuid,integer,integer,text,boolean,text,uuid)from public,anon,authenticated,service_role;
revoke all on function private.get_company_ownership_transfer(uuid,uuid,integer),private.request_company_ownership_transfer(uuid,uuid,integer,integer,integer,text,boolean,text,uuid),private.accept_company_ownership_transfer(uuid,uuid,integer,integer,boolean,text,uuid),private.cancel_company_ownership_transfer(uuid,uuid,integer,integer,text,boolean,text,uuid)from public,anon,authenticated,service_role;
grant execute on function private.get_company_ownership_transfer(uuid,uuid,integer),private.request_company_ownership_transfer(uuid,uuid,integer,integer,integer,text,boolean,text,uuid),private.accept_company_ownership_transfer(uuid,uuid,integer,integer,boolean,text,uuid),private.cancel_company_ownership_transfer(uuid,uuid,integer,integer,text,boolean,text,uuid)to authenticated;
create function public.get_company_ownership_transfer(p_company_id uuid,p_page_key uuid default null,p_limit integer default 50)returns jsonb language sql security invoker set search_path='' as $$select private.get_company_ownership_transfer(p_company_id,p_page_key,p_limit)$$;
create function public.request_company_ownership_transfer(p_company_id uuid,p_target_membership_id uuid,p_expected_owner_version integer,p_expected_target_version integer,p_expected_team_version integer,p_reason text,p_acknowledged boolean,p_attestation_version text,p_request_id uuid)returns jsonb language sql security invoker set search_path='' as $$select private.request_company_ownership_transfer(p_company_id,p_target_membership_id,p_expected_owner_version,p_expected_target_version,p_expected_team_version,p_reason,p_acknowledged,p_attestation_version,p_request_id)$$;
create function public.accept_company_ownership_transfer(p_company_id uuid,p_transfer_id uuid,p_expected_version integer,p_expected_team_version integer,p_acknowledged boolean,p_attestation_version text,p_request_id uuid)returns jsonb language sql security invoker set search_path='' as $$select private.accept_company_ownership_transfer(p_company_id,p_transfer_id,p_expected_version,p_expected_team_version,p_acknowledged,p_attestation_version,p_request_id)$$;
create function public.cancel_company_ownership_transfer(p_company_id uuid,p_transfer_id uuid,p_expected_version integer,p_expected_team_version integer,p_reason text,p_acknowledged boolean,p_attestation_version text,p_request_id uuid)returns jsonb language sql security invoker set search_path='' as $$select private.cancel_company_ownership_transfer(p_company_id,p_transfer_id,p_expected_version,p_expected_team_version,p_reason,p_acknowledged,p_attestation_version,p_request_id)$$;
revoke all on function public.get_company_ownership_transfer(uuid,uuid,integer),public.request_company_ownership_transfer(uuid,uuid,integer,integer,integer,text,boolean,text,uuid),public.accept_company_ownership_transfer(uuid,uuid,integer,integer,boolean,text,uuid),public.cancel_company_ownership_transfer(uuid,uuid,integer,integer,text,boolean,text,uuid)from public,anon,authenticated,service_role;
grant execute on function public.get_company_ownership_transfer(uuid,uuid,integer),public.request_company_ownership_transfer(uuid,uuid,integer,integer,integer,text,boolean,text,uuid),public.accept_company_ownership_transfer(uuid,uuid,integer,integer,boolean,text,uuid),public.cancel_company_ownership_transfer(uuid,uuid,integer,integer,text,boolean,text,uuid)to authenticated;
commit;
