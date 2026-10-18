import { createDatabase, asRole } from '../crm-db/helpers.mjs';
import { readFile } from 'node:fs/promises';

// Share the current complete migration and local scheduler bootstrap.
export { createDatabase, asRole };

export async function runSqlTests() {
 const db = await createDatabase();
 try { return await db.exec(await readFile(new URL('../../supabase/tests/vehicle_calculations.sql', import.meta.url), 'utf8')); }
 finally { await db.close(); }
}
