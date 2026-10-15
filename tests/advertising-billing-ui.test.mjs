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
const helpers = resolve(repo, 'tests/helpers/advertising-billing-ui');
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
    entry: resolve(helpers, 'entry.js'), output: { path: directory, filename: 'fixture.js', publicPath: '' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/advertising/financial-actions': resolve(repo, 'tests/helpers/advertising-financial-ui/actions.js'), '@/lib/advertising/invoice-actions': resolve(repo, 'tests/helpers/advertising-invoice-ui/actions.js'), '@/lib/advertising/correction-actions': resolve(repo, 'tests/helpers/advertising-corrections-ui/actions.js'), '@/lib/advertising/billing-actions': resolve(helpers,'actions.js'), '@': resolve(repo,'src') } },
    plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })],
    module: { rules: [{ test: /\.tsx?$/, use: resolve(repo, 'tests/helpers/advertising-usage-ui/swc-loader.cjs') }] } };
  await new Promise((resolveBuild, reject) => { const compiler = webpack(config); compiler.run((error, stats) => compiler.close(() => { if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true }))); else resolveBuild(); })); });
  browser = await playwright.launch({ executablePath: await Chromium.executablePath(), args: Chromium.args.filter(argument => argument !== '--single-process'), headless: true });
});
after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

async function setup(overrides={},props={}) {
 const page=await browser.newPage();await page.route('**/*',route=>route.abort());await page.setContent(`<style>${styles}</style><div class="wrap" id="root"></div>`);
 await page.evaluate(({overrides})=>{
  window.billingCalls=[];window.billingResponses=[];window.billingMutationResponses=[];let nonce=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`20000000-0000-4000-8000-${String(++nonce).padStart(12,'0')}`});
  const item={publicationId:'10000000-0000-4000-8000-000000000010',listingId:'10000000-0000-4000-8000-000000000011',channel:'blocket',publishedAt:'2026-09-19T12:00:00Z',unitPriceOre:null,priceSource:null,rateVersion:null};
  window.billing={companyId:'10000000-0000-4000-8000-000000000001',actorUserId:'10000000-0000-4000-8000-000000000002',actorRole:'platform_admin',month:'2026-09',periodStart:'2026-08-31T22:00:00Z',periodEnd:'2026-09-30T22:00:00Z',ended:true,trackingStartedAt:'2026-09-15T12:00:00Z',coverage:'partial',legacyPublishedJobs:0,rates:[],items:[item],count:1,unpricedCount:1,totalOre:null,reviewToken:'a'.repeat(64),locked:null,hasChangesSinceLock:false,...overrides};
 },{overrides});
 await page.addScriptTag({path:bundle});await page.evaluate(props=>window.mountBilling(props),{companyId:COMPANY,userId:USER,role:'platform_admin',superadmin:true,...props});
 await expect(page.getByRole('heading',{name:'Gällande kanalpriser'})).toBeVisible();return page;
}
test('mobile billing distinguishes missing price and intentional zero, accepts exact Swedish decimal only after review',async()=>{
 const page=await setup();try{
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByText('Kan inte beräknas – priser saknas')).toBeVisible();
  await page.getByRole('button',{name:'Granska nytt kanalpris',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('Ange det överenskomna priset.');
  await page.getByLabel('Överenskommet styckpris, kronor exkl. moms').fill('149,50');await page.getByRole('button',{name:'Granska nytt kanalpris',exact:true}).click();
  await expect(page.getByRole('button',{name:'Bekräfta och spara priset'})).toBeDisabled();
  await page.getByRole('checkbox',{name:'Jag har granskat företaget, kanalen, perioden och prisöverenskommelsen.'}).check();await page.getByRole('button',{name:'Bekräfta och spara priset'}).click();
  await expect(page.getByText('Det nya kanalpriset är sparat för kommande publiceringar.')).toBeVisible();
  const mutation=await page.evaluate(()=>window.billingCalls.find(c=>c.kind==='rate'));assert.equal(mutation.unitPriceOre,'14950');assert.equal(mutation.expectedVersion,0);assert.match(mutation.requestId,/^[0-9a-f-]{36}$/);
  await page.getByLabel('Överenskommet styckpris, kronor exkl. moms').fill('0');await page.getByRole('button',{name:'Granska nytt kanalpris',exact:true}).click();await expect(page.getByText('Blocket: 0,00 kr exklusive moms per unik publicerad annons.',{exact:false})).toBeVisible();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390));
 }finally{await page.close();}
});
test('fraction beyond two decimals is rejected and no monetary mutation occurs',async()=>{const page=await setup();try{
 await page.getByLabel('Överenskommet styckpris, kronor exkl. moms').fill('12,345');await page.getByRole('button',{name:'Granska nytt kanalpris',exact:true}).click();await expect(page.getByRole('alert')).toContainText('högst två decimaler');assert.equal(await page.evaluate(()=>window.billingCalls.filter(c=>c.kind!=='read').length),0);
}finally{await page.close();}});
test('read-only finance uses tenant action and cannot set prices, reconcile or lock',async()=>{const page=await setup({actorRole:'finance'},{role:'finance',superadmin:false});try{
 await expect(page.getByLabel('Överenskommet styckpris, kronor exkl. moms')).toHaveCount(0);await expect(page.getByRole('button',{name:'Granska och lås månadsunderlag'})).toHaveCount(0);assert.equal(await page.evaluate(()=>window.billingCalls[0].platform),false);
}finally{await page.close();}});
test('partial history lock requires both acknowledgments and carries exact reviewed revision',async()=>{const page=await setup({items:[],count:0,unpricedCount:0,totalOre:'0'});try{
 await page.getByRole('button',{name:'Granska och lås månadsunderlag'}).click();await page.getByRole('checkbox',{name:'Jag har granskat företaget, kanalen, perioden och prisöverenskommelsen.'}).check();await expect(page.getByRole('button',{name:'Bekräfta och lås underlaget'})).toBeDisabled();
 await page.getByRole('checkbox',{name:'Jag har granskat den ofullständiga historiken och godkänner att låsa det registrerade underlaget.'}).check();await page.getByRole('button',{name:'Bekräfta och lås underlaget'}).click();await expect(page.getByText('Månadsunderlaget är låst. Ingen faktura har skickats.')).toBeVisible();const call=await page.evaluate(()=>window.billingCalls.find(c=>c.kind==='lock'));assert.equal(call.expectedReviewToken,'a'.repeat(64));assert.equal(call.partialCoverageAcknowledged,true);
}finally{await page.close();}});
test('locked period displays original items and total while warning about later changes',async()=>{const lockedItem={publicationId:id(55),listingId:'ORIGINAL-ANNONS',channel:'wayke',publishedAt:'2026-09-17T12:00:00Z',unitPriceOre:'12500',priceSource:'rate',rateVersion:1};const page=await setup({totalOre:'99900',unpricedCount:0,hasChangesSinceLock:true,locked:{id:id(50),lockedAt:'2026-10-01T12:00:00Z',totalOre:'12500',count:1,reviewToken:'b'.repeat(64),partialCoverageAcknowledged:true,items:[lockedItem]}});try{
 await expect(page.getByRole('cell',{name:'125,00 kr',exact:true})).toBeVisible();await expect(page.getByRole('rowheader',{name:'ORIGINAL-ANNONS'})).toBeVisible();await expect(page.getByRole('link',{name:'Hämta låst månadsunderlag som CSV'})).toHaveAttribute('href','/api/advertising/billing/2026-09/csv?companyId='+COMPANY);await expect(page.getByRole('rowheader',{name:id(11)})).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('Nya uppgifter har tillkommit');await expect(page.getByRole('button',{name:'Granska och lås månadsunderlag'})).toHaveCount(0);
}finally{await page.close();}});
test('denial clears prior billing data and disables reads',async()=>{const page=await setup();try{
 await page.evaluate(()=>window.billingResponses.push({ok:false,code:'access_denied',message:'Åtkomst återkallad'}));await page.getByRole('button',{name:'Uppdatera prisunderlag'}).click();await expect(page.getByRole('alert')).toHaveText('Åtkomst återkallad');await expect(page.getByRole('heading',{name:'Gällande kanalpriser'})).toHaveCount(0);await expect(page.getByLabel('Avstämningsmånad')).toBeDisabled();
}finally{await page.close();}});
test('late response from previous company cannot restore billing data',async()=>{const page=await setup();try{
 await page.evaluate(()=>window.billingResponses.push({hold:true}));await page.getByRole('button',{name:'Uppdatera prisunderlag'}).click();await page.waitForFunction(()=>typeof window.releaseBilling==='function');await page.evaluate(()=>window.mountBilling({companyId:'10000000-0000-4000-8000-000000000009',userId:window.billing.actorUserId,role:'platform_admin',superadmin:true}));await expect(page.getByRole('alert')).toContainText('Företaget eller administratörsåtkomsten har ändrats');await page.evaluate(()=>window.releaseBilling({ok:true,page:window.billing}));await expect(page.getByRole('heading',{name:'Gällande kanalpriser'})).toHaveCount(0);
}finally{await page.close();}});
test('historical prices require a reason and review, and affect only chosen channel and reviewed month',async()=>{const page=await setup();try{
 await page.getByLabel('Överenskommet styckpris, kronor exkl. moms').fill('99,95');await page.getByRole('button',{name:'Granska pris för publiceringar utan pris'}).click();await expect(page.getByRole('alert')).toContainText('Beskriv varför');await page.getByLabel('Motivering till priset').fill('Avtalat med kund den 20 september');await page.getByRole('button',{name:'Granska pris för publiceringar utan pris'}).click();await expect(page.getByText('Gäller 1 publiceringar utan pris under',{exact:false})).toBeVisible();await page.getByRole('checkbox',{name:'Jag har granskat företaget, kanalen, perioden och prisöverenskommelsen.'}).check();await page.getByRole('button',{name:'Bekräfta och spara priset'}).click();await expect(page.getByText('Priset för de granskade publiceringarna är sparat.')).toBeVisible();const call=await page.evaluate(()=>window.billingCalls.find(c=>c.kind==='reconcile'));assert.equal(call.unitPriceOre,'9995');assert.equal(call.channel,'blocket');assert.equal(call.expectedReviewToken,'a'.repeat(64));assert.equal(call.reviewAcknowledged,true);assert.equal(call.reason,'Avtalat med kund den 20 september');
}finally{await page.close();}});
test('unpriced publications, ongoing months and entirely untracked months cannot be locked',async()=>{
 for(const overrides of [{},{ended:false,unpricedCount:0,totalOre:'0'},{trackingStartedAt:'2026-10-14T12:00:00Z',unpricedCount:0,totalOre:'0'}]){const page=await setup(overrides);try{await expect(page.getByRole('button',{name:'Granska och lås månadsunderlag'})).toBeDisabled();}finally{await page.close();}}
});
test('authorization revoked during price mutation removes prices and review',async()=>{const page=await setup();try{
 await page.getByLabel('Överenskommet styckpris, kronor exkl. moms').fill('49,00');await page.getByRole('button',{name:'Granska nytt kanalpris',exact:true}).click();await page.getByRole('checkbox',{name:'Jag har granskat företaget, kanalen, perioden och prisöverenskommelsen.'}).check();await page.evaluate(()=>window.billingMutationResponses.push({ok:false,code:'access_denied',message:'Administratörsåtkomsten har återkallats'}));await page.getByRole('button',{name:'Bekräfta och spara priset'}).click();await expect(page.getByRole('alert')).toHaveText('Administratörsåtkomsten har återkallats');await expect(page.getByRole('heading',{name:'Gällande kanalpriser'})).toHaveCount(0);await expect(page.getByRole('region',{name:'Granska ändring'})).toHaveCount(0);
}finally{await page.close();}});

test('locked billing opens actual lazy corrections only on request and child denial clears the parent financial view',async()=>{
 const item={publicationId:id(55),listingId:id(56),channel:'blocket',publishedAt:'2026-09-17T12:00:00Z',unitPriceOre:'12500',priceSource:'rate',rateVersion:1};
 const original={id:id(50),lockedAt:'2026-10-01T12:00:00Z',totalOre:'12500',count:1,reviewToken:'b'.repeat(64),partialCoverageAcknowledged:true,items:[item]};
 const page=await setup({unpricedCount:0,totalOre:'12500',locked:original});
 try{
  await page.evaluate(({original})=>{window.correctionCalls=[];window.corrections={companyId:window.billing.companyId,actorUserId:window.billing.actorUserId,actorRole:'platform_admin',month:window.billing.month,original,adjustments:[],reductionTotalOre:'0',netTotalOre:'12500',reviewToken:'c'.repeat(64),canonicalSnapshot:'unused-by-client'};},{original});
  assert.equal(await page.evaluate(()=>window.correctionCalls.length),0);
  await page.getByRole('button',{name:'Visa rättelser av låst underlag'}).click();
  await expect(page.getByRole('heading',{name:'Rättelser av låst månadsunderlag'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Hämta rättelseunderlag som CSV'})).toHaveAttribute('href',`/api/advertising/billing/2026-09/corrections/csv?companyId=${COMPANY}`);
  assert.deepEqual(await page.evaluate(()=>window.correctionCalls[0]),{kind:'read',companyId:COMPANY,month:'2026-09',platform:true});
  await page.evaluate(()=>{window.correctionResponses=[{ok:false,code:'access_denied',message:'Återkallad rättelseåtkomst'}];});
  await page.getByRole('button',{name:'Uppdatera rättelseunderlag'}).click();
  await expect(page.getByRole('alert')).toHaveText('Återkallad rättelseåtkomst');
  await expect(page.getByRole('heading',{name:'Gällande kanalpriser'})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Rättelser av låst månadsunderlag'})).toHaveCount(0);
 }finally{await page.close();}
});

test('billing opens invoice profiles before month locking only after explicit request and child denial clears all financial views',async()=>{
 const page=await setup();
 try{
  await page.evaluate(()=>{
   const fields={legalName:'Exempelbil AB',organisationNumber:'5561112222',invoiceEmail:null,addressLine1:null,addressLine2:null,postalCode:null,city:null,countryCode:null,reference:null};
   const buyerProfile={kind:'buyer',companyId:window.billing.companyId,version:0,fields,missingFields:['invoiceEmail','addressLine1','postalCode','city','countryCode'],updatedAt:null};
   const sellerProfile={kind:'seller',companyId:null,version:0,fields:{...fields,legalName:null,organisationNumber:null},missingFields:['legalName','organisationNumber','invoiceEmail','addressLine1','postalCode','city','countryCode'],updatedAt:null};
   window.invoiceCalls=[];window.invoicePage={companyId:window.billing.companyId,actorUserId:window.billing.actorUserId,actorRole:'platform_admin',month:window.billing.month,buyerProfile,sellerProfile,canEditBuyer:true,canEditSeller:true,basis:{original:null,adjustments:[],reductionTotalOre:'0',netTotalOre:null},drafts:[],nextBeforeVersion:null,reviewToken:'a'.repeat(64),canonicalSnapshot:'{}'};
  });
  assert.equal(await page.evaluate(()=>window.invoiceCalls.length),0);
  await page.getByRole('button',{name:'Visa faktureringsuppgifter och utkast'}).click();
  await expect(page.getByRole('heading',{name:'Köparens faktureringsuppgifter',exact:true})).toBeVisible();
  assert.deepEqual(await page.evaluate(()=>window.invoiceCalls[0]),{kind:'read',companyId:COMPANY,month:'2026-09',beforeVersion:null,platform:true});
  await expect(page.getByRole('button',{name:'Ändra köparens faktureringsuppgifter'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Granska nytt fakturautkast'})).toHaveCount(0);
  await page.evaluate(()=>{window.invoiceResponses=[{ok:false,code:'access_denied',message:'Återkallad fakturaåtkomst'}];});
  await page.getByRole('button',{name:'Uppdatera faktureringsuppgifter'}).click();
  await expect(page.getByRole('alert')).toHaveText('Återkallad fakturaåtkomst');
  await expect(page.getByRole('heading',{name:'Gällande kanalpriser'})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Köparens faktureringsuppgifter',exact:true})).toHaveCount(0);
 }finally{await page.close();}
});
