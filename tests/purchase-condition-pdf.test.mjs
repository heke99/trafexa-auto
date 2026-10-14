import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { generatePurchaseConditionPdf, parsePurchaseConditionSnapshot, formatPurchaseConditionMoney } from '../src/lib/documents/purchase-condition-pdf.ts';

export function fixture() {
  return {
    id: 'ce190000-0000-4000-8000-000000000001', companyId: 'ce190000-0000-4000-8000-000000000002', stockId: 'ce190000-0000-4000-8000-000000000003', version: 4,
    company: { name: 'Åberg & Söner Bil AB', organisationNumber: '5560000001' },
    basis: { purchasePriceOre: '10000029', vatScheme: 'standard', purchaseVatOre: '2000006', vatBasisConfirmed: false, calculationVersion: '9007199254740993',
      vehicle: { id: 'ce190000-0000-4000-8000-000000000004', registration: 'ABC123', make: 'Škoda', model: 'Öresund Åäö', modelYear: 2020, mileageKm: 50123 } },
    supplierKind: 'business', supplierName: 'Ängsvägen Fordon AB', supplierOrganisationNumber: '5560000002', acquiredOn: '2026-10-10', documentReference: 'Inköp Ö-12',
    checkedOn: '2026-10-09', mileageKm: 50125,
    conditions: { body: { status: 'issues', notes: 'Repa på höger dörr.\nKontrollera åtgärd före leverans.' }, interior: { status: 'good', notes: 'Säten kontrollerade.' },
      engine: { status: 'unassessed', notes: '' }, transmission: { status: 'unassessed', notes: 'Ej provkörd.' }, tyres: { status: 'issues', notes: 'Vänster däck behöver bytas.' }, service: { status: 'good', notes: 'Servicebok finns.' } },
    repairEstimateOre: '1250029', createdAt: '2026-10-14T15:00:00Z', actorLabel: 'Kollega',
  };
}
async function extract(bytes, context) {
  const directory = await mkdtemp(join(tmpdir(), 'trafexa-purchase-pdf-'));
  try {
    const path = join(directory, 'underlag.pdf'); await writeFile(path, bytes);
    const result = spawnSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') { context.skip('PDF text verification requires pdftotext.'); return ''; }
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('saved PDF renders supplier, stock identity, six assessed states and exact öre with Swedish glyphs', async context => {
  const bytes = await generatePurchaseConditionPdf(fixture());
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getTitle(), 'Inköps- och skickunderlag v4 – ABC123');
  assert.equal(pdf.getCreationDate().toISOString(), '2026-10-14T15:00:00.000Z');
  const text = (await extract(bytes, context)).replace(/\s+/g, ' '); if (!text) return;
  for (const value of ['Åberg & Söner Bil AB', 'Ängsvägen Fordon AB', '5560000002', 'Škoda Öresund Åäö', 'ABC123', 'Inköpsdatum: 2026-10-10', 'Datum för skickbedömning: 2026-10-09', 'Inköp Ö-12', '100 000,29 SEK', '20 000,06 SEK', '12 500,29 SEK', '112 500,58 SEK', 'Kaross: Anmärkningar', 'Interiör: Utan anmärkning', 'Motor: Ej bedömt', 'Växellåda: Ej bedömt', 'Däck: Anmärkningar', 'Servicehistorik: Utan anmärkning', 'Repa på höger dörr.', 'inte en bokförd kostnad eller genomförd betalning', 'Övriga faktiska kostnader och skulder ingår inte']) assert.ok(text.includes(value), value);
});
test('unknown repair estimate stays unknown while explicit zero permits exact indicative price plus estimate', async context => {
  for (const amount of [null, '0']) {
    const source = fixture(); source.repairEstimateOre = amount;
    const text = (await extract(await generatePurchaseConditionPdf(source), context)).replace(/\s+/g, ' '); if (!text) return;
    if (amount === null) { assert.ok(text.includes('Reparationsuppskattning: Okänd')); assert.ok(text.includes('Kan inte beräknas')); assert.ok(!text.includes('Reparationsuppskattning: 0,00 SEK')); }
    else { assert.ok(text.includes('Reparationsuppskattning: 0,00 SEK')); assert.ok(text.includes('Indikativt inköpspris + uppskattad åtgärd: 100 000,29 SEK')); }
  }
});
test('VMB and unknown VAT are labels from saved metadata, without an invented tax or profit calculation', async context => {
  for (const scheme of ['vmb', 'unknown']) {
    const source = fixture(); source.basis.vatScheme = scheme; source.basis.purchaseVatOre = null;
    const text = (await extract(await generatePurchaseConditionPdf(source), context)).replace(/\s+/g, ' '); if (!text) return;
    assert.ok(text.includes(scheme === 'vmb' ? 'Vinstmarginalbeskattning (VMB)' : 'Ej klassificerad'));
    assert.ok(text.includes('Okänd – underlag saknas'));
    assert.ok(text.includes('Ingen moms, vinst eller marginal beräknas'));
    if (scheme === 'vmb') assert.ok(text.includes('VMB-villkor bekräftade i underlaget: Nej'));
  }
});
test('PG bigint and indicative sum remain exact beyond JavaScript safe integers', async context => {
  const source = fixture(); source.basis.purchasePriceOre = '9223372036854775807'; source.basis.purchaseVatOre = null; source.repairEstimateOre = '999999999999';
  const text = (await extract(await generatePurchaseConditionPdf(source), context)).replace(/\s+/g, ' '); if (!text) return;
  assert.ok(text.includes('92 233 720 368 547 758,07 SEK'));
  assert.ok(text.includes('92 233 730 368 547 758,06 SEK'));
  assert.equal(formatPurchaseConditionMoney('29'), '0,29 SEK');
  assert.equal(formatPurchaseConditionMoney('18446744073709551614'), '184 467 440 737 095 516,14 SEK');
  for (const value of ['-1', '00', '1.09', '1e2', '18446744073709551615']) assert.throws(() => formatPurchaseConditionMoney(value));
});
test('immutable bytes remain stable despite later stock, supplier or estimate changes and extra Auth/lender metadata never prints', async context => {
  const saved = fixture(), before = await generatePurchaseConditionPdf(saved), changed = structuredClone(saved);
  changed.basis.purchasePriceOre = '1'; changed.supplierName = 'Senare leverantör'; changed.repairEstimateOre = null;
  assert.deepEqual(await generatePurchaseConditionPdf(saved), before);
  const authId = 'ab290000-0000-4000-8000-000000000008';
  const injected = { ...saved, createdBy: authId, actorUserId: authId, lenderName: 'PRIVATE_LENDER 漢字', hiddenMetadata: 'INTERNAL_SECRET' };
  assert.deepEqual(parsePurchaseConditionSnapshot(injected), saved);
  const text = await extract(await generatePurchaseConditionPdf(injected), context); if (!text) return;
  for (const value of [authId, 'PRIVATE_LENDER', 'INTERNAL_SECRET', saved.id, saved.companyId, saved.stockId, saved.basis.vehicle.id, saved.basis.calculationVersion, 'Senare leverantör']) assert.ok(!text.includes(value), value);
});
test('long inspection notes wrap across pages without losing glyphs or footer numbering', async context => {
  const saved = fixture(); saved.conditions.body.notes = 'Å'.repeat(1000); saved.conditions.interior.notes = 'Ö'.repeat(1000); saved.conditions.engine.notes = 'Ä'.repeat(1000);
  const bytes = await generatePurchaseConditionPdf(saved), pdf = await PDFDocument.load(bytes); assert.ok(pdf.getPageCount() >= 3);
  const text = await extract(bytes, context); if (!text) return;
  assert.equal((text.match(/Å/g) ?? []).length, 1002); // Company plus model.
  assert.ok(text.includes(`${pdf.getPageCount()}/${pdf.getPageCount()}`));
});
test('malformed or missing saved fields, unsafe money, invalid dates and unsupported visible glyphs are refused', async () => {
  for (const mutate of [
    v => { v.basis.purchasePriceOre = 9007199254740993; }, v => { v.basis.calculationVersion = '0'; }, v => { v.repairEstimateOre = '-1'; },
    v => { v.repairEstimateOre = '1000000000000'; }, v => { delete v.repairEstimateOre; }, v => { delete v.conditions.engine; },
    v => { v.conditions.engine.status = 'verified'; }, v => { v.conditions.body.notes = ''; }, v => { v.mileageKm = 2000001; },
    v => { v.acquiredOn = '2026-02-30'; }, v => { v.checkedOn = '2026-10-15'; }, v => { v.supplierKind = 'person'; },
    v => { v.basis.purchaseVatOre = '2000007'; }, v => { v.basis.vatScheme = 'vmb'; }, v => { v.basis.vatBasisConfirmed = true; },
  ]) { const source = fixture(); mutate(source); await assert.rejects(generatePurchaseConditionPdf(source)); }
  const source = fixture(); source.supplierName = '漢字'; await assert.rejects(generatePurchaseConditionPdf(source), /tecken.*inte stöder/);
});

test('text bounds count Unicode code points like the saved DTO and permit supported supplementary-plane glyphs', async () => {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await readFile(new URL('../assets/fonts/DejaVuSans.ttf', import.meta.url)));
  const supportedLetter = font.getCharacterSet().find(point => point > 65535 && /\p{L}/u.test(String.fromCodePoint(point)));
  assert.ok(supportedLetter, 'The actual embedded font supports supplementary-plane letters');
  const source = fixture(); source.supplierName = String.fromCodePoint(supportedLetter).repeat(160);
  assert.equal(parsePurchaseConditionSnapshot(source).supplierName, source.supplierName);
  assert.equal(Buffer.from((await generatePurchaseConditionPdf(source)).slice(0, 5)).toString(), '%PDF-');
  source.supplierName += String.fromCodePoint(supportedLetter); assert.throws(() => parsePurchaseConditionSnapshot(source));
});
