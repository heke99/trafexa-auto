import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';

export async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  for (const filename of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(filename, directory), 'utf8'));
  }
  return db;
}

// Mirror PostgREST transaction-local JWT/role setup; never persist identity across calls.
export async function asUser(db, userId, callback, role = 'authenticated') {
  if (!['authenticated', 'anon'].includes(role)) throw new Error('Unexpected test role');
  return db.transaction(async transaction => {
    await transaction.query(`set local role ${role}`);
    await transaction.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? '']);
    return callback(transaction);
  });
}
