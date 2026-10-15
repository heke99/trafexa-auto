import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {PDFDocument} from 'pdf-lib';
import {generateAdvertisingFinancialPdf} from '../src/lib/documents/advertising-financial-pdf.ts';
import {financialAssessment,resignFinancial,id} from './helpers/advertising-financial/fixture.mjs';
async function extract(bytes){const directory=await mkdtemp(join(tmpdir(),'trafexa-financial-pdf-'));try{const path=join(directory,'assessment.pdf');await writeFile(path,bytes);const result=spawnSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout;}finally{await rm(directory,{recursive:true,force:true});}}
test('reviewed PDF shows exact row-rounded VAT, frozen payment settings and unissued status on every page',async()=>{
 const value=financialAssessment(),bytes=await generateAdvertisingFinancialPdf(value),pdf=await PDFDocument.load(bytes),text=(await extract(bytes)).replace(/\s+/g,' ');
 assert.equal(pdf.getTitle(),'Granskat fakturaunderlag v1 – 2026-09');assert.equal(pdf.getCreationDate().toISOString(),'2026-10-15T09:02:00.000Z');
 for(const expected of ['Summa exklusive moms: 0,04 SEK','Moms 25 %: 0,02 SEK','Summa inklusive moms: 0,06 SEK','Bankgiro: 9912346','30 dagar från fakturadatum','SE556855488401','Åberg & Söner Bil AB',value.sourceHash,value.snapshot.draft.sourceHash])assert.ok(text.includes(expected),expected);
 assert.equal((text.match(/GRANSKAT UTKAST — EJ UTFÄRDAD FAKTURA/g)||[]).length,pdf.getPageCount());assert.ok(!text.includes('Att betala:'));
});
test('reviewed historical PDF is byte-stable and independent of later mutable financial settings',async()=>{
 const value=financialAssessment(),first=await generateAdvertisingFinancialPdf(value),live=structuredClone(value.snapshot.settings);live.fields.paymentAccount='55555551';live.fields.reason='LATER LIVE CHANGE';
 assert.deepEqual(await generateAdvertisingFinancialPdf(value),first);assert.ok(!(await extract(first)).includes('LATER LIVE CHANGE'));
});
test('reviewed PDF preserves money beyond JavaScript safe integer precision',async()=>{
 const value=financialAssessment(['9007199254740993','2']),text=(await extract(await generateAdvertisingFinancialPdf(value))).replace(/\s+/g,' ');
 assert.ok(text.includes('90 071 992 547 409,95 SEK'));assert.ok(text.includes('22 517 998 136 852,49 SEK'));assert.ok(text.includes('112 589 990 684 262,44 SEK'));
});
test('tampered totals, source, time, scope, settings or extra fields reject before private PDF rendering',async()=>{
 for(const mutate of [a=>a.sourceHash='a'.repeat(64),a=>a.companyId=id(99),a=>a.createdAt='2026-10-15T08:00:00Z',a=>a.snapshot.vatTotalOre='1',a=>a.snapshot.settings.fields.paymentAccount='9912347',a=>a.snapshot.lines[0].grossOre='99',a=>a.providerSecret='DO-NOT-EXPORT']){
  const value=financialAssessment();mutate(value);await assert.rejects(generateAdvertisingFinancialPdf(value));
 }
 const value=financialAssessment();value.snapshot.vatTotalOre='1';resignFinancial(value);await assert.rejects(generateAdvertisingFinancialPdf(value));
});
