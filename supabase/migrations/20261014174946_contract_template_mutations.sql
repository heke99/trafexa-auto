begin;
create function private.create_contract_template_version(p_company_id uuid,p_template_id uuid,p_expected_version integer,p_title text,p_body text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;r text;p jsonb;receipt jsonb;t private.sale_contract_template_versions;latest integer;begin
 select actor,actor_role into a,r from private.sale_contract_access(p_company_id,true);
 if p_template_id is null or p_expected_version is null or p_expected_version not between 0 and 2147483646 or p_title is null or length(p_title) not between 2 and 160 or p_title<>btrim(p_title) or p_title ~ '[[:cntrl:]]' or not private.sale_contract_body_valid(p_body) then raise exception 'Invalid contract template' using errcode='22023';end if;
 p:=jsonb_build_object('operation','createTemplate','company',p_company_id,'template',p_template_id,'expectedVersion',p_expected_version,'title',p_title,'body',p_body);
 receipt:=private.sale_contract_replay(a,p_request_id,p);if receipt is not null then return receipt;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||p_template_id::text,1));
 select coalesce(max(version),0) into latest from private.sale_contract_template_versions where company_id=p_company_id and template_id=p_template_id;
 if latest<>p_expected_version then raise exception 'Template version conflict' using errcode='40001';end if;
 insert into private.sale_contract_template_versions(company_id,template_id,version,title,body,created_by)values(p_company_id,p_template_id,latest+1,p_title,p_body,a) returning * into t;
 receipt:=jsonb_build_object('companyId',p_company_id,'actorUserId',a,'requestId',p_request_id,'template',private.sale_contract_template_json(t));
 insert into private.sale_contract_audit(company_id,actor_user_id,request_id,payload,receipt)values(p_company_id,a,p_request_id,p,receipt);return receipt;
end$$;
create function private.review_contract_template(p_company_id uuid,p_template_version_id uuid,p_expected_approval_version integer,p_status text,p_reason text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;r text;p jsonb;receipt jsonb;t private.sale_contract_template_versions;tid uuid;superseded jsonb;begin
 select actor,actor_role into a,r from private.sale_contract_access(p_company_id,true);
 if p_expected_approval_version is null or p_expected_approval_version not between 1 and 2147483646 or p_status is null or p_status not in ('approved','retired') or p_reason is null or length(p_reason) not between 2 and 500 or p_reason<>btrim(p_reason) or p_reason ~ '[[:cntrl:]]' then raise exception 'Invalid template review' using errcode='22023';end if;
 p:=jsonb_build_object('operation','reviewTemplate','company',p_company_id,'templateVersionId',p_template_version_id,'expectedApprovalVersion',p_expected_approval_version,'status',p_status,'reason',p_reason);
 receipt:=private.sale_contract_replay(a,p_request_id,p);if receipt is not null then return receipt;end if;
 select template_id into tid from private.sale_contract_template_versions where company_id=p_company_id and id=p_template_version_id;
 if not found then raise exception 'Template access denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||tid::text,1));
 select * into t from private.sale_contract_template_versions where company_id=p_company_id and id=p_template_version_id for update;
 if t.approval_version<>p_expected_approval_version or t.status='retired' or t.status=p_status or(p_status='approved' and t.version<>(select max(version) from private.sale_contract_template_versions where company_id=p_company_id and template_id=tid)) then raise exception 'Template approval conflict' using errcode='40001';end if;
 if p_status='approved' then
 select coalesce(jsonb_agg(private.sale_contract_template_json(x)),'[]') into superseded from private.sale_contract_template_versions x where company_id=p_company_id and template_id=tid and status='approved';
 update private.sale_contract_template_versions set status='retired',approval_version=approval_version+1 where company_id=p_company_id and template_id=tid and status='approved';end if;
 update private.sale_contract_template_versions set status=p_status,approval_version=approval_version+1,approved_at=case when p_status='approved' then clock_timestamp() else approved_at end where id=t.id returning * into t;
 receipt:=jsonb_build_object('companyId',p_company_id,'actorUserId',a,'requestId',p_request_id,'template',private.sale_contract_template_json(t),'superseded',superseded);
 insert into private.sale_contract_audit(company_id,actor_user_id,request_id,payload,receipt)values(p_company_id,a,p_request_id,p,receipt);return receipt;
end$$;
revoke all on function private.create_contract_template_version(uuid,uuid,integer,text,text,uuid),private.review_contract_template(uuid,uuid,integer,text,text,uuid) from public,anon,authenticated,service_role;
commit;
