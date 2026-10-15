import { spawn, spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';

export const container = process.env.TRAFEXA_ACQUISITION_TEST_CONTAINER ?? 'trafexa-acquisition-pg';
export const database = 'trafexa_acquisition_test';
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
    const marker = `__acquisition_${process.pid}_${applicationName}_${sequence++}__`;
    return new Promise((resolve, reject) => {
      current = { marker, resolve, reject };
      child.stdin.write(`${source}\nselect '${marker}';\n`);
    });
  }
  return { query, ready: () => query(`set application_name='acquisition_${applicationName}'; set statement_timeout='5s';`), close() { child.stdin.end('rollback;\n\\q\n'); } };
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

export const id=n=>`fc130000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const companyA=id(101),companyB=id(102),owner=id(1),otherOwner=id(2),admin=id(3),finance=id(4),buyer=id(7),deal=id(501);
const fixtureText=await readFile(new URL('../../supabase/tests/trade_in_acquisition.sql',import.meta.url),'utf8');
const fixture=fixtureText.split('-- BEGIN TRADE IN ACQUISITION FIXTURES')[1].split('-- END TRADE IN ACQUISITION FIXTURES')[0];
export function seed(){sql(`begin;truncate storage.objects;truncate auth.users cascade;${fixture}commit;`);return get();}
export function asUser(user,source){return sql(`begin;set local role authenticated;set local request.jwt.claim.sub='${user}';${source};commit;`);}
export function get({user=owner,company=companyA,dealId=deal}={}){return JSON.parse(asUser(user,`select public.get_trade_in_acquisition('${company}','${dealId}')`));}
function value(v){if(v===null)return'null';if(typeof v==='boolean')return v?'true':'false';return`'${String(v).replaceAll("'","''")}'`;}
export function call(basis,patch={}){
 const v={companyId:basis.companyId,dealId:basis.dealId,hash:basis.source?.sourceSha256??'0'.repeat(64),acquiredOn:'2000-01-01',agreement:'External purchase agreement fixture',debt:basis.source?.offerSnapshot.trade_in.debt_ore??'0',debtOn:'1990-01-01',evidence:'Manually reviewed external debt proof',fuel:'hybrid',gearbox:'manual',asking:'40000000',purchase:true,received:true,debtConfirmed:true,ack:true,version:'2026-10-15',request:id(901),...patch};
 return`select public.record_trade_in_acquisition(${[v.companyId,v.dealId,v.hash,v.acquiredOn,v.agreement,v.debt,v.debtOn,v.evidence,v.fuel,v.gearbox,v.asking,v.purchase,v.received,v.debtConfirmed,v.ack,v.version,v.request].map(value).join(',')})`;
}
export const record=(basis,patch={},user=owner)=>JSON.parse(asUser(user,call(basis,patch)));
export function counts(){return JSON.parse(sql(`select jsonb_build_object('vehicles',(select count(*) from public.vehicles),'stock',(select count(*) from public.stock_items),'acquisitions',(select count(*) from private.trade_in_acquisitions),'receipts',(select count(*) from private.trade_in_acquisition_audit),'mail',(select count(*) from private.transactional_email_outbox),'audit',(select count(*) from public.audit_events))`));}
export function stock(stockId){return JSON.parse(sql(`select to_jsonb(s)||jsonb_build_object('vehicle',(select to_jsonb(v) from public.vehicles v where v.id=s.vehicle_id)) from public.stock_items s where s.id='${stockId}'`));}
export async function waitForLock(name){const until=Date.now()+2500;while(Date.now()<until){if(sql(`select coalesce((select wait_event_type from pg_stat_activity where application_name='acquisition_${name}'),'');`)==='Lock')return;await new Promise(r=>setTimeout(r,10));}throw Error(`Session ${name} did not enter a lock wait`);}
export function competingCall(kind){
 if(kind==='manual')return`select public.create_stock('${companyA}',' ti 001 ','Volvo','V70',2020,110000,'hybrid','manual',30000029,40000000,'unknown')`;
 if(kind==='direct')return`update public.vehicles set registration_number=' tI 001 ' where company_id='${companyA}' and id='${id(305)}'`;
 const payload=JSON.stringify([{registration_number:' ti 001 ',make:'Volvo',model:'V70',model_year:2020,mileage_km:110000,fuel:'hybrid',gearbox:'manual',purchase_price_ore:30000029,asking_price_ore:40000000,vat_scheme:'unknown'}]);
 return`select public.import_stock_batch('${companyA}','${id(950)}','${payload}'::jsonb)`;
}
