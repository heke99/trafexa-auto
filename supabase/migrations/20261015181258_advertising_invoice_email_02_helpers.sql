begin;
create function private.advertising_invoice_email_json(r private.advertising_invoice_emails) returns jsonb language sql set search_path='' as $$select jsonb_build_object('id',r.id,'companyId',r.company_id,'documentKind',r.document_kind,'documentId',r.document_id,'documentSourceHash',r.document_source_hash,'documentNumber',r.snapshot->>'documentNumber','recipient',r.snapshot->>'recipient','status',r.status,'attempts',r.attempts,'createdAt',r.created_at,'nextAttemptAt',r.next_attempt_at,'acceptedAt',r.accepted_at,'deliveredAt',r.delivered_at,'bouncedAt',r.bounced_at,'complainedAt',r.complained_at)$$;
create function private.advertising_invoice_email_source(p_company uuid,p_kind text,p_document uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare doc jsonb;original jsonb;snap jsonb;begin
 if p_kind='invoice' then select private.advertising_issued_invoice_json(r) into doc from private.advertising_issued_invoices r where company_id=p_company and id=p_document;original:=doc;
 elsif p_kind='credit' then select private.advertising_credit_json(r) into doc from private.advertising_credit_invoices r where company_id=p_company and id=p_document;original:=doc->'snapshot'->'originalInvoice';else raise exception 'Invalid document kind' using errcode='22023';end if;
 if doc is null then raise exception 'Document missing' using errcode='42501';end if;
 snap:=doc->'snapshot';return jsonb_build_object('companyId',p_company,'documentKind',p_kind,'documentId',p_document,'documentSourceHash',doc->>'sourceHash','documentNumber',coalesce(doc->>'invoiceNumber',doc->>'creditNumber'),'currency','SEK','netTotalOre',snap->>'netTotalOre','vatTotalOre',snap->>'vatTotalOre','grossTotalOre',snap->>'grossTotalOre','recipient',original->'snapshot'->'assessment'->'snapshot'->'draft'->'snapshot'->'buyerProfile'->'fields'->>'invoiceEmail','templateVersion',1,'document',doc);
end $$;
create function private.advertising_invoice_email_page(p_company uuid,p_kind text,p_document uuid,p_platform boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare mr text;source jsonb;blockers jsonb:='[]';preview jsonb;r private.advertising_invoice_emails;begin
 mr:=private.advertising_invoice_context(p_company,p_platform);source:=private.advertising_invoice_email_source(p_company,p_kind,p_document);
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
revoke all on function private.advertising_invoice_email_json(private.advertising_invoice_emails),private.advertising_invoice_email_source(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function private.advertising_invoice_email_page(uuid,text,uuid,boolean) from public,anon,service_role;
grant execute on function private.advertising_invoice_email_page(uuid,text,uuid,boolean) to authenticated;
commit;
