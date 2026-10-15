import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {PDFDocument} from 'pdf-lib';
import {generateAdvertisingInvoicePdf} from '../src/lib/documents/advertising-invoice-pdf.ts';
import {invoiceFixture,resignInvoice,id} from './helpers/advertising-invoices/fixture.mjs';

async function extract(bytes){
 const directory=await mkdtemp(join(tmpdir(),'trafexa-invoice-pdf-'));
 try{const path=join(directory,'draft.pdf');await writeFile(path,bytes);const r=spawnSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr||r.error?.message);return r.stdout;}finally{await rm(directory,{recursive:true,force:true});}
}
test('immutable invoice PDF renders exact saved exVAT amounts, profile versions, references and prominent unissued status',async()=>{
 const draft=invoiceFixture(),bytes=await generateAdvertisingInvoicePdf(draft),pdf=await PDFDocument.load(bytes);
 assert.equal(Buffer.from(bytes.slice(0,5)).toString(),'%PDF-');assert.equal(pdf.getTitle(),'Fakturautkast v3 – 2026-09');assert.equal(pdf.getCreationDate().toISOString(),draft.createdAt.replace('Z','.000Z'));
 const text=(await extract(bytes)).replace(/\s+/g,' ');
 for(const expected of ['UTKAST — EJ UTFÄRDAD FAKTURA','Åberg & Söner Bil AB','Trafexa Nordic AB','Fakturagatan 1','Örebro','90 071 992 547 409,93 SEK','90 071 992 547 400,00 SEK','9,93 SEK','Moms: Ej fastställd','Saknas: Momsbedömning',draft.sourceHash,draft.snapshot.basis.reviewToken,id(30),'Uppgiftsversion 2'])assert.ok(text.includes(expected),expected);
 assert.ok(!text.includes('25 %'));assert.ok(!text.includes('Att betala:'));
});
test('missing addresses stay visibly missing and VAT or payable total is never invented; fully reduced rows still count',async()=>{
 const draft=invoiceFixture({incomplete:true,zero:true}),text=(await extract(await generateAdvertisingInvoicePdf(draft))).replace(/\s+/g,' ');
 for(const expected of ['Postadress: Inte angiven','Saknas: Säljare: Postadress','Saknas: Säljare: Landskod','Återstående underlag: 0,00 SEK','Antal unika publiceringar: 2'])assert.ok(text.includes(expected),expected);
});
test('historical draft renders identical bytes repeatedly and later independent live data cannot rewrite saved fields',async()=>{
 const draft=invoiceFixture(),first=await generateAdvertisingInvoicePdf(draft);
 const current=structuredClone(draft.snapshot);current.buyerProfile.fields.addressLine1='CHANGED LIVE ADDRESS';current.basis.netTotalOre='1';
 const second=await generateAdvertisingInvoicePdf(draft);assert.deepEqual(second,first);
 const text=await extract(second);assert.ok(!text.includes(current.buyerProfile.fields.addressLine1));assert.ok(text.includes('Fakturagatan 1'));
});
test('long approved profile text wraps and every page remains marked as unissued',async()=>{
 const draft=invoiceFixture();draft.snapshot.sellerProfile.fields.addressLine1='Adress'.repeat(25);draft.snapshot.buyerProfile.fields.legalName='Öresund'.repeat(20);resignInvoice(draft);
 const bytes=await generateAdvertisingInvoicePdf(draft),pdf=await PDFDocument.load(bytes),text=await extract(bytes);
 assert.ok(pdf.getPageCount()>1);assert.equal((text.match(/UTKAST — EJ UTFÄRDAD FAKTURA/g)||[]).length,pdf.getPageCount());
 assert.ok(text.replace(/\s+/g,'').includes('Öresund'.repeat(20)));
});
test('tampered canonical snapshots, wrong scope, invalid totals or missing original reject rendering before private bytes',async()=>{
 for(const mutate of [d=>d.canonicalSnapshot+=' ',d=>d.companyId=id(99),d=>d.sourceHash='a'.repeat(64),d=>d.snapshot.basis.netTotalOre='1',d=>d.snapshot.basis.original=null,d=>d.version=0,d=>d.createdAt='bad',d=>d.createdAt='2026-09-01T00:00:00Z',d=>d.snapshot.vatStatus='standard',d=>d.providerSecret='DO-NOT-EXPORT']){
  const draft=invoiceFixture();mutate(draft);await assert.rejects(generateAdvertisingInvoicePdf(draft));
 }
 const draft=invoiceFixture();draft.snapshot.buyerProfile.fields.addressLine1='字';resignInvoice(draft);await assert.rejects(generateAdvertisingInvoicePdf(draft));
});
