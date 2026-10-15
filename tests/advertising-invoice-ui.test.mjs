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
const helpers = resolve(repo, 'tests/helpers/advertising-invoice-ui');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const COMPANY = id(1), USER = id(2);
let browser, directory, bundle, styles;

before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'trafexa-advertising-ui-'));
  bundle = resolve(directory, 'fixture.js');
  styles = await readFile(resolve(repo, 'src/app/globals.css'), 'utf8');
  const config = { mode: 'development', target: 'web', devtool: false, context: repo,
    entry: resolve(helpers, 'entry.js'), output: { path: directory, filename: 'fixture.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/advertising/invoice-actions': resolve(helpers,'actions.js'), '@': resolve(repo,'src') } },
    module: { rules: [{ test: /\.tsx?$/, use: resolve(repo, 'tests/helpers/advertising-usage-ui/swc-loader.cjs') }] } };
  await new Promise((resolveBuild, reject) => { const compiler = webpack(config); compiler.run((error, stats) => compiler.close(() => { if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true }))); else resolveBuild(); })); });
  browser = await playwright.launch({ executablePath: await Chromium.executablePath(), args: Chromium.args.filter(argument => argument !== '--single-process'), headless: true });
});
after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

const DRAFT=id(50);
async function setup(overrides={},props={}){
 const page=await browser.newPage();await page.route('**/*',route=>route.abort());await page.setContent(`<style>${styles}</style><div class="wrap" id="root"></div>`);
 await page.evaluate(({overrides})=>{
  window.invoiceCalls=[];window.invoiceResponses=[];window.invoiceMutationResponses=[];window.invoiceDetailResponses=[];let nonce=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`20000000-0000-4000-8000-${String(++nonce).padStart(12,'0')}`});
  const companyId='10000000-0000-4000-8000-000000000001',actorUserId='10000000-0000-4000-8000-000000000002';
  const fields={legalName:'Exempelbil AB',organisationNumber:'5561112222',invoiceEmail:null,addressLine1:null,addressLine2:null,postalCode:null,city:null,countryCode:null,reference:null};
  const buyerProfile={kind:'buyer',companyId,version:0,fields,missingFields:['invoiceEmail','addressLine1','postalCode','city','countryCode'],updatedAt:null};
  const sellerProfile={kind:'seller',companyId:null,version:0,fields:{...fields,legalName:null,organisationNumber:null},missingFields:['legalName','organisationNumber','addressLine1','postalCode','city','countryCode'],updatedAt:null};
  const item={publicationId:'10000000-0000-4000-8000-000000000010',listingId:'10000000-0000-4000-8000-000000000011',channel:'blocket',publishedAt:'2026-09-19T12:00:00Z',unitPriceOre:'14950',priceSource:'rate',rateVersion:1};
  const basis={companyId,month:'2026-09',original:{id:'10000000-0000-4000-8000-000000000030',totalOre:'14950',count:1,items:[item],lockedAt:'2026-10-01T12:00:00Z',reviewToken:'b'.repeat(64),partialCoverageAcknowledged:true},adjustments:[],reductionTotalOre:'4950',netTotalOre:'10000',reviewToken:'c'.repeat(64),canonicalSnapshot:'{}'};
  window.invoiceDraft={id:'10000000-0000-4000-8000-000000000050',companyId,month:'2026-09',version:1,createdAt:'2026-10-15T12:00:00Z',sourceHash:'d'.repeat(64),canonicalSnapshot:'{}',snapshot:{status:'draft',currency:'SEK',vatStatus:'unresolved',companyId,month:'2026-09',buyerProfile,sellerProfile,basis,missingFields:['buyer.addressLine1','seller.addressLine1','vatTreatment']}};
  window.invoicePage={companyId,actorUserId,actorRole:'platform_admin',month:'2026-09',buyerProfile,sellerProfile,canEditBuyer:true,canEditSeller:true,basis,reviewToken:'a'.repeat(64),canonicalSnapshot:'{}',drafts:[{id:window.invoiceDraft.id,version:1,createdAt:window.invoiceDraft.createdAt,sourceHash:window.invoiceDraft.sourceHash,missingFields:window.invoiceDraft.snapshot.missingFields,isOutdated:false}],nextBeforeVersion:null,...overrides};
 },{overrides});
 await page.addScriptTag({path:bundle});await page.evaluate(props=>window.mountInvoices(props),{companyId:COMPANY,userId:USER,role:'platform_admin',superadmin:true,month:'2026-09',...props});await expect(page.getByRole('heading',{name:'Köparens faktureringsuppgifter',exact:true})).toBeVisible();return page;
}
const profileAck='Jag har granskat uppgifterna och eventuella kompletteringar som återstår.';
const draftAck='Jag har granskat företaget, perioden, originalet, rättelserna och uppgiftsversionerna. Jag förstår att detta endast är ett utkast.';
test('owner saves reviewed partial buyer contact fields without changing company identity or inventing country',async()=>{const page=await setup({actorRole:'owner',canEditSeller:false},{role:'owner',superadmin:false});try{
 await page.getByRole('button',{name:'Ändra köparens faktureringsuppgifter'}).click();const editor=page.getByRole('region',{name:'Redigera faktureringsuppgifter'});await expect(editor.getByLabel('Juridiskt företagsnamn')).toHaveAttribute('readonly','');await expect(editor.getByLabel('Organisationsnummer',{exact:false})).toHaveAttribute('readonly','');await editor.getByLabel('Fakturaepost').fill('Ekonomi@Exempel.SE');await expect(editor.getByLabel('Landkod',{exact:false})).toHaveValue('');await page.getByRole('button',{name:'Granska faktureringsuppgifterna',exact:true}).click();await expect(page.getByRole('button',{name:'Bekräfta och spara uppgifterna'})).toBeDisabled();await page.getByRole('checkbox',{name:profileAck}).check();await page.getByRole('button',{name:'Bekräfta och spara uppgifterna'}).click();await expect(page.getByText('Faktureringsuppgifterna är sparade i en ny version.',{exact:false})).toBeVisible();const call=await page.evaluate(()=>window.invoiceCalls.find(c=>c.kind==='buyer'));assert.equal(call.fields.invoiceEmail,'ekonomi@exempel.se');assert.equal(call.fields.countryCode,null);assert.equal(call.fields.addressLine1,null);assert.equal('legalName'in call.fields,false);assert.equal('organisationNumber'in call.fields,false);assert.equal(call.platform,false);assert.equal(call.expectedVersion,0);
}finally{await page.close();}});
test('superadmin seller suggestion needs explicit fill and review, leaves postal address and country empty',async()=>{const page=await setup();try{
 await page.getByRole('button',{name:'Ändra Trafexas säljaruppgifter'}).click();const editor=page.getByRole('region',{name:'Redigera faktureringsuppgifter'});await expect(editor.getByLabel('Juridiskt företagsnamn')).toHaveValue('');await page.getByRole('button',{name:'Fyll i Trafexas bekräftade bolagsuppgifter'}).click();await expect(editor.getByLabel('Juridiskt företagsnamn')).toHaveValue('Trafexa Nordic AB');await expect(editor.getByLabel('Organisationsnummer',{exact:false})).toHaveValue('5568554884');await expect(editor.getByLabel('Fakturaepost')).toHaveValue('info@trafexa.com');await expect(editor.getByLabel('Postadress',{exact:true})).toHaveValue('');await expect(editor.getByLabel('Landkod',{exact:false})).toHaveValue('');assert.equal(await page.evaluate(()=>window.invoiceCalls.filter(c=>c.kind==='seller').length),0);await page.getByRole('button',{name:'Granska faktureringsuppgifterna',exact:true}).click();await page.getByRole('checkbox',{name:profileAck}).check();await page.getByRole('button',{name:'Bekräfta och spara uppgifterna'}).click();await expect(page.getByText('Faktureringsuppgifterna är sparade i en ny version.',{exact:false})).toBeVisible();const call=await page.evaluate(()=>window.invoiceCalls.find(c=>c.kind==='seller'));assert.equal(call.fields.addressLine1,null);assert.equal(call.fields.countryCode,null);assert.equal('companyId'in call,false);
}finally{await page.close();}});
test('finance reads profiles and history without mutation controls',async()=>{const page=await setup({actorRole:'finance',canEditBuyer:false,canEditSeller:false},{role:'finance',superadmin:false});try{
 await expect(page.getByRole('button',{name:'Ändra köparens faktureringsuppgifter'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Ändra Trafexas säljaruppgifter'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Granska nytt fakturautkast'})).toHaveCount(0);assert.equal(await page.evaluate(()=>window.invoiceCalls[0].platform),false);await page.getByRole('button',{name:'Visa sparat utkast version 1'}).click();await expect(page.getByRole('link',{name:'Hämta PDF av sparat utkast version 1'})).toHaveAttribute('href',`/api/advertising/invoices/${DRAFT}/pdf`);
}finally{await page.close();}});
test('superadmin draft creation binds reviewed month, profiles and corrected basis while VAT stays unresolved',async()=>{const page=await setup();try{
 await page.getByRole('button',{name:'Granska nytt fakturautkast'}).click();const review=page.getByRole('region',{name:'Granska fakturaunderlag'});await expect(review).toContainText('Återstående underlag: 100,00 kr exklusive moms');await expect(review).toContainText('UTKAST / EJ UTFÄRDAD');await expect(page.getByRole('button',{name:'Bekräfta och spara fakturautkast'})).toBeDisabled();await page.getByRole('checkbox',{name:draftAck}).check();await page.getByRole('button',{name:'Bekräfta och spara fakturautkast'}).click();await expect(page.getByText('Ett oföränderligt fakturautkast är sparat.',{exact:false})).toBeVisible();const call=await page.evaluate(()=>window.invoiceCalls.find(c=>c.kind==='create'));assert.equal(call.expectedBuyerVersion,0);assert.equal(call.expectedSellerVersion,0);assert.equal(call.expectedReviewToken,'a'.repeat(64));assert.equal(call.month,'2026-09');assert.equal(call.reviewAcknowledged,true);assert.equal('vatRate'in call,false);assert.equal('dueDate'in call,false);
}finally{await page.close();}});
test('mobile saved draft shows immutable original values and stale badge with private exact PDF link',async()=>{const page=await setup();try{
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{window.invoiceOutdated=true;window.invoiceDraft.snapshot.basis={...window.invoiceDraft.snapshot.basis,reductionTotalOre:'0',netTotalOre:'14950'};});await page.getByRole('button',{name:'Visa sparat utkast version 1'}).click();const selected=page.getByRole('region',{name:'Valt fakturautkast'});await expect(selected).toContainText('UTKAST / EJ UTFÄRDAD');await expect(selected).toContainText('Detta utkast bygger på äldre uppgifter');await expect(selected).toContainText('149,50 kr');await expect(selected).toContainText('Moms: ej fastställd');await expect(selected.getByRole('link')).toHaveAttribute('href',`/api/advertising/invoices/${DRAFT}/pdf?companyId=${COMPANY}`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390));
}finally{await page.close();}});
test('no locked basis still allows buyer profile editing but blocks new invoice draft',async()=>{const page=await setup();try{
 await page.evaluate(()=>{window.invoicePage.basis={...window.invoicePage.basis,original:null,netTotalOre:null};});await page.getByRole('button',{name:'Uppdatera faktureringsuppgifter'}).click();await expect(page.getByText('Månaden har inget låst underlag.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Granska nytt fakturautkast'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Ändra köparens faktureringsuppgifter'})).toBeVisible();
}finally{await page.close();}});
test('uncertain create outcome reuses the exact request UUID and reviewed input',async()=>{const page=await setup();try{
 await page.getByRole('button',{name:'Granska nytt fakturautkast'}).click();await page.getByRole('checkbox',{name:draftAck}).check();await page.evaluate(()=>window.invoiceMutationResponses.push({throw:true}));await page.getByRole('button',{name:'Bekräfta och spara fakturautkast'}).click();await expect(page.getByRole('alert')).toContainText('resultat är okänt');await page.getByRole('button',{name:'Bekräfta och spara fakturautkast'}).click();await expect(page.getByText('Ett oföränderligt fakturautkast är sparat.',{exact:false})).toBeVisible();const calls=await page.evaluate(()=>window.invoiceCalls.filter(c=>c.kind==='create'));assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
}finally{await page.close();}});
test('fresh denial after saved profile receipt clears private profiles, history and PDF',async()=>{const page=await setup();try{
 await page.getByRole('button',{name:'Ändra köparens faktureringsuppgifter'}).click();await page.getByRole('button',{name:'Granska faktureringsuppgifterna',exact:true}).click();await page.getByRole('checkbox',{name:profileAck}).check();await page.evaluate(()=>window.invoiceResponses.push({ok:false,code:'access_denied',message:'Åtkomst återkallad'}));await page.getByRole('button',{name:'Bekräfta och spara uppgifterna'}).click();await expect(page.getByRole('alert')).toHaveText('Åtkomst återkallad');await expect(page.getByText('Exempelbil AB',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Visa sparat utkast version 1'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Uppdatera faktureringsuppgifter'})).toBeDisabled();
}finally{await page.close();}});
test('late selected draft after company switch cannot restore the prior PDF link',async()=>{const page=await setup();try{
 await page.evaluate(()=>window.invoiceDetailResponses.push({hold:true}));await page.getByRole('button',{name:'Visa sparat utkast version 1'}).click();await page.waitForFunction(()=>typeof window.releaseInvoiceDetail==='function');await page.evaluate(()=>window.mountInvoices({companyId:'10000000-0000-4000-8000-000000000099',userId:window.invoicePage.actorUserId,role:'platform_admin',superadmin:true,month:'2026-09'}));await expect(page.getByRole('alert')).toContainText('Företaget, perioden eller din behörighet har ändrats');await page.evaluate(()=>window.releaseInvoiceDetail({ok:true,draft:window.invoiceDraft,isOutdated:false}));await expect(page.getByRole('link',{name:'Hämta PDF av sparat utkast version 1'})).toHaveCount(0);await expect(page.getByText('Exempelbil AB',{exact:true})).toHaveCount(0);
}finally{await page.close();}});
test('wrong actor mutation receipt is denied before historical data can be displayed',async()=>{const page=await setup();try{
 await page.getByRole('button',{name:'Granska nytt fakturautkast'}).click();await page.getByRole('checkbox',{name:draftAck}).check();await page.evaluate(()=>window.invoiceMutationResponses.push({ok:true,draft:window.invoiceDraft,isOutdated:false,receipt:{draftId:window.invoiceDraft.id,companyId:window.invoicePage.companyId,actorUserId:'10000000-0000-4000-8000-000000000099',requestId:'20000000-0000-4000-8000-000000000001',sourceHash:window.invoiceDraft.sourceHash}}));await page.getByRole('button',{name:'Bekräfta och spara fakturautkast'}).click();await expect(page.getByRole('alert')).toContainText('Kvittot kunde inte verifieras');await expect(page.getByRole('button',{name:'Visa sparat utkast version 1'})).toHaveCount(0);
}finally{await page.close();}});
