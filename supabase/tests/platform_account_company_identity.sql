-- Reserved synthetic identities only. This transaction never dispatches email.
begin;
do $$begin
 if exists(select 1 from auth.users where id::text like 'fd310000-0000-4000-8000-%' or email like 'account-identity-fd310000-%@fixture.invalid')
 or exists(select 1 from public.companies where id::text like 'fd310000-0000-4000-8000-%')
 or exists(select 1 from public.memberships where id::text like 'fd310000-0000-4000-8000-%' or user_id::text like 'fd310000-0000-4000-8000-%')
 or exists(select 1 from private.demo_requests where id::text like 'fd310000-0000-4000-8000-%')
 or exists(select 1 from private.application_account_invitations where id::text like 'fd310000-0000-4000-8000-%' or user_id::text like 'fd310000-0000-4000-8000-%')then raise exception 'Account identity fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at)values
 ('fd310000-0000-4000-8000-000000000001','account-identity-fd310000-admin@fixture.invalid',now(),'{}','2026-10-16T00:00:01Z'),
 ('fd310000-0000-4000-8000-000000000002','account-identity-fd310000-user@fixture.invalid',now(),'{"name":"Elsa Bilsson"}','2026-10-16T00:00:02Z'),
 ('fd310000-0000-4000-8000-000000000003','account-identity-fd310000-new@fixture.invalid',now(),'{}','2026-10-16T00:00:03Z');
insert into private.platform_admins(user_id,created_by)values('fd310000-0000-4000-8000-000000000001','fd310000-0000-4000-8000-000000000001');
insert into public.companies(id,name,organisation_number,created_by) values
 ('fd310000-0000-4000-8000-000000000010','Bilbolaget %_ Norr AB','5561234567','fd310000-0000-4000-8000-000000000002'),
 ('fd310000-0000-4000-8000-000000000011','Södra Bil AB','5599876543','fd310000-0000-4000-8000-000000000002');
insert into public.memberships(id,company_id,user_id,role,status)values
 ('fd310000-0000-4000-8000-000000000020','fd310000-0000-4000-8000-000000000010','fd310000-0000-4000-8000-000000000002','owner','active'),
 ('fd310000-0000-4000-8000-000000000021','fd310000-0000-4000-8000-000000000011','fd310000-0000-4000-8000-000000000002','viewer','suspended');
insert into private.demo_requests(id,name,email,company,organisation_number,status,version,legacy,request_id,phone,seeking,message,privacy_version,privacy_acknowledged_at)values
 ('fd310000-0000-4000-8000-000000000030','Ny Handlare','account-identity-fd310000-new@fixture.invalid','Ansökt Bil AB','5567778899','in_review',2,false,'fd310000-0000-4000-8000-000000000031','0701234567',array['system'],'Syntetiskt prov','2026-10',now());
insert into private.application_account_invitations(id,application_id,application_version,actor_user_id,request_id,email,name,reason,request_payload,user_id,consumed_at)values
 ('fd310000-0000-4000-8000-000000000040','fd310000-0000-4000-8000-000000000030',2,'fd310000-0000-4000-8000-000000000001','fd310000-0000-4000-8000-000000000041','account-identity-fd310000-new@fixture.invalid','Ny Handlare','Syntetiskt prov','{}','fd310000-0000-4000-8000-000000000003',now());
set local role authenticated;
set local request.jwt.claim.sub='fd310000-0000-4000-8000-000000000001';
do $$declare p jsonb; q text;begin
 foreach q in array array['elsa bilsson','bilbolaget %_ norr','556123-4567','556 123 4567','165561234567','16 556123-4567','%_','account-identity-fd310000-user']loop
  p:=public.search_platform_accounts('all',q,null,50);
  if jsonb_array_length(p->'accounts')<>1 or p#>>'{accounts,0,userId}'<>'fd310000-0000-4000-8000-000000000002' or p#>>'{accounts,0,identityVersion}'<>'1' or p#>>'{accounts,0,companyCount}'<>'2' or p#>>'{accounts,0,companies,0,name}'<>'Bilbolaget %_ Norr AB' then raise exception 'Company/name/org/email search failed for %',q;end if;
 end loop;
 p:=public.search_platform_accounts('all','södra bil',null,50);
 if p#>>'{accounts,0,companies,0,membershipStatus}'<>'suspended' or p#>>'{accounts,0,companies,0,name}'<>'Södra Bil AB'then raise exception 'Suspended affiliation identity missing';end if;
 p:=public.search_platform_accounts('all','ansökt bil',null,50);
 if jsonb_array_length(p->'accounts')<>1 or p#>>'{accounts,0,companyCount}'<>'0' or p#>>'{accounts,0,requestedCompany,name}'<>'Ansökt Bil AB' or p#>>'{accounts,0,requestedCompany,organisationNumber}'<>'5567778899' then raise exception 'Requested company confused with membership';end if;
 if jsonb_array_length(public.search_platform_accounts('all','556777-8899',null,50)->'accounts')<>1 then raise exception 'Requested org search failed';end if;
 p:=public.list_platform_accounts('all',null,50);
 if not exists(select 1 from jsonb_array_elements(p->'accounts')a where a->>'userId'='fd310000-0000-4000-8000-000000000002' and a->>'companyCount'='2')then raise exception 'Legacy identity enrichment missing';end if;
 begin perform private.platform_account_identity('fd310000-0000-4000-8000-000000000002','');raise exception 'Helper enumeration';exception when insufficient_privilege then null;end;
 begin perform private.platform_account_matches('fd310000-0000-4000-8000-000000000002','');raise exception 'Helper predicate enumeration';exception when insufficient_privilege then null;end;
end$$;
set local request.jwt.claim.sub='fd310000-0000-4000-8000-000000000002';
do $$begin
 begin perform public.search_platform_accounts('all','bil',null,50);raise exception 'Dealer enumeration';exception when insufficient_privilege then null;end;
end$$;
set local role anon;
do $$begin
 begin perform public.search_platform_accounts('all','bil',null,50);raise exception 'Anonymous enumeration';exception when insufficient_privilege then null;end;
end$$;
reset role;
rollback;
select 'PASS: company identity, personal name, org normalization, literal search, requested-company distinction and denied callers; rolled back' as result;
