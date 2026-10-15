begin;
-- Deliberate dealer-to-dealer publication; no tenant tables become shared.
create table private.dealer_network_listings (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, stock_id uuid not null,
 published boolean not null default false, version integer not null default 1,
 source jsonb not null, updated_at timestamptz not null default clock_timestamp(),
 unique(company_id,stock_id), foreign key(company_id,stock_id) references public.stock_items(company_id,id)
);
create index dealer_network_published on private.dealer_network_listings(id)where published;
create table private.dealer_network_inquiries (
 id uuid primary key default gen_random_uuid(), listing_id uuid not null references private.dealer_network_listings(id),
 buyer_company_id uuid not null references public.companies(id), seller_company_id uuid not null references public.companies(id),
 sender_email text not null, vehicle_title text not null, created_at timestamptz not null default clock_timestamp(),
 check(buyer_company_id<>seller_company_id), unique(listing_id,buyer_company_id)
);
create table private.dealer_network_messages (
 id uuid primary key default gen_random_uuid(), inquiry_id uuid not null references private.dealer_network_inquiries(id),
 company_id uuid not null references public.companies(id), message text not null check(length(message) between 1 and 2000),
 created_at timestamptz not null default clock_timestamp()
);
create index dealer_network_inquiries_seller on private.dealer_network_inquiries(seller_company_id,created_at desc);
create index dealer_network_inquiries_buyer on private.dealer_network_inquiries(buyer_company_id,created_at desc);
create index dealer_network_messages_thread on private.dealer_network_messages(inquiry_id,created_at,id);
create index dealer_network_messages_company on private.dealer_network_messages(company_id);
create table private.dealer_network_requests (
 actor_id uuid not null references auth.users(id), request_id uuid not null, company_id uuid not null references public.companies(id),
 payload jsonb not null, receipt jsonb not null, primary key(actor_id,request_id)
);
create index dealer_network_requests_company on private.dealer_network_requests(company_id);
alter table private.dealer_network_listings enable row level security;
alter table private.dealer_network_inquiries enable row level security;
alter table private.dealer_network_messages enable row level security;
alter table private.dealer_network_requests enable row level security;
revoke all on private.dealer_network_listings,private.dealer_network_inquiries,private.dealer_network_messages,private.dealer_network_requests from public,anon,authenticated,service_role;
create trigger dealer_network_request_immutable before update or delete on private.dealer_network_requests for each row execute function private.reject_company_team_audit_mutation();
create trigger dealer_network_messages_immutable before update or delete on private.dealer_network_messages for each row execute function private.reject_company_team_audit_mutation();
create function private.dealer_network_scope(p_company uuid,p_mode text)returns text language plpgsql security invoker set search_path='' as $$
declare a uuid;r text;
begin
 select user_id into a from private.company_team_identity(true);
 perform 1 from public.companies where id=p_company and status='active' for share;
 if not found then raise exception 'Company denied'using errcode='42501';end if;
 select role into r from public.memberships where company_id=p_company and user_id=a and status='active' for share;
 if r is null or (p_mode='publish' and r not in('owner','admin')) or (p_mode='contact' and r not in('owner','admin','sales')) then raise exception 'Network denied'using errcode='42501';end if;
 return r;
end$$;
create function private.dealer_network_source(p_company uuid,p_stock uuid)returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('make',v.make,'model',v.model,'year',v.model_year,'mileageKm',v.mileage_km,'fuel',v.fuel,'gearbox',v.gearbox,'priceOre',s.asking_price_ore::text,'currency',s.currency,'seller',c.name)
 from public.stock_items s join public.vehicles v on v.company_id=s.company_id and v.id=s.vehicle_id join public.companies c on c.id=s.company_id
 where s.company_id=p_company and s.id=p_stock and s.status='available' and c.status='active'
$$;
create function private.dealer_network_page(p_company_id uuid,p_query text,p_offset integer)returns jsonb language plpgsql security definer set search_path='' as $$
declare r text;items jsonb;own jsonb;threads jsonb;more boolean;
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
 where s.company_id=p_company_id and (s.status='available' or l.published) order by s.id limit 500) x;
 else own:='[]';end if;
 if r in('owner','admin','sales') then
 select coalesce(jsonb_agg(x.data order by x.created_at desc,x.id),'[]')into threads from (
 select i.id,i.created_at,jsonb_build_object('id',i.id,'title',i.vehicle_title,'direction',case when i.buyer_company_id=p_company_id then 'sent' else 'received' end,'counterparty',c.name,'senderEmail',i.sender_email,
 'hasOlderMessages',(select count(*)>100 from(select 1 from private.dealer_network_messages m where m.inquiry_id=i.id limit 101)bounded),
 'messages',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'own',m.company_id=p_company_id,'text',m.message,'createdAt',m.created_at)order by m.created_at,m.id),'[]')from(select mm.*from private.dealer_network_messages mm where mm.inquiry_id=i.id order by mm.created_at desc,mm.id desc limit 100)m))data
 from private.dealer_network_inquiries i join public.companies c on c.id=case when i.buyer_company_id=p_company_id then i.seller_company_id else i.buyer_company_id end
 where p_company_id in(i.buyer_company_id,i.seller_company_id) and c.status='active' order by i.created_at desc,i.id limit 100) x;
 else threads:='[]';end if;
 return jsonb_build_object('companyId',p_company_id,'actorId',auth.uid(),'role',r,'items',items,'own',own,'threads',threads,'hasMore',more);
end$$;
create function private.dealer_network_mutate(p_company_id uuid,p_request_id uuid,p_payload jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;email text;r text;action text;l private.dealer_network_listings;i private.dealer_network_inquiries;prior private.dealer_network_requests;receipt jsonb;src jsonb;target uuid;partner uuid;
begin
 select x.user_id,x.email into a,email from private.company_team_identity(true)x;
 action:=p_payload->>'action';
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>20000 or action is null or action not in('publish','withdraw','inquire','reply') then raise exception 'Invalid network request'using errcode='22023';end if;
 r:=private.dealer_network_scope(p_company_id,case when action in('publish','withdraw')then 'publish' else 'contact' end);
 perform pg_advisory_xact_lock(hashtextextended('dealer_network:'||a::text||':'||p_request_id::text,0));
 select *into prior from private.dealer_network_requests where actor_id=a and request_id=p_request_id;
 if found then if prior.company_id<>p_company_id or prior.payload<>p_payload then raise exception 'Request conflict'using errcode='40001';end if;return prior.receipt;end if;
 if action in('publish','withdraw')then
 target:=(p_payload->>'stockId')::uuid;
 perform 1 from public.stock_items where company_id=p_company_id and id=target for update;
 if not found then raise exception 'Stock denied'using errcode='42501';end if;
 perform 1 from public.vehicles v join public.stock_items s on s.company_id=v.company_id and s.vehicle_id=v.id where s.company_id=p_company_id and s.id=target for share of v;
 select *into l from private.dealer_network_listings where company_id=p_company_id and stock_id=target for update;
 if (p_payload->>'version')::integer is distinct from coalesce(l.version,0) then raise exception 'Listing conflict'using errcode='40001';end if;
 src:=private.dealer_network_source(p_company_id,target);
 if action='publish' and (p_payload->'consent' is distinct from 'true'::jsonb or p_payload->'source' is distinct from src or src is null)then raise exception 'Review current available vehicle'using errcode='40001';end if;
 if l.id is null then
 if action='withdraw'then raise exception 'Listing missing'using errcode='40001';end if;
 insert into private.dealer_network_listings(company_id,stock_id,published,source)values(p_company_id,target,true,src)returning *into l;
 else update private.dealer_network_listings set published=action='publish',source=coalesce(src,source),version=version+1,updated_at=clock_timestamp()where id=l.id returning *into l;end if;
 receipt:=jsonb_build_object('id',l.id,'version',l.version);
 else
 if action='inquire'then
 select *into l from private.dealer_network_listings where id=(p_payload->>'listingId')::uuid;
 partner:=l.company_id;
 else select *into i from private.dealer_network_inquiries where id=(p_payload->>'inquiryId')::uuid;
 if i.id is null or p_company_id not in(i.buyer_company_id,i.seller_company_id)then raise exception 'Inquiry denied'using errcode='42501';end if;
 partner:=case when i.buyer_company_id=p_company_id then i.seller_company_id else i.buyer_company_id end;
 end if;
 if partner is null or partner=p_company_id then raise exception 'Listing denied'using errcode='42501';end if;
 perform 1 from public.companies where id in(p_company_id,partner) and status='active' order by id for share;
 if not exists(select 1 from public.companies where id=partner and status='active')then raise exception 'Partner unavailable'using errcode='42501';end if;
 if p_payload->>'message' is null or length(btrim(p_payload->>'message'))not between 1 and 2000 then raise exception 'Message required'using errcode='22023';end if;
 if action='inquire'then
 perform 1 from public.stock_items where company_id=l.company_id and id=l.stock_id for share;
 perform 1 from public.vehicles v join public.stock_items s on s.company_id=v.company_id and s.vehicle_id=v.id where s.company_id=l.company_id and s.id=l.stock_id for share of v;
 select *into l from private.dealer_network_listings where id=l.id for share;
 if not l.published or l.source is distinct from private.dealer_network_source(l.company_id,l.stock_id)or (p_payload->>'version')::integer is distinct from l.version or p_payload->'consent' is distinct from 'true'::jsonb then raise exception 'Listing unavailable or consent missing'using errcode='40001';end if;
 insert into private.dealer_network_inquiries(listing_id,buyer_company_id,seller_company_id,sender_email,vehicle_title)values(l.id,p_company_id,l.company_id,email,(l.source->>'make')||' '||(l.source->>'model'))returning *into i;
 end if;
 insert into private.dealer_network_messages(inquiry_id,company_id,message)values(i.id,p_company_id,btrim(p_payload->>'message'));
 receipt:=jsonb_build_object('id',i.id);
 end if;
 receipt:=jsonb_build_object('companyId',p_company_id,'actorId',a,'receipt',receipt);
 insert into private.dealer_network_requests(actor_id,request_id,company_id,payload,receipt)values(a,p_request_id,p_company_id,p_payload,receipt);
 return receipt;
 exception when unique_violation then raise exception 'Inquiry already exists; open the conversation'using errcode='40001';
end$$;
-- Private helpers cannot be invoked from the Data API.
revoke all on function private.dealer_network_scope(uuid,text),private.dealer_network_source(uuid,uuid),private.dealer_network_page(uuid,text,integer),private.dealer_network_mutate(uuid,uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function private.dealer_network_page(uuid,text,integer),private.dealer_network_mutate(uuid,uuid,jsonb)to authenticated;
create function public.dealer_network_page(p_company_id uuid,p_query text,p_offset integer)returns jsonb language sql security invoker set search_path='' as $$select private.dealer_network_page(p_company_id,p_query,p_offset)$$;
create function public.dealer_network_mutate(p_company_id uuid,p_request_id uuid,p_payload jsonb)returns jsonb language sql security invoker set search_path='' as $$select private.dealer_network_mutate(p_company_id,p_request_id,p_payload)$$;
revoke all on function public.dealer_network_page(uuid,text,integer),public.dealer_network_mutate(uuid,uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.dealer_network_page(uuid,text,integer),public.dealer_network_mutate(uuid,uuid,jsonb)to authenticated;
commit;
