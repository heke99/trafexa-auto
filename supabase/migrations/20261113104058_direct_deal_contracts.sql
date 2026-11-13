begin;
-- Private identity data never joins ordinary customer lists or browser persistence.
alter table public.customers add column contact_version integer not null default 1 check(contact_version>0);
create function private.bump_customer_contact_version() returns trigger language plpgsql set search_path='' as $$begin new.contact_version:=old.contact_version+1;return new;end$$;
create trigger customer_contact_version before update on public.customers for each row execute function private.bump_customer_contact_version();
revoke all on function private.bump_customer_contact_version() from public,anon,authenticated,service_role;
create table private.customer_identity_numbers(company_id uuid not null,customer_id uuid not null,kind text not null check(kind in('person','business')),identity_number text not null,primary key(company_id,customer_id),foreign key(company_id,customer_id) references public.customers(company_id,id));
alter table private.customer_identity_numbers enable row level security;
revoke all on private.customer_identity_numbers from public,anon,authenticated,service_role;
create table private.direct_deal_reviews(actor_id uuid not null references auth.users(id),request_id uuid not null,company_id uuid not null references public.companies(id),deal_id uuid not null,draft_id uuid not null unique references private.sale_contract_drafts(id),input_hash text not null,customer_version integer not null,customer_patch jsonb,template_requires_approval boolean not null default false,created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id),foreign key(company_id,deal_id) references public.deals(company_id,id));
alter table private.direct_deal_reviews enable row level security;
revoke all on private.direct_deal_reviews from public,anon,authenticated,service_role;
create trigger direct_deal_review_immutable before update or delete on private.direct_deal_reviews for each row execute function private.sale_contract_immutable();
alter table private.sale_contract_drafts alter column offer_id drop not null;
alter table private.contract_signatures add column approval_method text not null default 'drawn' check(approval_method in('drawn','typed_name'));
alter table private.contract_signatures add constraint typed_company_approval check(approval_method<>'typed_name' or(party='company' and strokes='[]'::jsonb));

create function private.normalize_customer_identity(p_kind text,p_value text) returns text language plpgsql stable set search_path='' as $$
declare n text;ten text;total integer:=0;i integer;v integer;yy integer;mm integer;dd integer;today date:=(clock_timestamp() at time zone 'Europe/Stockholm')::date;
begin
 if p_kind not in('person','business') or p_value is null or p_value !~ '^[0-9 +\-]+$' then raise exception 'Invalid customer identity' using errcode='22023';end if;
 n:=regexp_replace(p_value,'[ +\-]','','g');
 if p_kind='person' then
  if length(n)=10 then yy:=(extract(year from today)::integer/100)*100+substring(n,1,2)::integer;if yy>extract(year from today)::integer then yy:=yy-100;end if;if position('+' in p_value)>0 then yy:=yy-100;end if;n:=yy::text||substring(n,3);end if;
  if n !~ '^[0-9]{12}$' then raise exception 'Invalid personal identity' using errcode='22023';end if;
  yy:=substring(n,1,4)::integer;mm:=substring(n,5,2)::integer;dd:=substring(n,7,2)::integer;
  if dd>60 then dd:=dd-60;end if;
  if yy<1800 or make_date(yy,mm,dd)>today then raise exception 'Invalid identity date' using errcode='22023';end if;
  ten:=substring(n,3);
 else
  if length(n)=12 and left(n,2)='16' then n:=substring(n,3);end if;
  if n !~ '^[0-9]{10}$' or n ~ '^0{10}$' then raise exception 'Invalid organisation identity' using errcode='22023';end if;ten:=n;
 end if;
 for i in 1..10 loop v:=substring(ten,i,1)::integer*case when i%2=1 then 2 else 1 end;total:=total+v/10+v%10;end loop;
 if total%10<>0 then raise exception 'Invalid identity checksum' using errcode='22023';end if;return n;
exception when datetime_field_overflow then raise exception 'Invalid identity date' using errcode='22023';end$$;
revoke all on function private.normalize_customer_identity(text,text) from public,anon,authenticated,service_role;

create function private.direct_customer_context(c public.customers) returns jsonb language sql stable set search_path='' as $$select jsonb_build_object('id',c.id,'name',c.name,'kind',c.kind,'email',coalesce(c.email,''),'phone',coalesce(c.phone,''),'address',coalesce(c.address,''),'version',c.contact_version,'identityPresent',exists(select 1 from private.customer_identity_numbers i where i.company_id=c.company_id and i.customer_id=c.id and i.kind=c.kind));$$;
create function private.direct_deal_review_json(r private.direct_deal_reviews) returns jsonb language sql stable set search_path='' as $$select jsonb_build_object('companyId',r.company_id,'dealId',r.deal_id,'requestId',r.request_id,'customerVersion',r.customer_version,'templateApprovalRequired',r.template_requires_approval,'draft',private.sale_contract_draft_json(d),'canonicalContent',jsonb_build_object('draftId',d.id,'companyId',d.company_id,'dealId',d.deal_id,'draftVersion',d.version,'content',d.snapshot)::text,'reviewHash',encode(sha256(convert_to(jsonb_build_object('draftId',d.id,'companyId',d.company_id,'dealId',d.deal_id,'draftVersion',d.version,'content',d.snapshot)::text,'UTF8')),'hex')) from private.sale_contract_drafts d where d.id=r.draft_id;$$;
revoke all on function private.direct_customer_context(public.customers),private.direct_deal_review_json(private.direct_deal_reviews) from public,anon,authenticated,service_role;

create function private.direct_deal_access(p_company_id uuid,p_approval boolean default false) returns table(actor uuid,actor_role text) language plpgsql security invoker set search_path='' as $$
declare a uuid;r text;
begin
 select x.actor,x.actor_role into a,r from private.customer_contact_access(p_company_id,false)x;
 if r not in('owner','admin','sales') or(p_approval and r not in('owner','admin')) then raise exception 'Direct deal access denied' using errcode='42501';end if;
 return query select a,r;
end$$;
revoke all on function private.direct_deal_access(uuid,boolean) from public,anon,authenticated,service_role;

create function private.get_direct_deal_options(p_company_id uuid,p_deal_id uuid default null,p_customer_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;d public.deals;c public.customers;templates jsonb;pending private.direct_deal_reviews;s private.contract_signings;
begin
 select actor,actor_role into a,r from private.direct_deal_access(p_company_id,false);
 if p_deal_id is not null then select * into d from public.deals where company_id=p_company_id and id=p_deal_id;if not found then raise exception 'Deal denied' using errcode='42501';end if;p_customer_id:=d.customer_id;end if;
 if p_customer_id is not null then select * into c from public.customers where company_id=p_company_id and id=p_customer_id;if not found then raise exception 'Customer denied' using errcode='42501';end if;end if;
 select coalesce(jsonb_agg(private.sale_contract_template_json(x) order by x.created_at desc,x.id desc),'[]') into templates from(select * from private.sale_contract_template_versions where company_id=p_company_id and status='approved' order by created_at desc,id desc limit 100)x;
 if d.id is not null then select * into pending from private.direct_deal_reviews where company_id=p_company_id and deal_id=d.id order by created_at desc,draft_id desc limit 1;select * into s from private.contract_signings where company_id=p_company_id and deal_id=d.id;end if;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'templates',templates,'customer',case when c.id is not null then private.direct_customer_context(c) end,'deal',case when d.id is not null then jsonb_build_object('id',d.id,'stockItemId',d.stock_item_id,'customerId',d.customer_id,'agreedPriceOre',d.sale_price_ore::text,'customer',private.direct_customer_context(c)) end,'pendingReview',case when pending.draft_id is not null and s.id is null and(r<>'sales' or pending.actor_id=a) then private.direct_deal_review_json(pending) end,'agreementExists',s.id is not null,'signing',case when s.id is not null and r in('owner','admin') then private.contract_signing_json(s,a,r) end);
end$$;

create function private.prepare_direct_deal(p_company_id uuid,p_request_id uuid,p_deal_id uuid,p_stock_item_id uuid,p_customer_id uuid,p_customer jsonb,p_expected_customer_version integer,p_price_ore bigint,p_template_version_id uuid,p_expected_template_approval_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;prior private.direct_deal_reviews;customer public.customers;d public.deals;t private.sale_contract_template_versions;identity_value text;patch jsonb;payload_hash text;src jsonb;snapshot jsonb;draft private.sale_contract_drafts;next_version integer;vat bigint;now_at timestamptz:=clock_timestamp();
begin
 select actor,actor_role into a,r from private.direct_deal_access(p_company_id,false);
 if p_request_id is null or p_stock_item_id is null or p_price_ore is null or p_price_ore not between 1 and 999999999999 then raise exception 'Invalid direct deal' using errcode='22023';end if;
 payload_hash:=encode(sha256(convert_to(jsonb_build_object('companyId',p_company_id,'dealId',p_deal_id,'stockItemId',p_stock_item_id,'customerId',p_customer_id,'customer',p_customer,'expectedCustomerVersion',p_expected_customer_version,'priceOre',p_price_ore,'templateVersionId',p_template_version_id,'templateApprovalVersion',p_expected_template_approval_version)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('direct-deal:'||a::text||':'||p_request_id::text,0));
 select * into prior from private.direct_deal_reviews where actor_id=a and request_id=p_request_id;
 if found then if prior.company_id<>p_company_id or prior.input_hash<>payload_hash then raise exception 'Direct deal request changed' using errcode='40001';end if;return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'review',private.direct_deal_review_json(prior));end if;
 if p_deal_id is not null then select * into d from public.deals where company_id=p_company_id and id=p_deal_id for update;if not found or d.stock_item_id<>p_stock_item_id or d.customer_id is distinct from p_customer_id then raise exception 'Deal denied' using errcode='42501';end if;end if;
 if p_customer_id is null and p_customer is null then raise exception 'Customer required' using errcode='22023';end if;
 if p_customer_id is not null then select * into customer from public.customers where company_id=p_company_id and id=p_customer_id for update;if not found then raise exception 'Customer denied' using errcode='42501';end if;if p_expected_customer_version is distinct from customer.contact_version then raise exception 'Customer changed' using errcode='40001';end if;end if;
 if p_customer is not null then
  if jsonb_typeof(p_customer)<>'object' or (p_customer-array['name','kind','email','phone','address','identityNumber'])<>'{}'::jsonb or(select count(*) from jsonb_object_keys(p_customer))<>6 then raise exception 'Invalid customer fields' using errcode='22023';end if;
  if exists(select 1 from jsonb_each(p_customer) x where jsonb_typeof(x.value)<>'string') or p_customer->>'kind' not in('person','business') or p_customer->>'name' is null or length(btrim(p_customer->>'name')) not between 2 and 160 or p_customer->>'email' is null or lower(btrim(p_customer->>'email')) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p_customer->>'email')>254 or p_customer->>'phone' is null or regexp_replace(p_customer->>'phone','[^0-9]','','g') !~ '^[0-9]{7,15}$' or length(p_customer->>'address')>500 or ((p_customer->>'name')||(p_customer->>'email')||(p_customer->>'phone')) ~ '[[:cntrl:]]' then raise exception 'Customer contact incomplete' using errcode='22023';end if;
  patch:=jsonb_build_object('name',btrim(p_customer->>'name'),'kind',p_customer->>'kind','email',lower(btrim(p_customer->>'email')),'phone',btrim(p_customer->>'phone'),'address',btrim(p_customer->>'address'));
  if coalesce(p_customer->>'identityNumber','')<>'' then identity_value:=private.normalize_customer_identity(p_customer->>'kind',p_customer->>'identityNumber');end if;
 end if;
 if customer.id is not null and identity_value is null then select identity_number into identity_value from private.customer_identity_numbers where company_id=p_company_id and customer_id=customer.id and kind=coalesce(patch->>'kind',customer.kind);end if;
 if identity_value is null then raise exception 'Customer identity required' using errcode='22023';end if;
 if customer.id is null then
  insert into public.customers(company_id,name,kind,email,phone,address) values(p_company_id,patch->>'name',patch->>'kind',patch->>'email',patch->>'phone',patch->>'address') returning * into customer;
  insert into private.customer_identity_numbers values(p_company_id,customer.id,customer.kind,identity_value);patch:=null;
 end if;
 if coalesce(patch->>'email',customer.email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or regexp_replace(coalesce(patch->>'phone',customer.phone,''),'[^0-9]','','g') !~ '^[0-9]{7,15}$' then raise exception 'Customer contact incomplete' using errcode='22023';end if;
 if p_deal_id is null then p_deal_id:=private.create_deal(p_company_id,p_stock_item_id,customer.id,p_price_ore);end if;
 select * into d from public.deals where company_id=p_company_id and id=p_deal_id for update;
 if not found or d.stock_item_id<>p_stock_item_id or d.customer_id<>customer.id then raise exception 'Deal denied' using errcode='42501';end if;
 if d.status not in('draft','reserved') or exists(select 1 from private.contract_signings where company_id=p_company_id and deal_id=d.id) or exists(select 1 from private.offer_reviews where company_id=p_company_id and deal_id=d.id and status in('pending','accepted')) then raise exception 'Deal already has reviewed source or signing' using errcode='40001';end if;
 select * into t from private.sale_contract_template_versions where company_id=p_company_id and id=p_template_version_id for share;
 if p_template_version_id is null then
  if p_expected_template_approval_version is distinct from 0 then raise exception 'Template changed' using errcode='40001';end if;
  insert into private.sale_contract_template_versions(company_id,template_id,version,title,body,status,created_by)
  values(p_company_id,gen_random_uuid(),1,'Trafexa-grundavtal',E'Avtal om köp av fordon.\nSäljare: {{company.name}}, organisationsnummer {{company.organisation_number}}.\nKöpare: {{customer.name}}.\nFordon: {{vehicle.make}} {{vehicle.model}}, registreringsnummer {{vehicle.registration}}.\nÖverenskommet totalpris inklusive eventuell moms: {{offer.price_ore}}.\nKund-, fordons- och momsuppgifterna framgår av avtalet. Parterna godkänner de angivna uppgifterna och villkoren. Underskriften bekräftar inte att betalning, finansiering eller leverans har genomförts. Tvingande konsumentskydd gäller när köparen är konsument. Ytterligare överenskommelser ska dokumenteras separat innan parterna skriver under.','draft',a) returning * into t;
 elsif not found or t.approval_version is distinct from p_expected_template_approval_version or t.status not in('approved','draft')
 or(t.status='draft' and not exists(select 1 from private.sale_contract_drafts x join private.direct_deal_reviews q on q.draft_id=x.id where x.company_id=p_company_id and x.deal_id=d.id and x.template_version_id=t.id and q.template_requires_approval)) then raise exception 'Template changed' using errcode='40001';end if;
 update public.deals set sale_price_ore=p_price_ore where company_id=p_company_id and id=d.id;
 select coalesce(max(version),0)+1 into next_version from private.sale_contract_drafts where company_id=p_company_id and deal_id=d.id;
 vat:=(p_price_ore+2)/5;
 select jsonb_build_object('schema_version',1,'document_type','offer','version',next_version,'deal_id',d.id,'issued_at',now_at,'valid_until',((now_at at time zone 'Europe/Stockholm')::date+90)::text,'terms','','currency','SEK','price_basis','gross','sale_price_ore',p_price_ore::text,
 'company',jsonb_build_object('id',c.id,'name',c.name,'organisation_number',c.organisation_number),
 'customer',jsonb_build_object('id',customer.id,'kind',coalesce(patch->>'kind',customer.kind),'name',coalesce(patch->>'name',customer.name),'email',coalesce(patch->>'email',customer.email),'phone',coalesce(patch->>'phone',customer.phone),'address',coalesce(patch->>'address',customer.address)),
 'stock',jsonb_build_object('id',s.id,'vat_scheme',s.vat_scheme),'vehicle',jsonb_build_object('id',v.id,'registration_number',v.registration_number,'vin',v.vin,'make',v.make,'model',v.model,'model_year',v.model_year,'mileage_km',v.mileage_km,'fuel',v.fuel,'gearbox',v.gearbox),
 'vat',jsonb_build_object('rate_percent',case when s.vat_scheme='standard' then 25 else null end,'amount_ore',case when s.vat_scheme='standard' then vat::text else null end,'net_price_ore',case when s.vat_scheme='standard' then(p_price_ore-vat)::text else null end)) into src
 from public.companies c join public.stock_items s on s.company_id=c.id and s.id=d.stock_item_id join public.vehicles v on v.company_id=c.id and v.id=s.vehicle_id where c.id=p_company_id and c.status='active';
 if src is null then raise exception 'Deal source unavailable' using errcode='42501';end if;
 snapshot:=jsonb_build_object('offerVersion',next_version,'sourceKind','direct_deal','customerIdentity',jsonb_build_object('kind',coalesce(patch->>'kind',customer.kind),'number',identity_value),'template',jsonb_build_object('id',t.id,'templateId',t.template_id,'version',t.version,'approvalVersion',t.approval_version,'title',t.title,'body',t.body),'sourceOffer',src);
 insert into private.sale_contract_drafts(company_id,deal_id,version,offer_id,template_version_id,snapshot,created_by,created_at) values(p_company_id,d.id,next_version,null,t.id,snapshot,a,now_at) returning * into draft;
 insert into private.direct_deal_reviews(actor_id,request_id,company_id,deal_id,draft_id,input_hash,customer_version,customer_patch,template_requires_approval) values(a,p_request_id,p_company_id,d.id,draft.id,payload_hash,customer.contact_version,patch,t.status='draft') returning * into prior;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'review',private.direct_deal_review_json(prior));
end$$;

create function private.approve_direct_deal(p_company_id uuid,p_deal_id uuid,p_draft_id uuid,p_review_hash text,p_seller_name text,p_acknowledged boolean,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;d public.deals;draft private.sale_contract_drafts;q private.direct_deal_reviews;customer public.customers;t private.sale_contract_template_versions;s private.contract_signings;p jsonb;receipt jsonb;canonical text;identity_value text;
begin
 select actor,actor_role into a,r from private.sale_contract_access(p_company_id,true);
 if p_draft_id is null or p_request_id is null or p_review_hash is null or p_review_hash !~ '^[a-f0-9]{64}$' or p_acknowledged is distinct from true or p_seller_name is null or p_seller_name<>btrim(p_seller_name) or length(p_seller_name) not between 2 and 160 or p_seller_name ~ '[[:cntrl:]]' then raise exception 'Review required' using errcode='22023';end if;
 select * into d from public.deals where company_id=p_company_id and id=p_deal_id for update;if not found then raise exception 'Deal denied' using errcode='42501';end if;
 p:=jsonb_build_object('operation','approveDirectDeal','companyId',p_company_id,'dealId',p_deal_id,'draftId',p_draft_id,'reviewHash',p_review_hash,'sellerName',p_seller_name,'acknowledged',true,'consentVersion','2026-10-14');
 receipt:=private.contract_signing_replay(a,p_request_id,p);if receipt is not null then return receipt;end if;
 select * into draft from private.sale_contract_drafts where company_id=p_company_id and deal_id=d.id and id=p_draft_id;
 select * into q from private.direct_deal_reviews where company_id=p_company_id and deal_id=d.id and draft_id=p_draft_id;
 if draft.id is null or q.draft_id is null or draft.offer_id is not null or draft.snapshot->>'sourceKind' is distinct from 'direct_deal' then raise exception 'Direct source denied' using errcode='42501';end if;
 if d.status not in('draft','reserved') or exists(select 1 from private.contract_signings where company_id=p_company_id and deal_id=d.id) or exists(select 1 from private.sale_contract_drafts where company_id=p_company_id and deal_id=d.id and version>draft.version) or exists(select 1 from private.offer_reviews where company_id=p_company_id and deal_id=d.id and status in('pending','accepted')) then raise exception 'Deal source changed' using errcode='40001';end if;
 canonical:=jsonb_build_object('draftId',draft.id,'companyId',draft.company_id,'dealId',draft.deal_id,'draftVersion',draft.version,'content',draft.snapshot)::text;
 if encode(sha256(convert_to(canonical,'UTF8')),'hex')<>p_review_hash or(draft.snapshot#>>'{sourceOffer,sale_price_ore}')::bigint<>d.sale_price_ore then raise exception 'Review changed' using errcode='40001';end if;
 select * into customer from public.customers where company_id=p_company_id and id=d.customer_id for update;
 if not found or customer.contact_version<>q.customer_version then raise exception 'Customer changed since review' using errcode='40001';end if;
 select * into t from private.sale_contract_template_versions where company_id=p_company_id and id=draft.template_version_id for update;
 if not found or t.body is distinct from draft.snapshot#>>'{template,body}' or t.approval_version<>(draft.snapshot#>>'{template,approvalVersion}')::integer or (case when q.template_requires_approval then t.status<>'draft' else t.status<>'approved' end) then raise exception 'Template changed' using errcode='40001';end if;
 if q.template_requires_approval then update private.sale_contract_template_versions set status='approved',approval_version=approval_version+1,approved_at=clock_timestamp() where id=t.id returning * into t;insert into private.sale_contract_audit(company_id,actor_user_id,request_id,payload,receipt) values(p_company_id,a,p_request_id,jsonb_build_object('operation','approveDirectTemplate','draftId',draft.id,'reviewHash',p_review_hash,'templateVersionId',t.id,'expectedApprovalVersion',t.approval_version-1,'acknowledged',true),jsonb_build_object('companyId',p_company_id,'actorUserId',a,'requestId',p_request_id,'template',private.sale_contract_template_json(t)));end if;
 identity_value:=private.normalize_customer_identity(draft.snapshot#>>'{customerIdentity,kind}',draft.snapshot#>>'{customerIdentity,number}');
 if q.customer_patch is not null then
  update public.customers set name=q.customer_patch->>'name',kind=q.customer_patch->>'kind',email=q.customer_patch->>'email',phone=q.customer_patch->>'phone',address=q.customer_patch->>'address' where company_id=p_company_id and id=customer.id;
 end if;
 insert into private.customer_identity_numbers(company_id,customer_id,kind,identity_number) values(p_company_id,customer.id,draft.snapshot#>>'{customerIdentity,kind}',identity_value) on conflict(company_id,customer_id) do update set kind=excluded.kind,identity_number=excluded.identity_number;
 insert into private.contract_signings(company_id,deal_id,draft_id,customer_email,canonical_content,document_hash,created_by) values(p_company_id,d.id,draft.id,draft.snapshot#>>'{sourceOffer,customer,email}',canonical,p_review_hash,a) returning * into s;
 -- The dealer explicitly approves the reviewed exact content with a typed name.
 -- This is account authorization, not a drawn signature or an identity service.
 insert into private.contract_signatures(signing_id,party,actor_user_id,full_name,document_hash,consent_version,strokes,approval_method) values(s.id,'company',a,p_seller_name,s.document_hash,'2026-10-14','[]','typed_name');
 perform private.enqueue_transactional_email('contract_invitation',s.id,s.customer_email,null);
 receipt:=jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'requestId',p_request_id,'signing',private.contract_signing_json(s,a,r));
 insert into private.contract_signing_audit(actor_user_id,request_id,payload,receipt) values(a,p_request_id,p,receipt);return receipt;
end$$;

create function public.get_direct_deal_options(p_company_id uuid,p_deal_id uuid default null,p_customer_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.get_direct_deal_options(p_company_id,p_deal_id,p_customer_id);$$;
create function public.prepare_direct_deal(p_company_id uuid,p_request_id uuid,p_deal_id uuid,p_stock_item_id uuid,p_customer_id uuid,p_customer jsonb,p_expected_customer_version integer,p_price_ore bigint,p_template_version_id uuid,p_expected_template_approval_version integer) returns jsonb language sql security invoker set search_path='' as $$select private.prepare_direct_deal(p_company_id,p_request_id,p_deal_id,p_stock_item_id,p_customer_id,p_customer,p_expected_customer_version,p_price_ore,p_template_version_id,p_expected_template_approval_version);$$;
create function public.approve_direct_deal(p_company_id uuid,p_deal_id uuid,p_draft_id uuid,p_review_hash text,p_seller_name text,p_acknowledged boolean,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.approve_direct_deal(p_company_id,p_deal_id,p_draft_id,p_review_hash,p_seller_name,p_acknowledged,p_request_id);$$;
revoke all on function private.get_direct_deal_options(uuid,uuid,uuid),public.get_direct_deal_options(uuid,uuid,uuid),private.prepare_direct_deal(uuid,uuid,uuid,uuid,uuid,jsonb,integer,bigint,uuid,integer),public.prepare_direct_deal(uuid,uuid,uuid,uuid,uuid,jsonb,integer,bigint,uuid,integer),private.approve_direct_deal(uuid,uuid,uuid,text,text,boolean,uuid),public.approve_direct_deal(uuid,uuid,uuid,text,text,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_direct_deal_options(uuid,uuid,uuid),public.get_direct_deal_options(uuid,uuid,uuid),private.prepare_direct_deal(uuid,uuid,uuid,uuid,uuid,jsonb,integer,bigint,uuid,integer),public.prepare_direct_deal(uuid,uuid,uuid,uuid,uuid,jsonb,integer,bigint,uuid,integer),private.approve_direct_deal(uuid,uuid,uuid,text,text,boolean,uuid),public.approve_direct_deal(uuid,uuid,uuid,text,text,boolean,uuid) to authenticated;

create or replace function private.contract_signing_json(s private.contract_signings,a uuid,r text) returns jsonb language sql set search_path='' as $$
 select jsonb_build_object('id',s.id,'companyId',s.company_id,'dealId',s.deal_id,'draftId',s.draft_id,'draftVersion',d.version,'documentHash',s.document_hash,'canonicalContent',s.canonical_content,'draft',private.sale_contract_draft_json(d),'customerEmail',s.customer_email,'createdAt',s.created_at,
 'revision',1+q.n,'status',case when q.n=2 then 'completed' when c.status<>'active' or b.status not in('draft','reserved') then 'unavailable' else 'pending' end,
 'completedAt',case when q.n=2 then q.completed end,'customerSignature',q.customer,'companySignature',case when exists(select 1 from private.contract_signatures z where z.signing_id=s.id and z.party='company' and z.approval_method='typed_name') then q.company||jsonb_build_object('authenticationMethod','account','approvalMethod','typed_name') else q.company end,
 'party',case when r='customer' then 'customer' when r in('owner','admin') then 'company' end,
 'canSign',q.n<2 and c.status='active' and b.status in('draft','reserved') and not exists(select 1 from private.contract_party_signatures(s.id) z where (z.actor_user_id=a or z.party=case when r='customer' then 'customer' else 'company' end)) and r in('customer','owner','admin'))
 from private.sale_contract_drafts d join public.companies c on c.id=s.company_id join public.deals b on b.company_id=s.company_id and b.id=s.deal_id,
 lateral(select count(*)::integer n,max(x.signed_at) completed,
 max(case when x.party='customer' then (jsonb_build_object('party',x.party,'fullName',x.full_name,'signedAt',x.signed_at,'documentHash',x.document_hash,'consentVersion',x.consent_version,'strokes',x.strokes)||case when x.guest_invitation_id is not null then jsonb_build_object('authenticationMethod','email_link','approvalMethod','typed_name','guestInvitationId',x.guest_invitation_id,'recipientEmail',x.recipient_email) else '{}'::jsonb end)::text end)::jsonb customer,
 max(case when x.party='company' then (jsonb_build_object('party',x.party,'fullName',x.full_name,'signedAt',x.signed_at,'documentHash',x.document_hash,'consentVersion',x.consent_version,'strokes',x.strokes)||case when x.guest_invitation_id is not null then jsonb_build_object('authenticationMethod','email_link','approvalMethod','typed_name','guestInvitationId',x.guest_invitation_id,'recipientEmail',x.recipient_email) else '{}'::jsonb end)::text end)::jsonb company
 from private.contract_party_signatures(s.id) x)q where d.id=s.draft_id;
$$;

-- A direct agreement remains the real payment/delivery source; no synthetic offer ID.
alter table private.deal_payment_entries alter column offer_id drop not null;
alter table private.deal_payment_entries add column direct_signing_id uuid;
alter table private.deal_payment_entries add constraint direct_payment_signing_fk foreign key(company_id,direct_signing_id) references private.contract_signings(company_id,id);
alter table private.deal_payment_entries add constraint exactly_one_payment_source check((offer_id is not null)<>(direct_signing_id is not null));
create index deal_payment_direct_signing on private.deal_payment_entries(company_id,direct_signing_id) where direct_signing_id is not null;
alter table private.deal_deliveries alter column offer_id drop not null;

create or replace function private.deal_fulfilment_source(d public.deals,a uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare o public.offers;s private.contract_signings;c private.sale_contract_drafts;v private.contract_signing_archives;n integer;
begin
 if d.status not in('draft','reserved','completed')then return jsonb_build_object('source',null,'blockedReason','deal_unavailable');end if;
 if exists(select 1 from private.sale_contract_drafts x where x.company_id=d.company_id and x.deal_id=d.id and x.snapshot->>'sourceKind'='direct_deal') then
  select * into s from private.contract_signings where company_id=d.company_id and deal_id=d.id;
  if not found or(select count(*)from private.contract_party_signatures(s.id) where document_hash=s.document_hash and consent_version='2026-10-14')<>2 then return jsonb_build_object('source',null,'blockedReason','contract_required');end if;
  s:=private.require_contract_archive_source(s.id,d.company_id,a,false);
  select * into c from private.sale_contract_drafts where company_id=d.company_id and deal_id=d.id and id=s.draft_id;
  if c.offer_id is not null or c.snapshot->>'sourceKind' is distinct from 'direct_deal' or c.snapshot#>>'{sourceOffer,sale_price_ore}' is distinct from d.sale_price_ore::text or c.snapshot#>>'{sourceOffer,deal_id}' is distinct from d.id::text or c.snapshot#>>'{sourceOffer,company,id}' is distinct from d.company_id::text or c.snapshot#>>'{sourceOffer,customer,id}' is distinct from d.customer_id::text or c.snapshot#>>'{sourceOffer,stock,id}' is distinct from d.stock_item_id::text then raise exception 'Direct fulfilment source changed' using errcode='40001';end if;
  if c.snapshot#>'{sourceOffer,trade_in}' is not null then return jsonb_build_object('source',null,'blockedReason','trade_in_settlement_unsupported');end if;
  select *into v from private.contract_signing_archives where company_id=d.company_id and deal_id=d.id and signing_id=s.id and draft_id=c.id and document_content_sha256=s.document_hash and signing_revision=3;
  if not found then return jsonb_build_object('source',null,'blockedReason','original_required');end if;
  perform private.check_native_contract_archive_objects(v.pdf_object_path,v.pdf_bytes,v.evidence_object_path,v.evidence_bytes);
  return jsonb_build_object('source',jsonb_build_object('sourceKind','direct_deal','documentHash',s.document_hash,'offerId',null,'signingId',s.id,'archiveId',v.id,'amountDueOre',d.sale_price_ore::text),'blockedReason',null);
 end if;

 select count(*)into n from private.offer_reviews where company_id=d.company_id and deal_id=d.id and status='accepted';
 if n<>1 then return jsonb_build_object('source',null,'blockedReason','accepted_offer_required');end if;
 select x.*into o from public.offers x join private.offer_reviews r on r.company_id=x.company_id and r.offer_id=x.id and r.offer_version=x.version
 where r.company_id=d.company_id and r.deal_id=d.id and r.status='accepted'and x.deal_id=d.id;
 if not found or o.snapshot->>'sale_price_ore' is distinct from d.sale_price_ore::text or o.snapshot->>'deal_id' is distinct from d.id::text
 or o.snapshot#>>'{company,id}'is distinct from d.company_id::text or o.snapshot#>>'{customer,id}'is distinct from d.customer_id::text
 or o.snapshot#>>'{stock,id}'is distinct from d.stock_item_id::text or d.sale_price_ore not between 1 and 999999999999 then raise exception 'Fulfilment source conflict'using errcode='40001';end if;
 -- No invented settlement of trade-in debt, lender payout or negative net cash.
 if o.snapshot?'trade_in'then return jsonb_build_object('source',null,'blockedReason','trade_in_settlement_unsupported');end if;
 select *into s from private.contract_signings where company_id=d.company_id and deal_id=d.id;
 if not found or(select count(*)from private.contract_party_signatures(s.id) where document_hash=s.document_hash and consent_version='2026-10-14')<>2 then return jsonb_build_object('source',null,'blockedReason','contract_required');end if;
 s:=private.require_contract_archive_source(s.id,d.company_id,a,false);
 select *into c from private.sale_contract_drafts where company_id=d.company_id and deal_id=d.id and id=s.draft_id;
 if c.offer_id<>o.id or c.snapshot->'sourceOffer'is distinct from private.offer_review_snapshot(o.snapshot)then raise exception 'Fulfilment contract conflict'using errcode='40001';end if;
 select *into v from private.contract_signing_archives where company_id=d.company_id and deal_id=d.id and signing_id=s.id and draft_id=c.id and document_content_sha256=s.document_hash and signing_revision=3;
 if not found then return jsonb_build_object('source',null,'blockedReason','original_required');end if;
 perform private.check_native_contract_archive_objects(v.pdf_object_path,v.pdf_bytes,v.evidence_object_path,v.evidence_bytes);
 return jsonb_build_object('source',jsonb_build_object('offerId',o.id,'signingId',s.id,'archiveId',v.id,'amountDueOre',d.sale_price_ore::text),'blockedReason',null);
end$$;

create or replace function private.mutate_deal_fulfilment(p_company_id uuid,p_deal_id uuid,p_input jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid;r text;d public.deals;s public.stock_items;stock uuid;page jsonb;src jsonb;old private.deal_fulfilment_requests;entry private.deal_payment_entries;
 request uuid;op text;reason text;reference text;amount bigint;booked date;result uuid;version integer;today date:=(clock_timestamp()at time zone'Europe/Stockholm')::date;
begin
 select x.actor,x.actor_role into a,r from private.internal_inventory_scope(p_company_id,true)x;
 if r not in('owner','admin')then raise exception 'Fulfilment access denied'using errcode='42501';end if;
 if jsonb_typeof(p_input)is distinct from'object'or(p_input-array['companyId','dealId','requestId','expectedVersion','operation','amountOre','bankReference','bookedOn','reversalOf','reason'])<>'{}'::jsonb
 or p_input->>'companyId'is distinct from p_company_id::text or p_input->>'dealId'is distinct from p_deal_id::text
 or coalesce(p_input->>'requestId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 or jsonb_typeof(p_input->'expectedVersion')is distinct from'number'or coalesce(p_input->>'expectedVersion','')!~'^[0-9]{1,10}$'
 or(p_input->>'expectedVersion')::numeric>2147483646 then raise exception 'Invalid fulfilment input'using errcode='22023';end if;
 request:=(p_input->>'requestId')::uuid;op:=p_input->>'operation';reason:=p_input->>'reason';
 if op is null or op not in('payment','reverse','deliver')or reason is null or reason<>btrim(reason)or length(reason)not between 2 and 300 or reason~'[[:cntrl:]]'then raise exception 'Invalid fulfilment input'using errcode='22023';end if;
 select stock_item_id into stock from public.deals where company_id=p_company_id and id=p_deal_id;
 select *into s from public.stock_items where company_id=p_company_id and id=stock for update;
 if not found then raise exception 'Fulfilment access denied'using errcode='42501';end if;
 select *into d from public.deals where company_id=p_company_id and id=p_deal_id for update;
 if not found or d.stock_item_id<>stock then raise exception 'Fulfilment conflict'using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended(a::text||request::text,77));
 select *into old from private.deal_fulfilment_requests where actor_user_id=a and request_id=request;
 if found then if old.payload is distinct from p_input then raise exception 'Fulfilment request conflict'using errcode='40001';end if;return private.deal_fulfilment_page(d,a,r);end if;
 page:=private.deal_fulfilment_page(d,a,r);src:=page->'source';version:=(page->>'version')::integer;
 if version<>(p_input->>'expectedVersion')::integer or d.status not in('draft','reserved')or exists(select 1 from private.deal_deliveries where company_id=p_company_id and deal_id=p_deal_id)
 or src='null'::jsonb then raise exception 'Fulfilment agreement conflict'using errcode='40001';end if;
 if op='payment'then
  if p_input?'reversalOf'or coalesce(p_input->>'amountOre','')!~'^[1-9][0-9]{0,11}$'or coalesce(p_input->>'bookedOn','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'then raise exception 'Invalid payment'using errcode='22023';end if;
  amount:=(p_input->>'amountOre')::bigint;booked:=(p_input->>'bookedOn')::date;reference:=p_input->>'bankReference';
  if reference is null or reference<>btrim(reference)or length(reference)not between 2 and 300 or reference~'[[:cntrl:]]'or booked>today or booked<date'2000-01-01'then raise exception 'Invalid payment'using errcode='22023';end if;
  if version>=498 or(page->>'registeredOre')::bigint+amount>d.sale_price_ore then raise exception 'Payment amount conflict'using errcode='40001';end if;
  insert into private.deal_payment_entries(company_id,deal_id,offer_id,direct_signing_id,amount_ore,bank_reference,booked_on,reason,actor_user_id)
  values(p_company_id,p_deal_id,(src->>'offerId')::uuid,case when src->>'sourceKind'='direct_deal' then(src->>'signingId')::uuid else null end,amount,reference,booked,reason,a)returning id into result;
 elsif op='reverse'then
  if p_input?|array['amountOre','bankReference','bookedOn']or coalesce(p_input->>'reversalOf','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'then raise exception 'Invalid reversal'using errcode='22023';end if;
  select *into entry from private.deal_payment_entries where company_id=p_company_id and deal_id=p_deal_id and id=(p_input->>'reversalOf')::uuid and reversal_of is null;
  if not found or version>=499 or exists(select 1 from private.deal_payment_entries where reversal_of=entry.id)then raise exception 'Payment reversal conflict'using errcode='40001';end if;
  insert into private.deal_payment_entries(company_id,deal_id,offer_id,direct_signing_id,amount_ore,bank_reference,booked_on,reversal_of,reason,actor_user_id)
  values(p_company_id,p_deal_id,entry.offer_id,entry.direct_signing_id,-entry.amount_ore,entry.bank_reference,today,entry.id,reason,a)returning id into result;
 else
  if p_input?|array['amountOre','bankReference','bookedOn','reversalOf']or page->'canDeliver'is distinct from'true'::jsonb or s.status<>'reserved'then raise exception 'Delivery requirements conflict'using errcode='40001';end if;
  insert into private.deal_deliveries(company_id,deal_id,stock_item_id,offer_id,signing_id,archive_id,amount_ore,note,actor_user_id)
  values(p_company_id,p_deal_id,stock,(src->>'offerId')::uuid,(src->>'signingId')::uuid,(src->>'archiveId')::uuid,d.sale_price_ore,reason,a)returning id into result;
  update public.reservations set status='released'where company_id=p_company_id and stock_item_id=stock and deal_id=p_deal_id and status='active';
  update public.stock_items set status='sold'where company_id=p_company_id and id=stock;
  update public.deals set status='completed'where company_id=p_company_id and id=p_deal_id;
  select *into d from public.deals where company_id=p_company_id and id=p_deal_id;
 end if;
 insert into private.deal_fulfilment_requests(actor_user_id,request_id,company_id,deal_id,payload,receipt)values(a,request,p_company_id,p_deal_id,p_input,jsonb_build_object('id',result,'operation',op,'manual',true));
 return private.deal_fulfilment_page(d,a,r);
end$$;
commit;
