import { PGlite } from '../crm-db/node_modules/@electric-sql/pglite/dist/index.js';
import { readFile, readdir } from 'node:fs/promises';

export async function createHostedDocumentHubDatabase({ includeSigningArchive=true, approveEstablishedFixtures=true }={}) {
 const db=new PGlite();
 await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz not null default now(),
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
 // The document hub depends on the archive and signing identity constraints.
 // Keep the legacy option accepted, but run the real complete migration chain.
 const directory=new URL('../../supabase/migrations/',import.meta.url);
 const omitted=new Set(['20261013165650_signing_ledger.sql','20261013165726_offer_document_archive.sql']);
 const files=(await readdir(directory)).filter(name=>name.endsWith('.sql')&&!omitted.has(name)).sort();
 const bootstrap=files.find(name=>name.endsWith('_offer_archive_hosted_bootstrap.sql'));
 const hub=files.find(name=>name.endsWith('_dealer_document_hub.sql'));
 if(!bootstrap||!hub)throw Error('Missing hosted bootstrap/hub migration');
 files.splice(files.indexOf(bootstrap),1);files.splice(files.indexOf(hub),0,bootstrap);
 for(const filename of files) {
  let source = await readFile(new URL(filename,directory),'utf8');
  if (filename.endsWith('_reservation_expiry_scheduler.sql')) {
   // PGlite cannot install pg_cron. Keep every real reservation function;
   // scheduler setup and concurrent sessions have their own PostgreSQL suite.
   const boundary = source.indexOf('-- Explicitly approved background job.');
   if (boundary < 0) throw new Error('Unknown scheduler migration layout');
   source = source.slice(0,boundary) + 'commit;';
  }
  await db.exec(source);
 }
 // Established-fixture approval is TEST ONLY. The dedicated approval suite opts out.
 // Production migrations deliberately contain neither this trigger nor a backfill.
 if(approveEstablishedFixtures)await db.exec(`
 create function auth.approve_established_test_fixture() returns trigger language plpgsql as $$
 begin insert into private.account_approvals(user_id,status,updated_by) values(new.id,'approved',new.id); return new; end $$;
 create trigger approved_established_test_fixture after insert on auth.users for each row execute function auth.approve_established_test_fixture();
 `);
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
