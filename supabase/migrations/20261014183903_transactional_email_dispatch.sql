begin;
create function private.transactional_email_recipient_current(e private.transactional_email_outbox) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if e.kind in ('application_received','application_admin') then
  if not exists(select 1 from private.demo_requests where request_id=e.reference_id and (e.kind='application_admin' or lower(btrim(email))=e.recipient)) then return false;end if;
 end if;
 if e.recipient_user_id is not null and not exists(select 1 from auth.users u where u.id=e.recipient_user_id and lower(btrim(u.email))=e.recipient and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and not coalesce(u.is_sso_user,false) and (u.banned_until is null or u.banned_until<=clock_timestamp())) then return false;end if;
 if e.recipient_user_id is not null and private.account_effective_status(e.recipient_user_id)<>'approved' then return false;end if;
 if e.kind='application_admin' then return exists(select 1 from private.platform_admins where user_id=e.recipient_user_id and status='active');end if;
 if e.kind='account_approved' then return exists(select 1 from private.account_approvals where user_id=e.recipient_user_id and status='approved');end if;
 if e.kind='contract_completed_company' then
 return exists(select 1 from private.contract_signings s join private.contract_signatures g on g.signing_id=s.id and g.party='company' join public.companies c on c.id=s.company_id join public.deals d on d.id=s.deal_id join public.memberships m on m.company_id=s.company_id and m.user_id=g.actor_user_id where s.id=e.reference_id and g.actor_user_id=e.recipient_user_id and c.status='active' and d.status<>'cancelled' and m.status='active' and m.role in ('owner','admin') and (select count(*) from private.contract_signatures where signing_id=s.id)=2);
 end if;
 if e.kind in ('contract_invitation','contract_completed') then
  if not exists(select 1 from private.contract_signings s join public.companies c on c.id=s.company_id join public.deals d on d.id=s.deal_id where s.id=e.reference_id and s.customer_email=e.recipient and c.status='active' and d.status<>'cancelled') then return false;end if;
  if e.kind='contract_completed' then return (select count(*) from private.contract_signatures where signing_id=e.reference_id)=2;end if;
 end if;
 return true;
end $$;
revoke all on function private.transactional_email_recipient_current(private.transactional_email_outbox) from public,anon,authenticated,service_role;
create function public.claim_transactional_email(p_kind text default null,p_reference uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.transactional_email_outbox; l uuid:=gen_random_uuid();begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 update private.transactional_email_outbox set status='unknown',lease_id=null,lease_until=null,updated_at=clock_timestamp() where status='processing' and lease_until<clock_timestamp();
 for e in select * from private.transactional_email_outbox where status='pending' and attempts<5 and (p_kind is null or kind=p_kind) and (p_reference is null or reference_id=p_reference) order by created_at,id for update skip locked limit 20 loop
 if not private.transactional_email_recipient_current(e) then
 update private.transactional_email_outbox set status='cancelled',updated_at=clock_timestamp() where id=e.id;continue;end if;
 update private.transactional_email_outbox set first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),status='processing',lease_id=l,lease_until=clock_timestamp()+interval '30 seconds',attempts=attempts+1,updated_at=clock_timestamp() where id=e.id;
 return jsonb_build_object('id',e.id,'kind',e.kind,'reference',e.reference_id,'recipient',e.recipient,'createdAt',coalesce(e.first_attempt_at,clock_timestamp()),'leaseId',l);
 end loop;return null;end $$;
create function public.check_transactional_email_lease(p_id uuid,p_lease_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare e private.transactional_email_outbox;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 select * into e from private.transactional_email_outbox where id=p_id and lease_id=p_lease_id and status='processing' and lease_until>clock_timestamp();
 return found and private.transactional_email_recipient_current(e);end $$;
create function public.finish_transactional_email(p_id uuid,p_lease_id uuid,p_status text,p_provider_id text default null) returns boolean language plpgsql security definer set search_path='' as $$begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 if p_status not in ('accepted','rejected','unknown','pending','cancelled') or (p_status='accepted' and (p_provider_id is null or p_provider_id !~ '^[a-zA-Z0-9_-]{1,100}$')) then raise exception 'Invalid result' using errcode='22023';end if;
 update private.transactional_email_outbox set status=case when p_status='pending' and attempts>=5 then 'rejected' else p_status end,provider_id=p_provider_id,lease_id=null,lease_until=null,updated_at=clock_timestamp() where id=p_id and lease_id=p_lease_id and status='processing';return found;end $$;
revoke all on function public.claim_transactional_email(text,uuid),public.check_transactional_email_lease(uuid,uuid),public.finish_transactional_email(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_transactional_email(text,uuid),public.check_transactional_email_lease(uuid,uuid),public.finish_transactional_email(uuid,uuid,text,text) to service_role;
commit;
