begin;
create function private.advertising_invoice_profile(p_company uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r private.advertising_invoice_profiles;f jsonb:=jsonb_build_object('legalName',null,'organisationNumber',null,'invoiceEmail',null,'addressLine1',null,'addressLine2',null,'postalCode',null,'city',null,'countryCode',null,'reference',null);begin
 select * into r from private.advertising_invoice_profiles where scope_key=coalesce(p_company::text,'seller') order by version desc limit 1;
 if found then f:=r.fields;end if;
 if p_company is not null then f:=f|| (select jsonb_build_object('legalName',name,'organisationNumber',organisation_number) from public.companies where id=p_company);end if;
 return jsonb_build_object('kind',case when p_company is null then 'seller' else 'buyer' end,'companyId',p_company,'version',coalesce(r.version,0),'fields',f,'missingFields',private.advertising_invoice_missing(f),'updatedAt',r.created_at);
end $$;
create function private.advertising_invoice_source(p_company uuid,p_month text,p_platform boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare b jsonb;s jsonb;c jsonb;basis jsonb;snapshot jsonb;missing jsonb;
begin
 b:=private.advertising_invoice_profile(p_company);s:=private.advertising_invoice_profile(null);
 c:=private.advertising_corrections_read(p_company,p_month,p_platform);
 basis:=jsonb_build_object('companyId',c->'companyId','month',c->'month','original',c->'original','adjustments',c->'adjustments','reductionTotalOre',c->'reductionTotalOre','netTotalOre',c->'netTotalOre','reviewToken',c->'reviewToken','canonicalSnapshot',c->'canonicalSnapshot');
 select coalesce(jsonb_agg('buyer.'||v order by n),'[]') into missing from jsonb_array_elements_text(b->'missingFields') with ordinality x(v,n);
 missing:=missing||(select coalesce(jsonb_agg('seller.'||v order by n),'[]') from jsonb_array_elements_text(s->'missingFields') with ordinality x(v,n))||'["vatTreatment"]'::jsonb;
 snapshot:=jsonb_build_object('status','draft','currency','SEK','vatStatus','unresolved','companyId',p_company,'month',p_month,'buyerProfile',b-array['kind','companyId','updatedAt'],'sellerProfile',s-array['kind','companyId','updatedAt'],'basis',basis,'missingFields',missing);
 return jsonb_build_object('buyerProfile',b,'sellerProfile',s,'basis',basis,'snapshot',snapshot,'canonicalSnapshot',snapshot::text,'sourceHash',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'));
end $$;
create function private.advertising_invoice_page(p_company uuid,p_month text,p_platform boolean,p_before integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare mr text;source jsonb;drafts jsonb:='[]';r record;n integer:=0;last_version integer;next_version integer:=null;
begin
 mr:=private.advertising_invoice_context(p_company,p_platform);
 if p_before is not null and p_before<1 then raise exception 'Invalid cursor' using errcode='22023';end if;
 source:=private.advertising_invoice_source(p_company,p_month,p_platform);
 if p_before is not null and not exists(select 1 from private.advertising_invoice_drafts where company_id=p_company and month=p_month and version=p_before) then raise exception 'Invalid cursor scope' using errcode='22023';end if;
 for r in select id,version,created_at,source_hash,snapshot->'missingFields' as missing from private.advertising_invoice_drafts where company_id=p_company and month=p_month and (p_before is null or version<p_before) order by version desc limit 21 loop
  if n=20 then next_version:=last_version;exit;end if;
  drafts:=drafts||jsonb_build_array(jsonb_build_object('id',r.id,'version',r.version,'createdAt',r.created_at,'sourceHash',r.source_hash,'missingFields',r.missing,'isOutdated',r.source_hash<>source->>'sourceHash'));n:=n+1;last_version:=r.version;
 end loop;
 return jsonb_build_object('companyId',p_company,'actorUserId',auth.uid(),'actorRole',mr,'month',p_month,'buyerProfile',source->'buyerProfile','sellerProfile',source->'sellerProfile','canEditBuyer',mr in ('platform_admin','owner','admin'),'canEditSeller',mr='platform_admin','basis',source->'basis','reviewToken',source->>'sourceHash','canonicalSnapshot',source->>'canonicalSnapshot','drafts',drafts,'nextBeforeVersion',next_version);
end $$;
revoke all on function private.advertising_invoice_profile(uuid),private.advertising_invoice_source(uuid,text,boolean) from public,anon,authenticated,service_role;
revoke all on function private.advertising_invoice_page(uuid,text,boolean,integer) from public,anon,service_role;
grant execute on function private.advertising_invoice_page(uuid,text,boolean,integer) to authenticated;
commit;
