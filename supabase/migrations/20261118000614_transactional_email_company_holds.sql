begin;

create function private.transactional_email_company_id(e private.transactional_email_outbox)
returns uuid language sql stable set search_path='' as $$
 select case
  when e.kind='offer_invitation' then (select q.company_id from private.offer_reviews q where q.id=e.reference_id)
  when e.kind in('contract_invitation','contract_completed','contract_completed_company') then
   (select s.company_id from private.contract_signings s where s.id=e.reference_id)
 end
$$;

create function private.transactional_email_company_on_hold(e private.transactional_email_outbox)
returns boolean language plpgsql set search_path='' as $$
declare company_id uuid:=private.transactional_email_company_id(e);
        company_status text;
begin
 if company_id is null then return false;end if;
 -- Stabilize the status until source verification completes. A concurrent
 -- company mutation can temporarily defer this job without blocking other jobs.
 select c.status into company_status from public.companies c where c.id=company_id for share nowait;
 return coalesce(company_status='suspended',false);
exception when lock_not_available then return true;
end
$$;

create function private.claim_transactional_email_filtered(p_kinds text[],p_reference uuid)
returns jsonb language plpgsql set search_path='' as $$
declare e private.transactional_email_outbox;l uuid:=gen_random_uuid();customer boolean;
begin
 -- Only recover expired leases in the selected scope. A provider-started
 -- attempt can still become unknown during a hold and requires review.
 update private.transactional_email_outbox x
 set status=case when x.kind in('offer_invitation','contract_invitation','contract_completed')
  and x.customer_provider_started_at is null then 'pending' else 'unknown' end,
  lease_id=null,lease_until=null,updated_at=clock_timestamp()
 where x.status='processing' and x.lease_until<clock_timestamp()
  and (p_kinds is null or x.kind=any(p_kinds)) and (p_reference is null or x.reference_id=p_reference)
  and private.customer_document_email_latest(x);

 for e in
  select x.* from private.transactional_email_outbox x
  where x.status='pending' and x.attempts<5
   and (p_kinds is null or x.kind=any(p_kinds)) and (p_reference is null or x.reference_id=p_reference)
   and private.customer_document_email_latest(x)
   and not exists(select 1 from public.companies c where c.id=private.transactional_email_company_id(x) and c.status='suspended')
  order by x.created_at,x.id for update of x skip locked limit 20
 loop
  if private.transactional_email_company_on_hold(e) then continue;end if;
  if not private.transactional_email_recipient_current(e) then
   update private.transactional_email_outbox set status='cancelled',updated_at=clock_timestamp() where id=e.id;
   continue;
  end if;
  customer:=e.kind in('offer_invitation','contract_invitation','contract_completed');
  update private.transactional_email_outbox set first_attempt_at=case when customer then first_attempt_at else coalesce(first_attempt_at,clock_timestamp()) end,
   status='processing',lease_id=l,lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+case when customer then 0 else 1 end,updated_at=clock_timestamp()
   where id=e.id;
  return jsonb_build_object('id',e.id,'kind',e.kind,'reference',e.reference_id,'recipient',e.recipient,
   'createdAt',coalesce(e.first_attempt_at,clock_timestamp()),'leaseId',l,'generation',e.generation,
   'review',case when e.generation>0 and customer then private.customer_document_saved_review(e) else null end);
 end loop;
 return null;
end
$$;

revoke all on function private.transactional_email_company_id(private.transactional_email_outbox),
 private.transactional_email_company_on_hold(private.transactional_email_outbox),
 private.claim_transactional_email_filtered(text[],uuid)
 from public,anon,authenticated,service_role;

create or replace function public.claim_transactional_email(p_kind text default null,p_reference uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 return private.claim_transactional_email_filtered(case when p_kind is null then null else array[p_kind] end,p_reference);
end
$$;

create function public.claim_transactional_email_enabled(p_kinds text[])
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 if p_kinds is null or exists(
  select 1 from unnest(p_kinds) as requested(kind)
  where kind is null or kind not in('application_received','application_admin','account_approved','offer_invitation','contract_invitation','contract_completed','contract_completed_company')
 ) then raise exception 'Invalid enabled email kinds' using errcode='22023';end if;
 return private.claim_transactional_email_filtered(p_kinds,null);
end
$$;
revoke all on function public.claim_transactional_email_enabled(text[]) from public,anon,authenticated;
grant execute on function public.claim_transactional_email_enabled(text[]) to service_role;

create or replace function public.check_transactional_email_lease(p_id uuid,p_lease_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare e private.transactional_email_outbox;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 select * into e from private.transactional_email_outbox where id=p_id and lease_id=p_lease_id and status='processing' and lease_until>clock_timestamp();
 if not found or not private.customer_document_email_latest(e) then return false;end if;
 -- NULL indicates a temporary hold. Existing workers treat it as an
 -- unverifiable lease and return the unsent job to pending.
 if private.transactional_email_company_on_hold(e) then return null;end if;
 return private.transactional_email_recipient_current(e);
end
$$;

create or replace function public.claim_transactional_email_exact(p_kind text,p_reference uuid,p_expected_email_id uuid)returns jsonb
 language plpgsql security definer set search_path=''as $$
declare e private.transactional_email_outbox;i private.guest_document_invitations;l uuid:=gen_random_uuid();proof jsonb;
begin
 if current_setting('role',true)is distinct from 'service_role'then raise exception 'Service required'using errcode='42501';end if;
 if p_kind is null or p_kind not in('offer_invitation','contract_invitation','contract_completed')or p_reference is null or p_expected_email_id is null then raise exception 'Invalid reviewed dispatch'using errcode='22023';end if;
 select *into e from private.transactional_email_outbox where id=p_expected_email_id for update;
 if e.id is null or e.kind<>p_kind or e.reference_id<>p_reference or e.generation<=0 or not private.customer_document_email_latest(e)
 or(not exists(select 1 from private.customer_document_renewals where email_id=e.id)and not exists(select 1 from private.guest_invitation_renewal_audit where email_id=e.id))then raise exception 'Reviewed delivery changed'using errcode='40001';end if;
 if e.status='processing'and e.lease_until<=clock_timestamp()then
  update private.transactional_email_outbox set status=case when customer_provider_started_at is null then 'pending'else 'unknown'end,
   lease_id=null,lease_until=null,updated_at=clock_timestamp()where id=e.id returning *into e;
 end if;
 if e.status<>'pending'or e.attempts>=5 then return null;end if;
 if private.transactional_email_company_on_hold(e) then return null;end if;
 proof:=private.customer_document_saved_review(e);
 select *into i from private.guest_document_invitations where id=(proof->>'invitationId')::uuid and email_id=e.id for update;
 if i.id is null or i.revoked_at is not null or i.expires_at<=clock_timestamp()then raise exception 'Reviewed capability expired'using errcode='40001';end if;
 update private.transactional_email_outbox set status='processing',lease_id=l,lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp()
 where id=e.id returning *into e;
 return jsonb_build_object('id',e.id,'kind',e.kind,'reference',e.reference_id,'recipient',e.recipient,
 'createdAt',coalesce(e.first_attempt_at,clock_timestamp()),'leaseId',l,'generation',e.generation,'review',proof);
end$$;

commit;
