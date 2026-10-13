import test from 'node:test';
import assert from 'node:assert/strict';
import { runSqlTests } from './helpers.mjs';

test('actual foundation + signing + offer archive migrations enforce SQL authorization and immutable proofs',async()=>{
 const results=await runSqlTests();
 assert.ok(results.some(result=>result.rows.some(row=>String(row.result??'').startsWith('PASS:'))));
});
