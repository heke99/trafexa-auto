import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {allocateAdvertisingVatV2} from '../src/lib/advertising/vat-allocation.ts';
import {computeAdvertisingFinancialPreview,computeAdvertisingFinancialPreviewV2} from '../src/lib/advertising/financial-math.ts';
import {financialInvoice,financialFields,id} from './helpers/advertising-financial/fixture.mjs';
import {resignInvoice} from './helpers/advertising-invoices/fixture.mjs';
const rows=amounts=>amounts.map((netOre,index)=>({publicationId:id(index+1),netOre}));
const sum=values=>values.reduce((total,value)=>total+BigInt(value),0n).toString();
test('VAT v2 rounds once on the net base and assigns residual ore by remainder then canonical identity',()=>{
 assert.deepEqual(allocateAdvertisingVatV2(rows(['2','2'])),['1','0']);
 assert.deepEqual(allocateAdvertisingVatV2(rows(['14950','14950'])),['3738','3737']);
 assert.deepEqual(allocateAdvertisingVatV2(rows(['1','3','2','0'])),['0','1','1','0']);
 const tiny=allocateAdvertisingVatV2(rows(Array(100).fill('1')));assert.equal(sum(tiny),'25');assert.equal(tiny.filter(value=>value==='1').length,25);assert.deepEqual(tiny.slice(0,25),Array(25).fill('1'));
});
test('allocation retains input order while ties are stable by UUID under permutations and zero rows never receive ore',()=>{
 const original=rows(['2','0','2','2']),backwards=[...original].reverse();
 const expected=Object.fromEntries(original.map((row,index)=>[row.publicationId,allocateAdvertisingVatV2(original)[index]]));
 const reversed=Object.fromEntries(backwards.map((row,index)=>[row.publicationId,allocateAdvertisingVatV2(backwards)[index]]));assert.deepEqual(reversed,expected);assert.equal(expected[id(2)],'0');
 assert.deepEqual(allocateAdvertisingVatV2([]),[]);assert.deepEqual(allocateAdvertisingVatV2(rows(['0','0'])),['0','0']);
});
test('exact VAT allocation supports large intermediate values and valid totals even where old row rounding would overflow',()=>{
 const amounts=['2','2','2','7378697629483820639'],net=amounts.reduce((s,n)=>s+BigInt(n),0n),tax=allocateAdvertisingVatV2(rows(amounts));
 assert.equal(net.toString(),'7378697629483820645');assert.equal((net+BigInt(sum(tax))).toString(),'9223372036854775806');assert.ok(net+amounts.reduce((s,n)=>s+(BigInt(n)*25n+50n)/100n,0n)>9223372036854775807n);
 assert.equal(sum(allocateAdvertisingVatV2(rows(['9007199254740993','2']))),'2251799813685249');
 assert.throws(()=>allocateAdvertisingVatV2(rows(['7378697629483820646'])));assert.throws(()=>allocateAdvertisingVatV2(rows(['9223372036854775807','1'])));
});
test('invalid allocation source identities, duplicate UUIDs, count and noncanonical monetary values fail closed',()=>{
 for(const invalid of [[{publicationId:'bad',netOre:'1'}],[...rows(['1']),...rows(['2'])],rows(['-1']),rows(['01']),rows(['1.1']),rows(['9223372036854775808']),rows(Array(2001).fill('0'))])assert.throws(()=>allocateAdvertisingVatV2(invalid));
});
test('new financial preview reconciles total VAT without changing the legacy method or frozen original',()=>{
 const draft=financialInvoice(['14950','14950']),original=JSON.stringify(draft),old=computeAdvertisingFinancialPreview(draft,financialFields()),next=computeAdvertisingFinancialPreviewV2(draft,financialFields());
 assert.equal(old.vatTotalOre,'7476');assert.equal(next.vatTotalOre,'7475');assert.equal(next.grossTotalOre,'37375');assert.equal(sum(next.lines.map(line=>line.vatOre)),next.vatTotalOre);assert.equal(JSON.stringify(draft),original);assert.equal(computeAdvertisingFinancialPreview(draft,financialFields()).vatTotalOre,'7476');
 for(const fields of [{...financialFields(),vatTreatment:'unresolved'},{...financialFields(),sellerVatRegistered:null}]){const result=computeAdvertisingFinancialPreviewV2(draft,fields);assert.equal(result.vatTotalOre,null);assert.equal(result.grossTotalOre,null);assert.ok(result.lines.every(line=>line.vatOre===null));}
});
test('reviewed reductions are applied before total VAT and a fully reduced row cannot receive rounding ore',()=>{
 const draft=financialInvoice(['3','2']),basis=draft.snapshot.basis;basis.adjustments=[{id:id(99),publicationId:basis.original.items[0].publicationId,amountOre:'3',reason:'Granskad nedsättning',createdAt:'2026-10-15T08:00:00Z',createdBy:'Superadmin'}];basis.reductionTotalOre='3';basis.netTotalOre='2';const proof=JSON.parse(basis.canonicalSnapshot);proof.adjustments=basis.adjustments;proof.reductionTotalOre='3';proof.netTotalOre='2';basis.canonicalSnapshot=JSON.stringify(proof);basis.reviewToken=createHash('sha256').update(basis.canonicalSnapshot).digest('hex');resignInvoice(draft);
 const result=computeAdvertisingFinancialPreviewV2(draft,financialFields());assert.deepEqual(result.lines.map(line=>[line.netOre,line.vatOre]),[['0','0'],['2','1']]);assert.equal(result.grossTotalOre,'3');
});
