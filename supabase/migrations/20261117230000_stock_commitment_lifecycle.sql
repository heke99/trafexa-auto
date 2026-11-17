begin;

-- Accepted offers and fully signed documents both require a separate agreement
-- process. Reservation mutations check this predicate again with the deal locked.
create function private.deal_has_protected_agreement(p_company_id uuid,p_deal_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from private.offer_reviews q
  where q.company_id=p_company_id and q.deal_id=p_deal_id and q.status='accepted'
 ) or exists(
  select 1 from private.contract_signings s
  where s.company_id=p_company_id and s.deal_id=p_deal_id and private.deal_native_fully_signed(s)
 ) or exists(
  select 1 from private.uploaded_pdf_sources s
  where s.company_id=p_company_id and s.deal_id=p_deal_id and private.deal_pdf_fully_signed(s)
 );
$$;
revoke all on function private.deal_has_protected_agreement(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function private.expire_stock_reservations(stock uuid) returns void
language plpgsql security definer set search_path='' as $$
declare company uuid; item record;
begin
 select company_id into company from public.stock_items where id=stock;
 if not found then return; end if;
 perform 1 from public.companies where id=company for key share;
 if not found then return; end if;
 perform 1 from public.stock_items where id=stock and company_id=company for update;
 if not found then return; end if;
 for item in
  select d.id from public.deals d
  where d.company_id=company and exists (
   select 1 from public.reservations r
   where r.company_id=company and r.stock_item_id=stock and r.deal_id=d.id
   and r.status='active' and r.expires_at<=now()
  ) order by d.id for update of d
 loop
  -- Acceptance and signing paths serialize on this same deal lock.
  if private.deal_has_protected_agreement(company,item.id) then
   continue;
  end if;
  update public.reservations set status='expired'
  where company_id=company and stock_item_id=stock and deal_id=item.id
  and status='active' and expires_at<=now();
  if found then
   update public.deals set status='draft' where company_id=company and id=item.id and status='reserved';
  end if;
 end loop;
 update public.stock_items set status='available'
 where company_id=company and id=stock and status='reserved'
 and not exists(select 1 from public.reservations where company_id=company and stock_item_id=stock and status='active');
end $$;

create or replace function private.expire_reservations() returns integer
language plpgsql security definer set search_path='' as $$
declare tenant record; item record; reservation record; examined integer:=0; processed integer:=0;
begin
 -- Protected agreements are filtered before the batch limit so they cannot starve
 -- ordinary expirations. Every predicate is checked again after locking the deal.
 for tenant in
  select c.id from public.companies c
  where exists (
   select 1 from public.reservations r
   where r.company_id=c.id and r.status='active' and r.expires_at<=now()
   and not private.deal_has_protected_agreement(r.company_id,r.deal_id)
  ) order by c.id for key share of c skip locked
 loop
  exit when examined>=500;
  for item in
   select s.id from public.stock_items s
   where s.company_id=tenant.id and exists (
    select 1 from public.reservations r
    where r.company_id=tenant.id and r.stock_item_id=s.id and r.status='active' and r.expires_at<=now()
    and not private.deal_has_protected_agreement(r.company_id,r.deal_id)
   ) order by s.id limit (500-examined) for update of s skip locked
  loop
   examined:=examined+1;
   select r.id,r.deal_id into reservation from public.reservations r
   where r.company_id=tenant.id and r.stock_item_id=item.id and r.status='active' and r.expires_at<=now();
   if not found then continue; end if;
   -- A slow customer acceptance or contract transaction must not stall the batch.
   perform 1 from public.deals where company_id=tenant.id and id=reservation.deal_id for update skip locked;
   if not found then continue; end if;
   perform private.expire_stock_reservations(item.id);
   if exists(select 1 from public.reservations where id=reservation.id and status='expired') then
    processed:=processed+1;
   end if;
  end loop;
 end loop;
 return processed;
end $$;

create or replace function private.cancel_deal(p_company_id uuid,p_deal_id uuid,p_expected_status text,p_reason text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;stock uuid;d public.deals;s public.stock_items;old private.deal_cancellation_audit;p jsonb;v jsonb;released integer;
begin
 select actor,actor_role into a,r from private.customer_contact_access(p_company_id,true);
 if p_request_id is null or p_expected_status is null or p_expected_status not in ('draft','reserved') or p_reason is null or p_reason<>btrim(p_reason) or length(p_reason) not between 2 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception 'Invalid cancellation' using errcode='22023';end if;
 select stock_item_id into stock from public.deals where company_id=p_company_id and id=p_deal_id;
 if not found then raise exception 'Deal access denied' using errcode='42501';end if;
 -- Every reservation lifecycle mutation serializes on stock before deal.
 select * into s from public.stock_items where company_id=p_company_id and id=stock for update;
 if not found then raise exception 'Stock access denied' using errcode='42501';end if;
 select * into d from public.deals where company_id=p_company_id and id=p_deal_id for update;
 if not found or d.stock_item_id<>stock then raise exception 'Deal conflict' using errcode='40001';end if;
 p:=jsonb_build_object('companyId',p_company_id,'dealId',p_deal_id,'expectedStatus',p_expected_status,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(a::text||p_request_id::text,0));
 select * into old from private.deal_cancellation_audit where actor_user_id=a and request_id=p_request_id;
 if found then
  if old.payload is distinct from p then raise exception 'Request conflict' using errcode='40001';end if;
  return old.receipt;
 end if;
 if d.status<>p_expected_status then raise exception 'Deal conflict' using errcode='40001';end if;
 if private.deal_has_protected_agreement(p_company_id,p_deal_id) then
  raise exception 'Deal has an accepted offer or signed agreement' using errcode='40001';
 end if;
 update public.reservations set status='released' where company_id=p_company_id and deal_id=p_deal_id and stock_item_id=stock and status='active';
 get diagnostics released=row_count;
 update public.deals set status='cancelled' where company_id=p_company_id and id=p_deal_id;
 update public.stock_items set status='available' where company_id=p_company_id and id=stock and status='reserved' and not exists(select 1 from public.reservations where company_id=p_company_id and stock_item_id=stock and status='active');
 v:=jsonb_build_object('companyId',p_company_id,'actorUserId',a,'requestId',p_request_id,'dealId',p_deal_id,'status','cancelled','previousStatus',d.status,'reason',p_reason,'releasedReservations',released,'stockId',stock);
 insert into private.deal_cancellation_audit(company_id,deal_id,actor_user_id,request_id,payload,receipt)values(p_company_id,p_deal_id,a,p_request_id,p,v);
 return v;
end$$;

create or replace function private.release_reservation(company uuid,deal uuid) returns void language plpgsql security definer set search_path='' as $$
declare stock uuid;d public.deals;a uuid;r text;
begin
 select actor,actor_role into a,r from private.customer_contact_access(company,true);
 select stock_item_id into stock from public.deals where id=deal and company_id=company;
 if not found then raise exception 'Deal unavailable' using errcode='42501';end if;
 perform 1 from public.stock_items where id=stock and company_id=company for update;
 if not found then raise exception 'Vehicle unavailable' using errcode='42501';end if;
 select * into d from public.deals where id=deal and company_id=company for update;
 if not found or d.stock_item_id<>stock or d.status not in ('draft','reserved') then raise exception 'Deal unavailable' using errcode='40001';end if;
 if private.deal_has_protected_agreement(company,deal) then
  raise exception 'Deal has an accepted offer or signed agreement' using errcode='40001';
 end if;
 update public.reservations set status='released' where company_id=company and deal_id=deal and stock_item_id=stock and status='active';
 if found then
  update public.stock_items set status='available' where company_id=company and id=stock and status='reserved' and not exists(select 1 from public.reservations where company_id=company and stock_item_id=stock and status='active');
  update public.deals set status='draft' where company_id=company and id=deal and status='reserved';
 end if;
end$$;

create or replace function private.approve_direct_deal(p_company_id uuid,p_deal_id uuid,p_draft_id uuid,p_review_hash text,p_seller_name text,p_acknowledged boolean,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare trade private.trade_in_versions;a uuid;r text;d public.deals;stock_id uuid;stock public.stock_items;draft private.sale_contract_drafts;q private.direct_deal_reviews;customer public.customers;t private.sale_contract_template_versions;s private.contract_signings;p jsonb;receipt jsonb;canonical text;identity_value text;
begin
 select actor,actor_role into a,r from private.sale_contract_access(p_company_id,true);
 if p_draft_id is null or p_request_id is null or p_review_hash is null or p_review_hash !~ '^[a-f0-9]{64}$' or p_acknowledged is distinct from true or p_seller_name is null or p_seller_name<>btrim(p_seller_name) or length(p_seller_name) not between 2 and 160 or p_seller_name ~ '[[:cntrl:]]' then raise exception 'Review required' using errcode='22023';end if;
 select stock_item_id into stock_id from public.deals where company_id=p_company_id and id=p_deal_id;
 if not found then raise exception 'Deal denied' using errcode='42501';end if;
 -- The access check locks the company. Serialize on stock before locking the deal.
 select * into stock from public.stock_items where company_id=p_company_id and id=stock_id for update;
 if not found then raise exception 'Vehicle unavailable' using errcode='40001';end if;
 select * into d from public.deals where company_id=p_company_id and id=p_deal_id for update;
 if not found or d.stock_item_id is distinct from stock_id then
  raise exception 'Deal source changed' using errcode='40001';
 end if;
 p:=jsonb_build_object('operation','approveDirectDeal','companyId',p_company_id,'dealId',p_deal_id,'draftId',p_draft_id,'reviewHash',p_review_hash,'sellerName',p_seller_name,'acknowledged',true,'consentVersion','2026-10-14');
 receipt:=private.contract_signing_replay(a,p_request_id,p);if receipt is not null then return receipt;end if;
 if private.deal_is_archived(p_company_id,d.id)
 or stock.status not in ('available','reserved')
 or (stock.status='reserved' and not exists(
  select 1 from public.reservations r
  where r.company_id=p_company_id and r.stock_item_id=stock.id and r.deal_id=d.id
  and r.status='active' and r.expires_at>clock_timestamp()
 )) then
  raise exception 'Vehicle unavailable for this deal' using errcode='40001';
 end if;
 select * into draft from private.sale_contract_drafts where company_id=p_company_id and deal_id=d.id and id=p_draft_id;
 select * into q from private.direct_deal_reviews where company_id=p_company_id and deal_id=d.id and draft_id=p_draft_id;
 if draft.id is null or q.draft_id is null or draft.offer_id is not null or draft.snapshot->>'sourceKind' is distinct from 'direct_deal' then raise exception 'Direct source denied' using errcode='42501';end if;
 if d.status not in('draft','reserved') or exists(select 1 from private.contract_signings where company_id=p_company_id and deal_id=d.id) or exists(select 1 from private.sale_contract_drafts where company_id=p_company_id and deal_id=d.id and version>draft.version) or exists(select 1 from private.offer_reviews where company_id=p_company_id and deal_id=d.id and status in('pending','accepted')) then raise exception 'Deal source changed' using errcode='40001';end if;
 if draft.snapshot#>'{sourceOffer,trade_in}' is not null then
  select * into trade from private.trade_in_versions where company_id=p_company_id and deal_id=d.id and id=(draft.snapshot#>>'{sourceOffer,trade_in,id}')::uuid;
  if not found or trade.customer_id<>d.customer_id or trade.version<>(select max(version) from private.trade_in_versions where company_id=p_company_id and deal_id=d.id) or not trade.debt_known or trade.debt_ore is null or private.direct_trade_in_snapshot(trade,d.sale_price_ore) is distinct from draft.snapshot#>'{sourceOffer,trade_in}' then raise exception 'Trade-in changed since review' using errcode='40001';end if;
 end if;
 canonical:=jsonb_build_object('draftId',draft.id,'companyId',draft.company_id,'dealId',draft.deal_id,'draftVersion',draft.version,'content',draft.snapshot)::text;
 if encode(sha256(convert_to(canonical,'UTF8')),'hex')<>p_review_hash or(draft.snapshot#>>'{sourceOffer,sale_price_ore}')::bigint<>d.sale_price_ore then raise exception 'Review changed' using errcode='40001';end if;
 select * into customer from public.customers where company_id=p_company_id and id=d.customer_id for update;
 if not found or customer.contact_version<>q.customer_version then raise exception 'Customer changed since review' using errcode='40001';end if;
 select * into t from private.sale_contract_template_versions where company_id=p_company_id and id=draft.template_version_id for update;
 if not found or t.body is distinct from draft.snapshot#>>'{template,body}' or t.approval_version<>(draft.snapshot#>>'{template,approvalVersion}')::integer or (case when q.template_requires_approval then t.status<>'draft' else t.status<>'approved' end) then raise exception 'Template changed' using errcode='40001';end if;
 if q.template_requires_approval then update private.sale_contract_template_versions set status='approved',approval_version=approval_version+1,approved_at=clock_timestamp() where id=t.id returning * into t;insert into private.sale_contract_audit(company_id,actor_user_id,request_id,payload,receipt) values(p_company_id,a,p_request_id,jsonb_build_object('operation','approveDirectTemplate','draftId',draft.id,'reviewHash',p_review_hash,'templateVersionId',t.id,'expectedApprovalVersion',t.approval_version-1,'acknowledged',true),jsonb_build_object('companyId',p_company_id,'actorUserId',a,'requestId',p_request_id,'template',private.sale_contract_template_json(t)));end if;
 identity_value:=private.normalize_customer_identity(draft.snapshot#>>'{customerIdentity,kind}',draft.snapshot#>>'{customerIdentity,number}');
 if q.customer_patch is not null then
  update public.customers set name=q.customer_patch->>'name',kind=q.customer_patch->>'kind',email=q.customer_patch->>'email',phone=q.customer_patch->>'phone',address=q.customer_patch->>'address' where company_id=p_company_id and id=customer.id;
 end if;
 insert into private.customer_identity_numbers(company_id,customer_id,kind,identity_number) values(p_company_id,customer.id,draft.snapshot#>>'{customerIdentity,kind}',identity_value) on conflict(company_id,customer_id) do update set kind=excluded.kind,identity_number=excluded.identity_number;
 insert into private.contract_signings(company_id,deal_id,draft_id,customer_email,canonical_content,document_hash,created_by) values(p_company_id,d.id,draft.id,draft.snapshot#>>'{sourceOffer,customer,email}',canonical,p_review_hash,a) returning * into s;
 -- The dealer explicitly approves the reviewed exact content with a typed name.
 -- This is account authorization, not a drawn signature or an identity service.
 insert into private.contract_signatures(signing_id,party,actor_user_id,full_name,document_hash,consent_version,strokes,approval_method) values(s.id,'company',a,p_seller_name,s.document_hash,'2026-10-14','[]','typed_name');
 perform private.enqueue_transactional_email('contract_invitation',s.id,s.customer_email,null);
 receipt:=jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'requestId',p_request_id,'signing',private.contract_signing_json(s,a,r));
 insert into private.contract_signing_audit(actor_user_id,request_id,payload,receipt) values(a,p_request_id,p,receipt);return receipt;
end$$;

create or replace function public.sign_uploaded_pdf_guest(
 p_source_id uuid,p_token_sha256 text,p_document_hash text,p_full_name text,p_acknowledged boolean,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.uploaded_pdf_sources;p jsonb;r jsonb;
begin
 perform private.uploaded_pdf_service();
 if p_request_id is null or p_acknowledged is distinct from true or not private.contract_pdf_name_supported_v1(p_full_name) then
  raise exception 'Review required' using errcode='22023';
 end if;
 s:=private.uploaded_pdf_guest_source(p_source_id,p_token_sha256);
 perform 1 from public.companies where id=s.company_id and status='active' for share;
 if not found then raise exception 'Document unavailable' using errcode='42501';end if;
 perform 1 from public.deals where company_id=s.company_id and id=s.deal_id for update;
 if not found then raise exception 'Document unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('uploaded-pdf-guest:'||p_source_id::text,0));
 perform 1 from private.uploaded_pdf_sources where id=p_source_id for update;
 s:=private.uploaded_pdf_guest_source(p_source_id,p_token_sha256);
 p:=jsonb_build_object('documentHash',p_document_hash,'fullName',p_full_name,'acknowledged',true);
 select receipt into r from private.uploaded_pdf_guest_requests where source_id=s.id and request_id=p_request_id and payload=p;
 if found then return r;end if;
 if exists(select 1 from private.uploaded_pdf_guest_requests where source_id=s.id and request_id=p_request_id) then
  raise exception 'Request changed' using errcode='40001';
 end if;
 if s.document_hash<>p_document_hash or exists(
  select 1 from private.uploaded_pdf_signatures where source_id=s.id and party='customer'
 ) then
  raise exception 'Document changed' using errcode='40001';
 end if;
 insert into private.uploaded_pdf_signatures(source_id,party,actor_user_id,full_name,document_hash,consent_version)
 values(s.id,'customer',null,p_full_name,s.document_hash,'2026-11-13');
 r:=private.uploaded_pdf_json(s);
 insert into private.uploaded_pdf_guest_requests values(s.id,p_request_id,p,r);
 return r;
end$$;

commit;
