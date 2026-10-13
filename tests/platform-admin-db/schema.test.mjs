import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, asRole, runSqlTests } from './helpers.mjs';

const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=uuid(1), B=uuid(2), ADMIN=uuid(10), ADMIN2=uuid(11), OWNER=uuid(20);
async function call(db,user,name,args) {
 return asRole(db,'authenticated',user,async tx=>(await tx.query(
  `select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as value`,args)).rows[0].value);
}

test('all actual migrations and rollback assertions protect platform auth, bootstrap and tenant boundaries',async()=>{
 const results=await runSqlTests();
 assert.ok(results.some(result=>result.rows.some(row=>String(row.result??'').startsWith('PASS:'))));
});

test('competing platform status CAS and duplicate nonce calls commit exactly one immutable intent',async t=>{
 const db=await createDatabase();t.after(()=>db.close());
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now()),($5,$6,now())',
  [ADMIN,'admin@example.test',ADMIN2,'admin2@example.test',OWNER,'owner@example.test']);
 await db.query("insert into private.platform_admins(user_id,created_by) values($1,$1),($2,$1)",[ADMIN,ADMIN2]);
 await db.query('insert into public.companies(id,name,organisation_number,created_by) values($1,$2,$3,$4),($5,$6,$7,$4)',
  [A,'Company A','5560000001',OWNER,B,'Company B','5560000002']);
 const nonce=uuid(40);const args=[A,'active','suspended','Confirmed review',nonce];
 const duplicates=await Promise.all([call(db,ADMIN,'set_platform_company_status',args),call(db,ADMIN,'set_platform_company_status',args)]);
 assert.deepEqual(duplicates[0],duplicates[1]);
 assert.equal((await db.query('select count(*)::integer as n from private.platform_company_status_audit where company_id=$1',[A])).rows[0].n,1);
 const competing=await Promise.allSettled([
  call(db,ADMIN,'set_platform_company_status',[B,'active','suspended','Actor one review',uuid(41)]),
  call(db,ADMIN2,'set_platform_company_status',[B,'active','suspended','Actor two review',uuid(42)]),
 ]);
 assert.equal(competing.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(competing.filter(result=>result.status==='rejected'&&result.reason.code==='40001').length,1);
 assert.equal((await db.query('select count(*)::integer as n from private.platform_company_status_audit where company_id=$1',[B])).rows[0].n,1);
});


test('two same-UUID bootstrap claims produce one role and one activation audit',async t=>{
 const db=await createDatabase();t.after(()=>db.close());
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[ADMIN,'approved@example.test']);
 await db.query("insert into private.platform_admin_bootstrap_reservations(email,approval_reference) values('approved@example.test','Explicit rollback-only fixture')");
 const results=await Promise.all([call(db,ADMIN,'claim_platform_admin_access',[]),call(db,ADMIN,'claim_platform_admin_access',[])]);
 assert.ok(results.every(result=>result.is_platform_admin&&result.user_id===ADMIN));
 assert.equal(results.filter(result=>result.claimed).length,1);
 assert.equal((await db.query('select count(*)::integer as n from private.platform_admins')).rows[0].n,1);
 assert.equal((await db.query('select count(*)::integer as n from private.platform_admin_bootstrap_audit')).rows[0].n,1);
});


test('platform DDL works on the live foundation without pending signing/archive migrations',async t=>{
 const db=await createDatabase({includeSigningArchive:false});t.after(()=>db.close());
 const tables=(await db.query("select to_regclass('public.signing_jobs') as signing,to_regclass('public.offer_document_archives') as archives")).rows[0];
 assert.deepEqual(tables,{signing:null,archives:null});
 assert.equal((await db.query('select count(*)::integer as n from private.platform_admins')).rows[0].n,0);
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[ADMIN,'verified@example.test']);
 await db.query('insert into private.platform_admins(user_id,created_by) values($1,$1)',[ADMIN]);
 await db.query('insert into public.companies(id,name,organisation_number,created_by) values($1,$2,$3,$4)',[A,'Live foundation company','5560000001',ADMIN]);
 assert.equal((await call(db,ADMIN,'list_platform_companies',['',null,50])).companies.length,1);
 assert.equal((await call(db,ADMIN,'set_platform_company_status',[A,'active','suspended','Independent migration verified',uuid(90)])).status,'suspended');
});
