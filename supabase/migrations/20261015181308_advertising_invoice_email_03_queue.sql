begin;
create function private.queue_advertising_invoice_email(p_company uuid,p_kind text,p_document uuid,p_source text,p_review text,p_ack boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();payload jsonb;old private.advertising_invoice_email_requests;page jsonb;snap jsonb;r private.advertising_invoice_emails;begin
 perform private.advertising_invoice_context(p_company,true);
 if p_kind is null or p_document is null or p_source is null or p_source !~ '^[0-9a-f]{64}$' or p_review is null or p_review !~ '^[0-9a-f]{64}$' or p_ack is distinct from true or p_request is null then raise exception 'Invalid invoice email review' using errcode='22023';end if;
 payload:=jsonb_build_object('documentKind',p_kind,'documentId',p_document,'documentSourceHash',p_source,'reviewToken',p_review);
 select * into old from private.advertising_invoice_email_requests where actor_user_id=actor and request_id=p_request;
 if found then if old.company_id<>p_company or old.payload<>payload then raise exception 'Request reused' using errcode='40001';end if;select * into r from private.advertising_invoice_emails where id=old.email_id;
 else page:=private.advertising_invoice_email_page(p_company,p_kind,p_document,true);
 if page->>'documentSourceHash'<>p_source or page->'preview'->>'reviewToken' is distinct from p_review or not(page->>'canQueue')::boolean then raise exception 'Email review changed' using errcode='40001';end if;
 snap:=(page->'preview'->>'canonicalSnapshot')::jsonb;
 insert into private.advertising_invoice_emails(company_id,document_kind,document_id,document_source_hash,snapshot,canonical_snapshot,source_hash,created_by)values(p_company,p_kind,p_document,p_source,snap,page->'preview'->>'canonicalSnapshot',p_review,actor) returning * into r;
 insert into private.advertising_invoice_email_requests values(actor,p_request,p_company,r.id,payload);end if;
 return jsonb_build_object('email',private.advertising_invoice_email_json(r),'receipt',jsonb_build_object('emailId',r.id,'companyId',p_company,'actorUserId',actor,'requestId',p_request,'documentKind',p_kind,'documentId',p_document,'documentSourceHash',p_source,'reviewToken',p_review));
end $$;
revoke all on function private.queue_advertising_invoice_email(uuid,text,uuid,text,text,boolean,uuid) from public,anon,service_role;
grant execute on function private.queue_advertising_invoice_email(uuid,text,uuid,text,text,boolean,uuid) to authenticated;
commit;
