import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDatabase} from './crm-db/helpers.mjs';
test('generated public types cover every authenticated RPC and customer revision in the actual migration catalog',async()=>{
 const source=await readFile(new URL('../src/lib/supabase/database.types.ts',import.meta.url),'utf8');
 const start=source.indexOf('    Functions: {'),end=source.indexOf('    Enums:',start);assert.ok(start>0&&end>start,'Official generated Functions block is required');
 const names=new Set([...source.slice(start,end).matchAll(/^      ([A-Za-z_][A-Za-z_0-9]*):/gm)].map(m=>m[1]));
 assert.match(source,/contact_version: number/);
 const db=await createDatabase({profile:'migrations'});
 try{const rows=(await db.query("select distinct p.proname name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and has_function_privilege('authenticated',p.oid,'execute')")).rows;const missing=rows.map(r=>r.name).filter(n=>!names.has(n));assert.deepEqual(missing,[],'Regenerate types from the current isolated migrated database');assert.ok(rows.length>200);}finally{await db.close();}
});
