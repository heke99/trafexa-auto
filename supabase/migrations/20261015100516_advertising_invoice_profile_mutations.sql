begin;
create function private.save_advertising_invoice_profile(p_company uuid,p_fields jsonb,p_expected integer,p_request uuid,p_platform boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();mr text;r private.advertising_invoice_profiles;payload jsonb;f jsonb;v integer;profile jsonb;
begin
 mr:=private.advertising_invoice_context(p_company,p_platform);
 if p_company is not null and mr not in ('platform_admin','owner','admin') then raise exception 'Buyer edit not permitted' using errcode='42501';end if;
 f:=private.advertising_invoice_fields(p_fields,p_company is not null);
 if p_expected is null or p_expected<0 or p_expected>=2147483647 or p_request is null then raise exception 'Invalid profile version' using errcode='22023';end if;
 payload:=jsonb_build_object('companyId',p_company,'fields',f,'expectedVersion',p_expected);
 select * into r from private.advertising_invoice_profiles where created_by=actor and request_id=p_request;
 if found then
  if r.payload<>payload then raise exception 'Profile request reused' using errcode='40001';end if;
 else
  select coalesce(max(version),0) into v from private.advertising_invoice_profiles where scope_key=coalesce(p_company::text,'seller');
  if v<>p_expected then raise exception 'Profile changed' using errcode='40001';end if;
  if p_company is not null then f:=f||(select jsonb_build_object('legalName',name,'organisationNumber',organisation_number) from public.companies where id=p_company);end if;
  insert into private.advertising_invoice_profiles(kind,company_id,scope_key,version,fields,created_by,request_id,payload) values(case when p_company is null then 'seller' else 'buyer' end,p_company,coalesce(p_company::text,'seller'),v+1,f,actor,p_request,payload) returning * into r;
 end if;
 profile:=jsonb_build_object('kind',r.kind,'companyId',r.company_id,'version',r.version,'fields',r.fields,'missingFields',private.advertising_invoice_missing(r.fields),'updatedAt',r.created_at);
 return jsonb_build_object('profile',profile,'receipt',jsonb_build_object('profileId',r.id,'kind',r.kind,'companyId',r.company_id,'actorUserId',actor,'requestId',r.request_id));
end $$;
revoke all on function private.save_advertising_invoice_profile(uuid,jsonb,integer,uuid,boolean) from public,anon,service_role;
grant execute on function private.save_advertising_invoice_profile(uuid,jsonb,integer,uuid,boolean) to authenticated;
commit;
