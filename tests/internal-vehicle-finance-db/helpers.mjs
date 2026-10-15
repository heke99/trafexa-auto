import { spawn, spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';

export const container = process.env.TRAFEXA_INTERNAL_FINANCE_TEST_CONTAINER ?? 'trafexa-internal-finance-pg';
export const database = 'trafexa_internal_finance_test';
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
    const marker = `__internal_finance_${process.pid}_${applicationName}_${sequence++}__`;
    return new Promise((resolve, reject) => {
      current = { marker, resolve, reject };
      child.stdin.write(`${source}\nselect '${marker}';\n`);
    });
  }
  return { query, ready: () => query(`set application_name='internal_finance_${applicationName}'; set statement_timeout='5s';`), close() { child.stdin.end('rollback;\n\\q\n'); } };
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
  grant select,insert,update,delete on storage.objects to authenticated; grant usage on schema storage to anon; grant select,insert,update,delete on storage.objects to anon;
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

export const id=n=>`fd210000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const platform=id(1),owner=id(2),admin=id(3),sales=id(4),finance=id(5),viewer=id(6),foreign=id(7),company=id(101),otherCompany=id(102),stock=id(302),cost=id(401),deal=id(601);
export const purchase=13700000,costAmount=32700;
export const fixture=(await readFile(new URL('../../supabase/tests/internal_vehicle_financial_visibility.sql',import.meta.url),'utf8')).split('-- BEGIN INTERNAL FINANCE FIXTURES')[1].split('-- END INTERNAL FINANCE FIXTURES')[0];
export function seed(){sql(`begin;truncate auth.users cascade;${fixture}commit;`);}
export function value(v){if(v===null||v===undefined)return'null';if(typeof v==='boolean')return v?'true':'false';if(typeof v==='number')return String(v);return`'${String(v).replaceAll("'","''")}'`;}
export function asUser(user,source){return sql(`begin;set local role authenticated;set local request.jwt.claim.sub='${user}';${source};commit;`);}
export function workspace(user=owner,companyId=company){return JSON.parse(asUser(user,`select public.get_workspace_inventory('${companyId}')`));}
export function dashboard(user=owner){return JSON.parse(asUser(user,`select public.inventory_dashboard_totals('${company}')`));}
export function register({user=owner,kind='inventory',options=false,selected=null,query='',status=options?'available':'all'}={}){return JSON.parse(asUser(user,`select public.dealer_register_page(${[company,kind,query,status,'recent',null,options,selected].map(value).join(',')})`));}
export function calculation(user=owner){return JSON.parse(asUser(user,`select public.get_vehicle_calculation('${company}','${stock}')`));}
export function metadataCall({purchaseVat='2740000',costVat='6540'}={}){return`select public.save_vehicle_calculation_metadata('${company}','${stock}',(select (public.get_vehicle_calculation('${company}','${stock}')->>'version')),'${purchaseVat}',false,'[{"costId":"${cost}","deductibleVatOre":"${costVat}"}]')`;}
export function costCall({amount=12345,costId=id(402)}={}){return`insert into public.vehicle_costs(id,company_id,stock_item_id,category,description,amount_ore,incurred_on)values('${costId}','${company}','${stock}','repair','Granskad kostnad',${amount},current_date)returning id`;}
export function createCall({registration='DEF456',amount=7654321}={}){return`select public.create_stock('${company}','${registration}','Saab','9-3',2015,100000,'petrol','manual',${amount},15000000,'standard')`;}
export function importCall({registration='GHI789',amount=4567890,nonce=id(901)}={}){return`select public.import_stock_batch('${company}','${nonce}','${JSON.stringify([{registration_number:registration,make:'Saab',model:'9-5',model_year:2012,mileage_km:150000,fuel:'petrol',gearbox:'manual',purchase_price_ore:amount,asking_price_ore:10000000,vat_scheme:'standard'}])}')`;}
export async function waitForLock(name){const until=Date.now()+3000;while(Date.now()<until){if(sql(`select coalesce((select wait_event_type from pg_stat_activity where application_name='internal_finance_${name}'),'');`)==='Lock')return;await new Promise(r=>setTimeout(r,10));}throw Error(`Session ${name} did not enter a lock wait`);}
