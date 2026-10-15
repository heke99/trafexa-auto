import { spawn, spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';

export const container = process.env.TRAFEXA_BLOCKET_TEST_CONTAINER ?? 'trafexa-blocket-pg';
export const database = 'trafexa_blocket_test';
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
    const marker = `__blocket_${process.pid}_${applicationName}_${sequence++}__`;
    return new Promise((resolve, reject) => {
      current = { marker, resolve, reject };
      child.stdin.write(`${source}\nselect '${marker}';\n`);
    });
  }
  return { query, ready: () => query(`set application_name='blocket_${applicationName}'; set statement_timeout='5s';`), close() { child.stdin.end('rollback;\n\\q\n'); } };
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

export const id=n=>`fd190000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const platform=id(1),owner=id(2),sales=id(3),foreign=id(4),company=id(101),otherCompany=id(102),group=id(201),stock=id(301),listing=id(401),photo=id(501);
export const fixture=(await readFile(new URL('../../supabase/tests/blocket_group_delivery.sql',import.meta.url),'utf8')).split('-- BEGIN BLOCKET FIXTURES')[1].split('-- END BLOCKET FIXTURES')[0];
export function seed(){sql(`begin;truncate auth.users,private.blocket_groups cascade;${fixture}commit;`);}
export function value(v){if(v===null||v===undefined)return'null';if(typeof v==='boolean')return v?'true':'false';if(typeof v==='number')return String(v);return`'${String(v).replaceAll("'","''")}'`;}
export function asUser(user,source){return sql(`begin;set local role authenticated;set local request.jwt.claim.sub='${user}';${source};commit;`);}
export function service(source){return sql(`begin;set local role service_role;${source};commit;`);}
export function page(user=platform,companyId=company){return JSON.parse(asUser(user,`select public.get_platform_blocket_provisioning('${companyId}')`));}
export function groupCall({groupId=group,version=0,reference='Trafexa handlarnätverk',credential='blocket_group_main',scope='dealer_group',status='active',reason='Verifierat partnerunderlag',ack=true,nonce=id(901)}={}){return`select public.configure_blocket_group(${[groupId,version,reference,credential,scope,status,reason,ack,nonce].map(value).join(',')})`;}
export function configure(options={},user=platform){return JSON.parse(asUser(user,groupCall(options)));}
export const validUntil=new Date(Date.now()+7*86400000).toISOString();
export function bindCall({companyId=company,groupId=group,groupVersion=1,connectionVersion=0,dealerCode='dealer-a',evidence='Partneravtal – scope kontrollerat',until=validUntil,reason='Granskad koppling',ack=true,nonce=id(902)}={}){return`select public.bind_blocket_company(${[companyId,groupId,groupVersion,connectionVersion,dealerCode,evidence,until,reason,ack,nonce].map(value).join(',')})`;}
export function bind(options={},user=platform){return JSON.parse(asUser(user,bindCall(options)));}
export function disableCall({companyId=company,version=1,reason='Anslutning stängd',ack=true,nonce=id(903)}={}){return`select public.disable_blocket_company(${[companyId,version,reason,ack,nonce].map(value).join(',')})`;}
export function disable(options={},user=platform){return JSON.parse(asUser(user,disableCall(options)));}
export function job({jobId=id(601),version=2,code='dealer-a'}={}){sql(`insert into private.advertising_jobs(id,company_id,stock_id,listing_id,listing_version,channel,connection_id,connection_version,account_reference,dispatcher_id,created_by,snapshot)select '${jobId}',c.company_id,'${stock}','${listing}',${version},'blocket',c.id,c.version,'${code}',c.dispatcher_id,'${sales}',v.snapshot from private.advertising_connections c join private.advertising_versions v on v.company_id=c.company_id and v.listing_id='${listing}'and v.version=${version} where c.company_id='${company}'and c.channel='blocket'`);return jobId;}
export function ready(){return JSON.parse(service(`select public.refresh_advertising_dispatcher('blocket_${group.replaceAll('-','')}','blocket',clock_timestamp()+interval '5 minutes')`));}
export function beginCall({jobId=id(601),version=1,token=id(801),hash='a'.repeat(64)}={}){return`select public.begin_blocket_delivery(${[jobId,version,token,hash].map(value).join(',')})`;}
export function beginDelivery(options={}){return JSON.parse(service(beginCall(options)));}
export function recordCall(d,{version=d.version,token=id(801),status='submitted',requestId=id(811),adId=d.providerAdId,evidence=null}={}){return`select public.record_blocket_delivery(${[d.jobId??id(601),d.id,version,token,status,requestId,adId,evidence].map(value).join(',')})`;}
export function record(d,options={}){return JSON.parse(service(recordCall(d,options)));}
export async function waitForLock(name){const until=Date.now()+3000;while(Date.now()<until){if(sql(`select coalesce((select wait_event_type from pg_stat_activity where application_name='blocket_${name}'),'');`)==='Lock')return;await new Promise(r=>setTimeout(r,10));}throw Error(`Session ${name} did not enter a lock wait`);}
