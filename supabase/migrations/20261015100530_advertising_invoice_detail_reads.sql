begin;
create function private.get_advertising_invoice_draft(p_company uuid,p_id uuid,p_platform boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare mr text;draft private.advertising_invoice_drafts;source jsonb;
begin
 mr:=private.advertising_invoice_context(p_company,p_platform);
 select * into draft from private.advertising_invoice_drafts where company_id=p_company and id=p_id;
 if not found then raise exception 'Invoice draft missing' using errcode='42501';end if;
 source:=private.advertising_invoice_source(p_company,draft.month,p_platform);
 return jsonb_build_object('companyId',p_company,'actorUserId',auth.uid(),'actorRole',mr,'draft',private.advertising_invoice_draft_json(draft),'isOutdated',draft.source_hash<>source->>'sourceHash');
end $$;
revoke all on function private.get_advertising_invoice_draft(uuid,uuid,boolean) from public,anon,service_role;
grant execute on function private.get_advertising_invoice_draft(uuid,uuid,boolean) to authenticated;
commit;
