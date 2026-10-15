import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {PDFDocument} from 'pdf-lib';
import {generateAdvertisingIssuedInvoicePdf} from '../src/lib/documents/advertising-issued-invoice-pdf.ts';
import {issuedInvoiceFixture,resignIssued,id} from './helpers/advertising-issuance/fixture.mjs';
async function extract(bytes){const directory=await mkdtemp(join(tmpdir(),'trafexa-issued-pdf-'));try{const path=join(directory,'invoice.pdf');await writeFile(path,bytes);const result=spawnSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout;}finally{await rm(directory,{recursive:true,force:true});}}
test('issued invoice PDF includes number, dates, registered seat, services, unit prices, reductions, VAT and payment instructions',async()=>{
 const invoice=issuedInvoiceFixture(),bytes=await generateAdvertisingIssuedInvoicePdf(invoice),pdf=await PDFDocument.load(bytes),text=(await extract(bytes)).replace(/\s+/g,' ');
 assert.equal(pdf.getTitle(),'Faktura FIXTURE-2026-000001');assert.equal(pdf.getCreationDate().toISOString(),'2026-10-15T09:04:00.000Z');
 for(const expected of ['Fakturanummer: FIXTURE-2026-000001','Fakturadatum: 2026-10-15','Förfallodatum: 2026-11-14','Styrelsens registrerade säte: Stockholm','SE556855488401','Summa exklusive moms: 0,08 SEK','Moms 25 %: 0,02 SEK','Att betala: 0,10 SEK','Bankgiro: 9912346','Enhetspris exkl. moms: 0,04 SEK','Nedsättning: 0,00 SEK','Antal: 1','Publicering av unik fordonsannons på Blocket','Åberg & Söner Bil AB','Trafexa Nordic AB',invoice.sourceHash])assert.ok(text.includes(expected),expected);
 for(const row of invoice.snapshot.lines)assert.ok(text.includes(`Tjänstedatum (granskat): ${row.serviceDate}`));
 assert.equal((text.match(/FAKTURA FIXTURE-2026-000001/g)||[]).length,pdf.getPageCount());assert.ok(!text.includes('EJ UTFÄRDAD'));assert.ok(!text.includes('Granskad svensk annonsering och betalningsuppgifter'));
});
test('issued invoice bytes remain identical when later independent source data changes',async()=>{
 const invoice=issuedInvoiceFixture(),first=await generateAdvertisingIssuedInvoicePdf(invoice),later=structuredClone(invoice.snapshot.assessment);later.snapshot.settings.fields.paymentAccount='55555551';later.snapshot.draft.snapshot.buyerProfile.fields.addressLine1='NEW LIVE ADDRESS';
 assert.deepEqual(await generateAdvertisingIssuedInvoicePdf(invoice),first);assert.ok(!(await extract(first)).includes('NEW LIVE ADDRESS'));
});
test('issued PDF preserves exact amounts beyond JavaScript safe precision and known zero with real service rows',async()=>{
 const text=(await extract(await generateAdvertisingIssuedInvoicePdf(issuedInvoiceFixture(['9007199254740993','2'])))).replace(/\s+/g,' ');assert.ok(text.includes('Att betala: 112 589 990 684 262,44 SEK'));
 const zero=(await extract(await generateAdvertisingIssuedInvoicePdf(issuedInvoiceFixture(['0','0'])))).replace(/\s+/g,' ');assert.ok(zero.includes('Att betala: 0,00 SEK'));assert.ok(zero.includes('2 unika publiceringar'));
});
test('rehashed but inconsistent number, dates, service attestation, seat, source or totals cannot become an invoice PDF',async()=>{
 for(const mutate of [i=>i.companyId=id(999),i=>i.createdAt='2026-10-16T00:00:00Z',i=>i.snapshot.invoiceNumber='FIXTURE-2026-000002',i=>i.snapshot.dueDate='2026-11-15',i=>i.snapshot.serviceDatesAcknowledged=false,i=>i.snapshot.series.sellerRegisteredSeat='字',i=>i.snapshot.lines[0].serviceDate='2026-10-01',i=>i.snapshot.netTotalOre='3',i=>i.snapshot.rendererVersion=2,i=>i.snapshot.providerSecret='DO-NOT-EXPORT']){
  const invoice=issuedInvoiceFixture();mutate(invoice);resignIssued(invoice);await assert.rejects(generateAdvertisingIssuedInvoicePdf(invoice));
 }
 const invoice=issuedInvoiceFixture();invoice.providerSecret='DO-NOT-EXPORT';await assert.rejects(generateAdvertisingIssuedInvoicePdf(invoice));
});
test('issued PDF refuses per-row VAT totals that differ from tax on the total net base',async()=>{
 await assert.rejects(generateAdvertisingIssuedInvoicePdf(issuedInvoiceFixture(['2','2'])));
 await assert.rejects(generateAdvertisingIssuedInvoicePdf(issuedInvoiceFixture(['14950','14950'])));
});
