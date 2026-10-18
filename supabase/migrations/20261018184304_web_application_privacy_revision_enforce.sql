-- Enforce only after the version-2026-10-18 frontend and API are live.
begin;
create or replace function private.submit_web_application(p_request_id uuid,p_name text,p_email text,p_company text,p_phone text,p_organisation_number text,p_seeking text[],p_message text,p_privacy_version text,p_privacy_acknowledged boolean) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare v_name text:=btrim(p_name);v_email text:=lower(btrim(p_email));v_company text:=btrim(p_company);
 v_phone text:=btrim(p_phone);v_org text;v_message text:=btrim(p_message);v_seeking text[]; existing private.demo_requests;
begin
 if p_request_id is null or v_name is null or length(v_name) not between 2 and 160 or v_name ~ '[[:cntrl:]]'
 or v_email is null or v_email ~ '[[:cntrl:]]' or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or v_company is null or length(v_company) not between 2 and 160 or v_company ~ '[[:cntrl:]]'
 or v_phone is null or length(v_phone) not between 7 and 40 or v_phone !~ '^\+?[0-9 ()-]+$'
 or length(regexp_replace(v_phone,'[^0-9]','','g')) not between 7 and 15
 or v_message is null or length(v_message) not between 2 and 2000
 or p_privacy_acknowledged is distinct from true or p_privacy_version is null or p_privacy_version !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
 or p_seeking is null or cardinality(p_seeking) not between 1 and 6 or array_position(p_seeking,null) is not null
 or not p_seeking <@ array['system','purchase_finance','stock_finance','dealer_network','advertising','other']::text[] then
 raise exception 'Invalid application' using errcode='22023';end if;
 v_org:=private.normalize_organisation_number(p_organisation_number);
 select array_agg(s order by s) into v_seeking from (select distinct unnest(p_seeking) s) a;
 -- One bounded lock makes concurrent nonce retries, erasure and throttling atomic.
 perform pg_advisory_xact_lock(97261013);
 if exists(select 1 from private.web_application_erasure_tombstones where submission_request_id=p_request_id) then
  raise exception 'Application unavailable' using errcode='40001';end if;
 select * into existing from private.demo_requests where request_id=p_request_id;
 if found then
  if existing.name is distinct from v_name or existing.email is distinct from v_email or existing.company is distinct from v_company
   or existing.phone is distinct from v_phone or existing.organisation_number is distinct from v_org or existing.seeking is distinct from v_seeking
   or existing.message is distinct from v_message or existing.privacy_version is distinct from p_privacy_version then
    raise exception 'Application unavailable' using errcode='40001';end if;
 else
  -- Existing exact receipts retain the notice originally shown. New applications require the current information.
  if p_privacy_version is distinct from '2026-10-18' then raise exception 'Application notice changed' using errcode='22023';end if;
  if (select count(*) from private.demo_requests where created_at>now()-interval '1 minute')>=10
   or (select count(*) from private.demo_requests where email=v_email and created_at>now()-interval '1 hour')>=3 then
   raise exception 'Too many requests' using errcode='P0001';end if;
  insert into private.demo_requests(request_id,name,email,company,phone,organisation_number,seeking,message,privacy_version,privacy_acknowledged_at,legacy)
   values(p_request_id,v_name,v_email,v_company,v_phone,v_org,v_seeking,v_message,p_privacy_version,now(),false);
 end if;
 return jsonb_build_object('request_id',p_request_id,'accepted',true);
end $$;
commit;
