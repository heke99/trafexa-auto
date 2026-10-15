begin;
create function private.advertising_financial_outdated(p_company uuid,p_draft uuid,p_settings_token text,p_platform boolean) returns boolean language plpgsql security invoker set search_path='' as $$
declare detail jsonb;settings jsonb;begin
 detail:=private.get_advertising_invoice_draft(p_company,p_draft,p_platform);settings:=private.advertising_financial_settings_current(p_company);
 return (detail->>'isOutdated')::boolean or settings->>'reviewToken'<>p_settings_token;
end $$;
create function private.advertising_financial_page(p_company uuid,p_month text,p_draft uuid,p_before integer,p_platform boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare mr text;source jsonb;items jsonb:='[]';r record;n integer:=0;last_version integer;next_version integer:=null;
begin
 mr:=private.advertising_invoice_context(p_company,p_platform);
 if p_month is null or p_month !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' or (p_before is not null and p_before<1) then raise exception 'Invalid financial page' using errcode='22023';end if;
 source:=private.advertising_financial_source(p_company,p_draft,p_platform);
 if p_draft is not null and source->'draft'->>'month'<>p_month then raise exception 'Wrong draft period' using errcode='22023';end if;
 if p_before is not null and not exists(select 1 from private.advertising_financial_assessments where company_id=p_company and month=p_month and version=p_before) then raise exception 'Invalid financial cursor' using errcode='22023';end if;
 for r in select id,version,created_at,source_hash,draft_id,snapshot->'draft'->'version' as draft_version,snapshot->'settings'->>'reviewToken' as settings_token from private.advertising_financial_assessments where company_id=p_company and month=p_month and (p_before is null or version<p_before) order by version desc limit 21 loop
  if n=20 then next_version:=last_version;exit;end if;
  items:=items||jsonb_build_array(jsonb_build_object('id',r.id,'version',r.version,'createdAt',r.created_at,'sourceHash',r.source_hash,'draftId',r.draft_id,'draftVersion',r.draft_version,'isOutdated',private.advertising_financial_outdated(p_company,r.draft_id,r.settings_token,p_platform)));n:=n+1;last_version:=r.version;
 end loop;
 return source||jsonb_build_object('companyId',p_company,'actorUserId',auth.uid(),'actorRole',mr,'month',p_month,'canCreateAssessment',mr='platform_admin' and p_draft is not null and source->'preview'->'blockers'='[]'::jsonb,'assessments',items,'nextBeforeVersion',next_version);
end $$;
create function private.get_advertising_financial_assessment(p_company uuid,p_id uuid,p_platform boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare mr text;r private.advertising_financial_assessments;begin
 mr:=private.advertising_invoice_context(p_company,p_platform);
 select * into r from private.advertising_financial_assessments where id=p_id and company_id=p_company;
 if not found then raise exception 'Financial assessment missing' using errcode='42501';end if;
 return jsonb_build_object('companyId',p_company,'actorUserId',auth.uid(),'actorRole',mr,'assessment',private.advertising_financial_assessment_json(r),'isOutdated',private.advertising_financial_outdated(p_company,r.draft_id,r.snapshot->'settings'->>'reviewToken',p_platform));
end $$;
revoke all on function private.advertising_financial_outdated(uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
revoke all on function private.advertising_financial_page(uuid,text,uuid,integer,boolean),private.get_advertising_financial_assessment(uuid,uuid,boolean) from public,anon,service_role;
grant execute on function private.advertising_financial_page(uuid,text,uuid,integer,boolean),private.get_advertising_financial_assessment(uuid,uuid,boolean) to authenticated;
commit;
