-- Rollback-only, no hosted mutation. Run after company_team migration.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('20000000-0000-4000-8000-000000000001','team-owner@example.test',now()),
 ('20000000-0000-4000-8000-000000000002','team-recipient@example.test',now());
insert into public.companies(id,name,organisation_number,created_by) values
 ('20000000-0000-4000-8000-000000000101','SQL Team','1234567890','20000000-0000-4000-8000-000000000001');
insert into public.memberships(id,company_id,user_id,role) values
 ('20000000-0000-4000-8000-000000000201','20000000-0000-4000-8000-000000000101','20000000-0000-4000-8000-000000000001','owner');
do $$declare f text; role_name text; begin
 foreach f in array array['list_company_team(uuid,uuid,uuid,integer)','create_company_invitation(uuid,text,text,integer,uuid)',
 'revoke_company_invitation(uuid,uuid,integer,text,uuid)','update_company_team_member(uuid,uuid,integer,text,text,text,uuid)',
 'list_my_company_invitations(uuid,integer)','accept_company_invitation(uuid,integer,uuid)'] loop
  assert not (select prosecdef from pg_proc where oid=('public.'||f)::regprocedure), 'Public function must be invoker';
  assert (select prosecdef from pg_proc where oid=('private.'||f)::regprocedure), 'Private entrypoint must be definer';
  assert (select proconfig @> array['search_path=""'] from pg_proc where oid=('private.'||f)::regprocedure), 'Definer search path locked';
  assert has_function_privilege('authenticated','public.'||f,'EXECUTE'), 'Authenticated RPC grant missing';
  foreach role_name in array array['anon','service_role'] loop
   assert not has_function_privilege(role_name,'public.'||f,'EXECUTE'), 'Unexpected public RPC grant';
   assert not has_function_privilege(role_name,'private.'||f,'EXECUTE'), 'Unexpected private RPC grant';
  end loop;
 end loop;
 assert (select relrowsecurity from pg_class where oid='private.company_team_invitations'::regclass), 'Invitations RLS required';
 assert (select relrowsecurity from pg_class where oid='private.company_team_audit'::regclass), 'Audit RLS required';
 foreach role_name in array array['anon','authenticated','service_role'] loop
  assert not has_table_privilege(role_name,'private.company_team_invitations','SELECT'), 'Private invitations exposed';
  assert not has_table_privilege(role_name,'private.company_team_audit','INSERT'), 'Audit forging possible';
 end loop;
 assert not has_table_privilege('authenticated','public.memberships','UPDATE'), 'Membership direct updates widened';
 assert not has_table_privilege('authenticated','public.memberships','INSERT'), 'Membership direct inserts widened';
 assert not has_function_privilege('authenticated','private.company_team_identity(boolean)','EXECUTE'), 'Internal auth helper exposed';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
do $$declare a jsonb; b jsonb; begin
 a:=public.create_company_invitation('20000000-0000-4000-8000-000000000101',' Team-Recipient@Example.Test ','finance',1,'20000000-0000-4000-8000-000000000301');
 assert a->'invitation'->>'email'='team-recipient@example.test','Email normalization failed';
 b:=public.create_company_invitation('20000000-0000-4000-8000-000000000101','team-recipient@example.test','finance',1,'20000000-0000-4000-8000-000000000301');
 assert a=b,'Exact replay must be identical';
 begin
  perform public.update_company_team_member('20000000-0000-4000-8000-000000000101','20000000-0000-4000-8000-000000000201',1,'viewer','active','No owner transfer','20000000-0000-4000-8000-000000000302');
  raise exception 'Owner mutation unexpectedly allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
