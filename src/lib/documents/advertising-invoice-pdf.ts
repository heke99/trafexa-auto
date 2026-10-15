import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { wrapOfferText } from './offer-pdf.ts';
import { BILLING_UUID, ore } from '../advertising/billing-validation.ts';
import { parseAdvertisingInvoiceDraft } from '../advertising/invoice-validation.ts';
import type { AdvertisingInvoiceDraft } from '../advertising/invoice-types';

const labels: Record<string, string> = {
  legalName: 'Företagsnamn', organisationNumber: 'Organisationsnummer', invoiceEmail: 'Faktureringsmejl',
  addressLine1: 'Postadress', addressLine2: 'Adressrad 2', postalCode: 'Postnummer', city: 'Ort',
  countryCode: 'Landskod', reference: 'Referens',
};
export function invoiceMoney(value: string) {
  const amount = BigInt(ore(value));
  return `${(amount / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${(amount % 100n).toString().padStart(2, '0')} SEK`;
}
export function invoiceMissingLabel(key: string) {
  if (key === 'vatTreatment') return 'Momsbedömning';
  const [party, field] = key.split('.');
  return `${party === 'buyer' ? 'Kund' : 'Säljare'}: ${labels[field] ?? field}`;
}
let fontBytes: Promise<Buffer> | undefined;
function getFontBytes() {
  fontBytes ??= readFile(join(process.cwd(), 'assets', 'fonts', 'DejaVuSans.ttf')).catch(error => { fontBytes = undefined; throw error; });
  return fontBytes;
}

/** Renders only the immutable selected version, including its original missing fields. */
export async function generateAdvertisingInvoicePdf(value: unknown): Promise<Uint8Array> {
  if (!value || typeof value !== 'object') throw Error('Invalid invoice draft');
  const raw = value as AdvertisingInvoiceDraft;
  if (typeof raw.companyId !== 'string' || !BILLING_UUID.test(raw.companyId) || typeof raw.id !== 'string' || !BILLING_UUID.test(raw.id)) throw Error('Invalid invoice identity');
  const draft = parseAdvertisingInvoiceDraft(value, raw.companyId, raw.id), snapshot = draft.snapshot;
  const original = snapshot.basis.original;
  if (!original) throw Error('Locked original required');
  const document = await PDFDocument.create(); document.registerFontkit(fontkit);
  const font = await document.embedFont(await getFontBytes(), { subset: true }), supported = new Set(font.getCharacterSet());
  const created = new Date(draft.createdAt);
  document.setTitle(`Fakturautkast v${draft.version} – ${draft.month}`);
  document.setAuthor('Trafexa'); document.setCreator('Trafexa');
  document.setSubject('Ej utfärdad faktura. Sparat annonsunderlag i SEK exklusive moms.');
  document.setCreationDate(created); document.setModificationDate(created);
  const width = 595.28, height = 841.89, margin = 46, contentWidth = width - 2 * margin;
  const ink = rgb(0.10, 0.16, 0.24), muted = rgb(0.34, 0.39, 0.45), accent = rgb(0.08, 0.41, 0.49);
  let page = document.addPage([width, height]), y = height - margin - 30;
  function newPage() {
    if (document.getPageCount() >= 1000) throw Error('Invoice draft PDF too large');
    page = document.addPage([width, height]); y = height - margin - 30;
  }
  function draw(text: string, size = 10, color = ink, gap = 4) {
    if (Array.from(text.replace(/[\n\r\t]/g, '')).some(character => !supported.has(character.codePointAt(0)!))) throw Error('Underlaget innehåller tecken som PDF-teckensnittet inte stöder.');
    for (const line of wrapOfferText(text, font, size, contentWidth)) {
      if (y < margin + 40 + size) newPage();
      page.drawText(line, { x: margin, y: y - size, size, font, color }); y -= size * 1.5;
    }
    y -= gap;
  }
  function section(title: string) { if (y < margin + 100) newPage(); y -= 8; draw(title, 13, accent, 8); }
  const dateTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium', timeStyle: 'short' });
  draw('Fakturautkast', 23, accent, 12);
  draw(`Annonsunderlag för ${draft.month} · Utkastsversion ${draft.version}`, 12);
  draw(`Sparat ${dateTime.format(created)} · Internt utkast-ID: ${draft.id}`, 9, muted);
  draw('Dokumentet är ett granskningsutkast. Det har inget fakturanummer eller betalningskrav.', 10);
  function party(title: string, profile: typeof snapshot.buyerProfile) {
    section(`${title} · Uppgiftsversion ${profile.version}`);
    for (const key of Object.keys(labels)) draw(`${labels[key]}: ${profile.fields[key as keyof typeof profile.fields] ?? 'Inte angiven'}`);
  }
  party('Säljare', snapshot.sellerProfile); party('Kund', snapshot.buyerProfile);
  section('Underlag och belopp');
  draw(`Original: ${invoiceMoney(original.totalOre)} exklusive moms`);
  draw(`Sammanlagda nedsättningar: ${invoiceMoney(snapshot.basis.reductionTotalOre)} exklusive moms`);
  draw(`Återstående underlag: ${invoiceMoney(snapshot.basis.netTotalOre!)} exklusive moms`, 12, accent);
  draw(`Antal unika publiceringar: ${original.count}`);
  draw('Moms: Ej fastställd. Belopp inklusive moms och att betala är inte fastställda.', 10);
  section('Saknade uppgifter inför fortsatt fakturahantering');
  for (const key of snapshot.missingFields) draw(`Saknas: ${invoiceMissingLabel(key)}`);
  draw('Fakturautställning kräver även fastställda betalningsvillkor, betalningsuppgifter, nummerserie och bokföringskoppling.', 9, muted);
  section('Publiceringar från det låsta originalet');
  for (const item of original.items) {
    if (y < margin + 125) newPage();
    const reductions = snapshot.basis.adjustments.filter(row => row.publicationId === item.publicationId)
      .reduce((sum, row) => sum + BigInt(row.amountOre), 0n);
    draw(`${item.channel === 'blocket' ? 'Blocket' : 'Wayke'} · Annons-ID: ${item.listingId}`, 10);
    draw(`Publicerings-ID: ${item.publicationId} · Antal: 1`, 9, muted);
    draw(`Original ${invoiceMoney(item.unitPriceOre!)} · Nedsättning ${invoiceMoney(reductions.toString())} · Återstår ${invoiceMoney((BigInt(item.unitPriceOre!) - reductions).toString())}`, 9);
  }
  section('Rättelser i den sparade versionen');
  if (!snapshot.basis.adjustments.length) draw('Inga nedsättningar registrerade i detta utkast.');
  for (const adjustment of snapshot.basis.adjustments) {
    if (y < margin + 125) newPage();
    draw(`Rättelsereferens: ${adjustment.id}`, 9);
    draw(`Publicerings-ID: ${adjustment.publicationId}`, 9, muted);
    draw(`Nedsättning: ${invoiceMoney(adjustment.amountOre)} exklusive moms · ${dateTime.format(new Date(adjustment.createdAt))}`, 9);
    draw(`Motivering: ${adjustment.reason}`, 9);
  }
  section('Versionsbundet underlag');
  draw(`Original-ID: ${original.id}`, 9);
  draw(`Period: ${original.periodStart} till ${original.periodEnd} (slutet ingår inte)`, 9);
  draw(`Registrering startade: ${original.trackingStartedAt}`, 9);
  draw(`Täckning: ${original.coverage === 'full' ? 'Hela perioden' : 'Del av perioden — uttryckligen granskad'}`, 9);
  draw(`Äldre publicerade jobb som inte ingår: ${original.legacyPublishedJobs}`, 9);
  draw(`Originalets SHA-256: ${original.reviewToken}`, 8);
  draw(`Rättelseunderlagets SHA-256: ${snapshot.basis.reviewToken}`, 8);
  draw(`Utkastets SHA-256: ${draft.sourceHash}`, 8);
  draw('Dokumentet återger en sparad version. Kontrollera aktuell status i appen före fortsatt hantering; senare ändringar av underlag eller faktureringsuppgifter ändrar inte denna version.', 9, muted);
  const pages = document.getPages();
  pages.forEach((current, index) => {
    current.drawText('UTKAST — EJ UTFÄRDAD FAKTURA', { x: margin, y: height - margin, size: 12, font, color: accent });
    current.drawLine({ start: { x: margin, y: margin }, end: { x: width - margin, y: margin }, thickness: 0.5, color: muted });
    current.drawText(`Trafexa · UTKAST / EJ UTFÄRDAD · v${draft.version} · ${index + 1}/${pages.length}`, { x: margin, y: margin - 15, size: 8, font, color: muted });
  });
  return document.save();
}
