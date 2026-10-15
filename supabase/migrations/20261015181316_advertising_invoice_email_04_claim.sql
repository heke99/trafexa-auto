begin;
create function private.claim_advertising_invoice_email(p_company uuid,p_email uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.advertising_invoice_emails;job jsonb;t timestamptz:=clock_timestamp();begin
 perform private.advertising_invoice_context(p_company,true);perform 1 from public.companies where id=p_company and status='active' for share; if not found then raise exception 'Company suspended' using errcode='42501';end if;t:=clock_timestamp();select * into r from private.advertising_invoice_emails where id=p_email and company_id=p_company for update;
 if not found then raise exception 'Email missing' using errcode='42501';end if;
 if r.status='processing' and r.lease_until<=t then update private.advertising_invoice_emails set status='unknown' where id=r.id returning * into r;end if;
 if r.status='pending' and (r.attempts>=5 or r.first_attempt_at+interval '23 hours'<=t) then update private.advertising_invoice_emails set status='unknown' where id=r.id returning * into r;end if;
 if r.status='pending' and r.document_kind='invoice' and exists(select 1 from private.advertising_credit_invoices where original_invoice_id=r.document_id) then update private.advertising_invoice_emails set status='cancelled' where id=r.id returning * into r;end if;
 if r.status='pending' and exists(select 1 from private.advertising_invoice_emails e where lower(e.snapshot->>'recipient')=lower(r.snapshot->>'recipient') and (e.bounced_at is not null or e.complained_at is not null)) then update private.advertising_invoice_emails set status='cancelled' where id=r.id returning * into r;end if;
 if r.status='pending' and (r.next_attempt_at is null or r.next_attempt_at<=t) then
 update private.advertising_invoice_emails set status='processing',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,t),lease_id=gen_random_uuid(),lease_until=t+interval '60 seconds',lease_actor=auth.uid(),next_attempt_at=null where id=r.id returning * into r;
 job:=private.advertising_invoice_email_json(r)||jsonb_build_object('sourceHash',r.source_hash,'canonicalSnapshot',r.canonical_snapshot,'snapshot',r.snapshot,'leaseId',r.lease_id,'leaseUntil',r.lease_until,'firstAttemptAt',r.first_attempt_at,'payloadHash',r.payload_hash,'pdfSha256',r.pdf_sha256);
 end if;return jsonb_build_object('companyId',p_company,'actorUserId',auth.uid(),'actorRole','platform_admin','job',job);
end $$;
create function private.check_advertising_invoice_email(p_company uuid,p_email uuid,p_lease uuid,p_payload text,p_pdf text,p_bind boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.advertising_invoice_emails;t timestamptz:=clock_timestamp();begin
 perform private.advertising_invoice_context(p_company,true);perform 1 from public.companies where id=p_company and status='active' for share; if not found then raise exception 'Company suspended' using errcode='42501';end if;t:=clock_timestamp();select * into r from private.advertising_invoice_emails where id=p_email and company_id=p_company for update;
 if not found then raise exception 'Email missing' using errcode='42501';end if;
 if r.status<>'processing' or r.lease_id is distinct from p_lease or r.lease_actor is distinct from auth.uid() then return jsonb_build_object('ok',false);end if;
 if r.lease_until<=t or r.first_attempt_at+interval '23 hours'<=t then update private.advertising_invoice_emails set status='unknown' where id=r.id;return jsonb_build_object('ok',false);end if;
 if r.document_kind='invoice' and exists(select 1 from private.advertising_credit_invoices where original_invoice_id=r.document_id) then update private.advertising_invoice_emails set status='cancelled',lease_id=null,lease_until=null,lease_actor=null where id=r.id;return jsonb_build_object('ok',false);end if;
 if exists(select 1 from private.advertising_invoice_emails e where lower(e.snapshot->>'recipient')=lower(r.snapshot->>'recipient') and (e.bounced_at is not null or e.complained_at is not null)) then update private.advertising_invoice_emails set status='cancelled' where id=r.id;return jsonb_build_object('ok',false);end if;
 if p_payload is null or p_payload !~ '^[0-9a-f]{64}$' or p_pdf is null or p_pdf !~ '^[0-9a-f]{64}$' then raise exception 'Invalid email digests' using errcode='22023';end if;
 if (r.payload_hash is not null and r.payload_hash<>p_payload) or (r.pdf_sha256 is not null and r.pdf_sha256<>p_pdf) then raise exception 'Email bytes changed' using errcode='40001';end if;
 if p_bind then update private.advertising_invoice_emails set payload_hash=p_payload,pdf_sha256=p_pdf where id=r.id;elsif r.payload_hash is null or r.pdf_sha256 is null then return jsonb_build_object('ok',false);end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function private.claim_advertising_invoice_email(uuid,uuid),private.check_advertising_invoice_email(uuid,uuid,uuid,text,text,boolean) from public,anon,service_role;
grant execute on function private.claim_advertising_invoice_email(uuid,uuid),private.check_advertising_invoice_email(uuid,uuid,uuid,text,text,boolean) to authenticated;
commit;
