begin;
-- Inventory only. Catalog metadata is not proof of byte integrity, retention,
-- or the absence of an interrupted/in-flight upload. Nothing is deletable here.
create function private.get_private_document_inventory(p_after_bucket text default null,p_after_path text default null,p_limit integer default 50) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;items jsonb;last_bucket text;last_path text;more boolean;begin
 select i.user_id into actor from private.company_team_identity(true)i;
 perform 1 from private.platform_admins where user_id=actor and status='active' for share;
 if not found then raise exception 'Platform access denied' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 50 or (p_after_bucket is null)<>(p_after_path is null)
 or (p_after_bucket is not null and (p_after_bucket not in ('native-contract-originals','uploaded-contracts','dealer-documents') or length(p_after_path) not between 1 and 4096)) then raise exception 'Invalid inventory cursor' using errcode='22023';end if;
 with refs as (
  select 'native-contract-originals'::text bucket,pdf_object_path path from private.contract_signing_archives
  union select 'native-contract-originals',evidence_object_path from private.contract_signing_archives
  union select 'uploaded-contracts',object_path from private.uploaded_pdf_sources
  union select 'uploaded-contracts',pdf_path from private.uploaded_pdf_artifacts
  union select 'uploaded-contracts',evidence_path from private.uploaded_pdf_artifacts
  union select 'dealer-documents',object_path from public.offer_document_archives
  union select 'dealer-documents',object_path from public.documents
 ), objects as (
  select bucket_id bucket,name path,id,created_at from storage.objects where bucket_id in ('native-contract-originals','uploaded-contracts','dealer-documents')
 ), inventory as (
  select coalesce(o.bucket,r.bucket) bucket,coalesce(o.path,r.path) path,o.id,o.created_at,r.path is not null registered
  from objects o full join refs r using(bucket,path)
 ), selected as (
  select * from inventory where p_after_bucket is null or (bucket,path)>(p_after_bucket,p_after_path) order by bucket,path limit p_limit+1
 )select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket,'objectPath',path,'objectId',id,'createdAt',created_at,
  'registrationState',case when not registered then 'unregistered' when id is null then 'registered_missing' else 'registered_present' end,
  'bucketIsPrivate',exists(select 1 from storage.buckets b where b.id=bucket and b.public=false),
  'attemptState','unknown','canDelete',false) order by bucket,path),'[]') into items from selected;
 more:=jsonb_array_length(items)>p_limit;
 if more then items:=items- p_limit;last_bucket:=items->-1->>'bucket';last_path:=items->-1->>'objectPath';end if;
 return jsonb_build_object('actorUserId',actor,'generatedAt',statement_timestamp(),'items',items,'nextCursor',case when more then jsonb_build_object('bucket',last_bucket,'objectPath',last_path) else null end);
end $$;
revoke all on function private.get_private_document_inventory(text,text,integer) from public,anon,service_role;
grant execute on function private.get_private_document_inventory(text,text,integer) to authenticated;
create function public.get_private_document_inventory(p_after_bucket text default null,p_after_path text default null,p_limit integer default 50) returns jsonb language sql security invoker set search_path='' as $$select private.get_private_document_inventory(p_after_bucket,p_after_path,p_limit)$$;
revoke all on function public.get_private_document_inventory(text,text,integer) from public,anon,service_role;
grant execute on function public.get_private_document_inventory(text,text,integer) to authenticated;
commit;
