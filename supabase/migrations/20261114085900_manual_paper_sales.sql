begin;
-- A paper record is an authorized manual attestation, never a digital signature or bank receipt.
create table private.paper_sale_reviews(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),stock_item_id uuid not null,
 deal_id uuid,actor_id uuid not null references auth.users(id),request_id uuid not null,input jsonb not null,snapshot jsonb not null,
 source_hash text not null check(source_hash~'^[a-f0-9]{64}$'),review_hash text not null check(review_hash~'^[a-f0-9]{64}$'),created_at timestamptz not null default clock_timestamp(),
 unique(actor_id,request_id),foreign key(company_id,stock_item_id)references public.stock_items(company_id,id),foreign key(company_id,deal_id)references public.deals(company_id,id)
);
create table private.paper_sales(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),stock_item_id uuid not null unique,deal_id uuid not null unique,
 customer_id uuid not null,review_id uuid not null unique references private.paper_sale_reviews(id),actor_id uuid not null references auth.users(id),
 sale_price_ore bigint not null check(sale_price_ore between 1 and 999999999999),signed_on date not null,paper_reference text not null,note text not null,
 snapshot jsonb not null,recorded_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,stock_item_id)references public.stock_items(company_id,id),foreign key(company_id,deal_id)references public.deals(company_id,id),foreign key(company_id,customer_id)references public.customers(company_id,id),unique(company_id,id)
);
create table private.paper_sale_requests(actor_id uuid not null references auth.users(id),request_id uuid not null,payload jsonb not null,sale_id uuid not null references private.paper_sales(id),primary key(actor_id,request_id));
create index paper_sale_reviews_stock on private.paper_sale_reviews(company_id,stock_item_id);
create index paper_sales_company on private.paper_sales(company_id,recorded_at,id);
do $$declare n text;begin foreach n in array array['paper_sale_reviews','paper_sales','paper_sale_requests']loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 execute format('create trigger %I before update or delete on private.%I for each row execute function private.sale_contract_immutable()',n||'_immutable',n);end loop;end$$;
create function private.paper_sale_scope(p_company uuid,p_write boolean)returns table(actor uuid,actor_role text)language plpgsql security invoker set search_path=''as $$declare a uuid;r text;begin
 select x.actor,x.actor_role into a,r from private.internal_inventory_scope(p_company,p_write)x;
 if r not in('owner','admin','finance')or(p_write and r='finance')then raise exception 'Paper sale access denied'using errcode='42501';end if;return query select a,r;end$$;
create function private.paper_sale_receipt(p private.paper_sales)returns jsonb language sql stable set search_path=''as $$select jsonb_build_object('id',p.id,'source','paper','companyId',p.company_id,'stockItemId',p.stock_item_id,'dealId',p.deal_id,'customerId',p.customer_id,'actorId',p.actor_id,'priceOre',p.sale_price_ore::text,'signedOn',p.signed_on::text,'paperReference',p.paper_reference,'note',p.note,'snapshot',p.snapshot,'recordedAt',p.recorded_at,'bankVerified',false,'digitalSignature',false)$$;
create function private.paper_sale_basis(p_company uuid,p_stock uuid,p_deal uuid,p_customer uuid)returns jsonb language plpgsql security invoker set search_path=''as $$declare s public.stock_items;v public.vehicles;d public.deals;c public.customers;reservations jsonb;begin
 select *into s from public.stock_items where company_id=p_company and id=p_stock;if not found then raise exception 'Stock denied'using errcode='42501';end if;
 select *into v from public.vehicles where company_id=p_company and id=s.vehicle_id;
 if p_deal is not null then select *into d from public.deals where company_id=p_company and id=p_deal and stock_item_id=p_stock;if not found then raise exception 'Deal denied'using errcode='42501';end if;end if;
 if p_customer is not null then select *into c from public.customers where company_id=p_company and id=p_customer;if not found then raise exception 'Customer denied'using errcode='42501';end if;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'dealId',deal_id,'status',status,'expiresAt',expires_at)order by id),'[]')into reservations from public.reservations where company_id=p_company and stock_item_id=p_stock and status='active';
 return jsonb_build_object('stock',jsonb_build_object('id',s.id,'status',s.status,'askingPriceOre',s.asking_price_ore::text,'vatScheme',s.vat_scheme),'vehicle',jsonb_build_object('id',v.id,'registration',v.registration_number,'make',v.make,'model',v.model,'year',v.model_year),
 'deal',case when d.id is null then null else jsonb_build_object('id',d.id,'status',d.status,'customerId',d.customer_id,'salePriceOre',d.sale_price_ore::text)end,
 'customer',case when c.id is null then null else jsonb_build_object('id',c.id,'name',c.name,'kind',c.kind,'email',c.email,'phone',c.phone,'version',c.contact_version)end,'reservations',reservations);
end$$;
create function private.check_paper_sale_available(p_company uuid,p_stock uuid,p_deal uuid)returns void language plpgsql security invoker set search_path=''as $$declare s public.stock_items;d public.deals;archived boolean;begin
 select *into s from public.stock_items where company_id=p_company and id=p_stock;
 if not found or s.status not in('available','reserved')or exists(select 1 from private.paper_sales where company_id=p_company and stock_item_id=p_stock)then raise exception 'Vehicle already sold or unavailable'using errcode='40001';end if;
 if p_deal is not null then select *into d from public.deals where company_id=p_company and id=p_deal and stock_item_id=p_stock;if not found or d.status not in('draft','reserved')then raise exception 'Deal unavailable'using errcode='40001';end if;end if;
 if p_deal is not null and to_regprocedure('private.deal_is_archived(uuid,uuid)')is not null then execute 'select private.deal_is_archived($1,$2)'into archived using p_company,p_deal;if archived then raise exception 'Archived deal unavailable'using errcode='40001';end if;end if;
 if exists(select 1 from public.reservations where company_id=p_company and stock_item_id=p_stock and status='active'and expires_at>clock_timestamp()and deal_id is distinct from p_deal)
 or(s.status='reserved'and not exists(select 1 from public.reservations where company_id=p_company and stock_item_id=p_stock and deal_id=p_deal and status='active'and expires_at>clock_timestamp()))then raise exception 'Conflicting or expired reservation'using errcode='40001';end if;
 if exists(select 1 from private.contract_signings x join public.deals y on y.company_id=x.company_id and y.id=x.deal_id where y.company_id=p_company and y.stock_item_id=p_stock and y.status<>'cancelled')
 or exists(select 1 from private.uploaded_pdf_sources x join public.deals y on y.company_id=x.company_id and y.id=x.deal_id where y.company_id=p_company and y.stock_item_id=p_stock and y.status<>'cancelled'and not exists(select 1 from private.uploaded_pdf_cancellations z where z.source_id=x.id))
 or exists(select 1 from private.offer_reviews x join public.deals y on y.company_id=x.company_id and y.id=x.deal_id where y.company_id=p_company and y.stock_item_id=p_stock and y.status<>'cancelled'and x.status in('pending','accepted'))
 or exists(select 1 from private.deal_payment_entries x join public.deals y on y.company_id=x.company_id and y.id=x.deal_id where y.company_id=p_company and y.stock_item_id=p_stock)
 or exists(select 1 from private.trade_in_acquisitions x join public.deals y on y.company_id=x.company_id and y.id=x.deal_id where y.company_id=p_company and y.stock_item_id=p_stock)
 then raise exception 'Existing electronic or financial source must be resolved first'using errcode='40001';end if;
end$$;
create function private.get_paper_sale_options(p_company_id uuid,p_stock_item_id uuid,p_deal_id uuid default null)returns jsonb language plpgsql security definer set search_path=''as $$declare a uuid;r text;d public.deals;p private.paper_sales;basis jsonb;begin
 select x.actor,x.actor_role into a,r from private.paper_sale_scope(p_company_id,false)x;
 perform 1 from public.stock_items where company_id=p_company_id and id=p_stock_item_id for share;if not found then raise exception 'Stock denied'using errcode='42501';end if;
 if p_deal_id is not null then select *into d from public.deals where company_id=p_company_id and id=p_deal_id and stock_item_id=p_stock_item_id for share;if not found then raise exception 'Deal denied'using errcode='42501';end if;end if;
 select *into p from private.paper_sales where company_id=p_company_id and stock_item_id=p_stock_item_id and(p_deal_id is null or deal_id=p_deal_id);
 basis:=private.paper_sale_basis(p_company_id,p_stock_item_id,p_deal_id,d.customer_id);
 return jsonb_build_object('companyId',p_company_id,'actorId',a,'role',r,'businessDate',(clock_timestamp()at time zone'Europe/Stockholm')::date::text,'basis',basis,'existingReceipt',case when p.id is null then null else private.paper_sale_receipt(p)end);
end$$;
create function private.prepare_paper_sale(p_company_id uuid,p_stock_item_id uuid,p_deal_id uuid,p_customer_id uuid,p_buyer jsonb,p_price_ore bigint,p_signed_on date,p_paper_reference text,p_note text,p_request_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$declare a uuid;r text;d public.deals;c public.customers;basis jsonb;buyer jsonb;payload jsonb;snapshot jsonb;prior private.paper_sale_reviews;saved private.paper_sale_reviews;today date:=(clock_timestamp()at time zone'Europe/Stockholm')::date;begin
 select x.actor,x.actor_role into a,r from private.paper_sale_scope(p_company_id,true)x;
 if p_request_id is null or p_price_ore is null or p_price_ore not between 1 and 999999999999 or p_signed_on is null or p_signed_on<date'2000-01-01'or p_signed_on>today
 or p_paper_reference is null or p_paper_reference<>btrim(p_paper_reference)or length(p_paper_reference)not between 2 and 160 or p_paper_reference~'[[:cntrl:]]'
 or p_note is null or p_note<>btrim(p_note)or length(p_note)not between 2 and 500 or p_note~'[[:cntrl:]]'
 or(p_customer_id is null)=(p_buyer is null)then raise exception 'Paper sale details required'using errcode='22023';end if;
 payload:=jsonb_build_object('stockItemId',p_stock_item_id,'dealId',p_deal_id,'customerId',p_customer_id,'buyer',p_buyer,'priceOre',p_price_ore::text,'signedOn',p_signed_on::text,'paperReference',p_paper_reference,'note',p_note);
 perform pg_advisory_xact_lock(hashtextextended(a::text||p_request_id::text,714));
 select *into prior from private.paper_sale_reviews where actor_id=a and request_id=p_request_id;
 if found then if prior.company_id<>p_company_id or prior.input<>payload then raise exception 'Review request conflict'using errcode='40001';end if;return jsonb_build_object('companyId',p_company_id,'actorId',a,'role',r,'reviewId',prior.id,'reviewHash',prior.review_hash,'canonicalContent',prior.snapshot::text,'snapshot',prior.snapshot);end if;
 perform 1 from public.stock_items where company_id=p_company_id and id=p_stock_item_id for update;if not found then raise exception 'Stock denied'using errcode='42501';end if;
 if p_deal_id is not null then select *into d from public.deals where company_id=p_company_id and id=p_deal_id and stock_item_id=p_stock_item_id for update;if not found or d.customer_id is distinct from p_customer_id then raise exception 'Deal/customer conflict'using errcode='40001';end if;end if;
 perform private.check_paper_sale_available(p_company_id,p_stock_item_id,p_deal_id);
 if p_customer_id is not null then select *into c from public.customers where company_id=p_company_id and id=p_customer_id for share;if not found then raise exception 'Customer denied'using errcode='42501';end if;buyer:=jsonb_build_object('name',c.name,'kind',c.kind,'email',c.email,'phone',c.phone);
 else
  if jsonb_typeof(p_buyer)is distinct from'object'or jsonb_typeof(p_buyer->'name')is distinct from'string'or jsonb_typeof(p_buyer->'kind')is distinct from'string'or (p_buyer?'email'and jsonb_typeof(p_buyer->'email')not in('string','null'))or (p_buyer?'phone'and jsonb_typeof(p_buyer->'phone')not in('string','null'))or(p_buyer-array['name','kind','email','phone'])<>'{}'::jsonb or p_buyer->>'kind'not in('person','business')or p_buyer->>'kind'is null
  or p_buyer->>'name'is null or length(p_buyer->>'name')not between 2 and 160 or p_buyer->>'name'<>btrim(p_buyer->>'name')or p_buyer->>'name'~'[[:cntrl:]]'
  or(coalesce(p_buyer->>'email','')<>''and(length(p_buyer->>'email')>254 or p_buyer->>'email'!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
  or length(coalesce(p_buyer->>'phone',''))>60 or coalesce(p_buyer->>'phone','')~'[[:cntrl:]]'then raise exception 'Buyer details invalid'using errcode='22023';end if;
  buyer:=jsonb_build_object('name',p_buyer->>'name','kind',p_buyer->>'kind','email',nullif(lower(btrim(p_buyer->>'email')),''),'phone',nullif(btrim(p_buyer->>'phone'),''));
 end if;
 basis:=private.paper_sale_basis(p_company_id,p_stock_item_id,p_deal_id,p_customer_id);
 snapshot:=jsonb_build_object('source','paper','buyer',buyer,'vehicle',basis->'vehicle','priceOre',p_price_ore::text,'signedOn',p_signed_on::text,'paperReference',p_paper_reference,'note',p_note,'bankVerified',false,'digitalSignature',false);
 insert into private.paper_sale_reviews(company_id,stock_item_id,deal_id,actor_id,request_id,input,snapshot,source_hash,review_hash)
 values(p_company_id,p_stock_item_id,p_deal_id,a,p_request_id,payload,snapshot,encode(sha256(convert_to(basis::text,'UTF8')),'hex'),encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'))returning *into saved;
 return jsonb_build_object('companyId',p_company_id,'actorId',a,'role',r,'reviewId',saved.id,'reviewHash',saved.review_hash,'canonicalContent',saved.snapshot::text,'snapshot',saved.snapshot);
end$$;
create function private.confirm_paper_sale(p_company_id uuid,p_review_id uuid,p_review_hash text,p_acknowledged boolean,p_request_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$declare a uuid;r text;q private.paper_sale_reviews;old private.paper_sale_requests;p private.paper_sales;payload jsonb;basis jsonb;buyer jsonb;customer uuid;deal uuid;begin
 select x.actor,x.actor_role into a,r from private.paper_sale_scope(p_company_id,true)x;
 if p_request_id is null or p_acknowledged is distinct from true or p_review_hash is null or p_review_hash!~'^[a-f0-9]{64}$'then raise exception 'Paper attestation required'using errcode='22023';end if;
 payload:=jsonb_build_object('reviewId',p_review_id,'reviewHash',p_review_hash,'acknowledged',true);
 -- Request lease is acquired before source lookup and reused for exact receipt replay.
 perform pg_advisory_xact_lock(hashtextextended(a::text||p_request_id::text,715));select *into old from private.paper_sale_requests where actor_id=a and request_id=p_request_id;
 if found then if old.payload<>payload then raise exception 'Paper request conflict'using errcode='40001';end if;select *into p from private.paper_sales where id=old.sale_id and company_id=p_company_id;if not found then raise exception 'Receipt denied'using errcode='42501';end if;return jsonb_build_object('companyId',p_company_id,'actorId',a,'role',r,'receipt',private.paper_sale_receipt(p));end if;
 select *into q from private.paper_sale_reviews where id=p_review_id and company_id=p_company_id and actor_id=a;if not found then raise exception 'Review denied'using errcode='42501';end if;
 if q.review_hash<>p_review_hash then raise exception 'Review changed'using errcode='40001';end if;
 perform 1 from public.stock_items where company_id=p_company_id and id=q.stock_item_id for update;
 if q.deal_id is not null then perform 1 from public.deals where company_id=p_company_id and id=q.deal_id for update;end if;
 perform private.check_paper_sale_available(p_company_id,q.stock_item_id,q.deal_id);
 if q.input->>'customerId'is not null then perform 1 from public.customers where company_id=p_company_id and id=(q.input->>'customerId')::uuid for share;end if;
 basis:=private.paper_sale_basis(p_company_id,q.stock_item_id,q.deal_id,(q.input->>'customerId')::uuid);
 if encode(sha256(convert_to(basis::text,'UTF8')),'hex')<>q.source_hash then raise exception 'Stock/customer/deal changed since review'using errcode='40001';end if;
 buyer:=q.snapshot->'buyer';customer:=(q.input->>'customerId')::uuid;
 if customer is null then insert into public.customers(company_id,name,kind,email,phone)values(p_company_id,buyer->>'name',buyer->>'kind',buyer->>'email',buyer->>'phone')returning id into customer;end if;
 deal:=q.deal_id;if deal is null then insert into public.deals(company_id,stock_item_id,customer_id,sale_price_ore,created_by,status)values(p_company_id,q.stock_item_id,customer,(q.snapshot->>'priceOre')::bigint,a,'draft')returning id into deal;end if;
 insert into private.paper_sales(company_id,stock_item_id,deal_id,customer_id,review_id,actor_id,sale_price_ore,signed_on,paper_reference,note,snapshot)
 values(p_company_id,q.stock_item_id,deal,customer,q.id,a,(q.snapshot->>'priceOre')::bigint,(q.snapshot->>'signedOn')::date,q.snapshot->>'paperReference',q.snapshot->>'note',q.snapshot)returning *into p;
 update public.reservations set status='released'where company_id=p_company_id and stock_item_id=q.stock_item_id and status='active'and(deal_id=deal or expires_at<=clock_timestamp());
 update public.deals set sale_price_ore=p.sale_price_ore,status='completed'where company_id=p_company_id and id=deal;
 update public.stock_items set status='sold'where company_id=p_company_id and id=q.stock_item_id;
 insert into private.paper_sale_requests(actor_id,request_id,payload,sale_id)values(a,p_request_id,payload,p.id);
 return jsonb_build_object('companyId',p_company_id,'actorId',a,'role',r,'receipt',private.paper_sale_receipt(p));
end$$;
create function public.get_paper_sale_options(p_company_id uuid,p_stock_item_id uuid,p_deal_id uuid default null)returns jsonb language sql security invoker set search_path=''as $$select private.get_paper_sale_options(p_company_id,p_stock_item_id,p_deal_id)$$;
create function public.prepare_paper_sale(p_company_id uuid,p_stock_item_id uuid,p_deal_id uuid,p_customer_id uuid,p_buyer jsonb,p_price_ore bigint,p_signed_on date,p_paper_reference text,p_note text,p_request_id uuid)returns jsonb language sql security invoker set search_path=''as $$select private.prepare_paper_sale(p_company_id,p_stock_item_id,p_deal_id,p_customer_id,p_buyer,p_price_ore,p_signed_on,p_paper_reference,p_note,p_request_id)$$;
create function public.confirm_paper_sale(p_company_id uuid,p_review_id uuid,p_review_hash text,p_acknowledged boolean,p_request_id uuid)returns jsonb language sql security invoker set search_path=''as $$select private.confirm_paper_sale(p_company_id,p_review_id,p_review_hash,p_acknowledged,p_request_id)$$;
do $$declare f record;begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='private'and p.proname in('paper_sale_scope','paper_sale_receipt','paper_sale_basis','check_paper_sale_available','get_paper_sale_options','prepare_paper_sale','confirm_paper_sale'))or(n.nspname='public'and p.proname in('get_paper_sale_options','prepare_paper_sale','confirm_paper_sale'))loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);end loop;end$$;
grant execute on function private.get_paper_sale_options(uuid,uuid,uuid),public.get_paper_sale_options(uuid,uuid,uuid),private.prepare_paper_sale(uuid,uuid,uuid,uuid,jsonb,bigint,date,text,text,uuid),public.prepare_paper_sale(uuid,uuid,uuid,uuid,jsonb,bigint,date,text,text,uuid),private.confirm_paper_sale(uuid,uuid,text,boolean,uuid),public.confirm_paper_sale(uuid,uuid,text,boolean,uuid)to authenticated;
commit;
