begin;
create table private.customer_contacts (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, customer_id uuid not null,
 kind text not null check(kind in ('call','email','meeting','note')),
 contact_on date not null check(contact_on between date '1900-01-01' and date '9999-12-31'),
 summary text not null check(length(summary) between 2 and 2000 and summary=btrim(summary) and translate(summary,E'\n\r\t','') !~ '[[:cntrl:]]'),
 follow_up_on date check(follow_up_on between date '1900-01-01' and date '9999-12-31' and follow_up_on>=contact_on),
 follow_up_status text not null check(follow_up_status in ('none','pending','done','cancelled')),
 version integer not null default 1 check(version>0), created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,customer_id) references public.customers(company_id,id),
 check((follow_up_on is null and follow_up_status='none') or (follow_up_on is not null and follow_up_status<>'none'))
);
create index customer_contacts_customer_page on private.customer_contacts(company_id,customer_id,contact_on desc,id desc);
create index customer_contacts_pending_page on private.customer_contacts(company_id,id) where follow_up_status='pending';
create index customer_contacts_pending_due on private.customer_contacts(company_id,follow_up_on,id) where follow_up_status='pending';
create index customer_contacts_author on private.customer_contacts(created_by);
create table private.customer_contact_audit (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 actor_user_id uuid not null references auth.users(id), request_id uuid not null,
 payload jsonb not null, receipt jsonb not null, previous_value jsonb, current_value jsonb not null,
 created_at timestamptz not null default clock_timestamp(), unique(actor_user_id,request_id)
);
create index customer_contact_audit_company on private.customer_contact_audit(company_id,created_at);
alter table private.customer_contacts enable row level security;
alter table private.customer_contact_audit enable row level security;
revoke all on private.customer_contacts,private.customer_contact_audit from public,anon,authenticated,service_role;
create function private.customer_contact_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='customer_contact_audit' or tg_op='DELETE' then raise exception 'Immutable contact record' using errcode='55000'; end if;
 if (to_jsonb(new)-'follow_up_status'-'version') is distinct from (to_jsonb(old)-'follow_up_status'-'version')
  or new.version<>old.version+1 or new.follow_up_status=old.follow_up_status then
  raise exception 'Only versioned follow-up changes allowed' using errcode='55000'; end if;
 return new;
end $$;
create trigger customer_contact_immutable before update or delete on private.customer_contacts for each row execute function private.customer_contact_immutable();
create trigger customer_contact_audit_immutable before update or delete on private.customer_contact_audit for each row execute function private.customer_contact_immutable();
create function private.customer_contact_access(p_company uuid,p_write boolean) returns table(actor uuid,actor_role text)
 language plpgsql security invoker set search_path='' as $$
declare a uuid; r text; s text;
begin
 select user_id into a from private.company_team_identity(true);
 select status into s from public.companies where id=p_company for share;
 if s is distinct from 'active' then raise exception 'Company access denied' using errcode='42501'; end if;
 select role into r from public.memberships where company_id=p_company and user_id=a and status='active' for share;
 if r is null or r not in ('owner','admin','sales','finance','viewer') or (p_write and r not in ('owner','admin','sales')) then
  raise exception 'Contact access denied' using errcode='42501'; end if;
 return query select a,r;
end $$;
create function private.customer_contact_json(c private.customer_contacts) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('id',c.id,'companyId',c.company_id,'customerId',c.customer_id,'kind',c.kind,
 'contactOn',c.contact_on,'summary',c.summary,'followUpOn',c.follow_up_on,'followUpStatus',c.follow_up_status,
 'version',c.version,'createdAt',c.created_at,'createdBy',c.created_by);
$$;
create function private.customer_contact_replay(p_actor uuid,p_request uuid,p_payload jsonb) returns jsonb language plpgsql set search_path='' as $$
declare a private.customer_contact_audit%rowtype;
begin
 if p_request is null then raise exception 'Request required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,0));
 select * into a from private.customer_contact_audit where actor_user_id=p_actor and request_id=p_request;
 if found then
  if a.payload is distinct from p_payload then raise exception 'Request conflict' using errcode='40001'; end if;
  return a.receipt;
 end if;
 return null;
end $$;
revoke all on function private.customer_contact_immutable(),private.customer_contact_access(uuid,boolean),private.customer_contact_json(private.customer_contacts),private.customer_contact_replay(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
commit;
