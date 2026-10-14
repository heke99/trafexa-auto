begin;
create function private.respond_offer_review(p_review_id uuid,p_expected_version integer,p_decision text,p_responder_name text,p_reason text,p_ack_version text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;e text;r private.offer_reviews;scope_company uuid;scope_deal uuid;p jsonb;v jsonb;s text;begin
 select user_id,email into a,e from private.company_team_identity(true);
 select company_id,deal_id into scope_company,scope_deal from private.offer_reviews where id=p_review_id and recipient_email=e;
 if not found then raise exception 'Review access denied' using errcode='42501';end if;
 select status into s from public.companies where id=scope_company for share;
 if s is distinct from 'active' then raise exception 'Company access denied' using errcode='42501';end if;
 perform 1 from public.deals where company_id=scope_company and id=scope_deal for update;
 select * into r from private.offer_reviews where id=p_review_id and company_id=scope_company and deal_id=scope_deal and recipient_email=e for update;
 if not found then raise exception 'Review access denied' using errcode='42501';end if;
 if p_expected_version is null or p_expected_version<1 or p_decision is null or p_decision not in ('accepted','declined') or p_responder_name is null or p_responder_name<>btrim(p_responder_name) or length(p_responder_name) not between 2 and 160 or p_responder_name ~ '[[:cntrl:]]' or p_ack_version is distinct from '2026-10-14' or (p_decision='accepted' and p_reason is not null) or (p_decision='declined' and (p_reason is null or p_reason<>btrim(p_reason) or length(p_reason) not between 2 and 500 or p_reason ~ '[[:cntrl:]]')) then raise exception 'Invalid response' using errcode='22023';end if;
 p:=jsonb_build_object('action','respond','reviewId',p_review_id,'expectedVersion',p_expected_version,'decision',p_decision,'responderName',p_responder_name,'reason',p_reason,'ackVersion',p_ack_version,'recipientEmail',e);
 v:=private.offer_review_replay(a,p_request_id,p);if v is not null then return v;end if;
 if r.version<>p_expected_version or r.version=2147483647 or private.offer_review_json(r)->>'status'<>'pending' then raise exception 'Review conflict' using errcode='40001';end if;
 update private.offer_reviews set status=p_decision,version=version+1,decided_at=clock_timestamp(),responder_name=p_responder_name,reason=p_reason where id=r.id returning * into r;
 v:=jsonb_build_object('actorUserId',a,'requestId',p_request_id,'review',private.offer_review_json(r,true));
 insert into private.offer_review_audit(company_id,actor_user_id,request_id,payload,receipt)values(scope_company,a,p_request_id,p,v);return v;end $$;
create function public.respond_offer_review(p_review_id uuid,p_expected_version integer,p_decision text,p_responder_name text,p_reason text,p_ack_version text,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.respond_offer_review(p_review_id,p_expected_version,p_decision,p_responder_name,p_reason,p_ack_version,p_request_id);$$;
revoke all on function private.respond_offer_review(uuid,integer,text,text,text,text,uuid),public.respond_offer_review(uuid,integer,text,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.respond_offer_review(uuid,integer,text,text,text,text,uuid),public.respond_offer_review(uuid,integer,text,text,text,text,uuid) to authenticated;
commit;
