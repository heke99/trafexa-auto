begin;
create function private.web_application_email_event() returns trigger language plpgsql security definer set search_path='' as $$
declare a record;begin
 if not new.legacy then
 perform private.enqueue_transactional_email('application_received',new.request_id,new.email);
 for a in select u.id,u.email from private.platform_admins p join auth.users u on u.id=p.user_id where p.status='active' and u.email_confirmed_at is not null and u.email is not null and not coalesce(u.is_anonymous,false) and not coalesce(u.is_sso_user,false) and (u.banned_until is null or u.banned_until<=clock_timestamp()) loop
 perform private.enqueue_transactional_email('application_admin',new.request_id,a.email,a.id);
 end loop;
 end if;return new;end $$;
revoke all on function private.web_application_email_event() from public,anon,authenticated,service_role;
create trigger web_application_transactional_email after insert on private.demo_requests for each row execute function private.web_application_email_event();
create function private.account_approval_email_event() returns trigger language plpgsql security definer set search_path='' as $$
declare e text;begin
 if new.status='approved' and (tg_op='INSERT' or old.status is distinct from 'approved') then
 select email into e from auth.users where id=new.user_id and email_confirmed_at is not null;
 if e is not null then perform private.enqueue_transactional_email('account_approved',new.user_id,e,new.user_id);end if;
 end if;return new;end $$;
revoke all on function private.account_approval_email_event() from public,anon,authenticated,service_role;
create trigger account_approval_transactional_email after insert or update on private.account_approvals for each row execute function private.account_approval_email_event();
-- Pending application notifications are invalidated atomically when the source is erased.
create function private.erased_application_email_event() returns trigger language plpgsql security definer set search_path='' as $$begin
 update private.transactional_email_outbox set status=case when status in ('pending','processing') then 'cancelled' else status end,recipient='erased+'||id::text||'@invalid.invalid',recipient_user_id=null,lease_id=null,lease_until=null,updated_at=clock_timestamp() where reference_id=old.request_id and kind in ('application_received','application_admin');return old;end $$;
revoke all on function private.erased_application_email_event() from public,anon,authenticated,service_role;
create trigger erased_application_transactional_email before delete on private.demo_requests for each row execute function private.erased_application_email_event();

create function public.get_transactional_email_status() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.account_approval_admin_identity();
 return (select jsonb_build_object('pending',count(*) filter(where status='pending'),'processing',count(*) filter(where status='processing'),'accepted',count(*) filter(where status='accepted'),'rejected',count(*) filter(where status='rejected'),'unknown',count(*) filter(where status='unknown'),'cancelled',count(*) filter(where status='cancelled')) from private.transactional_email_outbox);
end $$;
revoke all on function public.get_transactional_email_status() from public,anon,service_role;
grant execute on function public.get_transactional_email_status() to authenticated;
commit;
