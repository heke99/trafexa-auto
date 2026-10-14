import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { z } from 'zod';
import { wrapOfferText } from './offer-pdf.ts';
import type { PurchaseCondition, ConditionKey } from '@/lib/purchase-condition/types';

const MAX_AMOUNT = BigInt('9223372036854775807');
const MAX_ESTIMATE = BigInt('999999999999');
const uuid = z.string().uuid();
const text = (min: number, max: number, multiline = false) => z.string().refine(value => Array.from(value).length >= min && Array.from(value).length <= max && value === value.trim() && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value));
const money = (maximum: bigint) => z.string().regex(/^(0|[1-9]\d{0,18})$/).refine(value => /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= maximum);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= '1900-01-01';
});
const check = z.object({ status: z.enum(['unassessed', 'good', 'issues']), notes: text(0, 1000, true) }).refine(value => value.status !== 'issues' || value.notes.length >= 2);
const schema = z.object({
  id: uuid, companyId: uuid, stockId: uuid, version: z.number().int().min(1).max(2147483647),
  company: z.object({ name: text(2, 160), organisationNumber: z.string().regex(/^\d{10}$/) }),
  basis: z.object({
    purchasePriceOre: money(MAX_AMOUNT), vatScheme: z.enum(['standard', 'vmb', 'unknown']), purchaseVatOre: money(MAX_AMOUNT).nullable(),
    vatBasisConfirmed: z.boolean(), calculationVersion: money(MAX_AMOUNT).refine(value => BigInt(value) > BigInt(0)),
    vehicle: z.object({ id: uuid, registration: text(2, 15), make: text(1, 160), model: text(1, 160), modelYear: z.number().int().min(1900).max(2100), mileageKm: z.number().int().min(0).max(2147483647) }),
  }),
  supplierKind: z.enum(['person', 'business']), supplierName: text(2, 160), supplierOrganisationNumber: z.string().regex(/^\d{10}$/).nullable(),
  acquiredOn: date, documentReference: text(1, 160).nullable(), checkedOn: date, mileageKm: z.number().int().min(0).max(2000000),
  conditions: z.object({ body: check, interior: check, engine: check, transmission: check, tyres: check, service: check }),
  repairEstimateOre: money(MAX_ESTIMATE).nullable(), createdAt: z.string().datetime({ offset: true }), actorLabel: z.enum(['Du', 'Kollega']),
}).superRefine((value, context) => {
  const businessDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value.createdAt));
  if (value.acquiredOn > businessDate || value.checkedOn > businessDate) context.addIssue({ code: 'custom', message: 'Dates exceed the saved business date' });
  if (value.supplierKind === 'person' && value.supplierOrganisationNumber !== null) context.addIssue({ code: 'custom', message: 'Private supplier must not include an organisation number' });
  const basis = value.basis;
  if (basis.purchaseVatOre !== null && BigInt(basis.purchaseVatOre) > (BigInt(basis.purchasePriceOre) + BigInt(2)) / BigInt(5)
    || basis.vatScheme === 'vmb' && basis.purchaseVatOre !== null && basis.purchaseVatOre !== '0'
    || basis.vatBasisConfirmed && basis.vatScheme !== 'vmb') context.addIssue({ code: 'custom', message: 'Invalid saved VAT evidence' });
});

/** Parse the saved DTO only. Unrecognized Auth/provider fields are discarded. */
export function parsePurchaseConditionSnapshot(value: unknown): PurchaseCondition { return schema.parse(value); }

export function formatPurchaseConditionMoney(value: string): string {
  if (!/^(0|[1-9]\d{0,19})$/.test(value) || BigInt(value) > MAX_AMOUNT * BigInt(2)) throw new Error('Invalid amount');
  const amount = BigInt(value);
  const whole = (amount / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${whole},${(amount % BigInt(100)).toString().padStart(2, '0')} SEK`;
}

let fontBytes: Promise<Buffer> | undefined;
function getFontBytes(): Promise<Buffer> {
  fontBytes ??= readFile(join(process.cwd(), 'assets', 'fonts', 'DejaVuSans.ttf')).catch(error => { fontBytes = undefined; throw error; });
  return fontBytes;
}

/** Reproduces one immutable version; no current stock/cost/payment data is read. */
export async function generatePurchaseConditionPdf(value: unknown): Promise<Uint8Array> {
  const saved = parsePurchaseConditionSnapshot(value);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(await getFontBytes(), { subset: true });
  const supported = new Set(font.getCharacterSet());
  const created = new Date(saved.createdAt);
  document.setTitle(`Inköps- och skickunderlag v${saved.version} – ${saved.basis.vehicle.registration}`);
  document.setAuthor(saved.company.name); document.setCreator('Trafexa');
  document.setSubject('Sparat inköps- och skickunderlag. Reparationsuppskattning är inte en bokförd kostnad.');
  document.setCreationDate(created); document.setModificationDate(created);
  const width = 595.28, height = 841.89, margin = 46, contentWidth = width - margin * 2;
  const ink = rgb(0.10, 0.16, 0.24), muted = rgb(0.34, 0.39, 0.45), accent = rgb(0.08, 0.41, 0.49);
  let page = document.addPage([width, height]), y = height - margin;
  function newPage() { page = document.addPage([width, height]); y = height - margin; }
  function draw(value: string, size = 10, color = ink, gap = 5) {
    if (Array.from(value.replace(/[\n\r\t]/g, '')).some(character => !supported.has(character.codePointAt(0)!))) throw new Error('Underlaget innehåller tecken som PDF-teckensnittet inte stöder.');
    for (const line of wrapOfferText(value, font, size, contentWidth)) {
      if (y < margin + 36 + size) newPage();
      page.drawText(line, { x: margin, y: y - size, size, font, color }); y -= size * 1.5;
    }
    y -= gap;
  }
  function section(title: string) { if (y < margin + 95) newPage(); y -= 10; draw(title, 13, accent, 8); }
  const dateTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium', timeStyle: 'short' });
  draw('Inköps- och skickunderlag', 23, accent, 12);
  draw(`${saved.company.name} · Organisationsnummer ${saved.company.organisationNumber}`, 11);
  draw(`Version ${saved.version} · Sparad ${dateTime.format(created)}`, 10, muted);
  section('Fordon vid registreringen');
  const vehicle = saved.basis.vehicle;
  draw(`${vehicle.make} ${vehicle.model} · ${vehicle.modelYear}`, 12);
  draw(`Registreringsnummer: ${vehicle.registration}`);
  draw(`Registrerad mätarställning: ${vehicle.mileageKm.toLocaleString('sv-SE')} km`);
  section('Inköpsuppgifter');
  draw(`Leverantör: ${saved.supplierName} · ${saved.supplierKind === 'business' ? 'Företag' : 'Privatperson'}`);
  if (saved.supplierOrganisationNumber) draw(`Leverantörens organisationsnummer: ${saved.supplierOrganisationNumber}`);
  draw(`Inköpsdatum: ${saved.acquiredOn}`);
  draw(`Underlagsreferens: ${saved.documentReference ?? 'Inte angiven'}`);
  draw(`Inköpets totalbelopp inklusive eventuell moms: ${formatPurchaseConditionMoney(saved.basis.purchasePriceOre)}`, 12, accent);
  const vatLabels = { standard: 'Standardmoms', vmb: 'Vinstmarginalbeskattning (VMB)', unknown: 'Ej klassificerad' };
  draw(`Registrerad momsmodell: ${vatLabels[saved.basis.vatScheme]}`);
  if (saved.basis.vatScheme === 'vmb') draw(`VMB-villkor bekräftade i underlaget: ${saved.basis.vatBasisConfirmed ? 'Ja' : 'Nej'}`);
  draw(`Registrerad avdragsgill inköpsmoms: ${saved.basis.purchaseVatOre === null ? 'Okänd – underlag saknas' : formatPurchaseConditionMoney(saved.basis.purchaseVatOre)}`);
  draw('Momsuppgifterna återger det sparade underlaget. Ingen moms eller avdragsrätt beräknas genom detta dokument.', 9, muted);
  section('Skickbedömning');
  draw(`Datum för skickbedömning: ${saved.checkedOn}`);
  draw(`Mätarställning vid bedömning: ${saved.mileageKm.toLocaleString('sv-SE')} km`);
  const labels: Record<ConditionKey, string> = { body: 'Kaross', interior: 'Interiör', engine: 'Motor', transmission: 'Växellåda', tyres: 'Däck', service: 'Servicehistorik' };
  const statuses = { unassessed: 'Ej bedömt', good: 'Utan anmärkning', issues: 'Anmärkningar' };
  for (const key of Object.keys(labels) as ConditionKey[]) {
    draw(`${labels[key]}: ${statuses[saved.conditions[key].status]}`, 11);
    draw(saved.conditions[key].notes || 'Ingen anteckning.', 10, muted, 9);
  }
  section('Reparationsuppskattning');
  if (saved.repairEstimateOre === null) {
    draw('Reparationsuppskattning: Okänd – ingen uppskattning registrerad.');
    draw('Indikativt inköpspris + uppskattad åtgärd: Kan inte beräknas när uppskattningen är okänd.');
  } else {
    draw(`Reparationsuppskattning: ${formatPurchaseConditionMoney(saved.repairEstimateOre)}`);
    const indicative = BigInt(saved.basis.purchasePriceOre) + BigInt(saved.repairEstimateOre);
    draw(`Indikativt inköpspris + uppskattad åtgärd: ${formatPurchaseConditionMoney(indicative.toString())}`, 12, accent);
  }
  draw('Uppskattningen är inte en bokförd kostnad eller genomförd betalning. Den indikativa summan består av inköpspris + uppskattad åtgärd. Övriga faktiska kostnader och skulder ingår inte. Ingen moms, vinst eller marginal beräknas.', 9, muted);
  section('Om underlaget');
  draw('Dokumentet återger en sparad version. Senare ändringar av fordon, inköpspris, momsuppgifter eller skickkontroll ändrar inte denna version.', 9, muted);
  draw('Skickbedömningen återger manuellt registrerade observationer. Dokumentet innebär ingen garanti, signering eller betalningsbekräftelse.', 9, muted);
  const pages = document.getPages();
  pages.forEach((current, index) => {
    current.drawLine({ start: { x: margin, y: margin }, end: { x: width - margin, y: margin }, thickness: 0.5, color: muted });
    current.drawText(`Trafexa · Inköps- och skickunderlag v${saved.version} · ${index + 1}/${pages.length}`, { x: margin, y: margin - 15, size: 8, font, color: muted });
  });
  return document.save();
}
