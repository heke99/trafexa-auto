begin;
do $$begin
 if exists(select 1 from auth.users where id='ee170000-0000-0000-0000-000000000001' or email='overview-proof@example.invalid') then raise exception 'Fixture collision';end if;
end $$;
insert into auth.users(id,email,email_confirmed_at,is_anonymous,is_sso_user) values('ee170000-0000-0000-0000-000000000001','overview-proof@example.invalid',now(),false,false);
insert into private.platform_admins(user_id,created_by) values('ee170000-0000-0000-0000-000000000001','ee170000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','ee170000-0000-0000-0000-000000000001',true);
do $$declare result jsonb;begin
 result:=public.get_platform_overview();
 if result->>'actorUserId'<>'ee170000-0000-0000-0000-000000000001' or jsonb_array_length(result->'daily')<>7
 or result->>'stockAskingPriceOre' !~ '^(0|[1-9][0-9]*)$' or result->'companies'->>'total' !~ '^(0|[1-9][0-9]*)$'
 or result::text like '%overview-proof@example.invalid%' then raise exception 'Overview proof failed';end if;
end $$;
select 'PASS: verified registry admin reads aggregate overview with exact money and seven calendar days' as result;
rollback;
