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
const helpers = resolve(repo, 'tests/helpers/advertising-usage-ui');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const COMPANY = id(1), USER = id(2), STOCK = id(3), LISTING = id(4), PHOTO = id(5);
const photo = (n = 5, contentType = 'image/jpeg') => ({ id: id(n), contentType, sizeBytes: 1234, version: 1, status: 'active', createdAt: '2026-10-13T18:00:00Z' });
const listing = (status = 'ready', photos = [photo()]) => ({ id: LISTING, companyId: COMPANY, stockId: STOCK, version: 3, status, createdAt: '2026-10-13T18:00:00Z', updatedAt: '2026-10-13T18:00:00Z', snapshot: { title: 'Volvo V60 <script>alert(1)</script>', description: 'Välskött kombi', priceGrossOre: '28900000', make: 'Volvo', model: 'V60', year: 2022, mileageKm: 48200, fuel: 'petrol', transmission: 'automatic', photos, includeRegistrationNumber: false, registrationNumber: null } });
let browser, directory, bundle, styles;

before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'trafexa-advertising-ui-'));
  bundle = resolve(directory, 'fixture.js');
  styles = await readFile(resolve(repo, 'src/app/globals.css'), 'utf8');
  const config = { mode: 'development', target: 'web', devtool: false, context: repo,
    entry: resolve(helpers, 'entry.js'), output: { path: directory, filename: 'fixture.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/advertising/correction-actions': resolve(repo, 'tests/helpers/advertising-corrections-ui/actions.js'), '@/lib/advertising/billing-actions': resolve(repo, 'tests/helpers/advertising-billing-ui/actions.js'), '@/lib/calculations/vehicle-calculation': resolve(repo, 'src/lib/calculations/vehicle-calculation.ts'), '@/lib/advertising/actions': resolve(repo, 'tests/helpers/advertising-ui/actions.js'), '@/lib/advertising/usage-actions': resolve(helpers, 'actions.js'), '@/components/vehicle-photo-gallery': resolve(repo, 'src/components/vehicle-photo-gallery.tsx'), '@/lib/vehicle-photos/actions': resolve(helpers, 'photos.js'), '@/lib/vehicle-photos/types': resolve(repo, 'src/lib/vehicle-photos/types.ts') } },
    module: { rules: [{ test: /\.tsx?$/, use: resolve(helpers, 'swc-loader.cjs') }] } };
  await new Promise((resolveBuild, reject) => { const compiler = webpack(config); compiler.run((error, stats) => compiler.close(() => { if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true }))); else resolveBuild(); })); });
  browser = await playwright.launch({ executablePath: await Chromium.executablePath(), args: Chromium.args.filter(argument => argument !== '--single-process'), headless: true });
});
after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

async function setup(responses=[]) {
 const page=await browser.newPage();
 await page.route('**/*', route=>route.abort());
 await page.setContent(`<style>${styles}</style><div class="wrap" id="root"></div>`);
 await page.evaluate(({responses})=>{
  const states={queued:2,dispatching:1,outcomeUnknown:3,submitted:7,published:20,rejected:1,retryable:2,newPublications:4};
  window.calls=[];window.responses=responses;
  window.usage={ok:true,companyId:'10000000-0000-4000-8000-000000000001',actorUserId:'10000000-0000-4000-8000-000000000002',actorRole:'owner',timeZone:'Europe/Stockholm',month:'2026-10',trackingStartedAt:'2026-10-14T00:00:00Z',legacyPublishedJobs:2,totals:{drafts:5,ready:3,...states},channels:[{channel:'blocket',...states},{channel:'wayke',...states,newPublications:0}],billing:{status:'quantity_only',unitPriceOre:null,totalOre:null,unpricedPublications:4}};
 },{responses});
 await page.addScriptTag({path:bundle});
 await page.evaluate(props=>window.mountUsage(props),{companyId:COMPANY,userId:USER,role:'owner'});
 return page;
}

test('real mobile usage component separates monthly unique publications from all-time jobs and unset prices',async()=>{
 const page=await setup();try{
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByText('Unika publiceringar under vald månad',{exact:true})).toBeVisible();
  await expect(page.getByText('Antalsstatistiken visar verifierade publiceringar.',{exact:false})).toBeVisible();
  await expect(page.getByText('Nuvarande status för samtliga leveransjobb, oavsett månad. Jobbantalet är inte debiteringsgrund.')).toBeVisible();
  await page.getByLabel('Faktureringsmånad').fill('2026-09');
  await expect(page.getByText('Debiteringsgrund för 2026-09')).toBeVisible();
  assert.equal((await page.evaluate(()=>window.calls.at(-1))).month,'2026-09');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390));
  await expect(page.getByRole('link',{name:'Hämta underlag som CSV'})).toHaveAttribute('href','/api/advertising/usage/2026-09/csv');
 }finally{await page.close();}
});

test('denied refreshed statistics clear previous results and stop future reads',async()=>{
 const page=await setup();try{
  await expect(page.getByText('Debiteringsgrund för',{exact:false})).toBeVisible();
  await page.evaluate(()=>window.responses.push({ok:false,code:'access_denied',message:'Åtkomst återkallad'}));
  await page.getByRole('button',{name:'Uppdatera statistik'}).click();
  await expect(page.getByRole('alert')).toHaveText('Åtkomst återkallad');
  await expect(page.getByText('Unika publiceringar under vald månad')).toHaveCount(0);
  await expect(page.getByLabel('Faktureringsmånad')).toBeDisabled();
 }finally{await page.close();}
});

test('late response after tenant switch cannot restore previous data',async()=>{
 const page=await setup([{hold:true}]);try{
  await page.evaluate(()=>window.mountUsage({companyId:'10000000-0000-4000-8000-000000000009',userId:'10000000-0000-4000-8000-000000000002',role:'owner'}));
  await expect(page.getByRole('alert')).toContainText('Företaget eller behörigheten har ändrats');
  await page.evaluate(()=>window.release({...window.usage,month:window.calls[0].month}));
  await expect(page.getByText('Unika publiceringar under vald månad')).toHaveCount(0);
 }finally{await page.close();}
});

test('superadmin uses explicit company scope and CSV company parameter without tenant membership',async()=>{
 const page=await setup();try{
  await page.evaluate(()=>{window.usage.actorRole='platform_admin';window.mountUsage({companyId:window.usage.companyId,userId:window.usage.actorUserId,role:'platform_admin',superadmin:true});});
  await expect(page.getByText('Unika publiceringar under vald månad')).toBeVisible();
  const href=await page.getByRole('link',{name:'Hämta underlag som CSV'}).getAttribute('href');
  assert.ok(href.endsWith('?companyId='+COMPANY));
 }finally{await page.close();}
});
