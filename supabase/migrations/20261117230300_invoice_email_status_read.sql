begin;
create function private.advertising_invoice_read_context(p_company uuid,p_platform boolean) returns text language plpgsql security definer set search_path='' as $$
declare actor uuid;mr text;begin
 select i.user_id into actor from private.company_team_identity(true) i;
 if p_platform then
  if not private.has_platform_admin() then raise exception 'Platform administrator required' using errcode='42501';end if;
  perform 1 from private.platform_admins where user_id=actor and status='active' for share;
  if not found then raise exception 'Platform administrator required' using errcode='42501';end if;
  perform 1 from public.companies where id=p_company for share;
  if not found then raise exception 'Company missing' using errcode='42501';end if;
  return 'platform_admin';
 end if;
 select x.actor_role into mr from private.customer_contact_access(p_company,false) x;
 if mr not in ('owner','admin','finance') then raise exception 'Invoice access denied' using errcode='42501';end if;
 return mr;
end $$;
revoke all on function private.advertising_invoice_read_context(uuid,boolean) from public,anon,authenticated,service_role;
create or replace function private.advertising_invoice_email_json(r private.advertising_invoice_emails) returns jsonb language sql set search_path='' as $$select jsonb_build_object('id',r.id,'companyId',r.company_id,'documentKind',r.document_kind,'documentId',r.document_id,'documentSourceHash',r.document_source_hash,'documentNumber',r.snapshot->>'documentNumber','recipient',r.snapshot->>'recipient','status',case when r.status='processing' and r.lease_until<=statement_timestamp() then 'unknown' else r.status end,'attempts',r.attempts,'createdAt',r.created_at,'nextAttemptAt',r.next_attempt_at,'acceptedAt',r.accepted_at,'deliveredAt',r.delivered_at,'bouncedAt',r.bounced_at,'complainedAt',r.complained_at)$$;
create or replace function private.advertising_invoice_email_page(p_company uuid,p_kind text,p_document uuid,p_platform boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare mr text;source jsonb;blockers jsonb:='[]';preview jsonb;r private.advertising_invoice_emails;begin
 mr:=private.advertising_invoice_read_context(p_company,p_platform);source:=private.advertising_invoice_email_source(p_company,p_kind,p_document);
 select * into r from private.advertising_invoice_emails where company_id=p_company and document_kind=p_kind and document_id=p_document;
 if exists(select 1 from public.companies where id=p_company and status<>'active') then blockers:=blockers||'["company.suspended"]'::jsonb;end if;
 if p_kind='invoice' and exists(select 1 from private.advertising_credit_invoices where original_invoice_id=p_document) then blockers:=blockers||'["original.creditExists"]'::jsonb;end if;
 if source->>'recipient' is null then blockers:=blockers||'["recipient.missing"]'::jsonb;end if;
 if exists(select 1 from private.advertising_invoice_emails e where lower(e.snapshot->>'recipient')=lower(source->>'recipient') and (e.bounced_at is not null or e.complained_at is not null)) then blockers:=blockers||'["recipient.suppressed"]'::jsonb;end if;
 if source->>'recipient' is not null and (length(source->>'recipient')>254 or source->>'recipient' !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$') then blockers:=blockers||'["recipient.invalid"]'::jsonb;end if;
 if r.id is not null then blockers:=blockers||'["email.exists"]'::jsonb;end if;
 if mr<>'platform_admin' then blockers:=blockers||'["email.adminOnly"]'::jsonb;end if;
 if blockers='[]'::jsonb then preview:=jsonb_build_object('reviewToken',encode(sha256(convert_to(source::text,'UTF8')),'hex'),'canonicalSnapshot',source::text);end if;
 return (source-'document'-'templateVersion')||jsonb_build_object('actorUserId',auth.uid(),'actorRole',mr,'email',case when r.id is null then null else private.advertising_invoice_email_json(r) end,'preview',preview,'blockers',blockers,'canQueue',blockers='[]'::jsonb);
end $$;
commit;
