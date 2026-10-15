import assert from 'node:assert/strict';
import {test} from 'node:test';
import {computeAdvertisingFinancialPreview,isValidFinancialPaymentAccount} from '../src/lib/advertising/financial-math.ts';
import {invoiceFixture,resignInvoice} from './helpers/advertising-invoices/fixture.mjs';
import {financialFields,financialInvoice} from './helpers/advertising-financial/fixture.mjs';

test('VAT rounds half up per remaining publication, then sums, rather than rounding aggregate VAT',()=>{
 const p=computeAdvertisingFinancialPreview(financialInvoice(),financialFields());
 assert.equal(p.netTotalOre,'4');assert.equal(p.vatTotalOre,'2');assert.equal(p.grossTotalOre,'6');
 assert.deepEqual(p.lines.map(row=>[row.netOre,row.vatOre,row.grossOre]),[['2','1','3'],['2','1','3']]);assert.deepEqual(p.blockers,[]);
 const small=computeAdvertisingFinancialPreview(financialInvoice(['1','1']),financialFields());assert.equal(small.vatTotalOre,'0');assert.equal(small.grossTotalOre,'2');
});
test('reviewed reductions affect the net before VAT and large öre stay exact above JS safe integers',()=>{
 const p=computeAdvertisingFinancialPreview(invoiceFixture(),financialFields());
 assert.equal(p.lines[0].originalOre,'9007199254740993');assert.equal(p.lines[0].reductionOre,'993');assert.equal(p.netTotalOre,'9007199254740000');assert.equal(p.vatTotalOre,'2251799813685000');assert.equal(p.grossTotalOre,'11258999068425000');
});
test('unresolved or unconfirmed tax inputs remain unknown even for a fully reduced zero net',()=>{
 for(const patch of[{vatTreatment:'unresolved'},{sellerVatRegistered:null},{sellerVatRegistered:false},{sellerVatNumber:null},{sellerVatNumber:'SE556000000101'}]){
  const p=computeAdvertisingFinancialPreview(invoiceFixture({zero:true}),{...financialFields(),...patch});assert.equal(p.netTotalOre,'0');assert.equal(p.vatTotalOre,null);assert.equal(p.grossTotalOre,null);assert.ok(p.blockers.length>0);
 }
 const valid=computeAdvertisingFinancialPreview(invoiceFixture({zero:true}),financialFields());assert.equal(valid.vatTotalOre,'0');assert.equal(valid.grossTotalOre,'0');assert.equal(valid.lines.length,2);
});
test('foreign or missing profile countries cannot silently inherit domestic tax treatment',()=>{
 for(const country of['DE',null]){const draft=invoiceFixture();draft.snapshot.buyerProfile.fields.countryCode=country;draft.snapshot.buyerProfile.missingFields=country===null?['countryCode']:[];draft.snapshot.missingFields=country===null?['buyer.countryCode','vatTreatment']:['vatTreatment'];resignInvoice(draft);const p=computeAdvertisingFinancialPreview(draft,financialFields());assert.equal(p.vatTotalOre,null);assert.ok(p.blockers.includes('vat.domesticCountry'));}
});
test('incomplete addresses and payment decisions prevent a complete assessment without fabricating values',()=>{
 const p=computeAdvertisingFinancialPreview(invoiceFixture({incomplete:true}),{...financialFields(),paymentDays:null,paymentMethod:'unresolved',paymentAccount:null,reason:null});
 for(const code of['seller.addressLine1','seller.postalCode','seller.city','seller.countryCode','vat.domesticCountry','paymentDays','paymentMethod','settings.reason'])assert.ok(p.blockers.includes(code),code);
 assert.equal(p.vatTotalOre,null);assert.equal(p.grossTotalOre,null);
 const account=computeAdvertisingFinancialPreview(financialInvoice(),{...financialFields(),paymentAccount:'1234567'});assert.ok(account.blockers.includes('paymentAccount'));
});
test('aggregate and per-line gross overflow fail closed, while maximum safe gross is preserved exactly',()=>{
 const p=computeAdvertisingFinancialPreview(financialInvoice(['7378697629483820645','0']),financialFields());assert.equal(p.grossTotalOre,'9223372036854775806');
 for(const amounts of[['7378697629483820646','0'],['4000000000000000000','4000000000000000000']])assert.throws(()=>computeAdvertisingFinancialPreview(financialInvoice(amounts),financialFields()));
 for(const fields of[{...financialFields(),paymentDays:0},{...financialFields(),paymentDays:91},{...financialFields(),paymentDays:1.5},{...financialFields(),vatTreatment:'zero'},{...financialFields(),sellerVatRegistered:'true'}])assert.throws(()=>computeAdvertisingFinancialPreview(financialInvoice(),fields));
});
test('official BG/PG vectors use account checksums and Swedish IBAN checks MOD97 without accepting unreviewed formatting',()=>{
 for(const method of['bankgiro','plusgiro'])for(const account of['9912346','55555551'])assert.equal(isValidFinancialPaymentAccount(method,account),true);
 assert.equal(isValidFinancialPaymentAccount('iban','SE4550000000058398257466'),true);
 for(const[method,account]of[['bankgiro','9912347'],['bankgiro','991-2346'],['bankgiro','0000000'],['plusgiro','000'],['plusgiro','1'],['iban','SE4550000000058398257467'],['iban','SE45 5000 0000 0583 9825 7466'],['iban','DE89370400440532013000'],['unresolved','9912346']])assert.equal(isValidFinancialPaymentAccount(method,account),false,`${method}:${account}`);
});
