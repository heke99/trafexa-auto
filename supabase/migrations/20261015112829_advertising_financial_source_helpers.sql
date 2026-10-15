begin;
create function private.advertising_financial_settings_current(p_company uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r private.advertising_financial_settings;f jsonb;snapshot jsonb;canonical text;token text;
begin
 select * into r from private.advertising_financial_settings where company_id=p_company order by version desc limit 1;
 if found then f:=r.fields;canonical:=r.canonical_snapshot;token:=r.review_token;
 else f:=jsonb_build_object('vatTreatment','unresolved','sellerVatRegistered',null,'sellerVatNumber',null,'paymentDays',null,'paymentMethod','unresolved','paymentAccount',null,'reason',null);snapshot:=jsonb_build_object('companyId',p_company,'version',0,'fields',f);canonical:=snapshot::text;token:=encode(sha256(convert_to(canonical,'UTF8')),'hex');end if;
 return jsonb_build_object('companyId',p_company,'version',coalesce(r.version,0),'fields',f,'reviewToken',token,'canonicalSnapshot',canonical,'updatedAt',r.created_at);
end $$;
create function private.advertising_financial_source(p_company uuid,p_draft uuid,p_platform boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare settings jsonb;detail jsonb;draft jsonb;preview jsonb;source jsonb;
begin
 settings:=private.advertising_financial_settings_current(p_company);
 if p_draft is null then return jsonb_build_object('settings',settings,'draft',null,'draftIsOutdated',null,'preview',null,'reviewToken',null,'reviewCanonicalSnapshot',null);end if;
 detail:=private.get_advertising_invoice_draft(p_company,p_draft,p_platform);draft:=detail->'draft';
 preview:=private.advertising_financial_preview(draft,settings->'fields');
 if (detail->>'isOutdated')::boolean then preview:=jsonb_set(preview,'{blockers}',(preview->'blockers')||'["draft.outdated"]'::jsonb);end if;
 source:=jsonb_build_object('companyId',p_company,'month',draft->'month','draftId',p_draft,'draftSourceHash',draft->>'sourceHash','settingsVersion',settings->'version','settingsReviewToken',settings->>'reviewToken','calculationVersion',1);
 return jsonb_build_object('settings',settings,'draft',draft,'draftIsOutdated',detail->'isOutdated','preview',preview,'reviewToken',encode(sha256(convert_to(source::text,'UTF8')),'hex'),'reviewCanonicalSnapshot',source::text);
end $$;
create function private.advertising_financial_assessment_json(p_row private.advertising_financial_assessments) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'companyId',p_row.company_id,'month',p_row.month,'version',p_row.version,'createdAt',p_row.created_at,'sourceHash',p_row.source_hash,'snapshot',p_row.snapshot,'canonicalSnapshot',p_row.canonical_snapshot);
$$;
revoke all on function private.advertising_financial_settings_current(uuid),private.advertising_financial_source(uuid,uuid,boolean),private.advertising_financial_assessment_json(private.advertising_financial_assessments) from public,anon,authenticated,service_role;
commit;
