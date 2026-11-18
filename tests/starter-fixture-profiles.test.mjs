import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from './crm-db/helpers.mjs';
test('explicit migration and established profiles distinguish test-only account approval and document grants',async()=>{
 for(const profile of ['migrations','established']){
  const db=await createDatabase({profile});
  try{
   const approval=(await db.query("select count(*)::int n from pg_trigger where tgname='approved_established_test_fixture'")).rows[0].n;
   assert.equal(approval,profile==='established'?1:0);
   const before=(await db.query("select has_table_privilege('service_role','public.documents','insert') allowed")).rows[0].allowed;
   // The pure profile must reflect migrated grants, without the fixture's additive grant.
   if(profile==='migrations')await assert.rejects(db.query('select auth.approve_established_test_fixture()'));
   else assert.equal(before,true);
  }finally{await db.close();}
 }
});
test('historical fixture profile requires an actual migration stop, not the ineffective archive boolean',async()=>{
 await assert.rejects(createDatabase({profile:'historical'}),/requires throughMigration/);
 await assert.rejects(createDatabase({profile:'migrations',includeSigningArchive:false}),/explicit migration checkpoint/);
 const db=await createDatabase({profile:'historical',throughMigration:'20261013160452_customer_leads.sql'});
 try{assert.equal((await db.query("select to_regclass('public.offer_document_archives') archive")).rows[0].archive,null);}finally{await db.close();}
});
test('Stockholm business-date boundary differs from UTC around Swedish midnight',async()=>{
 const db=await createDatabase({profile:'historical',throughMigration:'20261013130218_dealer_foundation.sql'});
 try{const row=(await db.query("select ('2026-11-16T23:30:00Z'::timestamptz at time zone 'Europe/Stockholm')::date::text swedish,('2026-11-16T23:30:00Z'::timestamptz at time zone 'UTC')::date::text utc")).rows[0];assert.deepEqual(row,{swedish:'2026-11-17',utc:'2026-11-16'});}finally{await db.close();}
});
