-- Both authenticated and email-link customer approvals belong to the same
-- signing. The existing archive guard still verifies provenance, parties and
-- distinct actors; no role or archive requirement changes.
begin;
create or replace function private.deal_fulfilment_source(d public.deals,a uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare o public.offers;s private.contract_signings;c private.sale_contract_drafts;v private.contract_signing_archives;n integer;
begin
 if d.status not in('draft','reserved','completed')then return jsonb_build_object('source',null,'blockedReason','deal_unavailable');end if;
 select count(*)into n from private.offer_reviews where company_id=d.company_id and deal_id=d.id and status='accepted';
 if n<>1 then return jsonb_build_object('source',null,'blockedReason','accepted_offer_required');end if;
 select x.*into o from public.offers x join private.offer_reviews r on r.company_id=x.company_id and r.offer_id=x.id and r.offer_version=x.version
 where r.company_id=d.company_id and r.deal_id=d.id and r.status='accepted'and x.deal_id=d.id;
 if not found or o.snapshot->>'sale_price_ore' is distinct from d.sale_price_ore::text or o.snapshot->>'deal_id' is distinct from d.id::text
 or o.snapshot#>>'{company,id}'is distinct from d.company_id::text or o.snapshot#>>'{customer,id}'is distinct from d.customer_id::text
 or o.snapshot#>>'{stock,id}'is distinct from d.stock_item_id::text or d.sale_price_ore not between 1 and 999999999999 then raise exception 'Fulfilment source conflict'using errcode='40001';end if;
 -- No invented settlement of trade-in debt, lender payout or negative net cash.
 if o.snapshot?'trade_in'then return jsonb_build_object('source',null,'blockedReason','trade_in_settlement_unsupported');end if;
 select *into s from private.contract_signings where company_id=d.company_id and deal_id=d.id;
 if not found or(select count(*)from private.contract_party_signatures(s.id) where document_hash=s.document_hash and consent_version='2026-10-14')<>2 then return jsonb_build_object('source',null,'blockedReason','contract_required');end if;
 s:=private.require_contract_archive_source(s.id,d.company_id,a,false);
 select *into c from private.sale_contract_drafts where company_id=d.company_id and deal_id=d.id and id=s.draft_id;
 if c.offer_id<>o.id or c.snapshot->'sourceOffer'is distinct from private.offer_review_snapshot(o.snapshot)then raise exception 'Fulfilment contract conflict'using errcode='40001';end if;
 select *into v from private.contract_signing_archives where company_id=d.company_id and deal_id=d.id and signing_id=s.id and draft_id=c.id and document_content_sha256=s.document_hash and signing_revision=3;
 if not found then return jsonb_build_object('source',null,'blockedReason','original_required');end if;
 perform private.check_native_contract_archive_objects(v.pdf_object_path,v.pdf_bytes,v.evidence_object_path,v.evidence_bytes);
 return jsonb_build_object('source',jsonb_build_object('offerId',o.id,'signingId',s.id,'archiveId',v.id,'amountDueOre',d.sale_price_ore::text),'blockedReason',null);
end$$;

commit;
