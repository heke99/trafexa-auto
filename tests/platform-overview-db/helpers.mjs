import { readFile } from 'node:fs/promises';
import { createDatabase, asRole } from '../crm-db/helpers.mjs';
export { createDatabase, asRole };

export async function runSqlTests() {
 const db=await createDatabase();
 try{return await db.exec(await readFile(new URL('../../supabase/tests/platform_overview.sql',import.meta.url),'utf8'));}
 finally{await db.close();}
}
