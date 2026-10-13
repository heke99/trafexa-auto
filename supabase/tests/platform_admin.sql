-- Rollback-only SQL verification. Fixtures do not constitute a live bootstrap.
begin;
create temporary table platform_fixtures(key text primary key,id uuid not null default gen_random_uuid(),payload jsonb);
grant select,insert,update on platform_fixtures to authenticated,anon,service_role;
insert into platform_fixtures(key) select unnest(array['super','super2','owner','owner_b','viewer','unverified','banned','anonymous','sso','bootstrap','duplicate','company','company_b','customer','customer_b','vehicle','stock','request','contact1','contact2']);
insert into auth.users(id,email,email_confirmed_at)
 select id,case when key='owner' then 'info@trafexa.com' when key='bootstrap' then 'approved-bootstrap@example.test' else key||'@example.test' end,
  case when key='unverified' then null else now() end from platform_fixtures where key in('super','super2','owner','owner_b','viewer','unverified','banned','anonymous','sso','bootstrap');
update auth.users set is_anonymous=true where id=(select id from platform_fixtures where key='anonymous');
update auth.users set is_sso_user=true where id=(select id from platform_fixtures where key='sso');
update auth.users set banned_until=now()+interval '1 day' where id=(select id from platform_fixtures where key='banned');
insert into public.companies(id,name,organisation_number,created_by) values
 ((select id from platform_fixtures where key='company'),'Platform test A','5560000001',(select id from platform_fixtures where key='owner')),
 ((select id from platform_fixtures where key='company_b'),'Platform test B','5560000002',(select id from platform_fixtures where key='owner_b'));
insert into public.memberships(company_id,user_id,role) values
 ((select id from platform_fixtures where key='company'),(select id from platform_fixtures where key='owner'),'owner'),
 ((select id from platform_fixtures where key='company'),(select id from platform_fixtures where key='viewer'),'viewer'),
 ((select id from platform_fixtures where key='company_b'),(select id from platform_fixtures where key='owner_b'),'owner');
insert into public.customers(id,company_id,name) values
 ((select id from platform_fixtures where key='customer'),(select id from platform_fixtures where key='company'),'Tenant A Customer'),
 ((select id from platform_fixtures where key='customer_b'),(select id from platform_fixtures where key='company_b'),'Tenant B Customer');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year) values
 ((select id from platform_fixtures where key='vehicle'),(select id from platform_fixtures where key='company'),'PAT001','Volvo','V60',2025);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme) values
 ((select id from platform_fixtures where key='stock'),(select id from platform_fixtures where key='company'),(select id from platform_fixtures where key='vehicle'),10000,20000,'unknown');
insert into private.demo_requests(id,name,email,company,phone,message,created_at) values
 ((select id from platform_fixtures where key='contact1'),'Contact A','a@example.test','Company request A',null,null,'2026-10-01T10:00:00Z'),
 ((select id from platform_fixtures where key='contact2'),'Contact B','b@example.test','Company request B','12345','Interested','2026-10-02T10:00:00Z');

-- All newly created registries are empty. A dealer owner with the contact email
-- and spoofed metadata gets neither platform privileges nor a bootstrap role.
do $$begin
 if exists(select 1 from private.platform_admins) or exists(select 1 from private.platform_admin_bootstrap_reservations) then raise exception 'FAIL platform migration pre-granted authority';end if;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from platform_fixtures where key='owner'),true);
select set_config('request.jwt.claims','{"role":"authenticated","email":"hekmat.h@trafexa.com","user_metadata":{"superadmin":true,"role":"platform_admin"},"app_metadata":{"platform_admin":true}}',true);
set local role authenticated;
do $$declare blocked boolean;begin
 if public.get_platform_admin_session()->>'is_platform_admin'<>'false' then raise exception 'FAIL dealer owner/contact email/metadata grant';end if;
 if (select count(*) from public.companies)<>1 or (select count(*) from public.customers)<>1 then raise exception 'FAIL ordinary dealer tenant RLS changed';end if;
 blocked:=false;begin perform public.list_platform_companies('',null,50);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL ordinary owner saw global companies';end if;
 blocked:=false;begin perform public.list_platform_contact_requests(null,50);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL ordinary owner saw contact PII';end if;
 blocked:=false;begin perform public.claim_platform_admin_access();exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL owner metadata claimed role';end if;
 blocked:=false;begin insert into private.platform_admins(user_id,created_by) values(auth.uid(),auth.uid());exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL self grant';end if;
 blocked:=false;begin select 1 from private.platform_admins;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL allowlist disclosure';end if;
 blocked:=false;begin insert into private.platform_admin_bootstrap_reservations(email,approval_reference) values('info@trafexa.com','Fake client approval');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL client bootstrap reservation';end if;
 blocked:=false;begin update public.companies set status='suspended';exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL dealer direct global status update';end if;
end $$;
reset role;
-- Trusted fixture bootstrap only; production requires a separately reviewed UID.
insert into private.platform_admins(user_id,created_by)
 select id,(select id from platform_fixtures where key='super') from platform_fixtures where key in('super','super2','unverified','banned','anonymous','sso');
select set_config('request.jwt.claim.sub',(select id::text from platform_fixtures where key='super'),true);
set local role authenticated;
do $$declare page jsonb; next_page jsonb; c uuid; receipt jsonb; replay jsonb; changed_back jsonb; request uuid; blocked boolean;begin
 if public.get_platform_admin_session()->>'is_platform_admin'<>'true' then raise exception 'FAIL verified allowlisted superadmin';end if;
 if exists(select 1 from public.companies) or exists(select 1 from public.customers) then raise exception 'FAIL superadmin broadened dealer RLS';end if;
 page:=public.list_platform_companies('',null,1);
 if jsonb_array_length(page->'companies')<>1 or page->>'next_page_key' is null then raise exception 'FAIL bounded company pagination';end if;
 next_page:=public.list_platform_companies('',(page->>'next_page_key')::uuid,1);
 if jsonb_array_length(next_page->'companies')<>1 or next_page->>'next_page_key' is not null
  or page#>>'{companies,0,id}'=next_page#>>'{companies,0,id}' then raise exception 'FAIL company cursor';end if;
 page:=public.list_platform_companies('5560000001',null,50);
 if jsonb_array_length(page->'companies')<>1 or page#>>'{companies,0,membership_count}'<>'2' or page#>>'{companies,0,stock_count}'<>'1'
  or page#>'{companies,0,customer}' is not null or page#>'{companies,0,email}' is not null then raise exception 'FAIL narrow company metadata/counts/search';end if;
 blocked:=false;begin perform public.list_platform_companies('',null,51);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL company page >50';end if;
 blocked:=false;begin perform public.list_platform_companies(repeat('x',161),null,50);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL oversized search';end if;
 page:=public.list_platform_contact_requests(null,1);
 if jsonb_array_length(page->'requests')<>1 or page#>>'{requests,0,name}'<>'Contact B' or page->>'next_page_key' is null then raise exception 'FAIL latest contact page';end if;
 next_page:=public.list_platform_contact_requests((page->>'next_page_key')::uuid,1);
 if jsonb_array_length(next_page->'requests')<>1 or next_page#>>'{requests,0,name}'<>'Contact A' or next_page->>'next_page_key' is not null then raise exception 'FAIL contact cursor';end if;
 blocked:=false;begin perform public.list_platform_contact_requests(null,51);exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL contact page >50';end if;
 blocked:=false;begin perform 1 from private.demo_requests;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL broadened contact table SELECT';end if;
 select id into c from platform_fixtures where key='company';select id into request from platform_fixtures where key='request';
 receipt:=public.set_platform_company_status(c,'active','suspended','Verified company review',request);
 if receipt->>'changed'<>'true' or receipt->>'actor_user_id'<>auth.uid()::text or receipt->>'previous_status'<>'active' or receipt->>'status'<>'suspended' then raise exception 'FAIL platform mutation receipt';end if;
 replay:=public.set_platform_company_status(c,'active','suspended','Verified company review',request);
 if replay<>receipt then raise exception 'FAIL duplicate nonce receipt';end if;
 blocked:=false;begin perform public.set_platform_company_status(c,'active','suspended','Changed reason',request);exception when serialization_failure then blocked:=true;end;
 if not blocked then raise exception 'FAIL changed nonce payload';end if;
 blocked:=false;begin perform public.set_platform_company_status(c,'active','suspended','Stale source',gen_random_uuid());exception when serialization_failure then blocked:=true;end;
 if not blocked then raise exception 'FAIL stale company CAS';end if;
 changed_back:=public.set_platform_company_status(c,'suspended','active','Review resolved',gen_random_uuid());
 if changed_back->>'changed'<>'true' then raise exception 'FAIL company restore';end if;
 if public.set_platform_company_status(c,'active','suspended','Verified company review',request)<>receipt then raise exception 'FAIL historical nonce after newer status';end if;
 replay:=public.set_platform_company_status(c,'active','active','Checked without changing status',gen_random_uuid());
 if replay->>'changed'<>'false' then raise exception 'FAIL unchanged status receipt';end if;
 blocked:=false;begin perform public.set_platform_company_status(gen_random_uuid(),'active','suspended','No company',gen_random_uuid());exception when no_data_found then blocked:=true;end;
 if not blocked then raise exception 'FAIL fake company';end if;
 blocked:=false;begin perform public.set_platform_company_status(c,'active','suspended',' ',gen_random_uuid());exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL missing reason';end if;
 blocked:=false;begin perform public.set_platform_company_status(c,'active','suspended',repeat('x',501),gen_random_uuid());exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL oversized reason';end if;
 blocked:=false;begin perform public.set_platform_company_status(c,'active','invalid','Wrong status',gen_random_uuid());exception when invalid_parameter_value then blocked:=true;end;
 if not blocked then raise exception 'FAIL unknown status';end if;
 update platform_fixtures set payload=receipt where key='request';
end $$;
reset role;
do $$declare blocked boolean:=false;begin
 if (select count(*) from private.platform_company_status_audit where company_id=(select id from platform_fixtures where key='company'))<>3 then raise exception 'FAIL audit count includes failed/duplicate intents';end if;
 if not exists(select 1 from private.platform_company_status_audit where request_id=(select id from platform_fixtures where key='request')
  and actor_user_id=(select id from platform_fixtures where key='super') and reason='Verified company review' and expected_status='active' and previous_status='active' and status='suspended') then raise exception 'FAIL immutable actor/company/reason audit';end if;
 begin update private.platform_company_status_audit set reason='Overwritten';exception when object_not_in_prerequisite_state then blocked:=true;end;
 if not blocked then raise exception 'FAIL privileged audit overwrite';end if;
end $$;
-- The original dealer audit trigger keeps working after platform changes.
select set_config('request.jwt.claim.sub',(select id::text from platform_fixtures where key='owner'),true);
set local role authenticated;
update public.customers set name='Changed through ordinary dealer RLS' where id=(select id from platform_fixtures where key='customer');
reset role;
do $$begin
 if not exists(select 1 from public.audit_events where entity_table='customers' and entity_id=(select id from platform_fixtures where key='customer')
  and actor_user_id=(select id from platform_fixtures where key='owner') and action='UPDATE') then raise exception 'FAIL existing record_audit regression';end if;
end $$;
-- Revocation and actual Auth states take effect without consulting spoofed JWT claims.
update private.platform_admins set status='suspended' where user_id=(select id from platform_fixtures where key='super');
select set_config('request.jwt.claim.sub',(select id::text from platform_fixtures where key='super'),true);
set local role authenticated;
do $$declare blocked boolean:=false;begin
 if public.get_platform_admin_session()->>'is_platform_admin'<>'false' then raise exception 'FAIL revoked admin session';end if;
 begin perform public.set_platform_company_status((select id from platform_fixtures where key='company'),'active','suspended','Old admin retry',(select id from platform_fixtures where key='request'));exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL revoked admin write/replay';end if;
end $$;
reset role;
do $$declare who record;blocked boolean;result jsonb;begin
 for who in select id from platform_fixtures where key in('unverified','banned','anonymous','sso','viewer') loop
  perform set_config('request.jwt.claim.sub',who.id::text,true);set local role authenticated;
  result:=public.get_platform_admin_session();
  if result->>'is_platform_admin'<>'false' then raise exception 'FAIL unsafe Auth/account grant';end if;
  blocked:=false;begin perform public.list_platform_companies('',null,50);exception when insufficient_privilege then blocked:=true;end;
  if not blocked then raise exception 'FAIL unsafe Auth/account global read';end if;
  reset role;
 end loop;
end $$;
-- Explicit approved reservation stays pending until the actual user is verified.
insert into private.platform_admin_bootstrap_reservations(email,approval_reference)
 values('approved-bootstrap@example.test','Approved only in rollback fixture');
update auth.users set email_confirmed_at=null where id=(select id from platform_fixtures where key='bootstrap');
select set_config('request.jwt.claim.sub',(select id::text from platform_fixtures where key='bootstrap'),true);
set local role authenticated;
do $$declare blocked boolean:=false;begin
 begin perform public.claim_platform_admin_access();exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL unverified approved email claim';end if;
end $$;
reset role;
update auth.users set email_confirmed_at=now(),is_sso_user=true where id=(select id from platform_fixtures where key='bootstrap');
set local role authenticated;
do $$declare blocked boolean:=false;begin
 begin perform public.claim_platform_admin_access();exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL SSO bootstrap claim';end if;
end $$;
reset role;
update auth.users set is_sso_user=false where id=(select id from platform_fixtures where key='bootstrap');
insert into auth.users(id,email,email_confirmed_at) values((select id from platform_fixtures where key='duplicate'),'APPROVED-BOOTSTRAP@example.test',now());
set local role authenticated;
do $$declare blocked boolean:=false;begin
 begin perform public.claim_platform_admin_access();exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL ambiguous verified duplicate email';end if;
end $$;
reset role;
update auth.users set email='other-principal@example.test' where id=(select id from platform_fixtures where key='duplicate');
set local role authenticated;
do $$declare first jsonb;again jsonb;begin
 first:=public.claim_platform_admin_access();again:=public.claim_platform_admin_access();
 if first->>'claimed'<>'true' or again->>'claimed'<>'false' or first->>'user_id'<>auth.uid()::text
  or public.get_platform_admin_session()->>'is_platform_admin'<>'true' then raise exception 'FAIL verified one-time UUID activation';end if;
end $$;
reset role;
do $$declare blocked boolean:=false;begin
 if (select count(*) from private.platform_admin_bootstrap_audit)<>1
  or not exists(select 1 from private.platform_admin_bootstrap_reservations where claimed_by=(select id from platform_fixtures where key='bootstrap') and claimed_at is not null)
  or not exists(select 1 from private.platform_admins where user_id=(select id from platform_fixtures where key='bootstrap') and created_by=user_id) then raise exception 'FAIL atomic bootstrap UUID/audit/reservation';end if;
 begin delete from private.platform_admin_bootstrap_audit;exception when object_not_in_prerequisite_state then blocked:=true;end;
 if not blocked then raise exception 'FAIL immutable bootstrap audit';end if;
end $$;
-- Moving the email to a different verified UUID never transfers the claimed role.
update auth.users set email='original-bound-uuid@example.test' where id=(select id from platform_fixtures where key='bootstrap');
update auth.users set email='approved-bootstrap@example.test' where id=(select id from platform_fixtures where key='duplicate');
select set_config('request.jwt.claim.sub',(select id::text from platform_fixtures where key='duplicate'),true);
set local role authenticated;
do $$declare blocked boolean:=false;begin
 begin perform public.claim_platform_admin_access();exception when insufficient_privilege then blocked:=true;end;
 if not blocked or public.get_platform_admin_session()->>'is_platform_admin'<>'false' then raise exception 'FAIL consumed email transferred role';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from platform_fixtures where key='bootstrap'),true);
set local role authenticated;
do $$begin
 if public.get_platform_admin_session()->>'is_platform_admin'<>'true' then raise exception 'FAIL fixed original UUID grant';end if;
end $$;
reset role;
-- No browser admin, service role or anonymous caller gets registry/audit writes.
select set_config('request.jwt.claim.sub',(select id::text from platform_fixtures where key='super2'),true);
set local role service_role;
do $$declare blocked boolean:=false;begin
 begin perform public.list_platform_companies('',null,50);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL service impersonated superadmin';end if;
 blocked:=false;begin perform public.claim_platform_admin_access();exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL service activated user UUID';end if;
 blocked:=false;begin select 1 from private.platform_admins;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL service allowlist disclosure';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$declare blocked boolean:=false;begin
 begin perform public.get_platform_admin_session();exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FAIL anonymous platform session';end if;
end $$;
reset role;
select 'PASS: empty fail-closed registry, active actual verified UUID allowlist, dealer owner/email/metadata denied, narrow global company/contact reads, bounded keysets, CAS and historical nonce receipts, immutable status audit, existing dealer RLS/audit preserved, revoked/banned/anonymous/SSO denied, protected exact-email reservation, unique verified bootstrap, immutable single-use activation audit, no email-to-new-UUID transfer, no service-role identity bypass' as result;
rollback;
