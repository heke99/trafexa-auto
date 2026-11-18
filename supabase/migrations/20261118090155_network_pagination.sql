begin;
create or replace function private.dealer_network_page(p_company_id uuid,p_query text,p_offset integer)returns jsonb language plpgsql security definer set search_path='' as $$
declare r text;items jsonb;own jsonb;threads jsonb;more boolean;own_more boolean:=false;threads_more boolean:=false;
begin
 r:=private.dealer_network_scope(p_company_id,'read');
 if p_query is null or length(p_query)>100 or p_offset is null or p_offset<0 or p_offset>10000 then raise exception 'Invalid network page'using errcode='22023';end if;
 select coalesce(jsonb_agg(x.data order by x.id),'[]') into items from (
 select l.id,jsonb_build_object('id',l.id,'version',l.version,'vehicle',l.source) data
 from private.dealer_network_listings l where l.company_id<>p_company_id and l.published and l.source=private.dealer_network_source(l.company_id,l.stock_id)
 and (p_query='' or position(lower(p_query) in lower(concat_ws(' ',l.source->>'make',l.source->>'model',l.source->>'seller')))>0)
 order by l.id limit 51 offset p_offset) x;
 more:=jsonb_array_length(items)>50;if more then items:=items-50;end if;
 if r in('owner','admin') then
 select coalesce(jsonb_agg(x.data order by x.id),'[]') into own from (
 select s.id,jsonb_build_object('stockId',s.id,'title',v.make||' '||v.model,'registration',v.registration_number,'status',s.status,'listingId',l.id,'version',coalesce(l.version,0),'published',coalesce(l.published,false),'live',coalesce(l.published and l.source=private.dealer_network_source(s.company_id,s.id),false),'source',private.dealer_network_source(s.company_id,s.id)) data
 from public.stock_items s join public.vehicles v on v.company_id=s.company_id and v.id=s.vehicle_id left join private.dealer_network_listings l on l.company_id=s.company_id and l.stock_id=s.id
 where s.company_id=p_company_id and (s.status='available' or l.published) order by s.id limit 51) x;
 own_more:=jsonb_array_length(own)>50;if own_more then own:=own-50;end if;
 else own:='[]';end if;
 if r in('owner','admin','sales') then
 select coalesce(jsonb_agg(x.data order by x.created_at desc,x.id),'[]')into threads from (
 select i.id,i.created_at,jsonb_build_object('id',i.id,'title',i.vehicle_title,'direction',case when i.buyer_company_id=p_company_id then 'sent' else 'received' end,'counterparty',c.name,'senderEmail',i.sender_email,
 'hasOlderMessages',(select count(*)>100 from(select 1 from private.dealer_network_messages m where m.inquiry_id=i.id limit 101)bounded),
 'messages',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'own',m.company_id=p_company_id,'text',m.message,'createdAt',m.created_at)order by m.created_at,m.id),'[]')from(select mm.*from private.dealer_network_messages mm where mm.inquiry_id=i.id order by mm.created_at desc,mm.id desc limit 100)m))data
 from private.dealer_network_inquiries i join public.companies c on c.id=case when i.buyer_company_id=p_company_id then i.seller_company_id else i.buyer_company_id end
 where p_company_id in(i.buyer_company_id,i.seller_company_id) and c.status='active' order by i.created_at desc,i.id limit 51) x;
 threads_more:=jsonb_array_length(threads)>50;if threads_more then threads:=threads-50;end if;
 else threads:='[]';end if;
 return jsonb_build_object('companyId',p_company_id,'actorId',auth.uid(),'role',r,'items',items,'own',own,'threads',threads,'hasMore',more,'hasMoreOwn',own_more,'hasMoreThreads',threads_more);
end$$;

create function private.dealer_network_more(p_company_id uuid,p_kind text,p_after_id uuid,p_inquiry_id uuid default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare r text;items jsonb;own_rows jsonb:='[]';thread_rows jsonb:='[]';message_rows jsonb:='[]';more boolean;cursor_date timestamptz; begin
 r:=private.dealer_network_scope(p_company_id,'read');
 if p_after_id is null or p_kind not in('own','threads','messages') or p_kind is null then raise exception 'Invalid page'using errcode='22023';end if;
 if p_kind='own' then
  if r not in('owner','admin')then raise exception 'Publication access required'using errcode='42501';end if;
  if not exists(select 1 from public.stock_items where id=p_after_id and company_id=p_company_id)then raise exception 'Cursor unavailable'using errcode='42501';end if;
  select coalesce(jsonb_agg(x.data order by x.id),'[]') into items from(
   select s.id,jsonb_build_object('stockId',s.id,'title',v.make||' '||v.model,'registration',v.registration_number,'status',s.status,'listingId',l.id,'version',coalesce(l.version,0),'published',coalesce(l.published,false),'live',coalesce(l.published and l.source=private.dealer_network_source(s.company_id,s.id),false),'source',private.dealer_network_source(s.company_id,s.id)) data
   from public.stock_items s join public.vehicles v on v.company_id=s.company_id and v.id=s.vehicle_id left join private.dealer_network_listings l on l.company_id=s.company_id and l.stock_id=s.id
   where s.company_id=p_company_id and(s.status='available' or l.published)and s.id>p_after_id order by s.id limit 51)x;
 elsif p_kind='threads' then
  if r not in('owner','admin','sales')then raise exception 'Contact access required'using errcode='42501';end if;
  select created_at into cursor_date from private.dealer_network_inquiries where id=p_after_id and p_company_id in(buyer_company_id,seller_company_id);
  if not found then raise exception 'Cursor unavailable'using errcode='42501';end if;
  select coalesce(jsonb_agg(x.data order by x.created_at desc,x.id),'[]')into items from(
   select i.id,i.created_at,jsonb_build_object('id',i.id,'title',i.vehicle_title,'direction',case when i.buyer_company_id=p_company_id then 'sent' else 'received'end,'counterparty',c.name,'senderEmail',i.sender_email,
   'hasOlderMessages',(select count(*)>100 from(select 1 from private.dealer_network_messages m where m.inquiry_id=i.id limit 101)bounded),
   'messages',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'own',m.company_id=p_company_id,'text',m.message,'createdAt',m.created_at)order by m.created_at,m.id),'[]')from(select mm.*from private.dealer_network_messages mm where mm.inquiry_id=i.id order by mm.created_at desc,mm.id desc limit 100)m))data
   from private.dealer_network_inquiries i join public.companies c on c.id=case when i.buyer_company_id=p_company_id then i.seller_company_id else i.buyer_company_id end
   where p_company_id in(i.buyer_company_id,i.seller_company_id)and c.status='active'and(i.created_at<cursor_date or(i.created_at=cursor_date and i.id>p_after_id))order by i.created_at desc,i.id limit 51)x;
 else
  if r not in('owner','admin','sales')or p_inquiry_id is null then raise exception 'Contact access required'using errcode='42501';end if;
  if not exists(select 1 from private.dealer_network_inquiries i join public.companies c on c.id=case when i.buyer_company_id=p_company_id then i.seller_company_id else i.buyer_company_id end where i.id=p_inquiry_id and p_company_id in(i.buyer_company_id,i.seller_company_id)and c.status='active')then raise exception 'Conversation unavailable'using errcode='42501';end if;
  select created_at into cursor_date from private.dealer_network_messages where id=p_after_id and inquiry_id=p_inquiry_id;
  if not found then raise exception 'Cursor unavailable'using errcode='42501';end if;
  select coalesce(jsonb_agg(x.data order by x.created_at desc,x.id desc),'[]')into items from(
   select m.id,m.created_at,jsonb_build_object('id',m.id,'own',m.company_id=p_company_id,'text',m.message,'createdAt',m.created_at)data from private.dealer_network_messages m
   where m.inquiry_id=p_inquiry_id and(m.created_at,m.id)<(cursor_date,p_after_id)order by m.created_at desc,m.id desc limit 51)x;
 end if;
 more:=jsonb_array_length(items)>50;if more then items:=items-50;end if;
 if p_kind='own'then own_rows:=items;elsif p_kind='threads'then thread_rows:=items;else select coalesce(jsonb_agg(value order by ordinality desc),'[]')into message_rows from jsonb_array_elements(items)with ordinality;end if;
 if private.dealer_network_scope(p_company_id,'read')is distinct from r then raise exception 'Scope changed'using errcode='42501';end if;
 return jsonb_build_object('companyId',p_company_id,'actorId',auth.uid(),'role',r,'kind',p_kind,'inquiryId',p_inquiry_id,'own',own_rows,'threads',thread_rows,'messages',message_rows,'hasMore',more);
end$$;
revoke all on function private.dealer_network_more(uuid,text,uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function private.dealer_network_more(uuid,text,uuid,uuid)to authenticated;
create function public.dealer_network_more(p_company_id uuid,p_kind text,p_after_id uuid,p_inquiry_id uuid default null)returns jsonb language sql security invoker set search_path=''as $$select private.dealer_network_more(p_company_id,p_kind,p_after_id,p_inquiry_id)$$;
revoke all on function public.dealer_network_more(uuid,text,uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.dealer_network_more(uuid,text,uuid,uuid)to authenticated;
commit;
