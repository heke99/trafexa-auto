begin;
create table private.deal_cancellation_audit(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,deal_id uuid not null,
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,
 payload jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,deal_id) references public.deals(company_id,id),unique(actor_user_id,request_id)
);
create index deal_cancellation_audit_deal on private.deal_cancellation_audit(company_id,deal_id);
alter table private.deal_cancellation_audit enable row level security;
revoke all on private.deal_cancellation_audit from public,anon,authenticated,service_role;
create function private.deal_cancellation_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Immutable cancellation audit' using errcode='55000';end$$;
create trigger deal_cancellation_immutable before update or delete on private.deal_cancellation_audit for each row execute function private.deal_cancellation_immutable();
create function private.cancel_deal(p_company_id uuid,p_deal_id uuid,p_expected_status text,p_reason text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;stock uuid;d public.deals;s public.stock_items;old private.deal_cancellation_audit;p jsonb;v jsonb;released integer;
begin
 select actor,actor_role into a,r from private.customer_contact_access(p_company_id,true);
 if p_request_id is null or p_expected_status is null or p_expected_status not in ('draft','reserved') or p_reason is null or p_reason<>btrim(p_reason) or length(p_reason) not between 2 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception 'Invalid cancellation' using errcode='22023';end if;
 select stock_item_id into stock from public.deals where company_id=p_company_id and id=p_deal_id;
 if not found then raise exception 'Deal access denied' using errcode='42501';end if;
 -- Every reservation lifecycle mutation serializes on stock before deal.
 select * into s from public.stock_items where company_id=p_company_id and id=stock for update;
 if not found then raise exception 'Stock access denied' using errcode='42501';end if;
 select * into d from public.deals where company_id=p_company_id and id=p_deal_id for update;
 if not found or d.stock_item_id<>stock then raise exception 'Deal conflict' using errcode='40001';end if;
 p:=jsonb_build_object('companyId',p_company_id,'dealId',p_deal_id,'expectedStatus',p_expected_status,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(a::text||p_request_id::text,0));
 select * into old from private.deal_cancellation_audit where actor_user_id=a and request_id=p_request_id;
 if found then
  if old.payload is distinct from p then raise exception 'Request conflict' using errcode='40001';end if;
  return old.receipt;
 end if;
 if d.status<>p_expected_status then raise exception 'Deal conflict' using errcode='40001';end if;
 -- Customer acceptance is immutable evidence requiring a separate agreement process.
 if exists(select 1 from private.offer_reviews where company_id=p_company_id and deal_id=p_deal_id and status='accepted') then raise exception 'Accepted offer requires agreement process' using errcode='40001';end if;
 update public.reservations set status='released' where company_id=p_company_id and deal_id=p_deal_id and stock_item_id=stock and status='active';
 get diagnostics released=row_count;
 update public.deals set status='cancelled' where company_id=p_company_id and id=p_deal_id;
 update public.stock_items set status='available' where company_id=p_company_id and id=stock and status='reserved' and not exists(select 1 from public.reservations where company_id=p_company_id and stock_item_id=stock and status='active');
 v:=jsonb_build_object('companyId',p_company_id,'actorUserId',a,'requestId',p_request_id,'dealId',p_deal_id,'status','cancelled','previousStatus',d.status,'reason',p_reason,'releasedReservations',released,'stockId',stock);
 insert into private.deal_cancellation_audit(company_id,deal_id,actor_user_id,request_id,payload,receipt)values(p_company_id,p_deal_id,a,p_request_id,p,v);
 return v;
end$$;
create function public.cancel_deal(p_company_id uuid,p_deal_id uuid,p_expected_status text,p_reason text,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.cancel_deal(p_company_id,p_deal_id,p_expected_status,p_reason,p_request_id);$$;
revoke all on function private.deal_cancellation_immutable(),private.cancel_deal(uuid,uuid,text,text,uuid),public.cancel_deal(uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.cancel_deal(uuid,uuid,text,text,uuid),public.cancel_deal(uuid,uuid,text,text,uuid) to authenticated;
commit;
