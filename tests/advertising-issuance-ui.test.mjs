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
const helpers = resolve(repo, 'tests/helpers/advertising-issuance-ui');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const COMPANY = id(1), USER = id(2);
let browser, directory, bundle, styles;

before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'trafexa-advertising-ui-'));
  bundle = resolve(directory, 'fixture.js');
  styles = await readFile(resolve(repo, 'src/app/globals.css'), 'utf8');
  const config = { mode: 'development', target: 'web', devtool: false, context: repo,
    entry: resolve(helpers, 'entry.js'), output: { path: directory, filename: 'fixture.js', publicPath: '' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/advertising/payment-export-actions': resolve(repo, 'tests/helpers/advertising-payment-ui/unavailable-export-actions.js'), '@/lib/advertising/payment-actions': resolve(repo, 'tests/helpers/advertising-payment-ui/actions.js'), '@/lib/advertising/invoice-email-actions': resolve(repo, 'tests/helpers/advertising-invoice-email-ui/actions.js'), '@/lib/advertising/invoice-email-send-actions': resolve(repo, 'tests/helpers/advertising-invoice-email-ui/send-actions.js'), '@/lib/advertising/credit-actions': resolve(repo, 'tests/helpers/advertising-credit-ui/actions.js'), '@/lib/advertising/issuance-actions': resolve(helpers,'actions.js'), '@': resolve(repo,'src') } },
    plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })],
    module: { rules: [{ test: /\.tsx?$/, use: resolve(repo, 'tests/helpers/advertising-usage-ui/swc-loader.cjs') }] } };
  await new Promise((resolveBuild, reject) => { const compiler = webpack(config); compiler.run((error, stats) => compiler.close(() => { if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true }))); else resolveBuild(); })); });
  browser = await playwright.launch({ executablePath: await Chromium.executablePath(), args: Chromium.args.filter(argument => argument !== '--single-process'), headless: true });
});
after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

const ASSESSMENT=id(70),INVOICE=id(80);
async function setup(overrides={},props={}){
 const page=await browser.newPage();await page.route('**/*',route=>route.abort());await page.setContent(`<style>${styles}</style><div class="wrap" id="root"></div>`);
 await page.evaluate(({overrides})=>{
  window.issuanceCalls=[];window.issuanceResponses=[];window.issuanceMutationResponses=[];window.issuanceDetailResponses=[];let nonce=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`20000000-0000-4000-8000-${String(++nonce).padStart(12,'0')}`});
  const companyId='10000000-0000-4000-8000-000000000001',actorUserId='10000000-0000-4000-8000-000000000002';
  const seller={version:1,missingFields:[],fields:{legalName:'Trafexa Nordic AB',organisationNumber:'5568554884',invoiceEmail:'info@trafexa.com',addressLine1:'Exempelvägen 1',addressLine2:null,postalCode:'11111',city:'Stockholm',countryCode:'SE',reference:null}};
  const buyer={...seller,fields:{...seller.fields,legalName:'Exempelbil AB',organisationNumber:'5561112222',invoiceEmail:'ekonomi@exempel.se'}};
  const line={publicationId:'10000000-0000-4000-8000-000000000010',listingId:'10000000-0000-4000-8000-000000000011',channel:'blocket',originalOre:'14950',reductionOre:'4950',netOre:'10000',vatOre:'2500',grossOre:'12500'};
  const assessment={id:'10000000-0000-4000-8000-000000000070',companyId,month:'2026-09',version:1,createdAt:'2026-10-15T12:00:00Z',sourceHash:'a'.repeat(64),canonicalSnapshot:'{}',snapshot:{status:'reviewed_draft',companyId,month:'2026-09',currency:'SEK',calculationVersion:1,draft:{version:1,snapshot:{buyerProfile:buyer,sellerProfile:seller}},settings:{version:2,fields:{vatTreatment:'se_standard_25',sellerVatRegistered:true,sellerVatNumber:'SE556855488401',paymentDays:15,paymentMethod:'bankgiro',paymentAccount:'9912346',reason:'Bekräftat konto'}},lines:[line],netTotalOre:'10000',vatTotalOre:'2500',grossTotalOre:'12500'}};
  window.issuanceSeries={id:'10000000-0000-4000-8000-000000000060',sellerOrganisationNumber:'5568554884',year:2026,prefix:'TFX',firstNumber:'41',sellerRegisteredSeat:'Stockholms kommun',configurationHash:'b'.repeat(64),canonicalConfiguration:'{}',reason:'Avstämt mot bolagets övriga system',configuredAt:'2026-10-15T12:00:00Z',nextNumber:'41',reviewToken:'c'.repeat(64),canonicalSnapshot:'{}'};
  const preview={invoiceNumber:'TFX-2026-000041',sequence:'41',invoiceDate:'2026-10-15',dueDate:'2026-10-30',serviceDates:[{publicationId:line.publicationId,serviceDate:'2026-09-19'}],assessmentSourceHash:assessment.sourceHash,seriesReviewToken:window.issuanceSeries.reviewToken,reviewToken:'d'.repeat(64),canonicalSnapshot:'{}'};
  window.issuancePreview=preview;
  window.issuedInvoice={id:'10000000-0000-4000-8000-000000000080',companyId,month:'2026-09',createdAt:'2026-10-15T12:00:00Z',invoiceNumber:preview.invoiceNumber,invoiceDate:preview.invoiceDate,dueDate:preview.dueDate,sourceHash:'e'.repeat(64),canonicalSnapshot:'{}',snapshot:{status:'issued',rendererVersion:1,currency:'SEK',companyId,month:'2026-09',invoiceNumber:preview.invoiceNumber,invoiceDate:preview.invoiceDate,dueDate:preview.dueDate,sequence:'41',serviceDatesAcknowledged:true,series:window.issuanceSeries,assessment,lines:[{...line,quantity:1,serviceDate:'2026-09-19'}],netTotalOre:'10000',vatTotalOre:'2500',grossTotalOre:'12500'}};
  window.issuanceSummary={id:window.issuedInvoice.id,invoiceNumber:preview.invoiceNumber,invoiceDate:preview.invoiceDate,dueDate:preview.dueDate,createdAt:window.issuedInvoice.createdAt,sourceHash:window.issuedInvoice.sourceHash,assessmentId:assessment.id,isSourceOutdated:false};
  window.issuancePage={companyId,actorUserId,actorRole:'platform_admin',month:'2026-09',currentYear:2026,businessDate:'2026-10-15',assessment,isOutdated:false,series:window.issuanceSeries,invoice:null,preview,blockers:[],canConfigureSeries:false,canIssue:true,...overrides};
 },{overrides});
 await page.addScriptTag({path:bundle});await page.evaluate(props=>window.mountIssuance(props),{companyId:COMPANY,userId:USER,role:'platform_admin',superadmin:true,month:'2026-09',assessmentId:ASSESSMENT,...props});await expect(page.getByText('Verifierar fakturering…')).toHaveCount(0);return page;
}
const seriesAck='Jag har granskat säljarbolaget, året, prefixet, startnumret och sätet. Serien och numren kolliderar inte med bolagets övriga faktureringssystem.';
const issueAck='Jag har granskat fakturanummer, datum, parter, belopp och betalningsuppgifter och vill utfärda denna faktura.';
const datesAck='Jag bekräftar att varje tjänst utfördes på den visade tjänstedagen. Om någon dag är fel utfärdar jag inte fakturan.';
async function beginIssue(page){await page.getByRole('button',{name:'Granska utfärdandet av fakturan'}).click();await page.getByRole('checkbox',{name:issueAck}).check();}
test('series configuration has no seeded prefix/start/seat and requires separate explicit uniqueness review',async()=>{const page=await setup({series:null,preview:null,canConfigureSeries:true,canIssue:false,blockers:['series.unconfigured']});try{
 await page.getByRole('button',{name:'Konfigurera nummerserie',exact:true}).click();await expect(page.getByLabel('Prefix för fakturanummer')).toHaveValue('');await expect(page.getByLabel('Första löpnummer')).toHaveValue('');await expect(page.getByLabel('Säljarbolagets registrerade säte')).toHaveValue('');await page.getByLabel('Prefix för fakturanummer').fill('tfx');await page.getByLabel('Första löpnummer').fill('41');await page.getByLabel('Säljarbolagets registrerade säte').fill('Stockholms kommun');await page.getByLabel('Motivering till nummerserien').fill('Avstämt mot bolagets övriga fakturering');await page.getByRole('button',{name:'Granska nummerserien'}).click();await expect(page.getByRole('button',{name:'Bekräfta och konfigurera nummerserien'})).toBeDisabled();await page.getByRole('checkbox',{name:seriesAck}).check();await page.getByRole('button',{name:'Bekräfta och konfigurera nummerserien'}).click();await expect(page.getByText('Nummerserien är konfigurerad.',{exact:false})).toBeVisible();const call=await page.evaluate(()=>window.issuanceCalls.find(c=>c.kind==='configure'));assert.equal(call.year,2026);assert.equal(call.prefix,'TFX');assert.equal(call.firstNumber,'41');assert.equal(call.sellerRegisteredSeat,'Stockholms kommun');assert.equal(call.expectedAssessmentSourceHash,'a'.repeat(64));assert.equal('sellerOrganisationNumber'in call,false);assert.equal(await page.evaluate(()=>window.issuanceCalls.filter(c=>c.kind==='issue').length),0);
}finally{await page.close();}});
test('invalid series start, prefix and absent registered seat are blocked before mutation',async()=>{const page=await setup({series:null,preview:null,canConfigureSeries:true,canIssue:false});try{
 await page.getByRole('button',{name:'Konfigurera nummerserie',exact:true}).click();await page.getByLabel('Prefix för fakturanummer').fill('A');await page.getByRole('button',{name:'Granska nummerserien'}).click();await expect(page.getByRole('alert')).toContainText('2–12');await page.getByLabel('Prefix för fakturanummer').fill('TFX');await page.getByLabel('Första löpnummer').fill('0');await page.getByRole('button',{name:'Granska nummerserien'}).click();await expect(page.getByRole('alert')).toContainText('mellan 1 och 999999999');await page.getByLabel('Första löpnummer').fill('41');await page.getByRole('button',{name:'Granska nummerserien'}).click();await expect(page.getByRole('alert')).toContainText('registrerade säte');assert.equal(await page.evaluate(()=>window.issuanceCalls.filter(c=>c.kind==='configure').length),0);
}finally{await page.close();}});
test('issuance previews exact frozen parties, service dates and totals and requires two independent acknowledgments',async()=>{const page=await setup();try{
 const preview=page.getByRole('region',{name:'Förhandsgranskning av utfärdande'});await expect(preview).toContainText('TFX-2026-000041');await expect(preview).toContainText('2026-10-30');await expect(preview).toContainText('2026-09-19');await expect(preview).toContainText('Exempelbil AB');await expect(preview).toContainText('Stockholms kommun');await expect(preview).toContainText('125,00 kr');await beginIssue(page);await expect(page.getByRole('button',{name:'Utfärda fakturan',exact:true})).toBeDisabled();await page.getByRole('checkbox',{name:datesAck}).check();await page.getByRole('button',{name:'Utfärda fakturan',exact:true}).click();await expect(page.getByText('Fakturan är utfärdad och bevarad.',{exact:false})).toBeVisible();const call=await page.evaluate(()=>window.issuanceCalls.find(c=>c.kind==='issue'));assert.equal(call.expectedAssessmentSourceHash,'a'.repeat(64));assert.equal(call.expectedSeriesReviewToken,'c'.repeat(64));assert.equal(call.expectedReviewToken,'d'.repeat(64));assert.equal(call.serviceDatesAcknowledged,true);assert.equal(call.reviewAcknowledged,true);assert.equal('invoiceDate'in call,false);assert.equal('sequence'in call,false);await expect(page.getByRole('button',{name:'Granska utfärdandet av fakturan'})).toHaveCount(0);
}finally{await page.close();}});
test('declining service-date confirmation cannot issue an invoice',async()=>{const page=await setup();try{await beginIssue(page);await expect(page.getByRole('checkbox',{name:datesAck})).not.toBeChecked();await expect(page.getByRole('button',{name:'Utfärda fakturan',exact:true})).toBeDisabled();assert.equal(await page.evaluate(()=>window.issuanceCalls.filter(c=>c.kind==='issue').length),0);}finally{await page.close();}});
test('outdated assessment or existing invoice never offers an issuance operation',async()=>{for(const overrides of[{isOutdated:true,preview:null,canIssue:false,blockers:['assessment.outdated']},{preview:null,canIssue:false,blockers:['invoice.exists']}]){const page=await setup(overrides);try{await expect(page.getByRole('button',{name:'Granska utfärdandet av fakturan'})).toHaveCount(0);}finally{await page.close();}}});
test('finance cannot see global series counters or issuance controls and reads issued original PDF',async()=>{const page=await setup({actorRole:'finance',series:null,preview:null,canIssue:false,canConfigureSeries:false,blockers:['issuance.adminOnly']},{role:'finance',superadmin:false});try{
 await page.evaluate(()=>{window.issuancePage.invoice=window.issuanceSummary;});await page.getByRole('button',{name:'Uppdatera fakturering'}).click();await expect(page.getByRole('region',{name:'Säljarens nummerserie'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Konfigurera nummerserie',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Granska utfärdandet av fakturan'})).toHaveCount(0);await page.getByRole('button',{name:'Visa den utfärdade fakturan'}).click();await expect(page.getByRole('link',{name:'Hämta PDF av faktura TFX-2026-000041'})).toHaveAttribute('href',`/api/advertising/issued/${INVOICE}/pdf`);assert.equal(await page.evaluate(()=>window.issuanceCalls[0].platform),false);
}finally{await page.close();}});
test('mobile issued invoice preserves frozen parties, amount and dates even when source has changed',async()=>{const page=await setup();try{
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{window.issuancePage={...window.issuancePage,invoice:window.issuanceSummary,preview:null,canIssue:false};window.issuedOutdated=true;});await page.getByRole('button',{name:'Uppdatera fakturering'}).click();await page.getByRole('button',{name:'Visa den utfärdade fakturan'}).click();const selected=page.getByRole('region',{name:'Vald utfärdad faktura'});await expect(selected).toContainText('125,00 kr');await expect(selected).toContainText('2026-10-30');await expect(selected).toContainText('Exempelbil AB');await expect(selected).toContainText('Källuppgifter har ändrats efter utfärdandet');await expect(selected.getByRole('link')).toHaveAttribute('href',`/api/advertising/issued/${INVOICE}/pdf?companyId=${COMPANY}`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390));
}finally{await page.close();}});
test('unknown issuance outcome retries same nonce and frozen review token',async()=>{const page=await setup();try{
 await beginIssue(page);await page.getByRole('checkbox',{name:datesAck}).check();await page.evaluate(()=>window.issuanceMutationResponses.push({throw:true}));await page.getByRole('button',{name:'Utfärda fakturan',exact:true}).click();await expect(page.getByRole('alert')).toContainText('resultat är okänt');await page.getByRole('button',{name:'Utfärda fakturan',exact:true}).click();await expect(page.getByText('Fakturan är utfärdad och bevarad.',{exact:false})).toBeVisible();const calls=await page.evaluate(()=>window.issuanceCalls.filter(c=>c.kind==='issue'));assert.deepEqual(calls[0],calls[1]);
}finally{await page.close();}});
test('fresh denial after issuance receipt removes frozen data and all invoice links',async()=>{const page=await setup();try{
 await beginIssue(page);await page.getByRole('checkbox',{name:datesAck}).check();await page.evaluate(()=>window.issuanceResponses.push({ok:false,code:'access_denied',message:'Åtkomst återkallad'}));await page.getByRole('button',{name:'Utfärda fakturan',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('Åtkomst återkallad');await expect(page.getByRole('region',{name:'Förhandsgranskning av utfärdande'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Visa den utfärdade fakturan'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Uppdatera fakturering'})).toBeDisabled();
}finally{await page.close();}});
test('late issued detail after assessment switch cannot restore the prior invoice',async()=>{const page=await setup();try{
 await page.evaluate(()=>{window.issuancePage={...window.issuancePage,invoice:window.issuanceSummary,preview:null,canIssue:false};window.issuanceDetailResponses.push({hold:true});});await page.getByRole('button',{name:'Uppdatera fakturering'}).click();await page.getByRole('button',{name:'Visa den utfärdade fakturan'}).click();await page.waitForFunction(()=>typeof window.releaseIssuedDetail==='function');await page.evaluate(()=>window.mountIssuance({companyId:window.issuancePage.companyId,userId:window.issuancePage.actorUserId,role:'platform_admin',superadmin:true,month:'2026-09',assessmentId:'10000000-0000-4000-8000-000000000099'}));await expect(page.getByRole('alert')).toContainText('Företaget, underlaget eller din behörighet har ändrats');await page.evaluate(()=>window.releaseIssuedDetail({ok:true,invoice:window.issuedInvoice,isSourceOutdated:false}));await expect(page.getByRole('region',{name:'Vald utfärdad faktura'})).toHaveCount(0);
}finally{await page.close();}});
test('VAT rounding mismatch blocks issuance and directs a new reviewed original while retaining the saved assessment',async()=>{
 const page=await setup({preview:null,canIssue:false,blockers:['vat.roundingMismatch']});try{
  await expect(page.getByText('Det äldre underlagets radmoms skiljer sig från moms på totalbeloppet.',{exact:false})).toContainText('Skapa ett nytt granskat underlag från samma aktuella fakturautkast');
  await expect(page.getByText('Det tidigare underlaget bevaras.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Granska utfärdandet av fakturan'})).toHaveCount(0);
  assert.equal(await page.evaluate(()=>window.issuanceCalls.some(call=>['issue','configure'].includes(call.kind))),false);
 }finally{await page.close();}
});
test('credit panel loads only after opening issued original and denial clears the entire issuance scope',async()=>{const page=await setup();try{
 await expect(page.getByRole('button',{name:'Visa kreditering av fakturan'})).toHaveCount(0);
 await page.evaluate(()=>{window.issuancePage={...window.issuancePage,invoice:window.issuanceSummary,preview:null,canIssue:false};window.creditPage={companyId:window.issuancePage.companyId,actorUserId:window.issuancePage.actorUserId,actorRole:'platform_admin',businessDate:'2026-10-15',currentYear:2026,originalInvoice:window.issuedInvoice,series:window.issuanceSeries,credit:null,preview:null,canConfigureSeries:false,canCredit:false,blockers:[]};});
 await page.getByRole('button',{name:'Uppdatera fakturering'}).click();await page.getByRole('button',{name:'Visa den utfärdade fakturan'}).click();await expect(page.getByRole('region',{name:'Kreditering av faktura',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Visa kreditering av fakturan'}).click();await expect(page.getByRole('region',{name:'Kreditering av faktura',exact:true})).toContainText('TFX-2026-000041');await page.evaluate(()=>window.creditResponses=[{ok:false,code:'access_denied',message:'Kreditbehörighet återkallad'}]);await page.getByRole('button',{name:'Uppdatera kreditering'}).click();await expect(page.getByRole('alert')).toHaveText('Kreditbehörighet återkallad');await expect(page.getByRole('region',{name:'Vald utfärdad faktura'})).toHaveCount(0);await expect(page.getByRole('link')).toHaveCount(0);await expect(page.getByRole('button',{name:'Uppdatera fakturering'})).toBeDisabled();
}finally{await page.close();}});
test('selected original lazy-loads its own email status and email denial clears all parent invoice data',async()=>{const page=await setup();try{await page.evaluate(()=>{window.issuancePage={...window.issuancePage,invoice:window.issuanceSummary,preview:null,canIssue:false};window.emailResponses=[];window.emailCalls=[];window.emailPage={companyId:window.issuancePage.companyId,actorUserId:window.issuancePage.actorUserId,actorRole:'platform_admin',documentKind:'invoice',documentId:window.issuedInvoice.id,documentNumber:window.issuedInvoice.invoiceNumber,documentSourceHash:'a'.repeat(64),recipient:'invoice@example.test',netTotalOre:'10000',vatTotalOre:'2500',grossTotalOre:'12500',email:null,preview:null,canQueue:false,blockers:[]};});await page.getByRole('button',{name:'Uppdatera fakturering'}).click();await page.getByRole('button',{name:'Visa den utfärdade fakturan'}).click();await expect(page.getByRole('region',{name:'Dokumentets mejlutskick'})).toHaveCount(0);await page.getByRole('button',{name:'Visa fakturans mejlutskick'}).click();await expect(page.getByRole('region',{name:'Dokumentets mejlutskick'})).toContainText('invoice@example.test');assert.equal(await page.evaluate(()=>window.emailCalls.find(call=>call.kind==='read').documentKind),'invoice');await page.evaluate(()=>window.emailResponses.push({ok:false,code:'access_denied',message:'Mejlbehörighet återkallad'}));await page.getByRole('button',{name:'Uppdatera utskicksstatus'}).click();await expect(page.getByRole('alert')).toHaveText('Mejlbehörighet återkallad');await expect(page.getByRole('region',{name:'Vald utfärdad faktura'})).toHaveCount(0);await expect(page.getByRole('link')).toHaveCount(0);await expect(page.getByRole('button',{name:'Uppdatera fakturering'})).toBeDisabled();}finally{await page.close();}});
test('payment reconciliation loads only for an opened issued original and fresh denial clears invoice/PDF scope',async()=>{const page=await setup();try{
 await page.evaluate(()=>{window.issuancePage={...window.issuancePage,invoice:window.issuanceSummary,preview:null,canIssue:false};window.paymentCalls=[];window.paymentReads=[];window.paymentWrites=[];window.paymentLookups=[];window.paymentDenials=[];window.paymentSaved={};window.paymentPage={companyId:window.issuancePage.companyId,invoiceId:window.issuedInvoice.id,invoiceNumber:window.issuedInvoice.invoiceNumber,invoiceSourceHash:window.issuedInvoice.sourceHash,actorUserId:window.issuancePage.actorUserId,actorRole:'platform_admin',currency:'SEK',businessDate:'2026-10-18',grossTotalOre:'12500',credit:null,receivableOre:'12500',receivedOre:'0',outstandingOre:'12500',surplusOre:'0',status:'unpaid',entries:[],nextBeforeSequence:null,latestSequence:'0',entryCount:'0',reviewToken:'b'.repeat(64),canonicalReview:'fixture',canWrite:true};});
 await page.getByRole('button',{name:'Uppdatera fakturering',exact:true}).click();await expect(page.getByRole('button',{name:'Visa betalningsavstämning',exact:true})).toHaveCount(0);assert.equal(await page.evaluate(()=>window.paymentCalls.length),0);
 await page.getByRole('button',{name:'Visa den utfärdade fakturan',exact:true}).click();await expect(page.getByRole('region',{name:'Fakturans betalningsavstämning'})).toHaveCount(0);assert.equal(await page.evaluate(()=>window.paymentCalls.length),0);
 await page.getByRole('button',{name:'Visa betalningsavstämning',exact:true}).click();await expect(page.getByRole('heading',{name:'Faktura TFX-2026-000041 · Obetald'})).toBeVisible();const calls=await page.evaluate(()=>window.paymentCalls);assert.equal(calls[0].invoiceId,await page.evaluate(()=>window.issuedInvoice.id));assert.equal(calls[0].platform,true);
 await page.evaluate(()=>window.paymentReads.push({ok:false,code:'access_denied',message:'Betalningsbehörighet återkallad'}));await page.getByRole('button',{name:'Uppdatera betalningsavstämning',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('Betalningsbehörighet återkallad');await expect(page.getByRole('region',{name:'Vald utfärdad faktura'})).toHaveCount(0);await expect(page.getByRole('link')).toHaveCount(0);await expect(page.getByRole('button',{name:'Uppdatera fakturering',exact:true})).toBeDisabled();
 }finally{await page.close();}});

test('nested invoice payment confirmation cannot be unmounted or replaced by invoice controls while pending',async()=>{
 const page=await setup();try{
  await page.setViewportSize({width:320,height:844});
  await page.evaluate(()=>{
   window.issuancePage={...window.issuancePage,invoice:window.issuanceSummary,preview:null,canIssue:false};
   window.paymentCalls=[];window.paymentReads=[];window.paymentWrites=[{hold:true}];window.paymentSaved={};
   window.paymentPage={companyId:window.issuedInvoice.companyId,invoiceId:window.issuedInvoice.id,invoiceNumber:window.issuedInvoice.invoiceNumber,actorUserId:window.issuancePage.actorUserId,actorRole:'platform_admin',canWrite:true,invoiceSourceHash:window.issuedInvoice.sourceHash,reviewToken:'b'.repeat(64),businessDate:'2026-10-18',grossTotalOre:'12500',receivableOre:'12500',receivedOre:'0',outstandingOre:'12500',surplusOre:'0',status:'unpaid',entryCount:'0',latestSequence:'0',entries:[],nextBeforeSequence:null,credit:null};
  });
  await page.getByRole('button',{name:'Uppdatera fakturering',exact:true}).click();
  await page.getByRole('button',{name:'Visa den utfärdade fakturan',exact:true}).click();
  await page.getByRole('button',{name:'Visa betalningsavstämning',exact:true}).click();
  await page.getByRole('button',{name:'Registrera mottagen betalning',exact:true}).click();
  await page.getByLabel('Bankhändelsens unika transaktions-ID').fill('bank-001');
  await page.getByLabel('Mottaget belopp, kr').fill('50');
  await page.getByLabel('Bankreferens / OCR',{exact:true}).fill('OCR-001');
  await page.getByLabel('Motivering och kontrollerat underlag').fill('Kontrollerat bankunderlag');
  await page.getByRole('button',{name:'Granska registreringen',exact:true}).click();
  await page.getByRole('checkbox',{name:'Jag har granskat bankunderlaget, fakturan, beloppet och datumet och bekräftar denna administrativa registrering.'}).check();
  await page.getByRole('button',{name:'Bekräfta mottagen betalning',exact:true}).click();
  await page.waitForFunction(()=>!!window.releasePayment);
  for(const name of ['Uppdatera fakturering','Visa den utfärdade fakturan','Dölj betalningsavstämning','Visa fakturans mejlutskick','Visa kreditering av fakturan'])await expect(page.getByRole('button',{name,exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Dölj betalningsavstämning',exact:true}).evaluate(button=>button.click());
  await expect(page.getByRole('region',{name:'Slutgranskning av betalningsregistrering'})).toBeVisible();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'/tmp/trafexa-nested-invoice-payment-pending-320.png',fullPage:true});
  await page.evaluate(()=>window.releasePayment.reject(Error('Lost payment response')));
  await expect(page.getByRole('button',{name:'Försök samma bekräftelse igen',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Dölj betalningsavstämning',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Försök samma bekräftelse igen',exact:true}).click();
  await expect(page.getByText('Betalningsregistreringen är sparad. Ingen banköverföring har utförts.',{exact:true})).toBeVisible();
  const calls=await page.evaluate(()=>window.paymentCalls.filter(call=>call.kind==='register'));
  assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
  await expect(page.getByRole('heading',{name:'Faktura TFX-2026-000041 · Delbetald',exact:true})).toBeVisible();
 }finally{await page.close();}
});
