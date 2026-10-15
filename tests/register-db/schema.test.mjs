import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatabase } from './helpers.mjs';

let db;
before(async () => { db = await createDatabase(); });
after(async () => { await db?.close(); });

test('hosted-safe rollback proof traverses all registers beyond 500 and verifies scope/approval/selector boundaries', async () => {
  let results;
  try { results = await db.exec(await readFile(new URL('../../supabase/tests/dealer_registers.sql', import.meta.url), 'utf8')); }
  catch (error) { await db.exec('rollback'); throw new Error(`Register SQL proof failed (${error.code}): ${error.message}`); }
  assert.ok(results.some((result) => result.rows.some((row) => String(row.result).startsWith('PASS:'))));
  assert.equal((await db.query('select count(*)::int n from public.companies')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from private.account_approvals')).rows[0].n, 0);
});

test('read-only public invoker and guarded private definer use stable reads, fixed paths and authenticated-only execute', async () => {
  const row = (await db.query("select prosecdef,provolatile,proconfig,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid='public.dealer_register_page(uuid,text,text,text,text,jsonb,boolean,uuid)'::regprocedure")).rows[0];
  assert.equal(row.prosecdef, false); assert.equal(row.provolatile, 's');
  assert.ok(row.proconfig.some((setting) => setting.startsWith('search_path=')));
  assert.equal(row.authenticated, true); assert.equal(row.anon, false); assert.equal(row.service, false);
  const helper = (await db.query("select prosecdef,provolatile,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid='private.dealer_register_page(uuid,text,text,text,text,jsonb,boolean,uuid)'::regprocedure")).rows[0];
  assert.equal(helper.prosecdef, true); assert.equal(helper.provolatile, 's');
  assert.ok(helper.proconfig.some((setting) => setting.startsWith('search_path=')));
  assert.equal(helper.anon, false); assert.equal(helper.service, false);
});
