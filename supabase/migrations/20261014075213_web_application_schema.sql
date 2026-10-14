-- Private web applications, notice receipts and platform-only case handling.
-- Legacy submissions remain identifiable; old incomplete submission RPCs close.
alter table private.demo_requests
 add column request_id uuid unique,
 add column organisation_number text,
 add column seeking text[],
 add column privacy_version text,
 add column privacy_acknowledged_at timestamptz,
 add column legacy boolean not null default true,
 add column status text not null default 'new' check(status in ('new','in_review','contacted','closed')),
 add column version integer not null default 1 check(version>0);
alter table private.demo_requests add constraint web_application_complete check(legacy or (
 request_id is not null and length(name) between 2 and 160 and length(company) between 2 and 160
 and phone is not null and length(phone) between 7 and 40 and organisation_number is not null and organisation_number ~ '^[0-9]{10}$'
 and seeking is not null and cardinality(seeking) between 1 and 6 and seeking <@ array['system','purchase_finance','stock_finance','dealer_network','advertising','other']::text[]
 and message is not null and length(message) between 2 and 2000
 and privacy_version is not null and privacy_acknowledged_at is not null));
create index demo_requests_status_created_idx on private.demo_requests(status,created_at desc,id desc);
create table private.web_application_status_audit(
 id uuid primary key default gen_random_uuid(),application_id uuid not null references private.demo_requests(id),
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,request_payload jsonb not null,
 previous_status text not null,status text not null,version integer not null,reason text not null,
 changed boolean not null,created_at timestamptz not null default now(),unique(actor_user_id,request_id));
alter table private.web_application_status_audit enable row level security;
revoke all on private.web_application_status_audit from public,anon,authenticated,service_role;
create index web_application_status_audit_application_idx on private.web_application_status_audit(application_id,created_at,id);
create index web_application_status_audit_actor_idx on private.web_application_status_audit(actor_user_id);
create table private.web_application_erasure_tombstones (
 application_id uuid primary key, submission_request_id uuid unique,
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,
 expected_version integer not null,reason text not null check(reason in ('rights_request','no_longer_needed')),
 created_at timestamptz not null default now(),unique(actor_user_id,request_id));
alter table private.web_application_erasure_tombstones enable row level security;
revoke all on private.web_application_erasure_tombstones from public,anon,authenticated,service_role;
create index web_application_erasure_actor_idx on private.web_application_erasure_tombstones(actor_user_id);
create trigger immutable_web_application_erasure before update or delete on private.web_application_erasure_tombstones
 for each row execute function private.reject_platform_audit_mutation();
create function private.reject_web_application_audit_mutation() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 -- Only the erasure transaction can establish this private tombstone first.
 if tg_op='DELETE' and exists(select 1 from private.web_application_erasure_tombstones t where t.application_id=old.application_id) then return old;end if;
 raise exception 'Application audit is immutable' using errcode='55000';
end $$;
revoke all on function private.reject_web_application_audit_mutation() from public,anon,authenticated,service_role;
create trigger immutable_web_application_status_audit before update or delete on private.web_application_status_audit
 for each row execute function private.reject_web_application_audit_mutation();

create function private.normalize_organisation_number(p_value text) returns text
 language plpgsql immutable security invoker set search_path='' as $$
declare v text:=replace(btrim(p_value),'-',''); total integer:=0; n integer; i integer;
begin
 if v ~ '^16[0-9]{10}$' then v:=substr(v,3);end if;
 if v is null or v !~ '^[0-9]{10}$' then raise exception 'Invalid organisation number' using errcode='22023';end if;
 for i in 1..10 loop n:=substr(v,i,1)::integer;if i%2=1 then n:=n*2;end if;total:=total+n/10+n%10;end loop;
 if total%10<>0 or v='0000000000' then raise exception 'Invalid organisation number' using errcode='22023';end if;
 return v;
end $$;
revoke all on function private.normalize_organisation_number(text) from public,anon,authenticated,service_role;

