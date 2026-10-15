begin;
-- Metadata only. The existing protected download handlers remain authoritative.
create index offer_archive_hub_page on public.offer_document_archives(company_id,created_at desc,document_id desc);
create index contract_archive_hub_page on private.contract_signing_archives(company_id,archived_at desc,id desc);
create index issued_invoice_hub_page on private.advertising_issued_invoices(company_id,created_at desc,id desc);
create index credit_invoice_hub_page on private.advertising_credit_invoices(company_id,created_at desc,id desc);
create function private.dealer_document_hub_page(p_company_id uuid,p_query text default '',p_kind text default 'all',p_cursor jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;actor_role text;items jsonb;next_key jsonb;last_time timestamptz;last_id uuid;last_kind text;
begin
 select x.actor,x.actor_role into actor,actor_role from private.internal_inventory_scope(p_company_id,false)x;
 if actor_role not in('owner','admin','finance')then raise exception 'Document access denied'using errcode='42501';end if;
 if p_query is null or length(p_query)>120 or p_query<>btrim(p_query) or p_kind is null or p_kind not in('all','offer','contract','invoice','credit')then raise exception 'Invalid document filter'using errcode='22023';end if;
 if p_cursor is not null then
  if jsonb_typeof(p_cursor) is distinct from 'object' or octet_length(p_cursor::text)>2048 then raise exception 'Invalid document cursor'using errcode='22023';end if;
  if (select count(*)from jsonb_object_keys(p_cursor))<>9 or not p_cursor ?& array['version','companyId','actorId','role','query','kind','createdAt','id','rowKind']
   or p_cursor->'version' is distinct from '1'::jsonb or p_cursor->>'companyId' is distinct from p_company_id::text
   or p_cursor->>'actorId' is distinct from actor::text or p_cursor->>'role' is distinct from actor_role
   or p_cursor->>'query' is distinct from p_query or p_cursor->>'kind' is distinct from p_kind
   or p_cursor->>'rowKind' not in('offer','contract','invoice','credit') or jsonb_typeof(p_cursor->'rowKind') is distinct from 'string'
   or jsonb_typeof(p_cursor->'createdAt') is distinct from 'string' or jsonb_typeof(p_cursor->'id') is distinct from 'string'
  then raise exception 'Invalid document cursor'using errcode='22023';end if;
  begin last_time:=(p_cursor->>'createdAt')::timestamptz;last_id:=(p_cursor->>'id')::uuid;last_kind:=p_cursor->>'rowKind';
   if not isfinite(last_time)then raise exception 'Invalid document cursor'using errcode='22023';end if;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'Invalid document cursor'using errcode='22023';end;
 end if;
 -- No catch-and-empty fallback: a missing/unavailable source fails the entire read.
 with sources as(
  select a.document_id id,'offer'::text kind,a.document_name title,a.created_at occurred,a.document_id download_id from public.offer_document_archives a where a.company_id=p_company_id
  union all
  select a.id,'contract','Avtal v'||a.draft_version::text,a.archived_at,a.signing_id from private.contract_signing_archives a where a.company_id=p_company_id
  union all
  select i.id,'invoice','Faktura '||i.invoice_number,i.created_at,i.id from private.advertising_issued_invoices i where i.company_id=p_company_id
  union all
  select c.id,'credit','Kreditfaktura '||c.credit_number,c.created_at,c.id from private.advertising_credit_invoices c where c.company_id=p_company_id
 ), selected as(
  select * from sources where(p_kind='all'or kind=p_kind)and(p_query=''or position(lower(p_query)in lower(title))>0)
   and(p_cursor is null or(occurred,id,kind)<(last_time,last_id,last_kind))order by occurred desc,id desc,kind desc limit 26
 ), numbered as(select *,row_number()over(order by occurred desc,id desc,kind desc)n from selected)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'title',title,'createdAt',occurred,'downloadId',download_id)order by occurred desc,id desc,kind desc)filter(where n<=25),'[]'::jsonb),
  case when count(*)>25 then(select jsonb_build_object('version',1,'companyId',p_company_id,'actorId',actor,'role',actor_role,'query',p_query,'kind',p_kind,'createdAt',occurred,'id',id,'rowKind',kind)from numbered where n=25)else null end
 into items,next_key from numbered;
 return jsonb_build_object('companyId',p_company_id,'actorId',actor,'role',actor_role,'query',p_query,'kind',p_kind,'rows',items,'nextCursor',next_key);
end$$;
revoke all on function private.dealer_document_hub_page(uuid,text,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function private.dealer_document_hub_page(uuid,text,text,jsonb)to authenticated;
create function public.dealer_document_hub_page(p_company_id uuid,p_query text default '',p_kind text default 'all',p_cursor jsonb default null)
returns jsonb language sql security invoker set search_path='' as $$select private.dealer_document_hub_page(p_company_id,p_query,p_kind,p_cursor)$$;
revoke all on function public.dealer_document_hub_page(uuid,text,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.dealer_document_hub_page(uuid,text,text,jsonb)to authenticated;
commit;
