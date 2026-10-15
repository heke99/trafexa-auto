begin;
-- GoTrue inserts first, then sets server-owned invited_at in the same transaction.
-- Inspect the final stored row at commit, never editable user metadata.
create function private.enforce_approved_application_invitation() returns trigger
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
revoke all on function private.enforce_approved_application_invitation() from public,anon,authenticated,service_role;
create constraint trigger approved_application_registration_gate after insert on auth.users
 deferrable initially deferred for each row execute function private.enforce_approved_application_invitation();
commit;
