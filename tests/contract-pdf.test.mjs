import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { generateContractPdf, parseContractDraft, renderContractTemplate } from '../src/lib/documents/contract-pdf.ts';

const id = n => `ce290000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture() {
  const sourceOffer = { schema_version:1,document_type:'offer',version:3,deal_id:id(3),issued_at:'2026-10-13T14:00:00Z',valid_until:'2026-11-12',terms:'ORIGINALVILLKOR: Betalning före leverans.\nÖverenskommelse om vinterdäck.',currency:'SEK',price_basis:'gross',sale_price_ore:'19900029',
    company:{id:id(2),name:'Åberg & Söner Bil AB',organisation_number:'5560000001'},customer:{id:id(4),kind:'person',name:'Zoë Öström',email:'zoe@example.invalid',phone:'+46 70 123 45 67',address:'Ängsvägen 1\nÖrebro'},stock:{id:id(5),vat_scheme:'standard'},
    vehicle:{id:id(6),registration_number:'ABC123',vin:'TESTVIN123',make:'Škoda',model:'Öresund Åäö',model_year:2022,mileage_km:50123,fuel:'hybrid',gearbox:'automatic'},vat:{rate_percent:25,amount_ore:'3980006',net_price_ore:'15920023'},
    trade_in:{id:id(7),version:2,registration:'INB123',make:'Volvo',model:'V60',model_year:2020,mileage_km:12345,value_ore:'10000029',debt_known:true,debt_ore:'2500001',net_trade_in_ore:'7500028',amount_to_pay_ore:'12400001'} };
  return {id:id(1),companyId:id(2),dealId:id(3),version:2,offerId:id(8),offerVersion:3,
    template:{id:id(9),templateId:id(10),version:4,approvalVersion:2,title:'Bilköpsmall Åäö',body:'Säljare {{company.name}} ({{company.organisation_number}}).\nKund {{customer.name}} / {{customer.email}}.\nFordon {{vehicle.registration}} {{vehicle.make}} {{vehicle.model}} årsmodell {{vehicle.model_year}}.\nOffert v{{offer.version}}: {{offer.price_ore}}. Inbyte {{trade_in.value_ore}}, belopp {{trade_in.amount_to_pay_ore}}.'},sourceOffer,createdAt:'2026-10-14T17:00:00Z',actorLabel:'Kollega'};
}
async function extract(bytes, context) {
  const directory=await mkdtemp(join(tmpdir(),'trafexa-contract-pdf-'));
  try {const path=join(directory,'draft.pdf');await writeFile(path,bytes);const result=spawnSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});if(result.error?.code==='ENOENT'){context.skip('PDF extraction requires pdftotext');return '';}assert.equal(result.status,0,result.stderr);return result.stdout;}
  finally{await rm(directory,{recursive:true,force:true});}
}
test('actual contract PDF is unsigned and renders saved Swedish parties, vehicle, approved template and original terms',async context=>{
  const draft=fixture(),bytes=await generateContractPdf(draft),pdf=await PDFDocument.load(bytes);
  assert.equal(Buffer.from(bytes.slice(0,5)).toString(),'%PDF-');assert.equal(pdf.getTitle(),'AVTALSUTKAST – OSIGNERAT – v2 – ABC123');assert.equal(pdf.getCreationDate().toISOString(),'2026-10-14T17:00:00.000Z');
  const text=(await extract(bytes,context)).replace(/\s+/g,' ');if(!text)return;
  for(const value of ['AVTALSUTKAST','OSIGNERAT','Åberg & Söner Bil AB','Zoë Öström','Ängsvägen 1','Örebro','Škoda Öresund Åäö','ABC123','Bilköpsmall Åäö','Version 4','accepterad offertversion 3','ORIGINALVILLKOR: Betalning före leverans.','Överenskommelse om vinterdäck.','39 800,06 SEK','159 200,23 SEK','199 000,29 SEK','100 000,29 SEK','25 000,01 SEK','75 000,28 SEK','124 000,01 SEK','bekräftar ingen genomförd signering, betalning, leverans eller finansiering'])assert.ok(text.includes(value),value);
  assert.ok(!text.includes('{{company.name}}'));assert.ok(!text.includes(draft.id));
});
test('finite template replacements are single-pass literal plaintext and missing optional values never become zero',()=>{
  const offer=fixture().sourceOffer;offer.customer.name='{{vehicle.make}} $& <script>literal</script>';offer.customer.email=null;delete offer.trade_in;
  assert.equal(renderContractTemplate('{{customer.name}} / {{customer.email}} / {{trade_in.value_ore}} / {{trade_in.amount_to_pay_ore}}',offer),'{{vehicle.make}} $& <script>literal</script> / Ingen uppgift / Inget inbyte / Inget inbyte');
  for(const body of ['{{constructor}}','{{company.name }}','{{ company.name}}','{{company.name}','{{company.name}}}}','{{{{company.name}}}}','{{company.name.toUpperCase()}}','{{}}','{company.name}'])assert.throws(()=>renderContractTemplate(body,offer));
});
test('known zero debt, signed payment and 13-digit payment remain exact while unknown attached debt is refused',async context=>{
  const draft=fixture();Object.assign(draft.sourceOffer.trade_in,{value_ore:'19900030',debt_ore:'0',net_trade_in_ore:'19900030',amount_to_pay_ore:'-1'});
  let text=(await extract(await generateContractPdf(draft),context)).replace(/\s+/g,' ');if(!text)return;assert.ok(text.includes('Bekräftad skuld: 0,00 SEK'));assert.ok(text.includes('-0,01 SEK'));assert.ok(text.includes('överskott till kunden'));
  Object.assign(draft.sourceOffer.trade_in,{value_ore:'1',debt_ore:'999999999999',net_trade_in_ore:'-999999999998',amount_to_pay_ore:'1999999999997'});draft.sourceOffer.sale_price_ore='999999999999';draft.sourceOffer.vat={rate_percent:25,amount_ore:'200000000000',net_price_ore:'799999999999'};
  text=(await extract(await generateContractPdf(draft),context)).replace(/\s+/g,' ');assert.ok(text.includes('19 999 999 999,97 SEK'));
  draft.sourceOffer.trade_in.debt_known=false;draft.sourceOffer.trade_in.debt_ore=null;await assert.rejects(generateContractPdf(draft));
});
test('legacy offer without trade-in preserves original terms even when the template omits them and VAT is not fabricated',async context=>{
  for(const scheme of ['vmb','unknown']){const draft=fixture();delete draft.sourceOffer.trade_in;draft.sourceOffer.stock.vat_scheme=scheme;draft.sourceOffer.vat={rate_percent:null,amount_ore:null,net_price_ore:null};draft.template.body='Kort mall utan originalvillkor.';
    const text=(await extract(await generateContractPdf(draft),context)).replace(/\s+/g,' ');if(!text)return;assert.ok(text.includes('ORIGINALVILLKOR:'));assert.ok(text.includes('Moms redovisas inte separat'));assert.ok(!text.includes('Pris exklusive moms'));assert.ok(!text.includes('Inbytesvärde:'));}
});
test('later live source/template changes do not change saved bytes and extra internal Auth/provider metadata never prints',async context=>{
  const draft=fixture(),before=await generateContractPdf(draft),current=structuredClone(draft);current.template.body='Ändrad levande mall';current.sourceOffer.customer.name='Senare kund';assert.deepEqual(await generateContractPdf(draft),before);
  const secret=id(11),injected={...draft,createdBy:secret,providerSigningUrl:'https://private.invalid/token',providerState:'completed',lenderName:'PRIVATE_LENDER 漢字'};injected.sourceOffer.trade_in.condition_notes='INTERNAL_CONDITION 漢字';injected.sourceOffer.trade_in.created_by=secret;
  const parsed=parseContractDraft(injected);assert.equal(parsed.createdBy,undefined);assert.equal(parsed.sourceOffer.trade_in.condition_notes,undefined);
  const text=await extract(await generateContractPdf(injected),context);if(!text)return;for(const value of [secret,'private.invalid','PRIVATE_LENDER','INTERNAL_CONDITION',draft.template.id,draft.offerId])assert.ok(!text.includes(value),value);
});
test('long approved plaintext tokens and original terms wrap across pages without losing Swedish glyphs',async context=>{
  const draft=fixture();draft.template.body='Å'.repeat(11000)+'\nMALLSLUT Ö';draft.sourceOffer.terms='Ä'.repeat(1800)+'\nORIGINALSLUT';
  const bytes=await generateContractPdf(draft),pdf=await PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>3);const text=await extract(bytes,context);if(!text)return;assert.ok(text.includes('MALLSLUT Ö'));assert.ok(text.includes('ORIGINALSLUT'));assert.equal((text.match(/Å/g)??[]).length,11003);assert.ok(text.includes(`${pdf.getPageCount()}/${pdf.getPageCount()}`));
});
test('mismatched source bindings, unapproved template version, unsafe amounts and malformed tokens fail closed',async()=>{
  for(const mutate of [v=>{v.companyId=id(11);},v=>{v.dealId=id(11);},v=>{v.offerVersion=4;},v=>{v.template.approvalVersion=0;},v=>{v.template.body='{{unknown}}';},v=>{v.template.body='x'.repeat(12001);},v=>{v.sourceOffer.sale_price_ore=19900029;},v=>{v.sourceOffer.vat.amount_ore='3980005';}]){const draft=fixture();mutate(draft);await assert.rejects(generateContractPdf(draft));}
  const draft=fixture();draft.template.title='漢字';await assert.rejects(generateContractPdf(draft),/tecken.*inte stöder/);
});
