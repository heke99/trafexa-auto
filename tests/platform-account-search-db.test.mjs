import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDatabase,asRole} from './crm-db/helpers.mjs';
import {createSourceLoader} from './helpers/source-loader.mjs';
const id=n=>`fd230000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('hosted-safe synthetic search proof rolls back all reserved accounts audit and email outbox rows',async()=>{
 const db=await createDatabase({approveEstablishedFixtures:false});try{
  const proof=await db.exec(await readFile(new URL('../supabase/tests/platform_account_email_search.sql',import.meta.url),'utf8'));
  assert.ok(proof.some(result=>result.rows.some(row=>String(row.result).startsWith('PASS:'))));
  const checks=await db.exec(await readFile(new URL('../supabase/tests/platform_account_email_search_cleanup.sql',import.meta.url),'utf8'));
  const counters=checks.at(-1).rows[0].cleanup;assert.ok(Object.values(counters).every(value=>value===0),JSON.stringify(counters));
 }finally{await db.close();}
});
test('actual account email search binds actor query filter and chronology, treats wildcard characters literally, and preserves legacy callers',async()=>{
 const db=await createDatabase({approveEstablishedFixtures:false});
 try {
  for(const [n,email]of [[1,'admin@test.invalid'],[2,'admin2@test.invalid'],[3,'first@example.test'],[4,'second@example.test'],[5,'literal%_@example.test'],[6,'unrelated@test.invalid']])await db.query("insert into auth.users(id,email,email_confirmed_at,created_at)values($1,$2,now(),$3)",[id(n),email,`2026-10-15T00:00:0${n}Z`]);
  await db.query('insert into private.platform_admins(user_id,created_by)values($1,$1),($2,$1)',[id(1),id(2)]);
  const rpc=(actor,name,args)=>asRole(db,'authenticated',actor,async tx=>(await tx.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})result`,args)).rows[0].result);
  const search=(query='',cursor=null,actor=id(1),filter='pending',limit=1)=>rpc(actor,'search_platform_accounts',[filter,query,cursor,limit]);
  const first=await search('example.test');assert.equal(first.accounts[0].userId,id(5));assert.ok(first.nextCursor);assert.equal(first.nextCursor.actorId,id(1));
  const next=await search('example.test',first.nextCursor);assert.equal(next.accounts[0].userId,id(4));
  const last=await search('example.test',next.nextCursor);assert.equal(last.accounts[0].userId,id(3));assert.equal(last.nextCursor,null);
  assert.deepEqual((await search('%_')).accounts.map(a=>a.userId),[id(5)]);
  for(const run of [()=>search('test',first.nextCursor),()=>search('example.test',first.nextCursor,id(2)),()=>search('example.test',first.nextCursor,id(1),'all'),()=>search('example.test',{...first.nextCursor,createdAt:'2020-01-01'})])await assert.rejects(run,e=>e.code==='40001');
  for(const query of ['UPPER','has space','bad\nvalue'])await assert.rejects(()=>search(query),e=>e.code==='22023');
  await assert.rejects(()=>search('',null,id(3)),e=>e.code==='42501');
  for(const role of ['anon','service_role'])await assert.rejects(()=>asRole(db,role,id(1),tx=>tx.query("select public.search_platform_accounts()")),e=>e.code==='42501');
  const legacy=await rpc(id(1),'list_platform_accounts',['pending',null,50]);assert.equal(legacy.accounts.length,4);assert.ok(Object.hasOwn(legacy,'nextPageKey'));
  // Exercise the actual action parser/normalizer against the real new RPC.
  let reads=0,revokeAfterRead=false;
  const sdk={auth:{async getUser(){reads++;return{data:{user:{id:id(1),email:'admin@test.invalid',email_confirmed_at:'2026-10-15T00:00:00Z'}},error:null};}},async rpc(name,args){try{const data=await rpc(id(1),name,Object.values(args));if(name==='search_platform_accounts'&&revokeAfterRead)await db.query("update private.platform_admins set status='suspended'where user_id=$1",[id(1)]);return{data,error:null};}catch(error){return{data:null,error};}}};
  const loader=await createSourceLoader({'server-only':{},react:{cache:fn=>fn},'next/cache':{revalidatePath(){}},'@/lib/supabase/server':{async createServerSupabaseClient(){return sdk;}}});
  const actions=loader.load('@/lib/platform-admin/account-actions');const page=await actions.listPlatformAccountsAction({filter:'pending',search:'  EXAMPLE.TEST  ',limit:1});assert.equal(page.ok,true);assert.equal(page.accounts[0].userId,id(5));assert.equal(typeof page.nextPageKey,'string');const continuation=await actions.listPlatformAccountsAction({filter:'pending',search:'example.test',pageKey:page.nextPageKey,limit:1});assert.equal(continuation.accounts[0].userId,id(4));assert.equal((await actions.listPlatformAccountsAction({filter:'pending',search:'different',pageKey:page.nextPageKey})).code,'invalid_input');assert.ok(reads>=4);
  revokeAfterRead=true;const revoked=await actions.listPlatformAccountsAction({filter:'pending',search:'example.test'});assert.equal(revoked.code,'access_denied');assert.equal(Object.hasOwn(revoked,'accounts'),false);await assert.rejects(()=>search('example.test'),e=>e.code==='42501');
 } finally {await db.close();}
});
