import { spawn, spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';

export const container = process.env.TRAFEXA_EXPIRY_TEST_CONTAINER ?? 'trafexa-expiry-pg';
export const database = 'trafexa_expiry_test';
const environment = { ...process.env };
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete environment[key];
const docker = ['--host=unix:///var/run/docker.sock', 'exec', '-i', container, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'];

export function sql(source, target = database) {
  const result = spawnSync('docker', [...docker, '-d', target], { env: environment, input: source, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Local PostgreSQL command failed');
  return result.stdout.trim();
}

/** A real persistent psql backend, not concurrent calls queued on one PGlite backend. */
export function session(applicationName) {
  const child = spawn('docker', [...docker, '-d', database], { env: environment });
  let output = '', errors = '', current, sequence = 0;
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { errors += chunk; });
  child.stdout.on('data', (chunk) => {
    output += chunk;
    if (current && output.includes(current.marker)) {
      const result = output.slice(0, output.indexOf(current.marker)).trim();
      output = output.slice(output.indexOf(current.marker) + current.marker.length);
      const pending = current; current = undefined; pending.resolve(result);
    }
  });
  child.on('error', (error) => { current?.reject(error); current = undefined; });
  child.stdin.on('error', (error) => { current?.reject(error); current = undefined; });
  child.on('exit', (code) => { if (current) { current.reject(new Error(errors || `psql exited with ${code}`)); current = undefined; } });
  function query(source) {
    if (current) throw new Error('A session query is already pending');
    const marker = `__expiry_${process.pid}_${applicationName}_${sequence++}__`;
    return new Promise((resolve, reject) => {
      current = { marker, resolve, reject };
      child.stdin.write(`${source}\nselect '${marker}';\n`);
    });
  }
  return { query, ready: () => query(`set application_name='expiry_${applicationName}'; set statement_timeout='5s';`), close() { child.stdin.end('rollback;\n\\q\n'); } };
}

export async function bootstrap() {
  sql(`drop database if exists ${database} with (force);`, 'postgres');
  sql(`create database ${database};`, 'postgres');
  sql(`do $$begin
   if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
   if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
   if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end$$;
  create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz not null default now(),is_anonymous boolean not null default false,is_sso_user boolean not null default false,banned_until timestamptz,raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.role() returns text language sql stable as $$select current_setting('role',true)$$;
  grant usage on schema auth to anon,authenticated,service_role;
  create schema storage;
  create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,metadata jsonb,owner uuid,owner_id text,unique(bucket_id,name));
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
  grant usage on schema storage to authenticated,service_role;
  grant select,insert on storage.objects to authenticated;
  grant all on storage.objects,storage.buckets to service_role;
  -- Catalog/API stub only: the official image does not contain pg_cron.
  -- No background scheduler or outbound worker runs in this network-none container.
  create schema cron;
  create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,command text,database text default current_database(),username text default current_user,active boolean default true);
  create function cron.schedule(job_name text,cron_schedule text,sql_command text) returns bigint language sql as $$
   insert into cron.job(jobname,schedule,command) values(job_name,cron_schedule,sql_command)
   on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid;
  $$;`);
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  for (const filename of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    let source = await readFile(new URL(filename, directory), 'utf8');
    if (filename.endsWith('_reservation_expiry_scheduler.sql')) source = source.replace(/^create extension if not exists pg_cron with schema pg_catalog;$/m, '-- Local cron catalog stub replaces extension installation only.');
    try { sql(source); } catch (error) { throw new Error(`Migration ${filename}: ${error.message}`); }
  }
}

export const ids = {
  companyA: '10000000-0000-4000-8000-000000000001', companyB: '20000000-0000-4000-8000-000000000001',
  ownerA: '10000000-0000-4000-8000-000000000002', ownerB: '20000000-0000-4000-8000-000000000002',
  customerA: '10000000-0000-4000-8000-000000000003', customerB: '20000000-0000-4000-8000-000000000003',
  buyer: '10000000-0000-4000-8000-000000000004',
};
export function rowId(prefix, number) { return `${prefix}0000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`; }

export function seed(countA = 1, countB = 1) {
  sql(`truncate auth.users cascade;
   insert into auth.users(id,email,email_confirmed_at) values
   ('${ids.ownerA}','expiry-owner-a@fixture.invalid',now()),('${ids.ownerB}','expiry-owner-b@fixture.invalid',now()),('${ids.buyer}','expiry-buyer@fixture.invalid',now());
   insert into private.account_approvals(user_id,status,updated_by) select id,'approved',id from auth.users;
   insert into public.companies(id,name,organisation_number,created_by) values
   ('${ids.companyA}','Expiry A','5560000081','${ids.ownerA}'),('${ids.companyB}','Expiry B','5560000082','${ids.ownerB}');
   insert into public.memberships(company_id,user_id,role) values('${ids.companyA}','${ids.ownerA}','owner'),('${ids.companyB}','${ids.ownerB}','owner');
   insert into public.customers(id,company_id,name,email) values('${ids.customerA}','${ids.companyA}','Expiry Buyer','expiry-buyer@fixture.invalid'),('${ids.customerB}','${ids.companyB}','Expiry Buyer B','expiry-buyer@fixture.invalid');
   with fixtures as(select n,case when n<=${countA} then '${ids.companyA}'::uuid else '${ids.companyB}'::uuid end company_id from generate_series(1,${countA + countB})n)
   insert into public.vehicles(id,company_id,registration_number,make,model,model_year)
   select ('40000000-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,company_id,'EX'||lpad(n::text,6,'0'),'Volvo','V60',2022 from fixtures;
   insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme,status)
   select ('30000000-0000-4000-8000-'||right(id::text,12))::uuid,company_id,id,10000000,12000000,'standard','reserved' from public.vehicles;
   insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by,status)
   select ('50000000-0000-4000-8000-'||right(id::text,12))::uuid,company_id,id,case company_id when '${ids.companyA}' then '${ids.customerA}'::uuid else '${ids.customerB}'::uuid end,12000000,case company_id when '${ids.companyA}' then '${ids.ownerA}'::uuid else '${ids.ownerB}'::uuid end,'reserved' from public.stock_items;
   insert into public.reservations(id,company_id,stock_item_id,deal_id,expires_at,created_by)
   select ('60000000-0000-4000-8000-'||right(id::text,12))::uuid,company_id,stock_item_id,id,now()-interval '1 minute',created_by from public.deals;
   insert into public.offers(id,company_id,deal_id,version,snapshot)
   select ('70000000-0000-4000-8000-'||right(id::text,12))::uuid,company_id,id,1,jsonb_build_object('valid_until',current_date+1,'customer',jsonb_build_object('email','expiry-buyer@fixture.invalid')) from public.deals;
   insert into private.offer_reviews(id,company_id,deal_id,offer_id,offer_version,recipient_email)
   select ('80000000-0000-4000-8000-'||right(id::text,12))::uuid,company_id,id,('70000000-0000-4000-8000-'||right(id::text,12))::uuid,1,'expiry-buyer@fixture.invalid' from public.deals;`);
}

export function accept(number = 1) {
  sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${ids.buyer}',true);
   select public.respond_offer_review('${rowId('8', number)}',1,'accepted','Expiry Buyer',null,'2026-10-14',gen_random_uuid()); commit;`);
}

export function state(number = 1) {
  return JSON.parse(sql(`select jsonb_build_object('stock',s.status,'deal',d.status,'reservation',r.status) from public.stock_items s join public.deals d on d.stock_item_id=s.id join public.reservations r on r.deal_id=d.id where s.id='${rowId('3', number)}' and d.id='${rowId('5', number)}';`));
}
