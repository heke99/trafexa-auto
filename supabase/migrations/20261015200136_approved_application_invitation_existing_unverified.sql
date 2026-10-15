begin;
-- Explicit superadmin review may recover an earlier open-registration account.
-- Verified/previously decided accounts are never silently adopted or reset.
create function private.adopt_unverified_application_account(p_invitation_id uuid) returns void
 language plpgsql security definer set search_path='' as $$
declare item private.application_account_invitations; u auth.users; a private.account_approvals; actor uuid; receipt jsonb; previous_version integer; email_identity_only boolean;
begin
 actor:=private.account_approval_admin_identity();
 select * into item from private.application_account_invitations where id=p_invitation_id for update;
 if not found or item.actor_user_id<>actor or item.user_id is not null then raise exception 'Invitation adoption conflict' using errcode='40001';end if;
 select * into u from auth.users where lower(btrim(email))=item.email for update;
 if not found then return;end if;
 if (select count(*) from auth.users where lower(btrim(email))=item.email)<>1 or u.email_confirmed_at is not null
 or to_jsonb(u)->>'last_sign_in_at' is not null
 or not (to_jsonb(u) ? 'encrypted_password')
 or coalesce(u.is_anonymous,false) or coalesce(u.is_sso_user,false) or (u.banned_until is not null and u.banned_until>clock_timestamp())
 or exists(select 1 from private.platform_admins where user_id=u.id)
 or exists(select 1 from private.application_account_invitations where user_id=u.id) then
  raise exception 'Existing account requires separate review' using errcode='23505';end if;
 if to_regclass('auth.identities') is null then raise exception 'Existing account requires separate review' using errcode='23505';end if;
 execute 'select count(*)>0 and bool_and(provider=''email'') from auth.identities where user_id=$1' into email_identity_only using u.id;
 if email_identity_only is distinct from true then raise exception 'Existing account requires separate review' using errcode='23505';end if;
 select * into a from private.account_approvals where user_id=u.id for update;
 if found and a.status<>'pending' then raise exception 'Existing account requires separate review' using errcode='23505';end if;
 -- Remove any password chosen during open signup before approval can become
 -- effective. GoTrue verify/invite later establishes an unknown temporary secret,
 -- then the recipient sets their own password through the activation flow.
 if to_jsonb(u) ? 'encrypted_password' then
  execute 'update auth.users set encrypted_password=null where id=$1' using u.id;
 end if;
 if to_regclass('auth.refresh_tokens') is not null then
  execute 'delete from auth.refresh_tokens where user_id::text=$1' using u.id::text;
 end if;
 if to_regclass('auth.sessions') is not null then
  execute 'delete from auth.sessions where user_id=$1' using u.id;
 end if;
 previous_version:=coalesce(a.version,0);
 if previous_version>=2147483647 then raise exception 'Existing account requires separate review' using errcode='23505';end if;
 update private.application_account_invitations set user_id=u.id,consumed_at=clock_timestamp() where id=item.id returning * into item;
 insert into private.account_approvals(user_id,status,version,updated_by) values(u.id,'approved',previous_version+1,actor)
 on conflict(user_id) do update set status=excluded.status,version=excluded.version,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 receipt:=jsonb_build_object('actorUserId',actor,'userId',u.id,'requestId',item.request_id,
 'previousStatus','pending','status','approved','version',previous_version+1,'changed',true,'reason',item.reason,'createdAt',item.consumed_at);
 insert into private.account_approval_audit(actor_user_id,user_id,request_id,payload,receipt,reason)
 values(actor,u.id,item.request_id,jsonb_build_object('applicationId',item.application_id,'invitationId',item.id,'adoptedUnverified',true),receipt,item.reason);
end $$;
revoke all on function private.adopt_unverified_application_account(uuid) from public,anon,authenticated,service_role;
commit;
