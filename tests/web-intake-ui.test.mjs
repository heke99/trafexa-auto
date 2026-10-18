import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createSourceLoader } from './helpers/source-loader.mjs';
import { createDatabase, asRole } from './crm-db/helpers.mjs';

const require = createRequire(import.meta.url);
const { chromium: playwright, expect } = require('@playwright/test');
const Chromium = require('@sparticuz/chromium').default;
const { webpack } = require('next/dist/compiled/webpack/webpack');
const repo = fileURLToPath(new URL('../', import.meta.url));
const helpers = resolve(repo, 'tests/helpers/web-intake-ui');
const COMPANY = '10000000-0000-4000-8000-000000000001';
const NEXT = '10000000-0000-4000-8000-000000000002';
const FILTERED = '10000000-0000-4000-8000-000000000003';
const makeCompany = (id = COMPANY, name = 'Fixture AB') => ({ id, name, organisationNumber: '5561234567', status: 'active', createdAt: '2026-10-13T18:00:00Z', membershipCount: 2, stockCount: 7 });
let browser, directory, bundle, styles;

before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'trafexa-admin-ui-'));
  bundle = resolve(directory, 'fixture.js');
  styles = await readFile(resolve(repo, 'src/app/globals.css'), 'utf8');
  const config = {
    mode: 'development', target: 'web', devtool: false, context: repo,
    entry: resolve(helpers, 'entry.js'), output: { path: directory, filename: 'fixture.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    module: { rules: [{ test: /\.tsx?$/, use: resolve(helpers, 'swc-loader.cjs') }] },
  };
  await new Promise((resolveBuild, reject) => {
    const compiler = webpack(config);
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true })));
      else resolveBuild();
    }));
  });
  browser = await playwright.launch({ executablePath: await Chromium.executablePath(), args: Chromium.args.filter(argument => argument !== '--single-process'), headless: true });
});
after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });


async function setup(responses=[]) {
 const page=await browser.newPage();await page.route('**/*',route=>route.abort());
 await page.setContent(`<style>${styles}</style><div class="wrap" id="root"></div>`);
 await page.evaluate(responses=>{let ids=0;Object.defineProperty(crypto,'randomUUID',{value:()=>`20000000-0000-4000-8000-${String(++ids).padStart(12,'0')}`});window.calls=[];window.responses=responses;window.fetch=async(_url,input)=>{const payload=JSON.parse(input.body);window.calls.push(payload);const response=window.responses.shift();if(response?.throw)throw new Error('Unknown transport');return {ok:true,json:async()=>response??{success:true,receipt:{requestId:payload.requestId,accepted:true}}};};},responses);
 await page.addScriptTag({path:bundle});return page;
}
async function fill(page) {
 await page.getByLabel('Företag',{exact:true}).fill('Bilhandlaren AB');await page.getByLabel('Ditt namn').fill('Anna Andersson');await page.getByLabel('Mejladress').fill('anna@example.test');await page.getByLabel('Telefon',{exact:true}).fill('0701234567');await page.getByLabel('Organisationsnummer').fill('556123-4567');await page.getByLabel('Trafexa-systemet',{exact:true}).check();await page.getByLabel('Beskriv vad ni söker').fill('Vi söker ett system för vårt lager.');await page.getByLabel(/Jag har tagit del/).check();
}
test('actual public form requires phone, org number, purpose, message and unchecked privacy acknowledgement at mobile width',async()=>{
 const page=await setup();try{await page.setViewportSize({width:390,height:844});await expect(page.getByLabel(/Jag har tagit del/)).not.toBeChecked();await page.getByRole('button',{name:'Skicka ansökan'}).click();assert.equal(await page.evaluate(()=>window.calls.length),0);await fill(page);for(const [label,value] of [['Telefon','0701234567'],['Organisationsnummer','556123-4567'],['Beskriv vad ni söker','Vi söker ett system för vårt lager.']]){await page.getByLabel(label,{exact:true}).fill('');await page.getByRole('button',{name:'Skicka ansökan'}).click();assert.equal(await page.evaluate(()=>window.calls.length),0);await page.getByLabel(label,{exact:true}).fill(value);}await page.getByLabel(/Jag har tagit del/).uncheck();await page.getByRole('button',{name:'Skicka ansökan'}).click();assert.equal(await page.evaluate(()=>window.calls.length),0);await page.getByLabel(/Jag har tagit del/).check();await page.getByLabel('Trafexa-systemet',{exact:true}).uncheck();await page.getByRole('button',{name:'Skicka ansökan'}).click();await expect(page.getByRole('alert')).toContainText('Välj minst ett område');assert.equal(await page.evaluate(()=>window.calls.length),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=390),true);}finally{await page.close();}
});
test('public success requires matching saved receipt and unknown outcomes reuse the same nonce',async()=>{
 const page=await setup([{throw:true},{success:true,receipt:{requestId:'wrong',accepted:true}}]);try{await fill(page);await page.getByRole('button',{name:'Skicka ansökan'}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Skicka ansökan'}).click();await expect(page.getByRole('alert')).toContainText('Ansökan kunde inte sparas');await expect(page.getByRole('heading',{name:'Tack. Vi hörs snart.'})).toHaveCount(0);await page.getByRole('button',{name:'Skicka ansökan'}).click();await expect(page.getByRole('heading',{name:'Tack. Vi hörs snart.'})).toBeVisible();const calls=await page.evaluate(()=>window.calls);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[1],calls[2]);assert.equal(calls[0].privacyAcknowledged,true);assert.equal(calls[0].privacyVersion,'2026-10-18');assert.deepEqual(calls[0].seeking,['system']);}finally{await page.close();}
});

test('actual browser application crosses API and migrated SQL once after a lost response and is readable and reviewable only by superadmin', async () => {
 const db = await createDatabase({ approveEstablishedFixtures: false });
 const admin = 'ec181900-0000-4000-8000-000000000001', ordinary = 'ec181900-0000-4000-8000-000000000002';
 let actor = admin, lostResponse = true;
 const payloads = [];
 const originalEnvironment = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','TRANSACTIONAL_EMAIL_ENABLED'].map(key => [key, process.env[key]]));
 const rpc = (role, name, args) => {
  assert.match(name, /^[a-z_]+$/);
  const entries = Object.entries(args);
  const result = asRole(db, role, role === 'authenticated' ? actor : null, async tx => (await tx.query(`select public.${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(',')}) result`, entries.map(([,value]) => value))).rows[0].result)
   .then(data => ({ data, error: null }), error => ({ data: null, error: { code: error.code } }));
  result.abortSignal = () => result;
  return result;
 };
 const authenticated = { auth: { getUser: async () => ({ data: { user: (await db.query('select id,email,email_confirmed_at,is_anonymous from auth.users where id=$1',[actor])).rows[0] }, error: null }) }, rpc: (name,args) => rpc('authenticated', name, args) };
 let page;
 try {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://isolated.fixture.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'synthetic-public-key';
  process.env.TRANSACTIONAL_EMAIL_ENABLED = 'false';
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',[admin,'intake-admin@example.invalid',ordinary,'ordinary@example.invalid']);
  await db.query('insert into private.platform_admins(user_id,created_by) values($1,$1)',[admin]);
  const loader = await createSourceLoader({
   '@supabase/supabase-js': { createClient: () => ({ rpc: (name,args) => rpc('anon',name,args) }) },
   '@/lib/supabase/server': { createServerSupabaseClient: async () => authenticated },
   'next/cache': { revalidatePath() {} },
  });
  const POST = loader.load('@/app/api/demo-requests/route').POST;
  const actions = loader.load('@/lib/platform-admin/actions');
  const invitations = loader.load('@/lib/platform-admin/application-invitation-actions');
  page = await setup();
  await page.setViewportSize({width:320,height:900});
  await page.exposeFunction('submitActualApplication', async payload => {
   payloads.push(payload);
   const response = await POST(new Request('https://www.trafexa.com/api/demo-requests',{method:'POST',headers:{origin:'https://www.trafexa.com','content-type':'application/json'},body:JSON.stringify(payload)}));
   const body = await response.json();
   if (response.status === 201 && lostResponse) { lostResponse = false; return { lost: true }; }
   return { status: response.status, body };
  });
  await page.evaluate(() => { window.fetch = async (_url,input) => { const result = await window.submitActualApplication(JSON.parse(input.body)); if(result.lost) throw Error('Synthetic lost response after commit'); return {ok:result.status>=200&&result.status<300,status:result.status,json:async()=>result.body}; }; });
  await fill(page);
  await page.getByLabel('Organisationsnummer').fill('556855-4884');
  await page.getByLabel('Annonsering',{exact:true}).check();
  await page.getByRole('button',{name:'Skicka ansökan'}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button',{name:'Skicka ansökan'}).click();
  await expect(page.getByRole('heading',{name:'Tack. Vi hörs snart.'})).toBeVisible();
  assert.equal(payloads.length,2); assert.deepEqual(payloads[0],payloads[1]);
  const rows = (await db.query('select * from private.demo_requests')).rows;
  assert.equal(rows.length,1);
  const applicationId = rows[0].id;
  const read = await actions.getPlatformWebApplicationAction({applicationId});
  assert.equal(read.ok,true,JSON.stringify(read));
  assert.equal(read.application.name,'Anna Andersson'); assert.equal(read.application.email,'anna@example.test');
  assert.equal(read.application.phone,'0701234567'); assert.equal(read.application.organisationNumber,'5568554884');
  assert.deepEqual(read.application.seeking,['advertising','system']); assert.equal(read.application.privacyVersion,'2026-10-18');
  assert.ok(read.application.privacyAcknowledgedAt); assert.equal(read.application.status,'new');
  assert.equal((await db.query('select count(*)::int n from private.transactional_email_outbox')).rows[0].n,2);
  actor = ordinary;
  assert.equal((await actions.getPlatformWebApplicationAction({applicationId})).code,'access_denied');
  assert.equal((await invitations.preparePlatformApplicationInvitationAction({applicationId,expectedVersion:1,reason:'Ordinary user must not approve',requestId:'ec181900-0000-4000-8000-000000000003',reviewAcknowledged:true})).code,'access_denied');
  actor = admin;
  const review = await invitations.preparePlatformApplicationInvitationAction({applicationId,expectedVersion:1,reason:'Reviewed complete synthetic application',requestId:'ec181900-0000-4000-8000-000000000004',reviewAcknowledged:true});
  assert.equal(review.ok,true,JSON.stringify(review)); assert.equal(review.invitation.email,'anna@example.test');
  assert.equal(review.invitation.status,'prepared'); assert.equal(review.invitation.userId,null);
  assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,2,'submission and review must not themselves create any account');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 } finally {
  await page?.close(); await db.close();
  for (const [key,value] of Object.entries(originalEnvironment)) { if(value===undefined) delete process.env[key]; else process.env[key]=value; }
 }
});
