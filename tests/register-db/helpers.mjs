import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';

/** Real migration chain with only Supabase-owned Auth/Storage catalogs modeled.
 * pg_cron is exercised separately on PostgreSQL; it is not supported by PGlite.
 * No test approval trigger is installed: each fixture explicitly needs approval.
 */
export const testCatalogSql = `
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz not null default now(),is_anonymous boolean not null default false,is_sso_user boolean not null default false,banned_until timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,metadata jsonb,owner uuid,owner_id text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
    grant usage on schema storage to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    grant all on storage.objects,storage.buckets to service_role;
  `;
export async function createDatabase() {
  const db = new PGlite();
  await db.exec(testCatalogSql);
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql') && !name.endsWith('_reservation_expiry_scheduler.sql')).sort();
  for (const file of files) await db.exec(await readFile(new URL(file, directory), 'utf8'));
  return db;
}
