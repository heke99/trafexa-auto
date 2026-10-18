begin;
create or replace function public.claim_transactional_email(p_kind text default null,p_reference uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.transactional_email_outbox;l uuid:=gen_random_uuid();customer boolean;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 -- Before the provider-start marker there was no external attempt. A crash in
 -- preparing a capability may safely reuse the same frozen token/body and queue item.
 update private.transactional_email_outbox set status=case when kind in('offer_invitation','contract_invitation','contract_completed') and customer_provider_started_at is null then 'pending' else 'unknown' end,
  lease_id=null,lease_until=null,updated_at=clock_timestamp() where status='processing' and lease_until<clock_timestamp() and private.customer_document_email_latest(transactional_email_outbox);
 for e in select x.* from private.transactional_email_outbox x where status='pending' and attempts<5 and private.customer_document_email_latest(x)
  and(p_kind is null or kind=p_kind) and(p_reference is null or reference_id=p_reference) order by created_at,id for update skip locked limit 20 loop
  if not private.transactional_email_recipient_current(e) then
   update private.transactional_email_outbox set status='cancelled',updated_at=clock_timestamp() where id=e.id;continue;
  end if;
  customer:=e.kind in('offer_invitation','contract_invitation','contract_completed');
  update private.transactional_email_outbox set first_attempt_at=case when customer then first_attempt_at else coalesce(first_attempt_at,clock_timestamp()) end,
   status='processing',lease_id=l,lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+case when customer then 0 else 1 end,updated_at=clock_timestamp() where id=e.id;
  return jsonb_build_object('id',e.id,'kind',e.kind,'reference',e.reference_id,'recipient',e.recipient,'createdAt',coalesce(e.first_attempt_at,clock_timestamp()),'leaseId',l,'generation',e.generation,'review',case when e.generation>0 and customer then private.customer_document_saved_review(e)else null end);
 end loop;return null;
end $$;

create or replace function public.check_transactional_email_lease(p_id uuid,p_lease_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare e private.transactional_email_outbox;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 select * into e from private.transactional_email_outbox where id=p_id and lease_id=p_lease_id and status='processing' and lease_until>clock_timestamp();
 return found and private.customer_document_email_latest(e) and private.transactional_email_recipient_current(e);
end$$;
commit;
