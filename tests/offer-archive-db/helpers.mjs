import { createDatabase, asRole } from '../crm-db/helpers.mjs';
import { readFile } from 'node:fs/promises';

// Reuse the complete migration bootstrap, including its local scheduler substitute.
export { createDatabase, asRole };

export async function runSqlTests() {
 const db = await createDatabase();
 try { return await db.exec(await readFile(new URL('../../supabase/tests/offer_document_archive.sql', import.meta.url), 'utf8')); }
 finally { await db.close(); }
}
