import {test}from'node:test';
import assert from'node:assert/strict';
import {readFile}from'node:fs/promises';
import{createDatabase,asRole}from'./crm-db/helpers.mjs';
import{createSourceLoader}from'./helpers/source-loader.mjs';
const id=n=>`fd320000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('company identity hosted-safe proof uses the complete schema and all eight cleanup counters return zero',async()=>{const db=await createDatabase({approveEstablishedFixtures:false});try{const results=await db.exec(await readFile(new URL('../supabase/tests/platform_account_company_identity.sql',import.meta.url),'utf8'));assert.ok(results.some(r=>r.rows.some(row=>row.result?.startsWith('PASS:'))));const cleanup=(await db.exec(await readFile(new URL('../supabase/tests/platform_account_company_identity_cleanup.sql',import.meta.url),'utf8'))).at(-1).rows[0].cleanup;assert.equal(Object.keys(cleanup).length,8);assert.ok(Object.values(cleanup).every(n=>n===0));}finally{await db.close();}});
test('actual action and SQL support names org numbers and email, prioritize matching affiliation beyond the display bound, and bind cursor identity freshly',async()=>{
 const db=await createDatabase({approveEstablishedFixtures:false});try{
  for(let n=1;n<=4;n++)await db.query("insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)values($1,$2,now(),$3,$4)",[id(n),`identity-${n}@fixture.invalid`,`2026-10-16T00:00:0${n}Z`,{name:n===3?'Lisa Svensson':'Person '+n}]);
  await db.query('insert into private.platform_admins(user_id,created_by)values($1,$1),($2,$1)',[id(1),id(2)]);
  for(let n=10;n<17;n++){await db.query('insert into public.companies(id,name,organisation_number,created_by)values($1,$2,$3,$4)',[id(n),n===16?'Zebra Bil AB':`Bilbolag ${n}`,String(5560000000+n),id(3)]);await db.query("insert into public.memberships(company_id,user_id,role)values($1,$2,'sales')",[id(n),id(3)]);}
  const rpc=(actor,name,args)=>asRole(db,'authenticated',actor,async tx=>(await tx.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})result`,args)).rows[0].result);
  let revoke=false;const sdk={auth:{async getUser(){return{data:{user:{id:id(1),email:'identity-1@fixture.invalid',email_confirmed_at:'2026-10-16T00:00:00Z'}},error:null};}},async rpc(name,args){try{const data=await rpc(id(1),name,Object.values(args));if(revoke&&name==='search_platform_accounts')await db.query("update private.platform_admins set status='suspended'where user_id=$1",[id(1)]);return{data,error:null};}catch(error){return{data:null,error};}}};
  const loader=await createSourceLoader({'server-only':{},react:{cache:fn=>fn},'next/cache':{revalidatePath(){}},'@/lib/supabase/server':{async createServerSupabaseClient(){return sdk;}}});const action=loader.load('@/lib/platform-admin/account-actions').listPlatformAccountsAction;
  for(const query of ['  LISA   SVENSSON  ','Zebra Bil','556000-0016','556 000 0016','165560000016','16 556000-0016','identity-3@']){const page=await action({filter:'all',search:query});assert.equal(page.ok,true,JSON.stringify(page));assert.equal(page.accounts.length,1);assert.equal(page.accounts[0].userId,id(3));assert.equal(page.accounts[0].companyCount,7);assert.equal(page.accounts[0].companies.length,5);if(query.includes('Zebra')||query.startsWith('556'))assert.equal(page.accounts[0].companies[0].name,'Zebra Bil AB');assert.equal(Object.hasOwn(page.accounts[0],'identityVersion'),false);}
  const first=await action({filter:'all',search:'identity-',limit:1});assert.equal(first.ok,true);assert.ok(first.nextPageKey);assert.equal((await action({filter:'all',search:'other',pageKey:first.nextPageKey})).code,'invalid_input');
  const c=JSON.parse(first.nextPageKey);for(const args of [['all','identity-',{...c,actorId:id(2)},1],['pending','identity-',c,1],['all','identity-3',c,1]])await assert.rejects(()=>rpc(id(1),'search_platform_accounts',args),e=>e.code==='40001');
  for(const role of['anon','service_role'])await assert.rejects(()=>asRole(db,role,id(1),tx=>tx.query('select public.search_platform_accounts()')),e=>e.code==='42501');
  const legacy=await action({filter:'all'});assert.equal(legacy.ok,true);assert.equal(legacy.accounts.find(a=>a.userId===id(3)).companyCount,7);
  revoke=true;const denied=await action({filter:'all',search:'zebra bil'});assert.equal(denied.code,'access_denied');assert.equal(Object.hasOwn(denied,'accounts'),false);
 }finally{await db.close();}
});
