begin;
create function private.publish_offer_review(p_company_id uuid,p_deal_id uuid,p_offer_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;role_name text;d public.deals;o public.offers;r private.offer_reviews;p jsonb;v jsonb;e text;begin
 select actor,actor_role into a,role_name from private.customer_contact_access(p_company_id,true);
 select * into d from public.deals where company_id=p_company_id and id=p_deal_id for update;
 if not found then raise exception 'Deal access denied' using errcode='42501';end if;
 select * into o from public.offers where company_id=p_company_id and deal_id=p_deal_id and id=p_offer_id;
 if not found then raise exception 'Offer access denied' using errcode='42501';end if;
 p:=jsonb_build_object('action','publish','companyId',p_company_id,'dealId',p_deal_id,'offerId',p_offer_id);
 v:=private.offer_review_replay(a,p_request_id,p);if v is not null then return v;end if;
 e:=lower(btrim(o.snapshot#>>'{customer,email}'));
 if d.status not in ('draft','reserved') or o.version<>(select max(version) from public.offers where company_id=p_company_id and deal_id=p_deal_id) or (o.snapshot->>'valid_until')::date<(clock_timestamp() at time zone 'Europe/Stockholm')::date or exists(select 1 from private.offer_reviews where company_id=p_company_id and offer_id=p_offer_id) then raise exception 'Review publication conflict' using errcode='40001';end if;
 if e is null or length(e)>254 or e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or e ~ '[[:cntrl:]]' or o.snapshot#>>'{stock,vat_scheme}' is null or o.snapshot#>>'{stock,vat_scheme}' not in ('standard','vmb') then raise exception 'Invalid review source' using errcode='22023';end if;
 insert into private.offer_reviews(company_id,deal_id,offer_id,offer_version,recipient_email) values(p_company_id,p_deal_id,p_offer_id,o.version,e) returning * into r;
 v:=jsonb_build_object('companyId',p_company_id,'actorUserId',a,'requestId',p_request_id,'review',private.offer_review_json(r));
 insert into private.offer_review_audit(company_id,actor_user_id,request_id,payload,receipt)values(p_company_id,a,p_request_id,p,v);return v;end $$;
create function private.withdraw_offer_review(p_company_id uuid,p_deal_id uuid,p_review_id uuid,p_expected_version integer,p_reason text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;role_name text;r private.offer_reviews;p jsonb;v jsonb;begin
 select actor,actor_role into a,role_name from private.customer_contact_access(p_company_id,true);
 perform 1 from public.deals where company_id=p_company_id and id=p_deal_id for update;
 if not found then raise exception 'Deal access denied' using errcode='42501';end if;
 select * into r from private.offer_reviews where company_id=p_company_id and deal_id=p_deal_id and id=p_review_id for update;
 if not found then raise exception 'Review access denied' using errcode='42501';end if;
 if p_expected_version is null or p_expected_version<1 or p_reason is null or p_reason<>btrim(p_reason) or length(p_reason) not between 2 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception 'Invalid withdrawal' using errcode='22023';end if;
 p:=jsonb_build_object('action','withdraw','companyId',p_company_id,'dealId',p_deal_id,'reviewId',p_review_id,'expectedVersion',p_expected_version,'reason',p_reason);
 v:=private.offer_review_replay(a,p_request_id,p);if v is not null then return v;end if;
 if r.status<>'pending' or r.version<>p_expected_version or r.version=2147483647 then raise exception 'Review conflict' using errcode='40001';end if;
 update private.offer_reviews set status='withdrawn',version=version+1,decided_at=clock_timestamp(),reason=p_reason where id=r.id returning * into r;
 v:=jsonb_build_object('companyId',p_company_id,'actorUserId',a,'requestId',p_request_id,'review',private.offer_review_json(r));
 insert into private.offer_review_audit(company_id,actor_user_id,request_id,payload,receipt)values(p_company_id,a,p_request_id,p,v);return v;end $$;
create function public.publish_offer_review(p_company_id uuid,p_deal_id uuid,p_offer_id uuid,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.publish_offer_review(p_company_id,p_deal_id,p_offer_id,p_request_id);$$;
create function public.withdraw_offer_review(p_company_id uuid,p_deal_id uuid,p_review_id uuid,p_expected_version integer,p_reason text,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.withdraw_offer_review(p_company_id,p_deal_id,p_review_id,p_expected_version,p_reason,p_request_id);$$;
revoke all on function private.publish_offer_review(uuid,uuid,uuid,uuid),private.withdraw_offer_review(uuid,uuid,uuid,integer,text,uuid),public.publish_offer_review(uuid,uuid,uuid,uuid),public.withdraw_offer_review(uuid,uuid,uuid,integer,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.publish_offer_review(uuid,uuid,uuid,uuid),private.withdraw_offer_review(uuid,uuid,uuid,integer,text,uuid),public.publish_offer_review(uuid,uuid,uuid,uuid),public.withdraw_offer_review(uuid,uuid,uuid,integer,text,uuid) to authenticated;
commit;
