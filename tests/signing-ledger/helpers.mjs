import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';

export async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema private;
    revoke all on schema private from public;
    grant usage on schema private to authenticated;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth to authenticated,service_role,anon;
    grant execute on function auth.uid() to authenticated,service_role,anon;
    create table public.companies(id uuid primary key,status text not null default 'active');
    create table public.memberships(company_id uuid references public.companies(id),user_id uuid references auth.users(id),
      role text not null,status text not null default 'active',primary key(company_id,user_id));
    create table public.deals(company_id uuid references public.companies(id),id uuid primary key,unique(company_id,id));
    create table public.documents(id uuid primary key,company_id uuid not null references public.companies(id),deal_id uuid,
      name text not null,object_path text not null unique,kind text not null,
      foreign key(company_id,deal_id) references public.deals(company_id,id),
      check(object_path like company_id::text || '/%'));
    create function private.has_company_role(p_company_id uuid,p_roles text[]) returns boolean
      language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.companies c join public.memberships m on m.company_id=c.id
        where c.id=p_company_id and c.status='active' and m.user_id=auth.uid() and m.status='active' and m.role=any(p_roles))
    $$;
    revoke all on function private.has_company_role(uuid,text[]) from public,anon,service_role;
    grant execute on function private.has_company_role(uuid,text[]) to authenticated;
    alter table public.documents enable row level security;
    create policy documents_read on public.documents for select to authenticated
      using(private.has_company_role(company_id,array['owner','admin','finance']));
    create policy documents_insert on public.documents for insert to authenticated
      with check(private.has_company_role(company_id,array['owner','admin','finance']));
    grant select,insert on public.documents to authenticated;
    grant select,insert,update on public.companies,public.memberships,public.deals,public.documents to service_role;
  `);
  const directory=new URL('../../supabase/migrations/',import.meta.url);
  for (const filename of (await readdir(directory)).filter(name=>name.endsWith('_signing_ledger.sql')).sort()) {
    await db.exec(await readFile(new URL(filename,directory),'utf8'));
  }
  return db;
}
export async function asRole(db,role,userId,callback) {
  if (!['authenticated','anon','service_role'].includes(role)) throw new Error('Unexpected role');
  return db.transaction(async tx=>{
    await tx.query(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[userId??'']);
    return callback(tx);
  });
}
export async function rpc(db,role,userId,name,args) {
  if (!/^[a-z_]+$/.test(name)) throw new Error('Unexpected RPC');
  const placeholders=args.map((_,i)=>`$${i+1}`).join(',');
  return asRole(db,role,userId,async tx=>(await tx.query(`select public.${name}(${placeholders}) as value`,args)).rows[0].value);
}
