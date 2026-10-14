begin;
create table private.offer_reviews(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,deal_id uuid not null,offer_id uuid not null,
 offer_version integer not null check(offer_version>0),recipient_email text not null check(recipient_email=lower(btrim(recipient_email))),
 status text not null default 'pending' check(status in ('pending','accepted','declined','withdrawn')),
 version integer not null default 1 check(version>0),created_at timestamptz not null default clock_timestamp(),
 decided_at timestamptz,responder_name text,reason text,
 foreign key(company_id,deal_id) references public.deals(company_id,id),foreign key(company_id,offer_id) references public.offers(company_id,id),unique(company_id,offer_id),
 check((status='pending' and decided_at is null and responder_name is null and reason is null) or (status='withdrawn' and decided_at is not null and responder_name is null and length(reason) between 2 and 500) or (status='accepted' and decided_at is not null and length(responder_name) between 2 and 160 and reason is null) or (status='declined' and decided_at is not null and length(responder_name) between 2 and 160 and length(reason) between 2 and 500))
);
create index offer_reviews_customer_page on private.offer_reviews(recipient_email,id desc);
create index offer_reviews_deal on private.offer_reviews(company_id,deal_id,offer_version desc,id desc);
create index offer_reviews_offer on private.offer_reviews(company_id,offer_id);
create table private.offer_review_audit(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),actor_user_id uuid not null references auth.users(id),request_id uuid not null,payload jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(actor_user_id,request_id));
create index offer_review_audit_company on private.offer_review_audit(company_id,created_at);
alter table private.offer_reviews enable row level security;
alter table private.offer_review_audit enable row level security;
revoke all on private.offer_reviews,private.offer_review_audit from public,anon,authenticated,service_role;
create function private.offer_review_immutable() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_table_name='offer_review_audit' or tg_op='DELETE' then raise exception 'Immutable review record' using errcode='55000'; end if;
 if old.status<>'pending' then raise exception 'Immutable review record' using errcode='55000'; end if;
 if (to_jsonb(new)-array['status','version','decided_at','responder_name','reason']) is distinct from (to_jsonb(old)-array['status','version','decided_at','responder_name','reason']) or new.version<>old.version+1 or new.status='pending' then raise exception 'Invalid review transition' using errcode='55000';end if; return new;end $$;
create trigger offer_review_immutable before update or delete on private.offer_reviews for each row execute function private.offer_review_immutable();
create trigger offer_review_audit_immutable before update or delete on private.offer_review_audit for each row execute function private.offer_review_immutable();
create function private.offer_review_replay(a uuid,n uuid,p jsonb) returns jsonb language plpgsql set search_path='' as $$ declare v private.offer_review_audit; begin
 if n is null then raise exception 'Request required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(a::text||n::text,0));
 select * into v from private.offer_review_audit where actor_user_id=a and request_id=n;
 if found then if v.payload is distinct from p then raise exception 'Request conflict' using errcode='40001';end if;return v.receipt;end if;return null;end $$;
revoke all on function private.offer_review_immutable(),private.offer_review_replay(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
commit;
