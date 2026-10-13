import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';

export async function createDatabase({ includeSigningArchive=true }={}) {
 const db=new PGlite();
 await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,
    is_anonymous boolean not null default false,is_sso_user boolean not null default false,banned_until timestamptz,raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
   select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
  $$;
  grant usage on schema auth to authenticated,anon,service_role;
  grant execute on function auth.uid() to authenticated,anon,service_role;
  create schema storage;
  create table storage.buckets(id text primary key,name text not null,public boolean not null default false,
    file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),
    name text not null,metadata jsonb,owner uuid,owner_id text,unique(bucket_id,name));
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]
  $$;
  grant usage on schema storage to authenticated,service_role;
  grant select,insert on storage.objects to authenticated;
  grant all on storage.objects,storage.buckets to service_role;
 `);
 const directory=new URL('../../supabase/migrations/',import.meta.url);
 for(const filename of (await readdir(directory)).filter(name=>name.endsWith('.sql') && (includeSigningArchive || !name.endsWith('_signing_ledger.sql') && !name.endsWith('_offer_document_archive.sql'))).sort()) {
  await db.exec(await readFile(new URL(filename,directory),'utf8'));
 }
 // Preserve the existing privileged worker contract without granting the archive
 // table or private storage catalogs to ordinary authenticated users.
 await db.exec('grant select,insert,update,delete on public.documents to service_role');
 return db;
}
export async function asRole(db,role,userId,callback) {
 if(!['authenticated','anon','service_role'].includes(role))throw new Error('Unexpected test role');
 return db.transaction(async tx=>{
  await tx.query(`set local role ${role}`);
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[userId??'']);
  return callback(tx);
 });
}
export async function runSqlTests() {
 const db=await createDatabase();
 try{return await db.exec(await readFile(new URL('../../supabase/tests/platform_admin.sql',import.meta.url),'utf8'));}
 finally{await db.close();}
}
