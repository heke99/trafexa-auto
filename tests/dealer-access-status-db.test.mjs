import{test}from'node:test';import assert from'node:assert/strict';import{createDatabase,asRole}from'./company-team-db/helpers.mjs';
const U='bb170000-0000-4000-8000-000000000001',V='bb170000-0000-4000-8000-000000000002',C='bb170000-0000-4000-8000-000000000003';
test('own suspended-company boolean preserves tenant RLS and cannot disclose foreign company data',async()=>{
 const db=await createDatabase();try{
  await db.query("insert into auth.users(id,email,email_confirmed_at)values($1,'suspended@example.test',now()),($2,'other@example.test',now())",[U,V]);await db.query("insert into public.companies(id,name,organisation_number,created_by,status)values($1,'Private Company','5568554884',$2,'suspended')",[C,U]);await db.query("insert into public.memberships(company_id,user_id,role)values($1,$2,'owner')",[C,U]);
  const call=(actor,role='authenticated')=>asRole(db,role,actor,async tx=>(await tx.query('select public.get_my_company_access_status()as result')).rows[0].result);
  assert.deepEqual(await call(U),{actorUserId:U,hasSuspendedCompany:true});assert.deepEqual(await call(V),{actorUserId:V,hasSuspendedCompany:false});
  const rows=await asRole(db,'authenticated',U,tx=>tx.query('select id,name from public.companies'));assert.deepEqual(rows.rows,[]);
  for(const role of ['anon','service_role'])await assert.rejects(()=>call(U,role),error=>error.code==='42501');
  await db.query("update private.account_approvals set status='suspended'where user_id=$1",[U]);await assert.rejects(()=>call(U),error=>error.code==='42501');
 }finally{await db.close();}
});
test('database invitation page carries actual recipient identity and the implementation cannot be called directly',async()=>{
 const db=await createDatabase();try{await db.query("insert into auth.users(id,email,email_confirmed_at)values($1,'recipient@example.test',now())",[U]);
  const page=await asRole(db,'authenticated',U,async tx=>(await tx.query('select public.list_my_company_invitations(null,50)as result')).rows[0].result);assert.deepEqual(page,{actorUserId:U,invitations:[],nextPageKey:null});
  await assert.rejects(()=>asRole(db,'authenticated',U,tx=>tx.query('select private.list_my_company_invitations_actor_impl(null,50)')),error=>error.code==='42501');
 }finally{await db.close();}
});
