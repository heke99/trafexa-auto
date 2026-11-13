begin;
-- Preserve every existing signed snapshot/hash and historical acquisition receipt.
create function private.direct_trade_in_snapshot(t private.trade_in_versions,p_sale_price bigint) returns jsonb language sql immutable set search_path='' as $$select jsonb_build_object('id',t.id,'version',t.version,'registration',t.registration,'make',t.make,'model',t.model,'model_year',t.model_year,'mileage_km',t.mileage_km,'value_ore',t.value_ore::text,'debt_known',t.debt_known,'debt_ore',t.debt_ore::text,'net_trade_in_ore',(t.value_ore-t.debt_ore)::text,'amount_to_pay_ore',(p_sale_price-t.value_ore+t.debt_ore)::text);$$;
revoke all on function private.direct_trade_in_snapshot(private.trade_in_versions,bigint) from public,anon,authenticated,service_role;
create or replace function private.get_direct_deal_options(p_company_id uuid,p_deal_id uuid default null,p_customer_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;d public.deals;c public.customers;templates jsonb;pending private.direct_deal_reviews;s private.contract_signings;
begin
 select actor,actor_role into a,r from private.direct_deal_access(p_company_id,false);
 if p_deal_id is not null then select * into d from public.deals where company_id=p_company_id and id=p_deal_id;if not found then raise exception 'Deal denied' using errcode='42501';end if;p_customer_id:=d.customer_id;end if;
 if p_customer_id is not null then select * into c from public.customers where company_id=p_company_id and id=p_customer_id;if not found then raise exception 'Customer denied' using errcode='42501';end if;end if;
 select coalesce(jsonb_agg(private.sale_contract_template_json(x) order by x.created_at desc,x.id desc),'[]') into templates from(select * from private.sale_contract_template_versions where company_id=p_company_id and status='approved' order by created_at desc,id desc limit 100)x;
 if d.id is not null then select * into pending from private.direct_deal_reviews where company_id=p_company_id and deal_id=d.id order by created_at desc,draft_id desc limit 1;select * into s from private.contract_signings where company_id=p_company_id and deal_id=d.id;end if;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'templates',templates,'tradeIns',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'version',x.version,'registration',x.registration,'make',x.make,'model',x.model,'valueOre',x.value_ore::text,'debtKnown',x.debt_known,'debtOre',x.debt_ore::text,'salePriceOre',x.sale_price_ore::text) order by x.version desc) from(select * from private.trade_in_versions where company_id=p_company_id and deal_id=d.id order by version desc limit 50)x),'[]'::jsonb),'customer',case when c.id is not null then private.direct_customer_context(c) end,'deal',case when d.id is not null then jsonb_build_object('id',d.id,'stockItemId',d.stock_item_id,'customerId',d.customer_id,'agreedPriceOre',d.sale_price_ore::text,'customer',private.direct_customer_context(c)) end,'pendingReview',case when pending.draft_id is not null and s.id is null and(r<>'sales' or pending.actor_id=a) then private.direct_deal_review_json(pending) end,'agreementExists',s.id is not null,'signing',case when s.id is not null and r in('owner','admin') then private.contract_signing_json(s,a,r) end);
end$$;
create or replace function private.prepare_direct_deal_with_trade_in(p_company_id uuid,p_request_id uuid,p_deal_id uuid,p_stock_item_id uuid,p_customer_id uuid,p_customer jsonb,p_expected_customer_version integer,p_price_ore bigint,p_template_version_id uuid,p_expected_template_approval_version integer,p_trade_in_id uuid,p_expected_trade_in_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare trade private.trade_in_versions;a uuid;r text;prior private.direct_deal_reviews;customer public.customers;d public.deals;t private.sale_contract_template_versions;identity_value text;patch jsonb;payload_hash text;src jsonb;snapshot jsonb;draft private.sale_contract_drafts;next_version integer;vat bigint;now_at timestamptz:=clock_timestamp();
begin
 select actor,actor_role into a,r from private.direct_deal_access(p_company_id,false);
 if p_request_id is null or p_stock_item_id is null or p_price_ore is null or p_price_ore not between 1 and 999999999999 then raise exception 'Invalid direct deal' using errcode='22023';end if;
 if (p_trade_in_id is null)<>(p_expected_trade_in_version is null) or p_trade_in_id is not null and (p_deal_id is null or p_expected_trade_in_version<1) then raise exception 'Explicit existing trade-in selection required' using errcode='22023';end if;
 payload_hash:=encode(sha256(convert_to(jsonb_build_object('companyId',p_company_id,'dealId',p_deal_id,'stockItemId',p_stock_item_id,'customerId',p_customer_id,'customer',p_customer,'expectedCustomerVersion',p_expected_customer_version,'priceOre',p_price_ore,'templateVersionId',p_template_version_id,'templateApprovalVersion',p_expected_template_approval_version)::text,'UTF8')),'hex');
 if p_trade_in_id is not null then payload_hash:=encode(sha256(convert_to(jsonb_build_object('base',payload_hash,'tradeInId',p_trade_in_id,'tradeInVersion',p_expected_trade_in_version)::text,'UTF8')),'hex');end if;
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
 if p_trade_in_id is not null then
  select * into trade from private.trade_in_versions where company_id=p_company_id and deal_id=d.id and id=p_trade_in_id;
  if not found or trade.customer_id<>customer.id or trade.version<>p_expected_trade_in_version or trade.version<>(select max(version) from private.trade_in_versions where company_id=p_company_id and deal_id=d.id) then raise exception 'Trade-in selection changed' using errcode='40001';end if;
  if not trade.debt_known or trade.debt_ore is null then raise exception 'Known reviewed debt required' using errcode='22023';end if;
  src:=src||jsonb_build_object('trade_in',private.direct_trade_in_snapshot(trade,p_price_ore));
 end if;
 snapshot:=jsonb_build_object('offerVersion',next_version,'sourceKind','direct_deal','customerIdentity',jsonb_build_object('kind',coalesce(patch->>'kind',customer.kind),'number',identity_value),'template',jsonb_build_object('id',t.id,'templateId',t.template_id,'version',t.version,'approvalVersion',t.approval_version,'title',t.title,'body',t.body),'sourceOffer',src);
 insert into private.sale_contract_drafts(company_id,deal_id,version,offer_id,template_version_id,snapshot,created_by,created_at) values(p_company_id,d.id,next_version,null,t.id,snapshot,a,now_at) returning * into draft;
 insert into private.direct_deal_reviews(actor_id,request_id,company_id,deal_id,draft_id,input_hash,customer_version,customer_patch,template_requires_approval) values(a,p_request_id,p_company_id,d.id,draft.id,payload_hash,customer.contact_version,patch,t.status='draft') returning * into prior;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'review',private.direct_deal_review_json(prior));
end$$;
create function public.prepare_direct_deal_with_trade_in(p_company_id uuid,p_request_id uuid,p_deal_id uuid,p_stock_item_id uuid,p_customer_id uuid,p_customer jsonb,p_expected_customer_version integer,p_price_ore bigint,p_template_version_id uuid,p_expected_template_approval_version integer,p_trade_in_id uuid,p_expected_trade_in_version integer) returns jsonb language sql security invoker set search_path='' as $$select private.prepare_direct_deal_with_trade_in(p_company_id,p_request_id,p_deal_id,p_stock_item_id,p_customer_id,p_customer,p_expected_customer_version,p_price_ore,p_template_version_id,p_expected_template_approval_version,p_trade_in_id,p_expected_trade_in_version);$$;
revoke all on function private.prepare_direct_deal_with_trade_in(uuid,uuid,uuid,uuid,uuid,jsonb,integer,bigint,uuid,integer,uuid,integer),public.prepare_direct_deal_with_trade_in(uuid,uuid,uuid,uuid,uuid,jsonb,integer,bigint,uuid,integer,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.prepare_direct_deal_with_trade_in(uuid,uuid,uuid,uuid,uuid,jsonb,integer,bigint,uuid,integer,uuid,integer),public.prepare_direct_deal_with_trade_in(uuid,uuid,uuid,uuid,uuid,jsonb,integer,bigint,uuid,integer,uuid,integer) to authenticated;
create or replace function private.approve_direct_deal(p_company_id uuid,p_deal_id uuid,p_draft_id uuid,p_review_hash text,p_seller_name text,p_acknowledged boolean,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare trade private.trade_in_versions;a uuid;r text;d public.deals;draft private.sale_contract_drafts;q private.direct_deal_reviews;customer public.customers;t private.sale_contract_template_versions;s private.contract_signings;p jsonb;receipt jsonb;canonical text;identity_value text;
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
 if draft.snapshot#>'{sourceOffer,trade_in}' is not null then
  select * into trade from private.trade_in_versions where company_id=p_company_id and deal_id=d.id and id=(draft.snapshot#>>'{sourceOffer,trade_in,id}')::uuid;
  if not found or trade.customer_id<>d.customer_id or trade.version<>(select max(version) from private.trade_in_versions where company_id=p_company_id and deal_id=d.id) or not trade.debt_known or trade.debt_ore is null or private.direct_trade_in_snapshot(trade,d.sale_price_ore) is distinct from draft.snapshot#>'{sourceOffer,trade_in}' then raise exception 'Trade-in changed since review' using errcode='40001';end if;
 end if;
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
alter table private.trade_in_acquisitions alter column offer_id drop not null;
alter table private.trade_in_acquisitions add column direct_draft_id uuid;
alter table private.trade_in_acquisitions add constraint trade_in_acquisition_direct_draft foreign key(company_id,direct_draft_id) references private.sale_contract_drafts(company_id,id);
alter table private.trade_in_acquisitions add constraint trade_in_acquisition_source_kind check((
 (offer_id is not null and direct_draft_id is null and not source?'sourceKind' and not source?'draftId') or
 (offer_id is null and direct_draft_id is not null and source->>'sourceKind'='direct_deal' and source->>'draftId'=direct_draft_id::text and source->'offerId'='null'::jsonb)) is true);
create or replace function private.trade_in_acquisition_source(d public.deals,a uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.offers;t private.trade_in_versions;s private.contract_signings;draft private.sale_contract_drafts;
 safe jsonb;expected_trade jsonb;base jsonb;native_state jsonb;n integer;
begin
 select * into s from private.contract_signings where company_id=d.company_id and deal_id=d.id;
 if found then select * into draft from private.sale_contract_drafts where company_id=d.company_id and deal_id=d.id and id=s.draft_id;end if;
 if draft.snapshot->>'sourceKind'='direct_deal' then
  safe:=draft.snapshot->'sourceOffer';
  if not safe?'trade_in' then return jsonb_build_object('source',null,'reason','no_accepted_trade_in');end if;
  if draft.offer_id is not null or safe#>>'{trade_in,id}' is null then raise exception 'Direct acquisition source invalid' using errcode='40001';end if;
  select * into t from private.trade_in_versions where company_id=d.company_id and deal_id=d.id and id=(safe#>>'{trade_in,id}')::uuid;
  if not found or t.customer_id<>d.customer_id or not t.debt_known or t.debt_ore is null or safe->'trade_in' is distinct from private.direct_trade_in_snapshot(t,(safe->>'sale_price_ore')::bigint) or safe#>>'{customer,id}'<>t.customer_id::text or safe#>>'{company,id}'<>d.company_id::text or safe->>'deal_id'<>d.id::text or safe#>>'{stock,id}'<>d.stock_item_id::text or safe->>'version'<>draft.version::text or t.model_year not between 1900 and 2100 or upper(regexp_replace(t.registration,'[[:space:]]','','g')) !~ '^[A-Z0-9-]{2,15}$' then raise exception 'Direct acquisition source conflict' using errcode='40001';end if;
  native_state:=private.contract_signing_json(s,a,'finance');
  if native_state->>'status' is distinct from 'completed' or native_state->'revision' is distinct from to_jsonb(3) then return jsonb_build_object('source',null,'reason','contract_incomplete');end if;
  s:=private.require_contract_archive_source(s.id,d.company_id,a,false);
  base:=jsonb_build_object('companyId',d.company_id,'dealId',d.id,'sourceKind','direct_deal','draftId',draft.id,'offerId',null,'offerVersion',draft.version,'tradeInId',t.id,'tradeInVersion',t.version,'sellerCustomerId',t.customer_id,'signingId',s.id,'signingDocumentSha256',s.document_hash,'signingRevision',3,'offerSnapshot',safe);
  return jsonb_build_object('source',base||jsonb_build_object('sourceSha256',encode(sha256(convert_to(base::text,'UTF8')),'hex')),'reason',null);
 end if;
 select count(*) into n from private.offer_reviews r join public.offers x on x.company_id=r.company_id and x.id=r.offer_id
 where r.company_id=d.company_id and r.deal_id=d.id and r.status='accepted' and x.snapshot?'trade_in';
 if n=0 then return jsonb_build_object('source',null,'reason','no_accepted_trade_in');end if;
 if n<>1 then raise exception 'Ambiguous acquisition source' using errcode='40001';end if;
 select x.* into o from public.offers x join private.offer_reviews r on r.company_id=x.company_id and r.offer_id=x.id
 where r.company_id=d.company_id and r.deal_id=d.id and r.status='accepted' and x.snapshot?'trade_in'
 and x.deal_id=d.id and r.offer_version=x.version;
 if not found or jsonb_typeof(o.snapshot->'trade_in') is distinct from 'object'
 or coalesce(o.snapshot#>>'{trade_in,id}','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
  raise exception 'Acquisition offer source conflict' using errcode='40001';end if;
 select * into t from private.trade_in_versions where company_id=d.company_id and deal_id=d.id and id=(o.snapshot#>>'{trade_in,id}')::uuid;
 if not found or t.customer_id<>d.customer_id or o.snapshot#>>'{customer,id}' is distinct from t.customer_id::text
 or o.snapshot#>>'{company,id}' is distinct from d.company_id::text or o.snapshot->>'deal_id' is distinct from d.id::text
 or o.snapshot#>>'{stock,id}' is distinct from d.stock_item_id::text or o.snapshot->>'version' is distinct from o.version::text
 or o.snapshot->>'sale_price_ore' is distinct from t.sale_price_ore::text or not t.debt_known or t.debt_ore is null then
  raise exception 'Acquisition trade-in source conflict' using errcode='40001';end if;
 expected_trade:=jsonb_build_object('id',t.id,'version',t.version,'registration',t.registration,'make',t.make,'model',t.model,
 'model_year',t.model_year,'mileage_km',t.mileage_km,'value_ore',t.value_ore::text,'debt_known',true,'debt_ore',t.debt_ore::text,
 'net_trade_in_ore',(t.value_ore-t.debt_ore)::text,'amount_to_pay_ore',(t.sale_price_ore-t.value_ore+t.debt_ore)::text);
 safe:=private.offer_review_snapshot(o.snapshot);
 if safe->'trade_in' is distinct from expected_trade
 or upper(regexp_replace(t.registration,'[[:space:]]','','g')) !~ '^[A-Z0-9-]{2,15}$' or t.model_year not between 1900 and 2100 then
  raise exception 'Acquisition trade-in snapshot conflict' using errcode='40001';end if;
 select * into s from private.contract_signings where company_id=d.company_id and deal_id=d.id;
 if not found then return jsonb_build_object('source',null,'reason','contract_incomplete');end if;
 -- Native status/revision are derived from immutable receipts, not stored columns.
 native_state:=private.contract_signing_json(s,a,'finance');
 if native_state->>'status' is distinct from 'completed' or native_state->'revision' is distinct from to_jsonb(3) then return jsonb_build_object('source',null,'reason','contract_incomplete');end if;
 s:=private.require_contract_archive_source(s.id,d.company_id,a,false);
 select * into draft from private.sale_contract_drafts where company_id=d.company_id and deal_id=d.id and id=s.draft_id;
 if draft.offer_id<>o.id or draft.snapshot->'sourceOffer' is distinct from safe then raise exception 'Completed acquisition contract source conflict' using errcode='40001';end if;
 base:=jsonb_build_object('companyId',d.company_id,'dealId',d.id,'offerId',o.id,'offerVersion',o.version,'tradeInId',t.id,'tradeInVersion',t.version,
 'sellerCustomerId',t.customer_id,'signingId',s.id,'signingDocumentSha256',s.document_hash,'signingRevision',3,'offerSnapshot',safe);
 return jsonb_build_object('source',base||jsonb_build_object('sourceSha256',encode(sha256(convert_to(base::text,'UTF8')),'hex')),'reason',null);
end$$;
create or replace function private.record_trade_in_acquisition(
 p_company_id uuid,p_deal_id uuid,p_expected_source_sha256 text,p_acquired_on date,p_purchase_agreement_reference text,
 p_debt_confirmed_ore bigint,p_debt_confirmed_on date,p_debt_evidence_reference text,p_fuel text,p_gearbox text,p_asking_price_ore bigint,
 p_purchase_confirmed boolean,p_received_confirmed boolean,p_debt_confirmed boolean,p_acknowledged boolean,p_attestation_version text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;old private.trade_in_acquisition_audit;t private.trade_in_acquisitions;d public.deals;stock uuid;
 p jsonb;basis jsonb;src jsonb;trade jsonb;registration text;vehicle uuid;new_stock uuid;today date:=(clock_timestamp() at time zone 'Europe/Stockholm')::date;
begin
 select x.actor,x.actor_role into a,r from private.trade_in_acquisition_access(p_company_id,true)x;
 if p_request_id is null then raise exception 'Acquisition request required' using errcode='22023';end if;
 p:=jsonb_build_object('companyId',p_company_id,'dealId',p_deal_id,'expectedSourceSha256',p_expected_source_sha256,'acquiredOn',p_acquired_on,
 'purchaseAgreementReference',p_purchase_agreement_reference,'debtConfirmedOre',p_debt_confirmed_ore::text,'debtConfirmedOn',p_debt_confirmed_on,
 'debtEvidenceReference',p_debt_evidence_reference,'fuel',p_fuel,'gearbox',p_gearbox,'askingPriceOre',p_asking_price_ore::text,
 'purchaseConfirmed',p_purchase_confirmed,'receivedConfirmed',p_received_confirmed,'debtConfirmed',p_debt_confirmed,'acknowledged',p_acknowledged,'attestationVersion',p_attestation_version);
 -- Fresh Auth/approval/company/membership precede historical replay. No current
 -- source/status/clock/duplicate predicate may invalidate an identical receipt.
 perform pg_advisory_xact_lock(hashtextextended(a::text||p_request_id::text,17));
 select * into old from private.trade_in_acquisition_audit where actor_user_id=a and request_id=p_request_id;
 if found then
  if old.payload is distinct from p or old.company_id is distinct from p_company_id or old.deal_id is distinct from p_deal_id then raise exception 'Acquisition request conflict' using errcode='40001';end if;
  select * into t from private.trade_in_acquisitions where company_id=p_company_id and id=old.acquisition_id;
  return jsonb_build_object('actorId',a,'role',r,'companyId',p_company_id,'dealId',p_deal_id,'requestId',p_request_id,'acquisition',private.trade_in_acquisition_json(t,a));
 end if;
 if p_expected_source_sha256 is null or p_expected_source_sha256 !~ '^[a-f0-9]{64}$'
 or p_acquired_on is null or p_acquired_on<date '1900-01-01' or p_acquired_on>today
 or p_debt_confirmed_on is null or p_debt_confirmed_on<date '1900-01-01' or p_debt_confirmed_on>today
 or p_purchase_agreement_reference is null or length(p_purchase_agreement_reference) not between 2 and 160 or p_purchase_agreement_reference<>btrim(p_purchase_agreement_reference) or p_purchase_agreement_reference ~ '[[:cntrl:]]'
 or p_debt_evidence_reference is null or length(p_debt_evidence_reference) not between 2 and 160 or p_debt_evidence_reference<>btrim(p_debt_evidence_reference) or p_debt_evidence_reference ~ '[[:cntrl:]]'
 or p_debt_confirmed_ore is null or p_debt_confirmed_ore not between 0 and 999999999999
 or p_fuel is null or p_fuel not in('petrol','diesel','electric','hybrid','other') or p_gearbox is null or p_gearbox not in('automatic','manual')
 or p_asking_price_ore is null or p_asking_price_ore not between 1 and 999999999999
 or p_purchase_confirmed is distinct from true or p_received_confirmed is distinct from true or p_debt_confirmed is distinct from true or p_acknowledged is distinct from true
 or p_attestation_version is distinct from '2026-10-15' then raise exception 'Invalid manual purchase attestation' using errcode='22023';end if;
 select stock_item_id into stock from public.deals where company_id=p_company_id and id=p_deal_id;
 if not found then raise exception 'Acquisition deal access denied' using errcode='42501';end if;
 perform 1 from public.stock_items where company_id=p_company_id and id=stock for share;
 select * into d from public.deals where company_id=p_company_id and id=p_deal_id for update;
 if not found or d.stock_item_id<>stock or d.status not in('draft','reserved')
 or exists(select 1 from private.trade_in_acquisitions where company_id=p_company_id and deal_id=p_deal_id) then raise exception 'Acquisition deal conflict' using errcode='40001';end if;
 basis:=private.trade_in_acquisition_source(d,a);src:=basis->'source';
 if src is null or src='null'::jsonb or basis->>'reason' is not null or src->>'sourceSha256' is distinct from p_expected_source_sha256 then raise exception 'Acquisition source conflict' using errcode='40001';end if;
 trade:=src#>'{offerSnapshot,trade_in}';
 if p_debt_confirmed_ore is distinct from(trade->>'debt_ore')::bigint then raise exception 'Manual debt confirmation conflict' using errcode='40001';end if;
 registration:=upper(regexp_replace(trade->>'registration','[[:space:]]','','g'));
 -- Same canonical identity as vehicles_company_normalized_registration_idx.
 -- The existing UNIQUE index also arbitrates manual/import/direct-RLS races.
 if exists(select 1 from public.vehicles where company_id=p_company_id and upper(regexp_replace(registration_number,'[[:space:]]','','g'))=registration) then raise exception 'Vehicle identity already exists' using errcode='23505';end if;
 insert into public.vehicles(company_id,registration_number,make,model,model_year,mileage_km,fuel,gearbox)
 values(p_company_id,registration,trade->>'make',trade->>'model',(trade->>'model_year')::integer,(trade->>'mileage_km')::integer,p_fuel,p_gearbox)returning id into vehicle;
 insert into public.stock_items(company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme,purchase_vat_ore,vat_basis_confirmed,acquired_on,status)
 values(p_company_id,vehicle,(trade->>'value_ore')::bigint,p_asking_price_ore,'unknown',null,false,p_acquired_on,'available')returning id into new_stock;
 insert into private.trade_in_acquisitions(company_id,deal_id,offer_id,direct_draft_id,trade_in_id,signing_id,vehicle_id,stock_item_id,source,acquired_on,purchase_agreement_reference,
 debt_confirmed_ore,debt_confirmed_on,debt_evidence_reference,fuel,gearbox,asking_price_ore,purchase_price_ore,attestation_version,created_by)
 values(p_company_id,p_deal_id,(src->>'offerId')::uuid,(src->>'draftId')::uuid,(src->>'tradeInId')::uuid,(src->>'signingId')::uuid,vehicle,new_stock,src,p_acquired_on,p_purchase_agreement_reference,
 p_debt_confirmed_ore,p_debt_confirmed_on,p_debt_evidence_reference,p_fuel,p_gearbox,p_asking_price_ore,(trade->>'value_ore')::bigint,p_attestation_version,a)returning * into t;
 insert into private.trade_in_acquisition_audit(actor_user_id,request_id,company_id,deal_id,acquisition_id,payload)values(a,p_request_id,p_company_id,p_deal_id,t.id,p);
 return jsonb_build_object('actorId',a,'role',r,'companyId',p_company_id,'dealId',p_deal_id,'requestId',p_request_id,'acquisition',private.trade_in_acquisition_json(t,a));
end$$;
commit;
