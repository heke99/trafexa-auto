import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {generateAdvertisingCorrectionsCsv} from '../src/lib/advertising/correction-csv.ts';
import {correctionFixture,id} from './helpers/advertising-corrections/fixture.mjs';

test('corrected CSV exports exact original/reduction/net and original count without changing the locked original',()=>{
  const page=correctionFixture(),original=JSON.stringify(page.original),csv=generateAdvertisingCorrectionsCsv(page);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"9007199254740993";"993";"9007199254740000"'));
  assert.ok(csv.includes('"Wayke";"2026-09-13T09:00:00Z";"1";"0";"0";"0"'));
  for(const text of [page.original.id,page.original.reviewToken,page.reviewToken,page.adjustments[0].id,'Överenskommen prisnedsättning','ingen faktura eller kreditfaktura','Del av perioden'])assert.ok(csv.includes(text),text);
  assert.equal(JSON.stringify(page.original),original);
});
test('fully reduced original remains a counted publication with explicit zero net; no reductions is a valid separate basis',()=>{
  const fully=correctionFixture({amount:'9007199254740993'}),csv=generateAdvertisingCorrectionsCsv(fully);
  assert.ok(csv.includes('"Totalt";"";"";"";"2";"9007199254740993";"9007199254740993";"0"'));
  assert.ok(generateAdvertisingCorrectionsCsv(correctionFixture({empty:true})).includes('"9007199254740993";"0";"9007199254740993"'));
});
test('human-entered reasons are quoted and spreadsheet formula prefixes are neutralized',()=>{
  for(const prefix of ['=','+','-','@']){
    const csv=generateAdvertisingCorrectionsCsv(correctionFixture({reason:prefix+'SUM("A1")'}));
    assert.ok(csv.includes(`"'${prefix}SUM(""A1"")"`));
  }
});
test('corrected export fails closed for forged source, scope, amounts, publication identity and author disclosure',()=>{
  for(const mutate of [p=>p.original=null,p=>p.original.totalOre='1',p=>p.canonicalSnapshot+=' ',p=>p.netTotalOre='1',
    p=>p.adjustments[0].publicationId=id(55),p=>p.adjustments[0].amountOre='9007199254740994',p=>p.adjustments[0].createdBy=id(88),
    p=>p.actorRole='sales',p=>p.actorUserId='bad',p=>p.companyId='=FORMULA()']){
    const p=correctionFixture();mutate(p);assert.throws(()=>generateAdvertisingCorrectionsCsv(p));
  }
  // A self-consistent ledger hash still cannot authorize reduction of an absent original publication.
  const p=correctionFixture();p.adjustments[0].publicationId=id(99);
  const snapshot=JSON.parse(p.canonicalSnapshot);snapshot.adjustments=p.adjustments;
  p.canonicalSnapshot=JSON.stringify(snapshot);p.reviewToken=createHash('sha256').update(p.canonicalSnapshot).digest('hex');
  assert.throws(()=>generateAdvertisingCorrectionsCsv(p));
});
