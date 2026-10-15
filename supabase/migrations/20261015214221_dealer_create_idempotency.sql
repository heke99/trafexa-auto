-- Durable creation receipts: no TTL, semantic deduplication, outbound messages or
-- service credentials. A nonce names one normalized payload for one actor/tenant.
begin;
-- All application creation paths now use atomic, payload-bound RPCs. Internal
-- lead/contact conversion runs as its existing function owner and is preserved.
revoke insert on public.customers,public.finance_applications from authenticated;
create table private.dealer_create_receipts(
 company_id uuid not null references public.companies(id),actor_user_id uuid not null references auth.users(id),request_id uuid not null,
 kind text not null check(kind in('customer','finance_intake')),payload_sha256 text not null check(payload_sha256~'^[0-9a-f]{64}$'),
 customer_id uuid,finance_application_id uuid,receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(company_id,actor_user_id,request_id),
 foreign key(company_id,customer_id)references public.customers(company_id,id),
 foreign key(company_id,finance_application_id)references public.finance_applications(company_id,id),
 check((kind='customer'and customer_id is not null and finance_application_id is null)or(kind='finance_intake'and customer_id is null and finance_application_id is not null))
);
create index dealer_create_receipts_actor on private.dealer_create_receipts(actor_user_id);
create index dealer_create_receipts_customer on private.dealer_create_receipts(company_id,customer_id)where customer_id is not null;
create index dealer_create_receipts_finance on private.dealer_create_receipts(company_id,finance_application_id)where finance_application_id is not null;
alter table private.dealer_create_receipts enable row level security;
revoke all on private.dealer_create_receipts from public,anon,authenticated,service_role;
create trigger dealer_create_receipt_immutable before update or delete on private.dealer_create_receipts for each row execute function private.reject_company_team_audit_mutation();

-- Match the existing form/DTO UTF-16 limits, canonical ECMAScript trim and C0/C1
-- rules. Optional multiline content permits internal tab/LF/CR, never edge space.
create function private.dealer_create_text_valid(p_value text,p_min integer,p_max integer,p_multiline boolean default false)returns boolean
language sql immutable security invoker set search_path=''as $$
 select private.company_store_text_valid(p_value,p_min,p_max,p_multiline)
 and length(p_value)+length(regexp_replace(p_value,'[^'||chr(65536)||'-'||chr(1114111)||']','','g'))<=p_max;
$$;
revoke all on function private.dealer_create_text_valid(text,integer,integer,boolean)from public,anon,authenticated,service_role;

create function private.dealer_create_record(p_company_id uuid,p_request_id uuid,p_kind text,p_payload jsonb)returns jsonb
language plpgsql security invoker set search_path=''as $$
declare a uuid;r text;s text;fingerprint text;prior private.dealer_create_receipts;record_id uuid;record_created timestamptz;outcome jsonb;keys text[];email_space text:=chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
begin
 -- Fresh actual Auth/approval -> company -> membership locks precede even a
 -- historical replay. Neither metadata nor an old role stored in a receipt grants access.
 select x.user_id into a from private.company_team_identity(true)x;
 select status into s from public.companies where id=p_company_id for share;
 select role into r from public.memberships where company_id=p_company_id and user_id=a and status='active'for share;
 if s is distinct from 'active'or r is null or p_kind is null or p_kind not in('customer','finance_intake')
  or not(r=any(case when p_kind='customer'then array['owner','admin','sales']else array['owner','admin','sales','finance']end))then raise exception 'Creation access denied'using errcode='42501';end if;
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'then raise exception 'Invalid creation request'using errcode='22023';end if;
 keys:=case when p_kind='customer'then array['name','kind','email','phone','address','notes']else array['product','dealId','requestedAmountOre','depositOre','termMonths','note']end;
 if not(p_payload?&keys)or(select count(*)from jsonb_object_keys(p_payload))<>cardinality(keys)then raise exception 'Invalid creation payload'using errcode='22023';end if;
 if p_kind='customer'then
  if jsonb_typeof(p_payload->'name')<>'string'or not private.dealer_create_text_valid(p_payload->>'name',2,160)
   or p_payload->>'kind'not in('person','business')or jsonb_typeof(p_payload->'kind')<>'string'
   or exists(select 1 from jsonb_each(p_payload)e where e.key in('email','phone','address','notes')and jsonb_typeof(e.value)not in('string','null'))
   or(p_payload->>'email'is not null and(not private.dealer_create_text_valid(p_payload->>'email',1,254)or p_payload->>'email'!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'or p_payload->>'email'~('['||email_space||']')))
   or(p_payload->>'phone'is not null and not private.dealer_create_text_valid(p_payload->>'phone',1,60))
   or(p_payload->>'address'is not null and not private.dealer_create_text_valid(p_payload->>'address',1,500,true))
   or(p_payload->>'notes'is not null and not private.dealer_create_text_valid(p_payload->>'notes',1,2000,true))
  then raise exception 'Invalid customer request'using errcode='22023';end if;
 else
  if jsonb_typeof(p_payload->'product')<>'string'or p_payload->>'product'not in('purchase','stock')
   or jsonb_typeof(p_payload->'dealId')not in('string','null')
   or(p_payload->>'dealId'is not null and p_payload->>'dealId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
   or jsonb_typeof(p_payload->'requestedAmountOre')<>'number'or p_payload->>'requestedAmountOre'!~'^[1-9][0-9]{0,11}$'or(p_payload->>'requestedAmountOre')::numeric>999999999999
   or jsonb_typeof(p_payload->'depositOre')<>'number'or p_payload->>'depositOre'!~'^(0|[1-9][0-9]{0,11})$'or(p_payload->>'depositOre')::numeric>999999999999
   or jsonb_typeof(p_payload->'termMonths')not in('number','null')
   or(p_payload->>'termMonths'is not null and(p_payload->>'termMonths'!~'^[1-9][0-9]{0,2}$'or(p_payload->>'termMonths')::integer>120))
   or jsonb_typeof(p_payload->'note')not in('string','null')or(p_payload->>'note'is not null and not private.dealer_create_text_valid(p_payload->>'note',1,2000,true))
  then raise exception 'Invalid finance intake request'using errcode='22023';end if;
 end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('kind',p_kind,'payload',p_payload)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('dealer-create:'||p_company_id::text||':'||a::text||':'||p_request_id::text,0));
 select *into prior from private.dealer_create_receipts where company_id=p_company_id and actor_user_id=a and request_id=p_request_id;
 if found then
  if prior.kind<>p_kind or prior.payload_sha256<>fingerprint then raise exception 'Creation request payload conflict'using errcode='40001';end if;
  return prior.receipt;
 end if;
 if p_kind='customer'then
  insert into public.customers(company_id,name,kind,email,phone,address,notes)values(p_company_id,p_payload->>'name',p_payload->>'kind',p_payload->>'email',p_payload->>'phone',p_payload->>'address',p_payload->>'notes')returning id,created_at into record_id,record_created;
 else
  -- A historical receipt returns above; mutable relationship checks apply only
  -- to a genuinely new request. No changes to the selected deal or finance status.
  if p_payload->>'dealId'is not null then
   perform 1 from public.deals where company_id=p_company_id and id=(p_payload->>'dealId')::uuid for key share;
   if not found then raise exception 'Finance deal unavailable'using errcode='23503';end if;
  end if;
  insert into public.finance_applications(company_id,created_by,product,deal_id,requested_amount_ore,deposit_ore,term_months,note,status)
  values(p_company_id,a,p_payload->>'product',(p_payload->>'dealId')::uuid,(p_payload->>'requestedAmountOre')::bigint,(p_payload->>'depositOre')::bigint,(p_payload->>'termMonths')::integer,p_payload->>'note','intake')returning id,created_at into record_id,record_created;
 end if;
 outcome:=jsonb_build_object('companyId',p_company_id,'actorId',a,'requestId',p_request_id,'kind',p_kind,'recordId',record_id,'createdAt',record_created);
 insert into private.dealer_create_receipts(company_id,actor_user_id,request_id,kind,payload_sha256,customer_id,finance_application_id,receipt)
 values(p_company_id,a,p_request_id,p_kind,fingerprint,case when p_kind='customer'then record_id end,case when p_kind='finance_intake'then record_id end,outcome);
 return outcome;
end$$;
revoke all on function private.dealer_create_record(uuid,uuid,text,jsonb)from public,anon,authenticated,service_role;

create function private.create_customer_request(p_company_id uuid,p_request_id uuid,p_name text,p_kind text,p_email text,p_phone text,p_address text,p_notes text)returns jsonb
language sql security definer set search_path=''as $$select private.dealer_create_record(p_company_id,p_request_id,'customer',jsonb_build_object('name',p_name,'kind',p_kind,'email',nullif(p_email,''),'phone',nullif(p_phone,''),'address',nullif(p_address,''),'notes',nullif(p_notes,'')))$$;
create function private.create_finance_intake_request(p_company_id uuid,p_request_id uuid,p_product text,p_deal_id uuid,p_requested_amount_ore bigint,p_deposit_ore bigint,p_term_months integer,p_note text)returns jsonb
language sql security definer set search_path=''as $$select private.dealer_create_record(p_company_id,p_request_id,'finance_intake',jsonb_build_object('product',p_product,'dealId',p_deal_id,'requestedAmountOre',p_requested_amount_ore,'depositOre',p_deposit_ore,'termMonths',p_term_months,'note',nullif(p_note,'')))$$;
create function public.create_customer_request(p_company_id uuid,p_request_id uuid,p_name text,p_kind text,p_email text,p_phone text,p_address text,p_notes text)returns jsonb
language sql security invoker set search_path=''as $$select private.create_customer_request(p_company_id,p_request_id,p_name,p_kind,p_email,p_phone,p_address,p_notes)$$;
create function public.create_finance_intake_request(p_company_id uuid,p_request_id uuid,p_product text,p_deal_id uuid,p_requested_amount_ore bigint,p_deposit_ore bigint,p_term_months integer,p_note text)returns jsonb
language sql security invoker set search_path=''as $$select private.create_finance_intake_request(p_company_id,p_request_id,p_product,p_deal_id,p_requested_amount_ore,p_deposit_ore,p_term_months,p_note)$$;
revoke all on function private.create_customer_request(uuid,uuid,text,text,text,text,text,text),private.create_finance_intake_request(uuid,uuid,text,uuid,bigint,bigint,integer,text),public.create_customer_request(uuid,uuid,text,text,text,text,text,text),public.create_finance_intake_request(uuid,uuid,text,uuid,bigint,bigint,integer,text)from public,anon,authenticated,service_role;
grant execute on function private.create_customer_request(uuid,uuid,text,text,text,text,text,text),private.create_finance_intake_request(uuid,uuid,text,uuid,bigint,bigint,integer,text),public.create_customer_request(uuid,uuid,text,text,text,text,text,text),public.create_finance_intake_request(uuid,uuid,text,uuid,bigint,bigint,integer,text)to authenticated;
commit;
