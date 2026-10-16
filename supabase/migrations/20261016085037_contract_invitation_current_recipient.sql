-- Stop stale customer signature invitations at claim and immediately before provider dispatch.
-- No existing outbox rows, recipients, credentials or delivery settings are changed.
begin;
create or replace function private.transactional_email_recipient_current(e private.transactional_email_outbox) returns boolean language plpgsql security definer set search_path='' as $$
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
  -- Invitation remains actionable only while the customer's signature is still missing.
  -- Match sign_contract/contract_signing_json availability; a company-only signature is allowed.
  return exists(select 1 from private.contract_signings s join public.deals d on d.company_id=s.company_id and d.id=s.deal_id
   where s.id=e.reference_id and d.status in ('draft','reserved')
   and not exists(select 1 from private.contract_signatures g where g.signing_id=s.id and g.party='customer'));
 end if;
 return true;
end $$;
revoke all on function private.transactional_email_recipient_current(private.transactional_email_outbox) from public,anon,authenticated,service_role;
commit;
