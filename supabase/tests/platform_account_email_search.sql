-- Synthetic rollback-only proof. No Auth API, provider, email dispatch or real account is used.
begin;
do $$begin
 if exists(select 1 from auth.users where id::text like 'fd260000-0000-4000-8000-%' or email like 'account-search-fd260000-%@fixture.invalid')
 or exists(select 1 from private.platform_admins where user_id::text like 'fd260000-0000-4000-8000-%')
 or exists(select 1 from private.account_approvals where user_id::text like 'fd260000-0000-4000-8000-%')
 or exists(select 1 from private.account_approval_audit where actor_user_id::text like 'fd260000-0000-4000-8000-%' or user_id::text like 'fd260000-0000-4000-8000-%')
 or exists(select 1 from private.transactional_email_outbox where recipient_user_id::text like 'fd260000-0000-4000-8000-%' or recipient like 'account-search-fd260000-%@fixture.invalid')then raise exception 'Account search fixture collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at,created_at)values
 ('fd260000-0000-4000-8000-000000000001','account-search-fd260000-admin@fixture.invalid',now(),'2026-10-15T00:00:01Z'),
 ('fd260000-0000-4000-8000-000000000002','account-search-fd260000-match%_1@fixture.invalid',now(),'2026-10-15T00:00:02Z'),
 ('fd260000-0000-4000-8000-000000000003','account-search-fd260000-match%_2@fixture.invalid',now(),'2026-10-15T00:00:03Z');
insert into private.platform_admins(user_id,created_by)values('fd260000-0000-4000-8000-000000000001','fd260000-0000-4000-8000-000000000001');
insert into private.account_approvals(user_id,status,updated_by)values
 ('fd260000-0000-4000-8000-000000000002','approved','fd260000-0000-4000-8000-000000000001'),
 ('fd260000-0000-4000-8000-000000000003','approved','fd260000-0000-4000-8000-000000000001');
set local role authenticated;
set local request.jwt.claim.sub='fd260000-0000-4000-8000-000000000001';
do $$declare p jsonb;n jsonb;c jsonb;q text:='account-search-fd260000-match%_';begin
 p:=public.search_platform_accounts('approved',q,null,50);
 if jsonb_array_length(p->'accounts')is distinct from 2 or p->'nextCursor'is distinct from 'null'::jsonb or p->>'actorUserId'is distinct from 'fd260000-0000-4000-8000-000000000001'then raise exception 'Literal account search scope mismatch';end if;
 if exists(select 1 from jsonb_array_elements(p->'accounts')a where a->>'status'is distinct from 'approved'or a->'emailVerified'is distinct from 'true'::jsonb or position(q in a->>'email')=0)then raise exception 'Wrong filtered account';end if;
 if jsonb_array_length(public.search_platform_accounts('pending',q,null,50)->'accounts')is distinct from 0 then raise exception 'Status filter ignored';end if;
 p:=public.search_platform_accounts('approved',q,null,1);c:=p->'nextCursor';
 if p->'accounts'->0->>'userId'is distinct from 'fd260000-0000-4000-8000-000000000003'or c is null or c='null'::jsonb then raise exception 'First account page mismatch';end if;
 n:=public.search_platform_accounts('approved',q,c,1);
 if n->'accounts'->0->>'userId'is distinct from 'fd260000-0000-4000-8000-000000000002'or n->'nextCursor'is distinct from 'null'::jsonb then raise exception 'Next account page mismatch';end if;
 begin perform public.search_platform_accounts('all',q,c,1);raise exception 'Cursor filter bypass';exception when serialization_failure then null;end;
 begin perform public.search_platform_accounts('approved',q||'1',c,1);raise exception 'Cursor query bypass';exception when serialization_failure then null;end;
 begin perform public.search_platform_accounts('approved',q,jsonb_set(c,'{actorId}','"fd260000-0000-4000-8000-000000000002"'),1);raise exception 'Cursor actor bypass';exception when serialization_failure then null;end;
end$$;
set local request.jwt.claim.sub='fd260000-0000-4000-8000-000000000002';
do $$begin
 begin perform public.search_platform_accounts('approved','account-search-fd260000-match%_',null,50);raise exception 'Ordinary approved account enumerated accounts';exception when insufficient_privilege then null;end;
end$$;
set local role anon;
do $$begin
 begin perform public.search_platform_accounts('approved','account-search-fd260000-match%_',null,50);raise exception 'Anonymous account enumeration';exception when insufficient_privilege then null;end;
end$$;
reset role;
rollback;
select 'PASS: synthetic account search literal query, paging, filter and caller boundaries; transaction rolled back' as result;
