import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { generateSignedContractArtifacts, generateSignedContractPdf, generateSigningEvidence, parseCompletedContract, sha256 } from '../src/lib/documents/signed-contract-pdf.ts';
const id = n => `ce290000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture() {
  const sourceOffer = { schema_version:1,document_type:'offer',version:3,deal_id:id(3),issued_at:'2026-10-13T14:00:00Z',valid_until:'2026-11-12',terms:'ORIGINALVILLKOR: Betalning före leverans.\nÖverenskommelse om vinterdäck.',currency:'SEK',price_basis:'gross',sale_price_ore:'19900029',
    company:{id:id(2),name:'Åberg & Söner Bil AB',organisation_number:'5560000001'},customer:{id:id(4),kind:'person',name:'Zoë Öström',email:'zoe@example.invalid',phone:'+46 70 123 45 67',address:'Ängsvägen 1\nÖrebro'},stock:{id:id(5),vat_scheme:'standard'},
    vehicle:{id:id(6),registration_number:'ABC123',vin:'TESTVIN123',make:'Škoda',model:'Öresund Åäö',model_year:2022,mileage_km:50123,fuel:'hybrid',gearbox:'automatic'},vat:{rate_percent:25,amount_ore:'3980006',net_price_ore:'15920023'},
    trade_in:{id:id(7),version:2,registration:'INB123',make:'Volvo',model:'V60',model_year:2020,mileage_km:12345,value_ore:'10000029',debt_known:true,debt_ore:'2500001',net_trade_in_ore:'7500028',amount_to_pay_ore:'12400001'} };
  return {id:id(1),companyId:id(2),dealId:id(3),version:2,offerId:id(8),offerVersion:3,
    template:{id:id(9),templateId:id(10),version:4,approvalVersion:2,title:'Bilköpsmall Åäö',body:'Säljare {{company.name}} ({{company.organisation_number}}).\nKund {{customer.name}} / {{customer.email}}.\nFordon {{vehicle.registration}} {{vehicle.make}} {{vehicle.model}} årsmodell {{vehicle.model_year}}.\nOffert v{{offer.version}}: {{offer.price_ore}}. Inbyte {{trade_in.value_ore}}, belopp {{trade_in.amount_to_pay_ore}}.'},sourceOffer,createdAt:'2026-10-14T17:00:00Z',actorLabel:'Kollega'};
}

function signed() {
 const draft=fixture(),canonicalContent=JSON.stringify({draftId:draft.id,companyId:draft.companyId,dealId:draft.dealId,draftVersion:draft.version,content:{offerVersion:draft.offerVersion,template:draft.template,sourceOffer:draft.sourceOffer}}), documentHash=sha256(canonicalContent);
 const receipt=party=>({party,fullName:party==='customer'?'Zoë Öström':'Åke Åberg',signedAt:party==='customer'?'2026-10-14T17:02:00Z':'2026-10-14T17:03:00Z',documentHash,consentVersion:'2026-10-14',strokes:[{points:[{x:0,y:0},{x:20,y:30},{x:40,y:0},{x:60,y:30}]}]});
 return {id:id(20),companyId:draft.companyId,dealId:draft.dealId,draftId:draft.id,draftVersion:draft.version,documentHash,canonicalContent,draft,status:'completed',revision:3,createdAt:'2026-10-14T17:01:00Z',completedAt:'2026-10-14T17:03:00Z',customerSignature:receipt('customer'),companySignature:receipt('company')};
}
test('completed two-party contract renders deterministic PDF and matching separate evidence checksum',async()=>{
 const s=signed(),bytes=await generateSignedContractPdf(s),pdf=await PDFDocument.load(bytes),evidence=await generateSigningEvidence(s);
 assert.equal(pdf.getTitle(),'SIGNERAT AVTAL – v2 – ABC123');assert.deepEqual(await generateSignedContractPdf(s),bytes);
 assert.equal(evidence.signedPdfSha256,sha256(bytes));assert.equal(evidence.documentContentSha256,s.documentHash);assert.equal(evidence.receipts.length,2);
 assert.ok(!JSON.stringify(evidence).includes('strokes'));assert.ok(evidence.assurance.includes('no BankID'));
});
test('one artifact pair hashes its exact PDF byte buffer and preserves evidence schema one',async()=>{
 const s=signed(),pair=await generateSignedContractArtifacts(s),evidence=JSON.parse(new TextDecoder().decode(pair.evidence));
 assert.equal(evidence.signedPdfSha256,sha256(pair.pdf));assert.equal(evidence.schemaVersion,1);assert.equal(evidence.signingId,s.id);
 assert.deepEqual(Object.keys(evidence).sort(),['schemaVersion','method','signingId','draftId','draftVersion','documentContentSha256','signedPdfSha256','completedAt','receipts','assurance'].sort());
 assert.equal(JSON.stringify(evidence).includes('strokes'),false);
});
test('pending, missing-party, mismatched-hash and substituted source contract fail before generating signed file',async()=>{
 for(const mutate of [s=>s.status='pending',s=>s.customerSignature=null,s=>s.companySignature.party='customer',s=>s.customerSignature.documentHash='0'.repeat(64),s=>s.documentHash='0'.repeat(64),s=>s.draft.template.body='Ändrad mall',s=>s.draftId=id(30),s=>s.draft.sourceOffer.customer.name='Annan kund']){
  const s=signed();mutate(s);assert.throws(()=>parseCompletedContract(s));await assert.rejects(generateSignedContractPdf(s));
 }
});
test('invalid receipt time, empty or unbounded strokes and control characters are refused',()=>{
 for(const mutate of [s=>s.completedAt='2026-10-14T17:02:00Z',s=>s.customerSignature.signedAt='2026-10-14T16:00:00Z',s=>s.customerSignature.strokes=[],s=>s.customerSignature.strokes=[{points:[{x:0,y:0},{x:0,y:0},{x:0,y:0}]}],s=>s.customerSignature.strokes[0].points[1].x=1000001,s=>s.customerSignature.fullName='Mall\nnamn']){const s=signed();mutate(s);assert.throws(()=>parseCompletedContract(s));}
});
test('canonical SQL JSON whitespace/key order is hashed exactly and compared structurally',()=>{
 const s=signed(),v=JSON.parse(s.canonicalContent);s.canonicalContent=JSON.stringify({content:v.content,draftVersion:v.draftVersion,dealId:v.dealId,companyId:v.companyId,draftId:v.draftId},null,2);s.documentHash=sha256(s.canonicalContent);s.customerSignature.documentHash=s.documentHash;s.companySignature.documentHash=s.documentHash;assert.equal(parseCompletedContract(s).documentHash,s.documentHash);
});
