import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceLoader} from './helpers/source-loader.mjs';
test('known production project requires an explicit deployment target before client IO',async t=>{
 const before={...process.env};t.after(()=>{for(const key of ['VERCEL_ENV','NEXT_PUBLIC_TRAFEXA_DEPLOYMENT_TARGET'])if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];});
 delete process.env.VERCEL_ENV;delete process.env.NEXT_PUBLIC_TRAFEXA_DEPLOYMENT_TARGET;
 const check=(await createSourceLoader()).load('@/lib/runtime/environment').assertSupabaseEnvironment;
 assert.doesNotThrow(()=>check('http://127.0.0.1:54321'));assert.doesNotThrow(()=>check('https://isolated-test.supabase.co'));
 assert.throws(()=>check('https://buqdtssxrotkzndublrt.supabase.co'),/explicit production/);
 process.env.VERCEL_ENV='preview';assert.throws(()=>check('https://buqdtssxrotkzndublrt.supabase.co'));
 process.env.NEXT_PUBLIC_TRAFEXA_DEPLOYMENT_TARGET='production';assert.doesNotThrow(()=>check('https://buqdtssxrotkzndublrt.supabase.co'));
 delete process.env.NEXT_PUBLIC_TRAFEXA_DEPLOYMENT_TARGET;process.env.VERCEL_ENV='production';assert.doesNotThrow(()=>check('https://buqdtssxrotkzndublrt.supabase.co'));
 assert.throws(()=>check('https://user:secret@test.supabase.co'),/Invalid/);
});

test('starter commands reference existing scripts and local config keeps login enabled while registration is closed',async()=>{
 const{readFile,access}=await import('node:fs/promises');
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 for(const[name,command]of Object.entries(pkg.scripts).filter(([k])=>k.startsWith('local:')||k.startsWith('db:types')||k==='test:matrix'||k==='test:database'||k==='test:native')){
  const path=command.match(/^node (scripts\/[^ ]+)/)?.[1];assert.ok(path,name);await access(new URL('../'+path,import.meta.url));
 }
 const config=await readFile(new URL('../supabase/config.toml',import.meta.url),'utf8');assert.match(config,/\[auth\][\s\S]*enable_signup = false/);assert.match(config,/\[auth.email\]\nenabled = true/);
 const env=await readFile(new URL('../.env.example',import.meta.url),'utf8');assert.doesNotMatch(env,/buqdtssxrotkzndublrt|https:\/\/app\.trafexa\.com/);assert.match(env,/CONTRACT_EMAIL_ENABLED=false/);assert.match(env,/UPLOADED_PDF_LINK_SECRET=/);
});

test('local CLI refuses hosted targets and unrelated commands before spawning any process',async()=>{
 const{localCli}=await import('../scripts/local-supabase.mjs');
 for(const args of [['link'],['db','push'],['db','reset','--remote'],['gen','types','--remote=postgres://prod.invalid/db'],['db','reset','--db-url','postgres://prod.invalid/db'],['start','--workdir','/other']])assert.throws(()=>localCli(args),/cannot target/);
});

test('test inventory includes legacy native entrypoints that the old flat glob omitted',async()=>{
 const{collectTestMatrix}=await import('../scripts/test-matrix.mjs');const rows=await collectTestMatrix();
 for(const file of ['tests/paper-sales-db/native-concurrency.mjs','tests/blocket-group-db/schema.mjs','tests/deal-fulfilment-db/schema.mjs','tests/application-invitation-lifecycle-native.mjs']){const row=rows.find(r=>r.file===file);assert.equal(row?.group,'native',file);assert.match(row.container,/^trafexa-/);assert.match(row.command,/test:native/);}
 assert.equal(rows.find(r=>r.file==='tests/web-applications-db/schema.test.mjs')?.group,'database');
});
