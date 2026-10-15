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
const helpers = resolve(repo, 'tests/helpers/advertising-corrections-ui');
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
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/advertising/correction-actions': resolve(repo, 'tests/helpers/advertising-corrections-ui/actions.js'), '@/lib/advertising/correction-actions': resolve(helpers,'actions.js'), '@': resolve(repo,'src') } },
    module: { rules: [{ test: /\.tsx?$/, use: resolve(repo, 'tests/helpers/advertising-usage-ui/swc-loader.cjs') }] } };
  await new Promise((resolveBuild, reject) => { const compiler = webpack(config); compiler.run((error, stats) => compiler.close(() => { if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true }))); else resolveBuild(); })); });
  browser = await playwright.launch({ executablePath: await Chromium.executablePath(), args: Chromium.args.filter(argument => argument !== '--single-process'), headless: true });
});
after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

const ORIGINAL=id(30), PUBLICATION=id(10);
async function setup(overrides={},props={}) {
 const page=await browser.newPage();await page.route('**/*',route=>route.abort());await page.setContent(`<style>${styles}</style><div class="wrap" id="root"></div>`);
 await page.evaluate(({overrides})=>{
  window.correctionCalls=[];window.correctionResponses=[];window.correctionMutationResponses=[];let nonce=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`20000000-0000-4000-8000-${String(++nonce).padStart(12,'0')}`});
  const item={publicationId:'10000000-0000-4000-8000-000000000010',listingId:'10000000-0000-4000-8000-000000000011',channel:'blocket',publishedAt:'2026-09-19T12:00:00Z',unitPriceOre:'14950',priceSource:'rate',rateVersion:1};
  window.corrections={companyId:'10000000-0000-4000-8000-000000000001',actorUserId:'10000000-0000-4000-8000-000000000002',actorRole:'platform_admin',month:'2026-09',original:{id:'10000000-0000-4000-8000-000000000030',totalOre:'14950',count:1,items:[item],lockedAt:'2026-10-01T12:00:00Z',reviewToken:'b'.repeat(64),partialCoverageAcknowledged:true},adjustments:[],reductionTotalOre:'0',netTotalOre:'14950',reviewToken:'a'.repeat(64),canonicalSnapshot:'{}',...overrides};
 },{overrides});
 await page.addScriptTag({path:bundle});await page.evaluate(props=>window.mountCorrections(props),{companyId:COMPANY,userId:USER,role:'platform_admin',superadmin:true,month:'2026-09',originalId:ORIGINAL,...props});
 await expect(page.getByText('Verifierar rättelseunderlag…')).toHaveCount(0);return page;
}
async function prepare(page,amount='49,50',reason='Överenskommen prisreduktion'){
 await page.getByLabel('Publicering att rätta').selectOption(PUBLICATION);await page.getByLabel('Reduktion, kronor exkl. moms').fill(amount);await page.getByLabel('Motivering till reduktionen').fill(reason);await page.getByRole('button',{name:'Granska reduktionen',exact:true}).click();
}
const acknowledgment='Jag har granskat företaget, månaden, originalpubliceringen, det återstående beloppet och motiveringen.';
test('mobile exact positive reduction requires explicit review and binds original publication and revision',async()=>{const page=await setup();try{
 await page.setViewportSize({width:390,height:844});await prepare(page);await expect(page.getByText('Återstår efter denna reduktion: 100,00 kr exklusive moms.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Bekräfta och spara reduktionen'})).toBeDisabled();await page.getByRole('checkbox',{name:acknowledgment}).check();await page.getByRole('button',{name:'Bekräfta och spara reduktionen'}).click();await expect(page.getByText('Reduktionen är sparad som ett separat rättelseunderlag.',{exact:false})).toBeVisible();const call=await page.evaluate(()=>window.correctionCalls.find(c=>c.kind==='create'));assert.equal(call.amountOre,'4950');assert.equal(call.publicationId,PUBLICATION);assert.equal(call.expectedReviewToken,'a'.repeat(64));assert.equal(call.reviewAcknowledged,true);assert.equal(call.month,'2026-09');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390));
}finally{await page.close();}});
test('zero, excessive, fractional and missing reason inputs cannot create a correction',async()=>{const page=await setup();try{
 for(const [amount,reason,message]of[['0','Giltigt skäl','större än noll'],['149,51','Giltigt skäl','återstående belopp'],['1,001','Giltigt skäl','högst två decimaler'],['1','','minst fem tecken']]){await prepare(page,amount,reason);await expect(page.getByRole('alert')).toContainText(message);}assert.equal(await page.evaluate(()=>window.correctionCalls.filter(c=>c.kind==='create').length),0);
}finally{await page.close();}});
test('prior reductions cap remaining line amount and readonly finance sees immutable history',async()=>{const page=await setup({actorRole:'finance',adjustments:[{id:id(40),publicationId:PUBLICATION,amountOre:'4950',reason:'Överenskommen justering',createdAt:'2026-10-14T12:00:00Z',createdBy:'Superadmin'}],reductionTotalOre:'4950',netTotalOre:'10000'},{role:'finance',superadmin:false});try{
 await expect(page.getByText('Överenskommen justering')).toBeVisible();await expect(page.getByText('Rättelsereferens: '+id(40),{exact:true})).toBeVisible();await expect(page.getByRole('cell',{name:'100,00 kr',exact:true})).toBeVisible();await expect(page.getByLabel('Reduktion, kronor exkl. moms')).toHaveCount(0);await expect(page.getByRole('link',{name:'Hämta rättelseunderlag som CSV'})).toHaveAttribute('href','/api/advertising/billing/2026-09/corrections/csv');assert.equal(await page.evaluate(()=>window.correctionCalls[0].platform),false);
}finally{await page.close();}});
test('admin cannot reduce beyond line remaining after earlier immutable reductions',async()=>{const page=await setup({adjustments:[{id:id(40),publicationId:PUBLICATION,amountOre:'4950',reason:'Tidigare prisreduktion',createdAt:'2026-10-14T12:00:00Z',createdBy:'Superadmin'}],reductionTotalOre:'4950',netTotalOre:'10000'});try{await prepare(page,'100,01');await expect(page.getByRole('alert')).toContainText('återstående belopp');await prepare(page,'100');await expect(page.getByRole('region',{name:'Granska rättelse'})).toContainText('Återstår efter denna reduktion: 0,00 kr');}finally{await page.close();}});
test('unknown outcome retry reuses the same request UUID and reviewed input',async()=>{const page=await setup();try{
 await prepare(page);await page.getByRole('checkbox',{name:acknowledgment}).check();await page.evaluate(()=>window.correctionMutationResponses.push({throw:true}));await page.getByRole('button',{name:'Bekräfta och spara reduktionen'}).click();await expect(page.getByRole('alert')).toContainText('resultat är okänt');await page.getByRole('button',{name:'Bekräfta och spara reduktionen'}).click();await expect(page.getByText('Reduktionen är sparad som ett separat rättelseunderlag.',{exact:false})).toBeVisible();const calls=await page.evaluate(()=>window.correctionCalls.filter(c=>c.kind==='create'));assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
}finally{await page.close();}});
test('no locked original and zero priced original have no correction controls',async()=>{
 for(const [overrides,props]of[[{original:null,netTotalOre:null},{originalId:null}],[{original:{id:ORIGINAL,totalOre:'0',count:0,items:[],lockedAt:'2026-10-01T12:00:00Z'},netTotalOre:'0'},{}]]){const page=await setup(overrides,props);try{await expect(page.getByLabel('Reduktion, kronor exkl. moms')).toHaveCount(0);await expect(page.getByRole('button',{name:'Granska reduktionen',exact:true})).toHaveCount(0);}finally{await page.close();}}
});
test('revoked access after historical correction receipt cannot restore private amounts',async()=>{const page=await setup();try{
 await prepare(page);await page.getByRole('checkbox',{name:acknowledgment}).check();await page.evaluate(()=>window.correctionResponses.push({ok:false,code:'access_denied',message:'Åtkomsten är återkallad'}));await page.getByRole('button',{name:'Bekräfta och spara reduktionen'}).click();await expect(page.getByRole('alert')).toHaveText('Åtkomsten är återkallad');await expect(page.getByText('Låst original, exkl. moms')).toHaveCount(0);await expect(page.getByRole('link',{name:'Hämta rättelseunderlag som CSV'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Uppdatera rättelseunderlag'})).toBeDisabled();
}finally{await page.close();}});
test('late read after month and original switch cannot expose previous original',async()=>{const page=await setup();try{
 await page.evaluate(()=>window.correctionResponses.push({hold:true}));await page.getByRole('button',{name:'Uppdatera rättelseunderlag'}).click();await page.waitForFunction(()=>typeof window.releaseCorrection==='function');await page.evaluate(()=>window.mountCorrections({companyId:window.corrections.companyId,userId:window.corrections.actorUserId,role:'platform_admin',superadmin:true,month:'2026-08',originalId:'10000000-0000-4000-8000-000000000099'}));await expect(page.getByRole('alert')).toContainText('månadsunderlaget eller din behörighet har ändrats');await page.evaluate(()=>window.releaseCorrection({ok:true,page:window.corrections}));await expect(page.getByText('Låst original, exkl. moms')).toHaveCount(0);
}finally{await page.close();}});
test('wrong company mutation receipt is denied and clears the review and amounts',async()=>{const page=await setup();try{
 await prepare(page);await page.getByRole('checkbox',{name:acknowledgment}).check();await page.evaluate(()=>window.correctionMutationResponses.push({ok:true,page:window.corrections,receipt:{id:'10000000-0000-4000-8000-000000000060',companyId:'10000000-0000-4000-8000-000000000099',actorUserId:window.corrections.actorUserId,requestId:'20000000-0000-4000-8000-000000000001'}}));await page.getByRole('button',{name:'Bekräfta och spara reduktionen'}).click();await expect(page.getByRole('alert')).toContainText('aktuellt företag och användare');await expect(page.getByRole('region',{name:'Granska rättelse'})).toHaveCount(0);await expect(page.getByText('Låst original, exkl. moms')).toHaveCount(0);
}finally{await page.close();}});
