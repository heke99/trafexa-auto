-- Synthetic current-month settings and permission proof. Version 2 read boundary; no legacy draft, closed period or assessment is forged.
begin;
do $$declare a uuid:='ee450000-0000-4000-8000-000000000001';u uuid:='ee450000-0000-4000-8000-000000000002';c uuid:='ee450000-0000-4000-8000-000000000003';begin
 if exists(select 1 from auth.users where id in(a,u)) or exists(select 1 from public.companies where id=c) then raise exception 'Financial fixture collision';end if;
 insert into auth.users(id,email,email_confirmed_at)values(a,'financial-admin-ee450000@example.invalid',now()),(u,'financial-owner-ee450000@example.invalid',now());
 insert into private.account_approvals(user_id,status,updated_by)values(a,'approved',a),(u,'approved',u) on conflict(user_id) do nothing;
 insert into private.platform_admins(user_id,created_by)values(a,a);
 insert into public.companies(id,name,organisation_number,created_by)values(c,'Financial Rollback Fixture','9945000001',u);
 insert into public.memberships(company_id,user_id,role)values(c,u,'owner');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ee450000-0000-4000-8000-000000000001',true);
do $$declare c uuid:='ee450000-0000-4000-8000-000000000003';m text:=to_char(clock_timestamp() at time zone 'Europe/Stockholm','YYYY-MM');f jsonb:='{"vatTreatment":"unresolved","sellerVatRegistered":null,"sellerVatNumber":null,"paymentDays":null,"paymentMethod":"unresolved","paymentAccount":null,"reason":"Rollback reviewed partial settings"}';p jsonb;r jsonb;begin
 p:=public.get_platform_advertising_financial_page_v2(c,m,null,null);
 if p->>'calculationVersion'<>'2' or p->'settings'->>'version'<>'0' or p->'settings'->'fields'->>'vatTreatment'<>'unresolved' or p->'settings'->'fields'->'sellerVatRegistered'<>'null'::jsonb or p->'preview'<>'null'::jsonb or (p->>'canCreateAssessment')::boolean then raise exception 'Unconfigured settings mismatch';end if;
 r:=public.save_advertising_financial_settings(c,f,0,true,'ee450000-0000-4000-8000-000000000004');
 if r->'settings'->>'version'<>'1' or r->'receipt'->>'actorUserId'<>auth.uid()::text or r->'settings'->'fields'->'paymentAccount'<>'null'::jsonb then raise exception 'Partial settings receipt mismatch';end if;
 if public.save_advertising_financial_settings(c,f,0,true,'ee450000-0000-4000-8000-000000000004')<>r then raise exception 'Financial settings replay mismatch';end if;
 begin perform public.create_advertising_financial_assessment_v2(c,m,null,repeat('a',64),1,r->'settings'->>'reviewToken',repeat('b',64),true,'ee450000-0000-4000-8000-000000000005');raise exception 'Unselected assessment unexpectedly created';exception when sqlstate '22023' then null;end;
 begin perform 1 from private.advertising_financial_settings;raise exception 'Direct private read allowed';exception when sqlstate '42501' then null;end;
end $$;
select set_config('request.jwt.claim.sub','ee450000-0000-4000-8000-000000000002',true);
do $$declare c uuid:='ee450000-0000-4000-8000-000000000003';m text:=to_char(clock_timestamp() at time zone 'Europe/Stockholm','YYYY-MM');p jsonb;begin
 p:=public.list_advertising_financial_page_v2(c,m,null,null);
 if p->>'calculationVersion'<>'2' or p->>'actorRole'<>'owner' or p->'settings'->>'version'<>'1' or (p->>'canCreateAssessment')::boolean then raise exception 'Readonly dealer settings mismatch';end if;
 begin perform public.save_advertising_financial_settings(c,p->'settings'->'fields',1,true,'ee450000-0000-4000-8000-000000000006');raise exception 'Dealer settings write allowed';exception when sqlstate '42501' then null;end;
end $$;
reset role;
do $$begin
 if exists(select 1 from private.advertising_financial_assessments where company_id='ee450000-0000-4000-8000-000000000003') then raise exception 'Unexpected reviewed assessment';end if;
end $$;
select 'PASS: explicit V2 scope, unconfigured VAT remains unknown, explicit partial settings and exact replay, private admin/dealer reads, owner writes/private access denied, selected source required' result;
rollback;
