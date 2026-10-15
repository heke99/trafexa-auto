import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {generateAdvertisingFinancialPdf} from '../src/lib/documents/advertising-financial-pdf.ts';
import {generateAdvertisingIssuedInvoicePdf} from '../src/lib/documents/advertising-issued-invoice-pdf.ts';
import {financialAssessment,financialAssessmentV2,resignFinancial} from './helpers/advertising-financial/fixture.mjs';
import {issuedInvoiceFixture,issuedInvoiceFixtureV2} from './helpers/advertising-issuance/fixture.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function extract(bytes){const directory=await mkdtemp(join(tmpdir(),'trafexa-vat-pdf-'));try{const path=join(directory,'invoice.pdf');await writeFile(path,bytes);const result=spawnSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.replace(/\s+/g,' ');}finally{await rm(directory,{recursive:true,force:true});}}
test('both historical V1 PDF renderers preserve exact pre-change golden bytes',async()=>{
 assert.equal(digest(await generateAdvertisingFinancialPdf(financialAssessment())),'d7bf338a2701f4955f87497e151cb12e695e7289fde26f84686a93117308b0bf');
 assert.equal(digest(await generateAdvertisingIssuedInvoicePdf(issuedInvoiceFixture())),'8c978c71a4e4f9e4c96453bb8720766213ed8a458f81aecd662cd9ec1f5e7562');
});
test('V2 reviewed PDF shows tax-base rounding and exact allocated rows without rewriting its frozen source',async()=>{
 const value=await financialAssessmentV2(),source=JSON.stringify(value),bytes=await generateAdvertisingFinancialPdf(value),text=await extract(bytes);
 for(const expected of ['Moms 25 %: 74,75 SEK','Summa inklusive moms: 373,75 SEK','Moms beräknas på hela nettobeloppet','37,38 SEK','37,37 SEK','Beräkningsversion: 2','EJ UTFÄRDAD FAKTURA'])assert.ok(text.includes(expected),expected);
 assert.equal(JSON.stringify(value),source);assert.deepEqual(await generateAdvertisingFinancialPdf(value),bytes);
});
test('V2 actual issued PDF accepts the formerly mismatched two-row assessment and retains exact payable total',async()=>{
 const value=await issuedInvoiceFixtureV2(),bytes=await generateAdvertisingIssuedInvoicePdf(value),text=await extract(bytes);for(const expected of ['Att betala: 373,75 SEK','Moms 25 %: 74,75 SEK','Moms beräknas på hela nettobeloppet','37,38 SEK','37,37 SEK'])assert.ok(text.includes(expected),expected);assert.ok(!text.includes('EJ UTFÄRDAD'));assert.deepEqual(await generateAdvertisingIssuedInvoicePdf(value),bytes);
});
test('unknown calculation versions or wrong same-sum row allocation cannot pass a rehashed V2 financial proof',async()=>{
 for(const version of [0,3,'2']){const value=await financialAssessmentV2();value.snapshot.calculationVersion=version;resignFinancial(value);await assert.rejects(generateAdvertisingFinancialPdf(value));}
 const value=await financialAssessmentV2();[value.snapshot.lines[0].vatOre,value.snapshot.lines[1].vatOre]=[value.snapshot.lines[1].vatOre,value.snapshot.lines[0].vatOre];for(const line of value.snapshot.lines)line.grossOre=(BigInt(line.netOre)+BigInt(line.vatOre)).toString();resignFinancial(value);await assert.rejects(generateAdvertisingFinancialPdf(value));
});
