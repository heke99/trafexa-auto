import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createDatabase,asRole} from '../crm-db/helpers.mjs';
const id=n=>`ec181800-0000-4000-8000-${String(n).padStart(12,'0')}`;
const expand='20261018184303_web_application_privacy_revision.sql';
const enforce='20261018185525_web_application_privacy_revision_enforce.sql';
const args=(n,version,patch={})=>Object.values({request:id(n),name:'Historical Applicant',email:`policy-fixture-${n}@example.invalid`,company:'Policy Fixture AB',phone:'0701234567',organisation:'5568554884',seeking:['system'],message:'Access application under displayed notice',version,ack:true,...patch});
const submit=(db,values)=>asRole(db,'anon',null,async tx=>(await tx.query('select public.submit_web_application($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) r',values)).rows[0].r);
test('expand supports both deployed forms before strict enforcement while exact historical receipts remain unchanged across both phases',async()=>{
 const directory=new URL('../../supabase/migrations/',import.meta.url);
 const baseline=(await readdir(directory)).filter(n=>n.endsWith('.sql')&&n<expand).sort().at(-1);
 const db=await createDatabase({throughMigration:baseline,approveEstablishedFixtures:false});
 try{
  const old=args(1,'2026-10-14'),receipt=await submit(db,old);
  const before=(await db.query('select to_jsonb(r) r from private.demo_requests r where request_id=$1',[id(1)])).rows[0].r;
  assert.equal(before.privacy_version,'2026-10-14');
  await db.exec(await readFile(new URL(expand,directory),'utf8'));
  assert.deepEqual(await submit(db,old),receipt);
  // Phase A accepts both the still-deployed form and its replacement.
  const rollingOld=args(2,'2026-10-14'),rollingNew=args(3,'2026-10-18');
  const rollingReceipt=await submit(db,rollingOld);
  assert.equal((await submit(db,rollingNew)).accepted,true);
  await assert.rejects(submit(db,args(4,'2026-10-13')),e=>e.code==='22023');
  assert.deepEqual((await db.query('select to_jsonb(r) r from private.demo_requests r where request_id=$1',[id(1)])).rows[0].r,before);
  await db.exec(await readFile(new URL(enforce,directory),'utf8'));
  // Phase B rejects fresh old forms while preserving receipts from both phases.
  assert.deepEqual(await submit(db,old),receipt);
  assert.deepEqual(await submit(db,rollingOld),rollingReceipt);
  assert.deepEqual((await db.query('select to_jsonb(r) r from private.demo_requests r where request_id=$1',[id(1)])).rows[0].r,before);
  await assert.rejects(submit(db,args(5,'2026-10-14')),e=>e.code==='22023');
  await assert.rejects(submit(db,args(1,'2026-10-18')),e=>e.code==='40001');
  await assert.rejects(submit(db,args(1,'2026-10-14',{message:'Different historical payload'})),e=>e.code==='40001');
  assert.equal((await submit(db,args(6,'2026-10-18'))).accepted,true);
  assert.equal((await db.query('select privacy_version from private.demo_requests where request_id=$1',[id(6)])).rows[0].privacy_version,'2026-10-18');
  assert.equal((await db.query('select count(*)::int n from private.demo_requests')).rows[0].n,4);
  assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,0);
  await assert.rejects(asRole(db,'anon',null,tx=>tx.query("select public.submit_demo_request('Applicant','policy-fixture@example.invalid','Policy Fixture AB',null,null)")),e=>e.code==='42501');
  await db.exec(await readFile(new URL('../../supabase/tests/web_application_privacy_revision.sql',import.meta.url),'utf8'));
  const cleanup=await db.exec(await readFile(new URL('../../supabase/tests/web_application_privacy_revision_cleanup.sql',import.meta.url),'utf8'));
  assert.equal(cleanup.at(-1).rows[0].privacy_revision_cleanup_pass,true);
 }finally{await db.close();}
});
