import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {PDFDocument} from 'pdf-lib';
import {generateAdvertisingCreditInvoicePdf} from '../src/lib/documents/advertising-credit-invoice-pdf.ts';
import {generateAdvertisingIssuedInvoicePdf} from '../src/lib/documents/advertising-issued-invoice-pdf.ts';
import {creditInvoiceFixture,creditInvoiceFixtureV2,resignCredit,id} from './helpers/advertising-credit/fixture.mjs';

async function extract(bytes){
 const directory=await mkdtemp(join(tmpdir(),'trafexa-credit-pdf-'));
 try{const path=join(directory,'credit.pdf');await writeFile(path,bytes);const result=spawnSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.replace(/\s+/g,' ');}
 finally{await rm(directory,{recursive:true,force:true});}
}
test('credit PDF unambiguously references original and shows exact negative tax change without payment demand',async()=>{
 const credit=creditInvoiceFixture(),original=credit.snapshot.originalInvoice,bytes=await generateAdvertisingCreditInvoicePdf(credit),pdf=await PDFDocument.load(bytes),text=await extract(bytes);
 assert.equal(pdf.getTitle(),`Kreditfaktura ${credit.creditNumber}`);
 assert.equal(pdf.getCreationDate().toISOString(),new Date(credit.createdAt).toISOString());
 for(const expected of [`Kreditfakturanummer: ${credit.creditNumber}`,`Kreditfakturadatum: ${credit.creditDate}`,`Avser faktura: ${original.invoiceNumber}`,`Fakturadatum: ${original.invoiceDate}`,credit.snapshot.reason,'Krediteras exklusive moms: -0,08 SEK','Krediterad moms 25 %: -0,02 SEK','Krediteras inklusive moms: -0,10 SEK','Trafexa Nordic AB','Åberg & Söner Bil AB',original.id,original.sourceHash,credit.sourceHash,'Ingen ny momsberäkning görs.'])assert.ok(text.includes(expected),expected);
 for(const forbidden of ['Att betala:','Förfallodatum:','Bankgiro:','Betalningsvillkor:','Ange fakturanummer'])assert.ok(!text.includes(forbidden),forbidden);
 assert.ok(text.includes('Originalets enhetspris exkl. moms: 0,04 SEK'));
 assert.equal((text.match(new RegExp(`KREDITFAKTURA ${credit.creditNumber}`,'g'))||[]).length,pdf.getPageCount());
});
test('credit renderer preserves frozen original bytes and deterministic credit after later independent profile changes',async()=>{
 const credit=creditInvoiceFixture(),original=credit.snapshot.originalInvoice,originalBefore=await generateAdvertisingIssuedInvoicePdf(original),creditBefore=await generateAdvertisingCreditInvoicePdf(credit);
 const later=structuredClone(original.snapshot.assessment);later.snapshot.draft.snapshot.buyerProfile.fields.addressLine1='NEW LIVE ADDRESS';later.snapshot.settings.fields.paymentAccount='55555551';
 assert.deepEqual(await generateAdvertisingCreditInvoicePdf(credit),creditBefore);
 assert.deepEqual(await generateAdvertisingIssuedInvoicePdf(original),originalBefore);
 assert.ok(!(await extract(creditBefore)).includes('NEW LIVE ADDRESS'));
});
test('credit PDF preserves V2 allocation and monetary precision beyond Number safe integer',async()=>{
 const credit=await creditInvoiceFixtureV2(['9007199254740993','2']),text=await extract(await generateAdvertisingCreditInvoicePdf(credit));
 assert.ok(text.includes('Krediteras exklusive moms: -90 071 992 547 409,95 SEK'));
 assert.ok(text.includes('Krediterad moms 25 %: -22 517 998 136 852,49 SEK'));
 assert.ok(text.includes('Krediteras inklusive moms: -112 589 990 684 262,44 SEK'));
 const small=await creditInvoiceFixtureV2(['2','2']),smallText=await extract(await generateAdvertisingCreditInvoicePdf(small));
 assert.ok(smallText.includes('Krediterad moms 25 %: -0,01 SEK'));
 assert.ok(smallText.includes('Krediteras inklusive moms: -0,05 SEK'));
 assert.ok(!smallText.includes('-0,00 SEK'));
});
test('rehashed but inconsistent credit direction, original link, totals, source, dates or unsupported reason cannot render',async()=>{
 for(const mutate of [c=>c.companyId=id(999),c=>c.originalInvoiceId=id(999),c=>c.snapshot.direction='invoice',c=>c.snapshot.documentType='partial_credit',c=>c.snapshot.creditNumber='FIXTURE-2026-999999',c=>c.snapshot.creditDate='2026-10-14',c=>c.snapshot.netTotalOre='1',c=>c.snapshot.lines[0].vatOre='2',c=>c.snapshot.reason='字',c=>c.snapshot.rendererVersion=2,c=>c.snapshot.originalInvoice.sourceHash='a'.repeat(64),c=>c.snapshot.providerSecret='PRIVATE']){
  const credit=creditInvoiceFixture();mutate(credit);resignCredit(credit);await assert.rejects(generateAdvertisingCreditInvoicePdf(credit));
 }
 const credit=creditInvoiceFixture();credit.providerSecret='PRIVATE';await assert.rejects(generateAdvertisingCreditInvoicePdf(credit));
});
