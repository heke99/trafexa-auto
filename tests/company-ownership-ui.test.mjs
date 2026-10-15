import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium: playwright, expect } = require('@playwright/test');
const Chromium = require('@sparticuz/chromium').default;
const { webpack } = require('next/dist/compiled/webpack/webpack');
const repo = fileURLToPath(new URL('../', import.meta.url));
const helpers = resolve(repo, 'tests/helpers/company-ownership-ui');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const COMPANY = id(1), ACTOR = id(2), TARGET = id(3);
const owner = { membershipId: id(4), userId: ACTOR, email: 'owner@example.com', version: 2 };
const candidate = { membershipId: id(5), userId: TARGET, email: 'admin@example.com', version: 4 };
const state = () => ({ companyId: COMPANY, actorUserId: ACTOR, actorRole: 'owner', teamVersion: 8, serverNow: '2026-10-15T12:00:00Z', owner, candidates: [candidate], nextPageKey: null, transfer: null, canRequest: true, canAccept: false, canCancel: false, blockReason: null });
const transfer = (status = 'pending') => ({ id: id(6), companyId: COMPANY, from: owner, to: candidate, status, version: 1, teamVersionAtRequest: 8, reason: 'Nytt ansvar', attestationVersion: '2026-10-15', createdAt: '2026-10-15T12:00:00Z', expiresAt: '2026-10-16T12:00:00Z', resolvedAt: status === 'expired' ? '2026-10-16T12:00:00Z' : null, cancelReason: null });
let browser, directory, bundle, styles;

before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'trafexa-team-ui-'));
  bundle = resolve(directory, 'fixture.js');
  styles = await readFile(resolve(repo, 'src/app/globals.css'), 'utf8');
  const config = {
    plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })],
    mode: 'development', target: 'web', devtool: false, context: repo,
    entry: resolve(helpers, 'entry.js'), output: { path: directory, filename: 'fixture.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/company-ownership/actions': resolve(helpers, 'actions.js'), 'next/navigation': resolve(helpers, 'navigation.js'), '@/lib/company-team/actions': resolve(helpers, 'team-actions.js'), '@': resolve(repo, 'src') } },
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

async function setup(p = state(), overrides = {}, props = {}) {
 const page = await browser.newPage();
 await page.route('**/*', r => r.abort());
 await page.setContent(`<style>${styles}</style><div class="wrap" id="root"></div>`);
 await page.evaluate(({p,overrides}) => { let nonce = 0; Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => `20000000-0000-4000-8000-${String(++nonce).padStart(12, '0')}` }); window.fixture = { page:p, getCalls:[],requestCalls:[],acceptCalls:[],cancelCalls:[],getResponses:[],requestResponses:[],acceptResponses:[],cancelResponses:[],refreshes:0,parentRefreshes:0,...overrides }; }, {p,overrides});
 await page.addScriptTag({path:bundle});
 await page.evaluate(props => window.mountOwnership(props), {companyId:COMPANY,userId:p.actorUserId,companyRole:p.actorRole,...props});
 await expect(page.getByText('Verifierar ägarrollen…')).toHaveCount(0);
 return page;
}
async function reviewRequest(p) {
 await p.getByLabel('Ny innehavare av ägarrollen').selectOption(candidate.membershipId);
 await p.getByLabel('Motivering för överlåtelse').fill('Nytt ansvar');
 await p.getByRole('button',{name:'Granska överlåtelse',exact:true}).click();
}
const ack = p => p.getByRole('checkbox').check();
test('request is explicitly reviewed, mobile-safe, unknown retry preserves exact nonce and CAS', async()=>{
 const p=await setup(state(),{requestResponses:[{throw:true}]});
 try {
 await p.setViewportSize({width:390,height:844}); await reviewRequest(p);
 await expect(p.getByRole('heading',{name:'Bekräfta överlåtelse'})).toBeFocused();
 await expect(p.getByRole('button',{name:'Skicka förfrågan om ägarroll'})).toBeDisabled();
 assert.equal(await p.evaluate(()=>window.fixture.requestCalls.length),0);
 await ack(p); await p.getByRole('button',{name:'Skicka förfrågan om ägarroll'}).click();
 await expect(p.getByRole('alert')).toContainText('okänt');
 await p.getByRole('button',{name:'Skicka förfrågan om ägarroll'}).click();
 await expect(p.getByRole('status')).toContainText('registrerat');
 const f=await p.evaluate(()=>window.fixture); assert.deepEqual(f.requestCalls[0],f.requestCalls[1]); assert.equal(f.requestCalls[0].expectedOwnerVersion,2); assert.equal(f.requestCalls[0].expectedTargetVersion,4); assert.equal(f.parentRefreshes,1);assert.equal(f.refreshes,1);
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=390));
 }finally{await p.close();}
});
test('target admin explicitly accepts and renders refreshed owner rather than historical receipt',async()=>{
 const s={...state(),actorUserId:TARGET,actorRole:'admin',candidates:[],canRequest:false,canAccept:true,transfer:transfer()};
 const current={...s,actorRole:'owner',owner:candidate,canAccept:false,canRequest:true,transfer:transfer('accepted')};
 const p=await setup(s,{getResponses:[{ok:true,...s},{ok:true,...current}]});
 try{await p.getByRole('button',{name:'Granska accept av ägarroll'}).click();await expect(p.getByRole('checkbox')).not.toBeChecked();await ack(p);await p.getByRole('button',{name:'Acceptera ägarrollen',exact:true}).click();await expect(p.getByRole('status')).toContainText('registrerat');await expect(p.getByText('Aktuell ägarroll:')).toContainText('admin@example.com');assert.equal(await p.evaluate(()=>window.fixture.acceptCalls.length),1);}finally{await p.close();}
});
test('owner cancellation requires reason and unchecked explicit confirmation',async()=>{
 const s={...state(),canRequest:false,canCancel:true,transfer:transfer(),blockReason:'pending_transfer'};const p=await setup(s);
 try{await expect(p.getByRole('button',{name:'Granska återkallande'})).toBeDisabled();await p.getByLabel('Motivering för återkallande').fill('Fel mottagare');await p.getByRole('button',{name:'Granska återkallande'}).click();await expect(p.getByRole('button',{name:'Återkalla förfrågan',exact:true})).toBeDisabled();await ack(p);await p.getByRole('button',{name:'Återkalla förfrågan',exact:true}).click();assert.equal(await p.evaluate(()=>window.fixture.cancelCalls[0].reason),'Fel mottagare');}finally{await p.close();}
});
test('candidate pagination merges only fresh team snapshot and rejects changed version',async()=>{
 const s={...state(),nextPageKey:'cursor'};const next={...s,candidates:[{...candidate,membershipId:id(20),email:'second@example.com'}],nextPageKey:null};const p=await setup(s,{getResponses:[{ok:true,...s},{ok:true,...next}]});
 try{await p.getByRole('button',{name:'Läs in fler administratörer'}).click();await expect(p.getByLabel('Ny innehavare av ägarrollen').locator('option')).toHaveCount(3);assert.equal(await p.evaluate(()=>window.fixture.getCalls[1].pageKey),'cursor');}finally{await p.close();}
 const q=await setup(s,{getResponses:[{ok:true,...s},{ok:true,...next,teamVersion:9}]});try{await q.getByRole('button',{name:'Läs in fler administratörer'}).click();await expect(q.getByRole('alert')).toContainText('ändrats');await expect(q.getByLabel('Ny innehavare av ägarrollen')).toHaveCount(0);}finally{await q.close();}
});
for(const blockReason of ['owner_missing','multiple_owners'])test(`ambiguous owner ${blockReason} blocks all mutations`,async()=>{
 const p=await setup({...state(),owner:null,canRequest:false,blockReason});try{await expect(p.getByRole('alert')).toContainText('återställning');await expect(p.getByLabel('Ny innehavare av ägarrollen')).toHaveCount(0);}finally{await p.close();}
});
test('server expiry is displayed without acceptance or cancellation controls',async()=>{
 const p=await setup({...state(),canRequest:false,transfer:transfer('expired')});try{await expect(p.getByRole('heading',{name:'Utgången'})).toBeVisible();await expect(p.getByText('Avslutad:')).toBeVisible();await expect(p.getByRole('button',{name:/Granska accept|Granska återkallande/})).toHaveCount(0);}finally{await p.close();}
});
test('conflict discards reviewed snapshot and requires fresh read',async()=>{
 const p=await setup(state(),{requestResponses:[{ok:false,code:'conflict',message:'Underlaget har ändrats.'}]});try{await reviewRequest(p);await ack(p);await p.getByRole('button',{name:'Skicka förfrågan om ägarroll'}).click();await expect(p.getByRole('alert')).toContainText('ändrats');await expect(p.getByRole('checkbox')).toHaveCount(0);await p.getByRole('button',{name:'Uppdatera ägarrollen'}).click();await expect(p.getByLabel('Ny innehavare av ägarrollen')).toBeVisible();}finally{await p.close();}
});
test('revocation after historical receipt clears private data and does not announce current roles',async()=>{
 const p=await setup(state(),{getResponses:[{ok:true,...state()},{ok:false,code:'access_denied',message:'Åtkomst återkallad.'}]});try{await reviewRequest(p);await ack(p);await p.getByRole('button',{name:'Skicka förfrågan om ägarroll'}).click();await expect(p.getByRole('alert')).toContainText('återkallad');await expect(p.getByText('admin@example.com',{exact:true})).toHaveCount(0);assert.equal(await p.evaluate(()=>window.fixture.refreshes),0);}finally{await p.close();}
});
test('late old company response is discarded after remount and demo makes no reads',async()=>{
 const p=await setup(state());try{await p.evaluate(()=>{window.fixture.getResponses.push({defer:true});});await p.getByRole('button',{name:'Uppdatera ägarrollen'}).click();await p.evaluate(({companyId,userId})=>window.mountOwnership({companyId,userId,companyRole:'viewer'}),{companyId:id(99),userId:ACTOR});await p.evaluate(s=>window.fixture.resolve({ok:true,...s}),state());await expect(p.getByText('owner@example.com',{exact:true})).toHaveCount(0);await expect(p.getByRole('alert')).toContainText('krävs');}finally{await p.close();}
 const d=await setup(state(),{},{demo:true});try{assert.equal(await d.evaluate(()=>window.fixture.getCalls.length),0);}finally{await d.close();}
});
test('team ownership panel stays closed with zero ownership reads until explicit open',async()=>{
 const p=await setup(state(),{},{demo:true});
 try{await p.evaluate(({companyId,userId})=>window.mountOwnershipTeam({companyId,userId,companyRole:'owner'}),{companyId:COMPANY,userId:ACTOR});await expect(p.getByRole('button',{name:'Hantera ägarroll',exact:true})).toBeVisible();assert.equal(await p.evaluate(()=>window.fixture.getCalls.length),0);await p.getByRole('button',{name:'Hantera ägarroll',exact:true}).click();await expect(p.getByLabel('Ny innehavare av ägarrollen')).toBeVisible();assert.equal(await p.evaluate(()=>window.fixture.getCalls.length),1);}finally{await p.close();}
});
test('Strict Mode replay remains usable and performs no mutation',async()=>{
 const p=await setup(state(),{},{demo:true});try{await p.evaluate(({companyId,userId})=>window.mountOwnershipStrict({companyId,userId,companyRole:'owner'}),{companyId:COMPANY,userId:ACTOR});await expect(p.getByLabel('Ny innehavare av ägarrollen')).toBeVisible();await expect(p.getByText('Verifierar ägarrollen…')).toHaveCount(0);assert.equal(await p.evaluate(()=>window.fixture.requestCalls.length),0);}finally{await p.close();}
});
