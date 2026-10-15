begin;
create function private.advertising_invoice_email_reconcile(p_email uuid) returns void language sql security definer set search_path='' as $$
 update private.advertising_invoice_emails r set delivered_at=coalesce(r.delivered_at,e.delivered),bounced_at=coalesce(r.bounced_at,e.bounced),complained_at=coalesce(r.complained_at,e.complained)
 from (select min(event_at)filter(where event_type='delivered') delivered,min(event_at)filter(where event_type='bounced') bounced,min(event_at)filter(where event_type='complained') complained from private.advertising_invoice_email_events where (email_id is null or email_id=p_email) and provider_id=(select provider_id from private.advertising_invoice_emails where id=p_email) and recipient_hash=(select encode(sha256(convert_to(lower(snapshot->>'recipient'),'UTF8')),'hex') from private.advertising_invoice_emails where id=p_email)) e where r.id=p_email;
$$;
create function private.finish_advertising_invoice_email(p_company uuid,p_email uuid,p_lease uuid,p_actor uuid,p_payload text,p_pdf text,p_outcome text,p_provider text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.advertising_invoice_emails;t timestamptz:=clock_timestamp();begin
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'Provider result service required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('advertising-invoice-seller',0));t:=clock_timestamp();select * into r from private.advertising_invoice_emails where id=p_email and company_id=p_company for update;
 if not found then raise exception 'Email missing' using errcode='42501';end if;
 if r.status='accepted' and p_outcome='accepted' and r.provider_id=p_provider and r.lease_id=p_lease and r.lease_actor=p_actor and r.payload_hash=p_payload and r.pdf_sha256=p_pdf then return jsonb_build_object('status','accepted');end if;
 if r.status not in ('processing','unknown') or r.lease_id is distinct from p_lease or r.lease_actor is distinct from p_actor or p_actor is null or r.payload_hash is distinct from p_payload or r.pdf_sha256 is distinct from p_pdf then raise exception 'Email lease changed' using errcode='40001';end if;
 if p_outcome is null or p_outcome not in ('accepted','retryable','rejected','unknown','cancelled') or (p_outcome='accepted' and (p_provider is null or length(p_provider) not between 1 and 200 or p_provider !~ '^[A-Za-z0-9_-]+$' or r.payload_hash is null or r.pdf_sha256 is null)) or (p_outcome<>'accepted' and p_provider is not null) then raise exception 'Invalid email result' using errcode='22023';end if;
 if (r.lease_until<=t or r.status='unknown') and p_outcome<>'accepted' then p_outcome:='unknown';p_provider:=null;end if;
 if p_outcome='retryable' and (r.attempts>=5 or r.first_attempt_at+interval '23 hours'<=t) then p_outcome:='rejected';end if;
 update private.advertising_invoice_emails set status=case when p_outcome='retryable' then 'pending' else p_outcome end,provider_id=p_provider,accepted_at=case when p_outcome='accepted' then t else null end,next_attempt_at=case when p_outcome='retryable' then t+(30*power(2,r.attempts-1))*interval '1 second' else null end,lease_id=case when p_outcome='unknown' then lease_id else null end,lease_until=case when p_outcome='unknown' then lease_until else null end,lease_actor=case when p_outcome='unknown' then lease_actor else null end where id=r.id returning * into r;
 if p_outcome='accepted' then perform private.advertising_invoice_email_reconcile(r.id);end if;
 delete from private.advertising_invoice_email_events e where e.received_at<t-interval '24 hours' and not exists(select 1 from private.advertising_invoice_emails j where j.provider_id=e.provider_id);
 return jsonb_build_object('status',r.status);
end $$;
revoke all on function private.advertising_invoice_email_reconcile(uuid) from public,anon,authenticated,service_role;
revoke all on function private.finish_advertising_invoice_email(uuid,uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function private.finish_advertising_invoice_email(uuid,uuid,uuid,uuid,text,text,text,text) to service_role;
commit;
