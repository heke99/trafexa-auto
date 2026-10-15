-- Synthetic current-month profiles and permissions only. No closed period is forged.
begin;
do $$declare a uuid:='ee400000-0000-4000-8000-000000000001';u uuid:='ee400000-0000-4000-8000-000000000002';c uuid:='ee400000-0000-4000-8000-000000000003';begin
 if exists(select 1 from auth.users where id in(a,u)) or exists(select 1 from public.companies where id=c) then raise exception 'Invoice fixture collision';end if;
 insert into auth.users(id,email,email_confirmed_at)values(a,'invoice-admin-ee400000@example.invalid',now()),(u,'invoice-owner-ee400000@example.invalid',now());
 insert into private.account_approvals(user_id,status,updated_by)values(a,'approved',a),(u,'approved',u) on conflict(user_id) do nothing;
 insert into private.platform_admins(user_id,created_by)values(a,a);
 insert into public.companies(id,name,organisation_number,created_by)values(c,'Invoice Rollback Fixture','9940000001',u);
 insert into public.memberships(company_id,user_id,role)values(c,u,'owner');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ee400000-0000-4000-8000-000000000002',true);
do $$declare c uuid:='ee400000-0000-4000-8000-000000000003';f jsonb:='{"invoiceEmail":null,"addressLine1":null,"addressLine2":null,"postalCode":null,"city":null,"countryCode":null,"reference":"Rollback only"}';r jsonb;p jsonb;begin
 r:=public.save_advertising_buyer_profile(c,f,0,'ee400000-0000-4000-8000-000000000004');
 if r->'profile'->'fields'->>'legalName'<>'Invoice Rollback Fixture' or r->'profile'->'fields'->'addressLine1'<>'null'::jsonb or r->'profile'->>'version'<>'1' then raise exception 'Derived partial buyer profile mismatch';end if;
 if public.save_advertising_buyer_profile(c,f,0,'ee400000-0000-4000-8000-000000000004')<>r then raise exception 'Profile replay mismatch';end if;
 begin perform public.save_advertising_buyer_profile(c,f||'{"legalName":"Forged"}'::jsonb,1,'ee400000-0000-4000-8000-000000000005');raise exception 'Forged buyer identity accepted';exception when sqlstate '22023' then null;end;
 p:=public.list_advertising_invoice_page(c,to_char(clock_timestamp() at time zone 'Europe/Stockholm','YYYY-MM'),null);
 if p->>'actorRole'<>'owner' or (p->>'canEditSeller')::boolean or p->'basis'->'original'<>'null'::jsonb then raise exception 'Dealer page scope mismatch';end if;
 begin perform public.save_advertising_seller_profile('{}',0,'ee400000-0000-4000-8000-000000000006');raise exception 'Dealer seller write accepted';exception when sqlstate '42501' then null;end;
end $$;
select set_config('request.jwt.claim.sub','ee400000-0000-4000-8000-000000000001',true);
do $$declare c uuid:='ee400000-0000-4000-8000-000000000003';m text:=to_char(clock_timestamp() at time zone 'Europe/Stockholm','YYYY-MM');p jsonb;begin
 p:=public.get_platform_advertising_invoice_page(c,m,null);
 if p->>'actorRole'<>'platform_admin' or p->'drafts'<>'[]'::jsonb then raise exception 'Admin page mismatch';end if;
 begin perform public.create_advertising_invoice_draft(c,m,(p->'buyerProfile'->>'version')::integer,(p->'sellerProfile'->>'version')::integer,p->>'reviewToken',true,'ee400000-0000-4000-8000-000000000007');raise exception 'Unclosed draft accepted';exception when sqlstate '22023' then null;end;
 begin perform 1 from private.advertising_invoice_profiles;raise exception 'Direct private access accepted';exception when sqlstate '42501' then null;end;
end $$;
reset role;
do $$begin
 if exists(select 1 from private.advertising_invoice_drafts where company_id='ee400000-0000-4000-8000-000000000003') then raise exception 'Unexpected invoice draft';end if;
end $$;
select 'PASS: actual buyer identity, partial private profile, exact replay, owner/admin scope, forged identity/seller write/direct access denied, unlocked draft denied' result;
rollback;
