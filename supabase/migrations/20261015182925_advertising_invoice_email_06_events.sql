begin;
create function private.apply_advertising_invoice_email_event(p_event text,p_provider text,p_type text,p_at timestamptz,p_recipient text,p_email uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare eid uuid;existing private.advertising_invoice_email_events;job private.advertising_invoice_emails;begin
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'Verified webhook service required' using errcode='42501';end if;
 if p_event is null or length(p_event) not between 1 and 200 or p_event !~ '^[A-Za-z0-9_-]+$' or p_provider is null or length(p_provider) not between 1 and 200 or p_provider !~ '^[A-Za-z0-9_-]+$' or p_type is null or p_type not in ('delivered','bounced','complained') or p_at is null or p_at>clock_timestamp()+interval '5 minutes' or p_at<clock_timestamp()-interval '30 days' or p_recipient is null or p_recipient !~ '^[0-9a-f]{64}$' then raise exception 'Invalid verified email event' using errcode='22023';end if;
 -- Event ingestion and finish reconcile serialize on a shared lock before any email row lock.
 perform pg_advisory_xact_lock(hashtextextended('advertising-invoice-seller',0));
 select * into existing from private.advertising_invoice_email_events where event_id=p_event;
 if found then if existing.provider_id<>p_provider or existing.event_type<>p_type or existing.event_at<>p_at or existing.recipient_hash<>p_recipient or existing.email_id is distinct from p_email then raise exception 'Email event reused' using errcode='40001';end if;return jsonb_build_object('ok',true);end if;
 delete from private.advertising_invoice_email_events e where e.received_at<clock_timestamp()-interval '24 hours' and not exists(select 1 from private.advertising_invoice_emails j where j.provider_id=e.provider_id);
 if p_email is not null then
 select * into job from private.advertising_invoice_emails where id=p_email for update;
 if not found or encode(sha256(convert_to(lower(job.snapshot->>'recipient'),'UTF8')),'hex')<>p_recipient or (job.provider_id is not null and job.provider_id<>p_provider) then return jsonb_build_object('ok',true);end if;
 if job.provider_id is null and job.status in ('processing','unknown') and job.attempts>0 and job.payload_hash is not null and job.pdf_sha256 is not null and job.lease_id is not null and job.lease_actor is not null then
 update private.advertising_invoice_emails set provider_id=p_provider,status='accepted',accepted_at=clock_timestamp() where id=job.id;
 end if;end if;
 select id into eid from private.advertising_invoice_emails where (p_email is null or id=p_email) and provider_id=p_provider and encode(sha256(convert_to(lower(snapshot->>'recipient'),'UTF8')),'hex')=p_recipient;
 if eid is null and (select count(*) from private.advertising_invoice_email_events e where not exists(select 1 from private.advertising_invoice_emails j where j.provider_id=e.provider_id))>=10000 then raise exception 'Unmatched event capacity' using errcode='54000';end if;
 insert into private.advertising_invoice_email_events(event_id,email_id,provider_id,event_type,event_at,recipient_hash)values(p_event,p_email,p_provider,p_type,p_at,p_recipient);
 if eid is not null then perform private.advertising_invoice_email_reconcile(eid);end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function private.apply_advertising_invoice_email_event(text,text,text,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function private.apply_advertising_invoice_email_event(text,text,text,timestamptz,text,uuid) to service_role;
commit;
