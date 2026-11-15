begin;
-- Removing an unsigned draft changes list visibility, never erases its originals.
create table private.deal_list_removals(
 company_id uuid not null,deal_id uuid not null,actor_id uuid not null references auth.users(id),request_id uuid not null,
 payload jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(company_id,deal_id),unique(actor_id,request_id),foreign key(company_id,deal_id)references public.deals(company_id,id));
alter table private.deal_list_removals enable row level security;
revoke all on private.deal_list_removals from public,anon,authenticated,service_role;
create trigger deal_list_removal_immutable before update or delete on private.deal_list_removals for each row execute function private.sale_contract_immutable();
create function private.deal_is_removed(p_company uuid,p_deal uuid)returns boolean language sql stable security definer set search_path=''as $$select exists(select 1 from private.deal_list_removals where company_id=p_company and deal_id=p_deal);$$;
revoke all on function private.deal_is_removed(uuid,uuid)from public,anon,authenticated,service_role;
create or replace function private.deal_is_archived(p_company_id uuid,p_deal_id uuid)returns boolean language sql stable security definer set search_path=''as $$select private.deal_is_removed(p_company_id,p_deal_id)or coalesce((select archived from private.deal_archive_states where company_id=p_company_id and deal_id=p_deal_id),false);$$;
create function private.deal_native_fully_signed(s private.contract_signings)returns boolean language sql stable security invoker set search_path=''as $$select count(distinct p.party)=2 from private.contract_party_signatures(s.id)p where p.document_hash=s.document_hash and p.party in('company','customer');$$;
create function private.deal_pdf_fully_signed(s private.uploaded_pdf_sources)returns boolean language sql stable security invoker set search_path=''as $$select count(distinct p.party)=2 from private.uploaded_pdf_signatures p where p.source_id=s.id and p.document_hash=s.document_hash and p.party in('company','customer');$$;
revoke all on function private.deal_native_fully_signed(private.contract_signings),private.deal_pdf_fully_signed(private.uploaded_pdf_sources)from public,anon,authenticated,service_role;

-- Future business relations default to protected; only retained technical
-- draft/valuation/archive/reservation history is explicitly removable from lists.
create function private.deal_has_business_history(d public.deals)returns boolean language plpgsql stable security invoker set search_path=''as $$
declare rel record;predicate text;present boolean;
begin
 if exists(select 1 from private.uploaded_pdf_sources s join private.uploaded_pdf_signatures p on p.source_id=s.id where s.company_id=d.company_id and s.deal_id=d.id)then return true;end if;
 for rel in
  select n.nspname,c.relname,string_agg(format('r.%I::text = ($1 ->> %L)',child.attname,parent.attname),' and 'order by k.ord)predicate
  from pg_catalog.pg_constraint f join pg_catalog.pg_class c on c.oid=f.conrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  cross join lateral unnest(f.conkey,f.confkey)with ordinality k(child_id,parent_id,ord)
  join pg_catalog.pg_attribute child on child.attrelid=f.conrelid and child.attnum=k.child_id
  join pg_catalog.pg_attribute parent on parent.attrelid=f.confrelid and parent.attnum=k.parent_id
  where f.contype='f'and f.confrelid='public.deals'::regclass
   and(n.nspname||'.'||c.relname)not in('public.activities','public.offers','public.reservations','private.sale_contract_drafts','private.direct_deal_reviews','private.trade_in_versions','private.uploaded_pdf_sources','private.pdf_template_generations','private.deal_archive_states','private.deal_archive_audit','private.deal_cancellation_audit')
  group by f.oid,n.nspname,c.relname
 loop
  execute format('select exists(select 1 from %I.%I r where %s)',rel.nspname,rel.relname,rel.predicate)into present using to_jsonb(d);
  if present then return true;end if;
 end loop;
 return false;
end$$;
revoke all on function private.deal_has_business_history(public.deals)from public,anon,authenticated,service_role;
create function private.deal_delete_page(d public.deals,a uuid,r text)returns jsonb language plpgsql volatile security invoker set search_path=''as $$
declare why text;basis jsonb;
begin
 why:=case when exists(select 1 from public.reservations where company_id=d.company_id and deal_id=d.id and status='active')or d.status='reserved'then 'active_reservation'when d.status not in('draft','cancelled')then 'not_draft'when private.deal_is_removed(d.company_id,d.id)or private.deal_has_business_history(d)then 'business_history'else null end;
 basis:=jsonb_build_object('deal',to_jsonb(d),'archived',private.deal_is_archived(d.company_id,d.id),'blockedReason',why,'revisions',jsonb_build_array((select count(*)from public.offers where company_id=d.company_id and deal_id=d.id),(select count(*)from private.sale_contract_drafts where company_id=d.company_id and deal_id=d.id),(select count(*)from private.direct_deal_reviews where company_id=d.company_id and deal_id=d.id),(select count(*)from private.uploaded_pdf_sources where company_id=d.company_id and deal_id=d.id)));
 return jsonb_build_object('companyId',d.company_id,'dealId',d.id,'actorId',a,'role',r,'canDelete',why is null and r in('owner','admin'),'blockedReason',why,'reviewHash',encode(sha256(convert_to(basis::text,'UTF8')),'hex'));
end$$;
revoke all on function private.deal_delete_page(public.deals,uuid,text)from public,anon,authenticated,service_role;
create function private.get_deal_delete(p_company_id uuid,p_deal_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid;r text;d public.deals;stock uuid;
begin
 select x.actor,x.actor_role into a,r from private.internal_inventory_scope(p_company_id,false)x;
 select stock_item_id into stock from public.deals where company_id=p_company_id and id=p_deal_id;
 perform 1 from public.stock_items where company_id=p_company_id and id=stock for share;
 select *into d from public.deals where company_id=p_company_id and id=p_deal_id for share;
 if not found then raise exception 'Deal access denied'using errcode='42501';end if;
 return private.deal_delete_page(d,a,r);
end$$;
create function private.mutate_deal_delete(p_company_id uuid,p_deal_id uuid,p_input jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid;r text;d public.deals;stock uuid;page jsonb;req uuid;old private.deal_list_removals;receipt jsonb;
begin
 select x.actor,x.actor_role into a,r from private.internal_inventory_scope(p_company_id,true)x;
 if jsonb_typeof(p_input)is distinct from'object'or(p_input-array['companyId','dealId','reviewHash','acknowledged','requestId'])<>'{}'::jsonb or p_input->>'companyId'is distinct from p_company_id::text or p_input->>'dealId'is distinct from p_deal_id::text or p_input->'acknowledged'is distinct from'true'::jsonb or coalesce(p_input->>'requestId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'or coalesce(p_input->>'reviewHash','')!~'^[a-f0-9]{64}$'then raise exception 'Invalid removal review'using errcode='22023';end if;
 req:=(p_input->>'requestId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(a::text||req::text,515));
 select *into old from private.deal_list_removals where actor_id=a and request_id=req;
 if found then if old.payload is distinct from p_input then raise exception 'Removal request conflict'using errcode='40001';end if;return old.receipt;end if;
 select stock_item_id into stock from public.deals where company_id=p_company_id and id=p_deal_id;
 perform 1 from public.stock_items where company_id=p_company_id and id=stock for update;
 select *into d from public.deals where company_id=p_company_id and id=p_deal_id for update;
 if not found then raise exception 'Deal access denied'using errcode='42501';end if;
 page:=private.deal_delete_page(d,a,r);
 if page->'canDelete'is distinct from'true'::jsonb or page->>'reviewHash'<>p_input->>'reviewHash'then raise exception 'Removal source changed'using errcode='40001';end if;
 receipt:=jsonb_build_object('companyId',p_company_id,'dealId',p_deal_id,'actorId',a,'deleted',true,'requestId',req);
 insert into private.deal_list_removals(company_id,deal_id,actor_id,request_id,payload,receipt)values(p_company_id,p_deal_id,a,req,p_input,receipt);
 return receipt;
end$$;
revoke all on function private.get_deal_delete(uuid,uuid),private.mutate_deal_delete(uuid,uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function private.get_deal_delete(uuid,uuid),private.mutate_deal_delete(uuid,uuid,jsonb)to authenticated;
create function public.get_deal_delete(p_company_id uuid,p_deal_id uuid)returns jsonb language sql security invoker set search_path=''as $$select private.get_deal_delete(p_company_id,p_deal_id);$$;
create function public.mutate_deal_delete(p_company_id uuid,p_deal_id uuid,p_input jsonb)returns jsonb language sql security invoker set search_path=''as $$select private.mutate_deal_delete(p_company_id,p_deal_id,p_input);$$;
revoke all on function public.get_deal_delete(uuid,uuid),public.mutate_deal_delete(uuid,uuid,jsonb)from public,anon,service_role;
grant execute on function public.get_deal_delete(uuid,uuid),public.mutate_deal_delete(uuid,uuid,jsonb)to authenticated;

create or replace function private.deal_archive_page(d public.deals,a uuid,r text)returns jsonb language plpgsql volatile security invoker set search_path=''as $$
declare is_archived boolean;v integer;why text;reserved boolean;live_contract boolean;money boolean;review jsonb;
begin
 if private.deal_is_removed(d.company_id,d.id)then raise exception 'Removed deal unavailable'using errcode='42501';end if;
 select archived,version into is_archived,v from private.deal_archive_states where company_id=d.company_id and deal_id=d.id;
 is_archived:=coalesce(is_archived,false);v:=coalesce(v,0);
 reserved:=d.status='reserved' or exists(select 1 from public.reservations where company_id=d.company_id and deal_id=d.id and status='active');
 live_contract:=d.status not in('completed','cancelled') and(
 exists(select 1 from private.contract_signings s where s.company_id=d.company_id and s.deal_id=d.id and not private.deal_native_fully_signed(s))
 or exists(select 1 from private.offer_reviews o where o.company_id=d.company_id and o.deal_id=d.id and(o.status='pending'or(o.status='accepted'and not exists(select 1 from private.contract_signings s join private.sale_contract_drafts v on v.id=s.draft_id and v.company_id=s.company_id where s.company_id=d.company_id and s.deal_id=d.id and v.offer_id=o.offer_id and private.deal_native_fully_signed(s)))))
 or exists(select 1 from private.uploaded_pdf_sources s where s.company_id=d.company_id and s.deal_id=d.id and exists(select 1 from private.uploaded_pdf_signatures p where p.source_id=s.id) and not private.deal_pdf_fully_signed(s) and not exists(select 1 from private.uploaded_pdf_cancellations c where c.source_id=s.id)));
 money:=d.status<>'completed' and exists(select 1 from private.deal_payment_entries where company_id=d.company_id and deal_id=d.id group by category having sum(amount_ore)<>0);
 why:=case when reserved then 'active_reservation' when live_contract then 'live_contract' when money then 'unsettled_payment' when d.status not in('draft','cancelled','completed')then 'deal_unavailable' else null end;
 review:=jsonb_build_object('deal',to_jsonb(d),'version',v,'archived',is_archived,'reserved',reserved,'liveContract',live_contract,'money',money,'sourceRevisions',jsonb_build_array(
 (select count(*) from public.offers where company_id=d.company_id and deal_id=d.id),
 (select count(*) from private.sale_contract_drafts where company_id=d.company_id and deal_id=d.id),
 (select count(*) from private.trade_in_versions where company_id=d.company_id and deal_id=d.id),
 (select count(*) from private.uploaded_pdf_sources where company_id=d.company_id and deal_id=d.id),
 (select count(*) from private.deal_payment_entries where company_id=d.company_id and deal_id=d.id)) );
 return jsonb_build_object('companyId',d.company_id,'dealId',d.id,'actorId',a,'role',r,'version',v,'archived',is_archived,'dealStatus',d.status,'canArchive',not is_archived and why is null and r in('owner','admin'),'blockedReason',why,'reviewHash',encode(sha256(convert_to(review::text,'UTF8')),'hex'));
end$$;

create or replace function private.dealer_register_page(
 p_company_id uuid,p_kind text,p_query text default '',p_status text default 'all',
 p_sort text default 'recent',p_cursor jsonb default null,p_options boolean default false,p_selected_id uuid default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); actor_role text; result jsonb;
 before_id uuid; before_date timestamptz; before_price bigint;
begin
 select x.actor,x.actor_role into actor,actor_role from private.internal_inventory_scope(p_company_id,false)x;
 if p_kind is null or p_kind not in ('inventory','customers','deals') or p_options is null
 or p_query is null or length(p_query)>120 or p_query ~ '[[:cntrl:]]'
 or p_query<>regexp_replace(btrim(p_query),'[[:space:]]+',' ','g')
 or p_sort is null or p_sort not in ('recent','price_asc','price_desc')
 or p_kind='customers' and p_sort<>'recent'
 or p_status is null
 or p_kind='inventory' and p_status not in ('all','available','reserved','sold','archived')
 or p_kind='customers' and p_status not in ('all','person','business')
 or p_kind='deals' and p_status not in ('all','draft','reserved','cancelled','completed','archived')
 or p_options and (p_kind='deals' or p_sort<>'recent' or p_status<>case when p_kind='inventory' then 'available' else 'all' end)
 or not p_options and p_selected_id is not null then
  raise exception 'Invalid dealer register input' using errcode='22023';
 end if;
 if p_cursor is not null then
  if jsonb_typeof(p_cursor) is distinct from 'object' or octet_length(p_cursor::text)>4096 then raise exception 'Invalid register cursor' using errcode='22023';end if;
  if (select count(*) from jsonb_object_keys(p_cursor))<>12
   or not p_cursor ?& array['version','companyId','actorId','role','kind','query','status','sort','options','id','createdAt','priceOre']
   or p_cursor->'version' is distinct from '1'::jsonb
   or p_cursor->>'companyId' is distinct from p_company_id::text
   or p_cursor->>'actorId' is distinct from actor::text
   or p_cursor->>'role' is distinct from actor_role
   or p_cursor->>'kind' is distinct from p_kind or p_cursor->>'query' is distinct from p_query
   or p_cursor->>'status' is distinct from p_status or p_cursor->>'sort' is distinct from p_sort
   or p_cursor->'options' is distinct from to_jsonb(p_options)
   or jsonb_typeof(p_cursor->'id') is distinct from 'string'
   or (p_cursor->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(p_cursor->'createdAt') is distinct from 'string'
   or (p_cursor->>'createdAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
   or jsonb_typeof(p_cursor->'priceOre') is distinct from 'string'
   or (p_cursor->>'priceOre') !~ '^[0-9]{1,19}$'
   or (p_cursor->>'priceOre')::numeric>9223372036854775807 then
   raise exception 'Invalid register cursor scope' using errcode='22023';
  end if;
  begin
   before_id:=(p_cursor->>'id')::uuid;before_date:=(p_cursor->>'createdAt')::timestamptz;before_price:=(p_cursor->>'priceOre')::bigint;
   if not isfinite(before_date) or extract(year from before_date) not between 1 and 9999 then raise exception 'Invalid register date';end if;
  exception when others then raise exception 'Invalid register cursor anchor' using errcode='22023';end;
 end if;
 with source as materialized (
  select s.id,s.created_at,s.asking_price_ore as price_ore,s.status,false as archived,
   lower(regexp_replace(concat_ws(' ',v.make,v.model,v.registration_number),'[[:space:]]+',' ','g')) as search_text
  from public.stock_items s join public.vehicles v on v.company_id=s.company_id and v.id=s.vehicle_id
  where p_kind='inventory' and s.company_id=p_company_id and (not p_options or s.status='available')
  union all
  select c.id,c.created_at,0::bigint,c.kind,false,lower(regexp_replace(concat_ws(' ',c.name,c.email,c.phone),'[[:space:]]+',' ','g'))
  from public.customers c where p_kind='customers' and c.company_id=p_company_id
  union all
  select d.id,d.created_at,d.sale_price_ore,d.status,private.deal_is_archived(d.company_id,d.id),
   lower(regexp_replace(concat_ws(' ',c.name,c.email,c.phone,v.make,v.model,v.registration_number),'[[:space:]]+',' ','g'))
  from public.deals d join public.customers c on c.company_id=d.company_id and c.id=d.customer_id
  join public.stock_items s on s.company_id=d.company_id and s.id=d.stock_item_id
  join public.vehicles v on v.company_id=s.company_id and v.id=s.vehicle_id
  where p_kind='deals' and d.company_id=p_company_id and not private.deal_is_removed(d.company_id,d.id)
 ), filtered as materialized (
  select * from source where (case when p_kind='deals' then (p_status='archived' and archived) or(p_status<>'archived' and not archived and(p_status='all' or status=p_status)) else p_status='all' or status=p_status end) and strpos(search_text,lower(p_query))>0
 ), bounded as materialized (
  select * from filtered where p_cursor is null
   or p_sort='recent' and (created_at,id)<(before_date,before_id)
   or p_sort='price_asc' and (price_ore,created_at,id)>(before_price,before_date,before_id)
   or p_sort='price_desc' and (price_ore,created_at,id)<(before_price,before_date,before_id)
  order by case when p_sort='price_asc' then price_ore end asc,
   case when p_sort='price_desc' then price_ore end desc,
   case when p_sort='price_asc' then created_at end asc,
   case when p_sort<>'price_asc' then created_at end desc,
   case when p_sort='price_asc' then id end asc,
   case when p_sort<>'price_asc' then id end desc limit 51
 ), numbered as materialized (
  select *,row_number() over(order by case when p_sort='price_asc' then price_ore end asc,
   case when p_sort='price_desc' then price_ore end desc,
   case when p_sort='price_asc' then created_at end asc,
   case when p_sort<>'price_asc' then created_at end desc,
   case when p_sort='price_asc' then id end asc,
   case when p_sort<>'price_asc' then id end desc) as ordinal from bounded
 ), requested as (
  select id,ordinal from numbered where ordinal<=50
  union all select id,0::bigint from source where p_options and id=p_selected_id
 ), payloads as (
  select r.ordinal,jsonb_build_object('id',s.id,'company_id',s.company_id,'status',s.status,'created_at',s.created_at,
   'acquired_on',s.acquired_on,'purchase_price_ore',case when actor_role in('owner','admin','finance')then s.purchase_price_ore::text else null end,'asking_price_ore',s.asking_price_ore::text,'vat_scheme',s.vat_scheme,
   'vehicles',jsonb_build_object('id',v.id,'company_id',v.company_id,'registration_number',v.registration_number,'make',v.make,'model',v.model,'model_year',v.model_year,'mileage_km',v.mileage_km,'fuel',v.fuel,'gearbox',v.gearbox)) as row_data
  from requested r join public.stock_items s on s.id=r.id and s.company_id=p_company_id
  join public.vehicles v on v.id=s.vehicle_id and v.company_id=s.company_id where p_kind='inventory'
  union all
  select r.ordinal,jsonb_build_object('id',c.id,'company_id',c.company_id,'name',c.name,'kind',c.kind,'email',c.email,'phone',c.phone,'address',c.address,'notes',c.notes,'created_at',c.created_at)
  from requested r join public.customers c on c.id=r.id and c.company_id=p_company_id where p_kind='customers'
  union all
  select r.ordinal,jsonb_build_object('id',d.id,'company_id',d.company_id,'status',d.status,'sale_price_ore',d.sale_price_ore::text,'customer_id',d.customer_id,'stock_item_id',d.stock_item_id,'created_at',d.created_at,'archived',private.deal_is_archived(d.company_id,d.id),'contractProgress',private.deal_contract_progress(d.company_id,d.id),
   'createdBy',jsonb_build_object('id',d.created_by,'name',private.deal_creator_name(d.company_id,d.id,d.created_by)),
   'customer',jsonb_build_object('id',c.id,'company_id',c.company_id,'name',c.name,'kind',c.kind,'email',c.email,'phone',c.phone,'address',c.address,'notes',c.notes,'created_at',c.created_at),
   'stockItem',jsonb_build_object('id',s.id,'company_id',s.company_id,'status',s.status,'created_at',s.created_at,'acquired_on',s.acquired_on,'purchase_price_ore',case when actor_role in('owner','admin','finance')then s.purchase_price_ore::text else null end,'asking_price_ore',s.asking_price_ore::text,'vat_scheme',s.vat_scheme,
    'vehicles',jsonb_build_object('id',v.id,'company_id',v.company_id,'registration_number',v.registration_number,'make',v.make,'model',v.model,'model_year',v.model_year,'mileage_km',v.mileage_km,'fuel',v.fuel,'gearbox',v.gearbox)))
  from requested r join public.deals d on d.id=r.id and d.company_id=p_company_id
  join public.customers c on c.id=d.customer_id and c.company_id=d.company_id
  join public.stock_items s on s.id=d.stock_item_id and s.company_id=d.company_id
  join public.vehicles v on v.id=s.vehicle_id and v.company_id=s.company_id where p_kind='deals'
 ), totals as (
  select count(*) as all_count,
   case p_kind when 'inventory' then jsonb_build_object('available',count(*) filter(where status='available')::text,'reserved',count(*) filter(where status='reserved')::text,'sold',count(*) filter(where status='sold')::text,'archived',count(*) filter(where status='archived')::text)
    when 'customers' then jsonb_build_object('person',count(*) filter(where status='person')::text,'business',count(*) filter(where status='business')::text)
    else jsonb_build_object('draft',count(*) filter(where status='draft' and not archived)::text,'reserved',count(*) filter(where status='reserved' and not archived)::text,'cancelled',count(*) filter(where status='cancelled' and not archived)::text,'completed',count(*) filter(where status='completed' and not archived)::text,'archived',count(*) filter(where archived)::text) end as category_counts
  from source
 ) select jsonb_build_object('kind',p_kind,'companyId',p_company_id,'actorId',actor,'role',actor_role,'options',p_options,
  'rows',coalesce((select jsonb_agg(row_data order by ordinal) from payloads where ordinal>0),'[]'::jsonb),
  'selected',(select row_data from payloads where ordinal=0),
  'totalCount',t.all_count::text,'filteredCount',(select count(*)::text from filtered),
  'counts',jsonb_build_object('all',case when p_kind='deals' then (t.all_count-(t.category_counts->>'archived')::bigint)::text else t.all_count::text end)||t.category_counts,
  'nextCursor',case when exists(select 1 from numbered where ordinal=51) then
   (select jsonb_build_object('version',1,'companyId',p_company_id,'actorId',actor,'role',actor_role,'kind',p_kind,'query',p_query,'status',p_status,'sort',p_sort,'options',p_options,
    'id',id,'createdAt',created_at,'priceOre',price_ore::text) from numbered where ordinal=50) else null end)
 into result from totals t;
 return result;
end $$;

create or replace function private.get_deal_contract_progress(p_company_id uuid,p_deal_ids uuid[])returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a uuid;r text;rows jsonb;
begin
 select x.actor,x.actor_role into a,r from private.internal_inventory_scope(p_company_id,false)x;
 if p_deal_ids is null or coalesce(array_length(p_deal_ids,1),0)>500 or array_ndims(p_deal_ids)>1 or array_position(p_deal_ids,null) is not null or(select count(*)from unnest(p_deal_ids))<>(select count(distinct x)from unnest(p_deal_ids)x)then raise exception 'Invalid contract progress request'using errcode='22023';end if;
 if exists(select 1 from unnest(p_deal_ids)x where not exists(select 1 from public.deals d where d.company_id=p_company_id and d.id=x))then raise exception 'Contract progress scope denied'using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('dealId',d.id,'archived',private.deal_is_archived(d.company_id,d.id),'removed',private.deal_is_removed(d.company_id,d.id),'contractProgress',private.deal_contract_progress(d.company_id,d.id))order by d.id),'[]')into rows from public.deals d where d.company_id=p_company_id and d.id=any(p_deal_ids);
 return jsonb_build_object('companyId',p_company_id,'actorId',a,'role',r,'rows',rows);
end$$;

-- Operational global counters exclude hidden deals; created events stay historical.
create or replace function private.get_platform_overview() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; generated timestamptz:=statement_timestamp(); today date:=(statement_timestamp() at time zone 'Europe/Stockholm')::date;
begin
 select i.user_id into actor from private.company_team_identity(true) i;
 perform 1 from private.platform_admins a where a.user_id=actor and a.status='active' for share;
 if not found then raise exception 'Platform access denied' using errcode='42501';end if;
 return jsonb_build_object('actorUserId',actor,'generatedAt',generated,
'companies',(select jsonb_build_object('total',(count(*) filter(where true))::text,'active',(count(*) filter(where status='active'))::text,'suspended',(count(*) filter(where status='suspended'))::text) from public.companies),
'users',(select jsonb_build_object('total',(count(*) filter(where true))::text,'verified',(count(*) filter(where email_confirmed_at is not null))::text,'activeMemberships',(select count(*)::text from public.memberships where status='active')) from auth.users),
'applications',(select jsonb_build_object('total',(count(*) filter(where true))::text,'new',(count(*) filter(where status='new'))::text,'inReview',(count(*) filter(where status='in_review'))::text,'contacted',(count(*) filter(where status='contacted'))::text,'closed',(count(*) filter(where status='closed'))::text,'legacyIncomplete',(count(*) filter(where legacy))::text) from private.demo_requests),
'inventory',(select jsonb_build_object('total',(count(*) filter(where true))::text,'available',(count(*) filter(where status='available'))::text,'reserved',(count(*) filter(where status='reserved'))::text,'sold',(count(*) filter(where status='sold'))::text,'archived',(count(*) filter(where status='archived'))::text) from public.stock_items),
'deals',(select jsonb_build_object('total',(count(*) filter(where true))::text,'draft',(count(*) filter(where status='draft'and not private.deal_is_archived(company_id,id)))::text,'reserved',(count(*) filter(where status='reserved'and not private.deal_is_archived(company_id,id)))::text,'cancelled',(count(*) filter(where status='cancelled'))::text,'completed',(count(*) filter(where status='completed'))::text) from public.deals),
'offers',(select jsonb_build_object('customerReviews',(count(*) filter(where true))::text,'accepted',(count(*) filter(where status='accepted'))::text,'declined',(count(*) filter(where status='declined'))::text,'versions',(select count(*)::text from public.offers)) from private.offer_reviews),
'advertising',(select jsonb_build_object('draft',(count(*) filter(where status='draft'))::text,'ready',(count(*) filter(where status='ready'))::text,'connectionsRequested',(select count(*)::text from private.advertising_connections where status='requested'),'connectionsVerified',(select count(*)::text from private.advertising_connections where status='verified')) from private.advertising_listings),
'financing',(select jsonb_build_object('intakeRequests',(count(*) filter(where status='intake'))::text) from public.finance_applications),
 'stockAskingPriceOre',(select coalesce(sum(asking_price_ore),0)::text from public.stock_items where status in ('available','reserved')),
 'daily',(select jsonb_agg(jsonb_build_object('date',d::text,
  'applications',(select count(*)::text from private.demo_requests where created_at>=d::timestamp at time zone 'Europe/Stockholm' and created_at<(d+1)::timestamp at time zone 'Europe/Stockholm'),
  'companies',(select count(*)::text from public.companies where created_at>=d::timestamp at time zone 'Europe/Stockholm' and created_at<(d+1)::timestamp at time zone 'Europe/Stockholm'),
  'deals',(select count(*)::text from public.deals where created_at>=d::timestamp at time zone 'Europe/Stockholm' and created_at<(d+1)::timestamp at time zone 'Europe/Stockholm')) order by d)
  from (select today-6+i as d from generate_series(0,6) i) days));
end $$;
commit;
