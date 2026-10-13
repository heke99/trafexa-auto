import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { formatOfferMoney, generateOfferPdf, parseOfferSnapshot, wrapOfferText } from '../src/lib/documents/offer-pdf.ts';

const id = 'e1ab754a-7e92-401d-905f-8b86eb1a5ad1';
function snapshot() {
  return {
    schema_version: 1, document_type: 'offer', version: 1, deal_id: id,
    issued_at: '2026-10-13T14:00:00+00:00', valid_until: '2026-11-12', terms: 'Betalning före leverans.\nÅterkoppla till säljaren för överenskommelse.',
    currency: 'SEK', price_basis: 'gross', sale_price_ore: '19900029',
    company: { id, name: 'Åberg & Söner Bil AB', organisation_number: '5560000001' },
    customer: { id, name: 'Zoë Öström', kind: 'person', email: 'zoe@example.invalid', phone: '+46 70 123 45 67', address: 'Ängsvägen 1\n123 45 Örebro' },
    stock: { id, vat_scheme: 'standard' },
    vehicle: { id, registration_number: 'ABC123', vin: 'TESTVIN12345', make: 'Volvo', model: 'V60 Öresund', model_year: 2022, mileage_km: 50123, fuel: 'hybrid', gearbox: 'automatic' },
    vat: { rate_percent: 25, amount_ore: '3980006', net_price_ore: '15920023' },
  };
}

async function extract(bytes, context) {
  const directory = await mkdtemp(join(tmpdir(), 'trafexa-offer-pdf-'));
  try {
    const filename = join(directory, 'offer.pdf');
    await writeFile(filename, bytes);
    const result = spawnSync('pdftotext', ['-layout', filename, '-'], { encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') { context.skip('Text extraction requires pdftotext (Poppler).'); return ''; }
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('PDF is a valid Unicode offer with customer, actual sale price, exact VAT and no credit approval', async (context) => {
  const source = snapshot();
  const bytes = await generateOfferPdf(source, id);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 1);
  assert.equal(pdf.getTitle(), 'Offert v1 – ABC123');
  assert.equal(pdf.getCreationDate()?.toISOString(), '2026-10-13T14:00:00.000Z');
  const text = (await extract(bytes, context)).replace(/\s+/g, ' ');
  if (!text) return;
  for (const expected of ['OFFERT', 'Åberg & Söner Bil AB', 'Zoë Öström', 'Ängsvägen 1', 'Örebro', 'Volvo V60 Öresund', 'ABC123', 'Totalpris inklusive eventuell moms:', '199 000,29 SEK', '159 200,23 SEK', '39 800,06 SEK', 'Standardmoms 25 %', 'inte signerat', 'inget kreditbeslut', '2026-11-12']) assert.ok(text.includes(expected), expected);
  assert.ok(!text.includes('purchase_price_ore'));
});

test('historical snapshot PDF remains identical after current customer and price data change', async (context) => {
  const stored = snapshot();
  const before = await generateOfferPdf(stored, id);
  const current = structuredClone(stored);
  current.customer.name = 'Uppdaterad kund'; current.sale_price_ore = '25000000'; current.vehicle.model = 'Uppdaterad bil';
  const after = await generateOfferPdf(stored, id);
  assert.deepEqual(after, before);
  const text = await extract(after, context);
  if (!text) return;
  assert.ok(text.includes('Zoë Öström'));
  assert.ok(!text.includes('Uppdaterad kund'));
  assert.ok(!text.includes('250 000,00'));
});

test('long single-token terms are wrapped across pages without losing Swedish characters', async (context) => {
  const source = snapshot(); source.terms = 'Å'.repeat(1800) + '\nSLUTPUNKT ÄÖ';
  const bytes = await generateOfferPdf(source, id);
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 2);
  const text = await extract(bytes, context);
  if (!text) return;
  assert.equal((text.match(/Å/g) ?? []).length, 1801); // Terms plus Åberg.
  assert.ok(text.includes('SLUTPUNKT ÄÖ'));
  assert.ok(text.includes(`2/${pdf.getPageCount()}`));
});

test('font-width wrapping keeps every line inside its allocated width', async () => {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await readFile(new URL('../assets/fonts/DejaVuSans.ttf', import.meta.url)));
  const input = `Försäljningsvillkor ${'Ö'.repeat(500)}\nNästa rad: åäö.`;
  const lines = wrapOfferText(input, font, 10, 200);
  assert.ok(lines.length > 10);
  assert.ok(lines.every((line) => font.widthOfTextAtSize(line, 10) <= 200));
  assert.equal(lines.join('').replace(/\s/g, ''), input.replace(/\s/g, ''));
});

test('VMB and unknown VAT keep their classification and never invent a VAT breakdown', async (context) => {
  for (const scheme of ['vmb', 'unknown']) {
    const source = snapshot(); source.stock.vat_scheme = scheme; source.vat = { rate_percent: null, amount_ore: null, net_price_ore: null };
    const text = (await extract(await generateOfferPdf(source, id), context)).replace(/\s+/g, ' ');
    if (!text) return;
    assert.ok(text.includes(scheme === 'vmb' ? 'Vinstmarginalbeskattning (VMB)' : 'inte klassificerad'));
    assert.ok(text.includes('Moms redovisas inte separat'));
    assert.ok(!text.includes('Pris exklusive moms'));
    assert.ok(!text.includes('Standardmoms 25 %'));
  }
});

test('exact öre formatting, immutable-schema validation and VAT arithmetic reject malformed documents', async () => {
  assert.equal(formatOfferMoney('29'), '0,29 SEK');
  assert.equal(formatOfferMoney('109'), '1,09 SEK');
  assert.equal(formatOfferMoney('999999999999'), '9 999 999 999,99 SEK');
  for (const value of ['1.09', '1e2', '-1', '00', '1000000000000']) assert.throws(() => formatOfferMoney(value));
  for (const mutate of [
    (value) => { value.document_type = 'contract'; },
    (value) => { value.price_basis = 'net'; },
    (value) => { delete value.price_basis; },
    (value) => { value.sale_price_ore = 19900029; },
    (value) => { value.terms = 'x'.repeat(2001); },
    (value) => { value.vat.amount_ore = '3980005'; },
    (value) => { value.stock.vat_scheme = 'unknown'; },
    (value) => { value.valid_until = '2026-02-30'; },
    (value) => { value.currency = 'EUR'; },
  ]) { const value = snapshot(); mutate(value); assert.throws(() => parseOfferSnapshot(value)); }
  const source = snapshot(); source.customer.name = '漢字';
  await assert.rejects(generateOfferPdf(source, id), /tecken.*inte stöder/);
});
