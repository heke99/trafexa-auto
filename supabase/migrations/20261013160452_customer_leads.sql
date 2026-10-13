-- Intake creates the contact and lead together. Only status is mutable via the Data API.
revoke insert,update on public.leads from public,anon,authenticated;
grant update(status) on public.leads to authenticated;
create trigger audit_lead_change after insert or update on public.leads
for each row execute function private.record_audit();
create index leads_company_created_id_idx on public.leads(company_id,created_at desc,id desc);

-- UUID retries are retained for seven days, with at most 1000 receipts per company.
-- Payload hashes avoid retaining a second copy of contact details or the lead note.
create table private.lead_intakes (
 company_id uuid not null references public.companies(id),
 user_id uuid not null references auth.users(id),
 submission_id uuid not null,
 payload_hash text not null,
 lead_id uuid not null,
 created_at timestamptz not null default now(),
 primary key(company_id,user_id,submission_id),
 foreign key(company_id,lead_id) references public.leads(company_id,id)
);
create index lead_intakes_company_created_idx on private.lead_intakes(company_id,created_at);
create index lead_intakes_user_idx on private.lead_intakes(user_id);
create index lead_intakes_lead_idx on private.lead_intakes(company_id,lead_id);
alter table private.lead_intakes enable row level security;
revoke all on private.lead_intakes from public,anon,authenticated;
create policy no_direct_lead_intakes on private.lead_intakes
for all to anon,authenticated using(false) with check(false);

create function private.create_customer_lead(company uuid,submission uuid,contact_name text,contact_email text,contact_phone text,lead_subject text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); previous private.lead_intakes;
 normalized_name text:=btrim(contact_name);
 normalized_email text:=lower(btrim(coalesce(contact_email,'')));
 normalized_phone text:=btrim(coalesce(contact_phone,''));
 normalized_subject text:=btrim(lead_subject);
 request_hash text; customer uuid; result uuid;
begin
 if actor is null or not private.has_company_role(company,array['owner','admin','sales']) then
  raise exception 'Access denied' using errcode='42501';
 end if;
 if submission is null or normalized_name is null or length(normalized_name) not between 2 and 160
 or normalized_name ~ '[[:cntrl:]]' or length(normalized_email)>254
 or (normalized_email<>'' and normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
 or length(normalized_phone)>60 or normalized_phone ~ '[[:cntrl:]]'
 or (normalized_phone<>'' and (normalized_phone !~ '^[+0-9() .-]+$' or length(regexp_replace(normalized_phone,'[^0-9]','','g'))<3))
 or (normalized_email='' and normalized_phone='')
 or normalized_subject is null or length(normalized_subject) not between 1 and 2000
 or translate(normalized_subject,chr(9)||chr(10)||chr(13),'') ~ '[[:cntrl:]]' then
  raise exception 'Invalid lead details' using errcode='22023';
 end if;
 request_hash:=encode(sha256(convert_to(jsonb_build_array(normalized_name,normalized_email,normalized_phone,normalized_subject)::text,'UTF8')),'hex');
 -- Company-level serialization bounds receipt growth even for parallel intakes.
 perform pg_advisory_xact_lock(hashtextextended('trafexa-lead-intake:'||company::text,0));
 delete from private.lead_intakes where company_id=company and created_at<=now()-interval '7 days';
 select * into previous from private.lead_intakes
 where company_id=company and user_id=actor and submission_id=submission;
 if found then
  if previous.payload_hash<>request_hash then raise exception 'Lead submission payload changed' using errcode='22023'; end if;
  return previous.lead_id;
 end if;
 if (select count(*) from private.lead_intakes where company_id=company)>=1000 then
  raise exception 'Lead intake limit reached' using errcode='P0001';
 end if;
 insert into public.customers(company_id,kind,name,email,phone)
 values(company,'person',normalized_name,nullif(normalized_email,''),nullif(normalized_phone,''))
 returning id into customer;
 insert into public.leads(company_id,customer_id,subject,status)
 values(company,customer,normalized_subject,'new') returning id into result;
 insert into private.lead_intakes(company_id,user_id,submission_id,payload_hash,lead_id)
 values(company,actor,submission,request_hash,result);
 return result;
end $$;
revoke all on function private.create_customer_lead(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function private.create_customer_lead(uuid,uuid,text,text,text,text) to authenticated;
create function public.create_customer_lead(company uuid,submission uuid,contact_name text,contact_email text,contact_phone text,lead_subject text)
returns uuid language sql security invoker set search_path='' as $$
 select private.create_customer_lead(company,submission,contact_name,contact_email,contact_phone,lead_subject);
$$;
revoke all on function public.create_customer_lead(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.create_customer_lead(uuid,uuid,text,text,text,text) to authenticated;
