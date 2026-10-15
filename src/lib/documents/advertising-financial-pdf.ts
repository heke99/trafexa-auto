import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { wrapOfferText } from './offer-pdf.ts';
import { invoiceMoney } from './advertising-invoice-pdf.ts';
import { BILLING_UUID } from '../advertising/billing-validation.ts';
import { parseAdvertisingFinancialAssessment } from '../advertising/financial-validation.ts';
import type { AdvertisingFinancialAssessment } from '../advertising/financial-types';

let fontBytes: Promise<Buffer> | undefined;
function getFontBytes() {
  fontBytes ??= readFile(join(process.cwd(), 'assets', 'fonts', 'DejaVuSans.ttf')).catch(error => { fontBytes = undefined; throw error; });
  return fontBytes;
}

/** Frozen reviewed calculations; never uses current bank details or tax settings. */
export async function generateAdvertisingFinancialPdf(value: unknown): Promise<Uint8Array> {
  if (!value || typeof value !== 'object') throw Error('Invalid financial assessment');
  const raw = value as AdvertisingFinancialAssessment;
  if (typeof raw.companyId !== 'string' || !BILLING_UUID.test(raw.companyId) || typeof raw.id !== 'string' || !BILLING_UUID.test(raw.id)) throw Error('Invalid identity');
  const assessment = parseAdvertisingFinancialAssessment(value, raw.companyId, raw.id), saved = assessment.snapshot;
  const document = await PDFDocument.create(); document.registerFontkit(fontkit);
  const font = await document.embedFont(await getFontBytes(), { subset: true }), supported = new Set(font.getCharacterSet());
  const created = new Date(assessment.createdAt);
  document.setTitle(`Granskat fakturaunderlag v${assessment.version} – ${assessment.month}`);
  document.setAuthor('Trafexa'); document.setCreator('Trafexa');
  document.setSubject('Granskat utkast med moms och betalningsvillkor. Ej utfärdad faktura.');
  document.setCreationDate(created); document.setModificationDate(created);
  const width = 595.28, height = 841.89, margin = 46, contentWidth = width - 2 * margin;
  const ink = rgb(0.10, 0.16, 0.24), muted = rgb(0.34, 0.39, 0.45), accent = rgb(0.08, 0.41, 0.49);
  let page = document.addPage([width, height]), y = height - margin - 30;
  function newPage() { if (document.getPageCount() >= 1000) throw Error('Assessment PDF too large'); page = document.addPage([width, height]); y = height - margin - 30; }
  function draw(text: string, size = 10, color = ink, gap = 4) {
    if (Array.from(text.replace(/[\n\r\t]/g, '')).some(character => !supported.has(character.codePointAt(0)!))) throw Error('Underlaget innehåller tecken som PDF-teckensnittet inte stöder.');
    for (const line of wrapOfferText(text, font, size, contentWidth)) {
      if (y < margin + 40 + size) newPage();
      page.drawText(line, { x: margin, y: y - size, size, font, color }); y -= size * 1.5;
    }
    y -= gap;
  }
  function section(title: string) { if (y < margin + 100) newPage(); y -= 8; draw(title, 13, accent, 8); }
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium', timeStyle: 'short' });
  draw('Granskat fakturaunderlag', 22, accent, 10);
  draw(`Period ${assessment.month} · Underlagsversion ${assessment.version}`, 12);
  draw(`Sparat ${date.format(created)} · Underlagsreferens ${assessment.id}`, 9, muted);
  draw('Dokumentet återger ett granskat utkast. Fakturanummer, fakturadatum, förfallodatum och betalningskrav har inte skapats.', 10);
  for (const [title, profile] of [['Säljare', saved.draft.snapshot.sellerProfile], ['Kund', saved.draft.snapshot.buyerProfile]] as const) {
    section(`${title} · Uppgiftsversion ${profile.version}`);
    const fields = profile.fields;
    draw(fields.legalName!, 12); draw(`Organisationsnummer: ${fields.organisationNumber}`);
    draw(`Postadress: ${fields.addressLine1}`); if (fields.addressLine2) draw(fields.addressLine2);
    draw(`${fields.postalCode} ${fields.city} · ${fields.countryCode}`);
    draw(`Faktureringsmejl: ${fields.invoiceEmail}`); if (fields.reference) draw(`Referens: ${fields.reference}`);
  }
  section('Moms och belopp');
  draw(`Summa exklusive moms: ${invoiceMoney(saved.netTotalOre)}`, 12);
  draw(`Moms 25 %: ${invoiceMoney(saved.vatTotalOre)}`, 12);
  draw(`Summa inklusive moms: ${invoiceMoney(saved.grossTotalOre)}`, 14, accent);
  draw(`Säljarens uppgivna momsregistreringsnummer: ${saved.settings.fields.sellerVatNumber}`);
  draw('Momshantering: Svensk standardmoms, uttryckligen granskad för detta underlag.');
  draw(saved.calculationVersion === 1
    ? 'Moms beräknas på varje publiceringsrads återstående belopp efter nedsättningar, avrundas till närmaste öre med halva ören uppåt och summeras därefter.'
    : 'Moms beräknas på hela nettobeloppet efter nedsättningar och avrundas till närmaste öre med halva ören uppåt. Örena fördelas mellan raderna efter störst decimalrest; publicerings-ID avgör lika rest.', 9, muted);
  section(`Betalningsuppgifter · Inställningsversion ${saved.settings.version}`);
  draw(`Betalningsvillkor inför utställning: ${saved.settings.fields.paymentDays} dagar från fakturadatum.`);
  const methods = { bankgiro: 'Bankgiro', plusgiro: 'PlusGiro', iban: 'Svensk IBAN', unresolved: 'Ej fastställt' };
  draw(`${methods[saved.settings.fields.paymentMethod]}: ${saved.settings.fields.paymentAccount}`);
  draw('Förfallodatum bestäms först vid faktisk fakturautställning.', 9, muted);
  draw(`Motivering till granskade inställningar: ${saved.settings.fields.reason}`, 9);
  section(`Publiceringsrader · Antal ${saved.lines.length}`);
  for (const row of saved.lines) {
    if (y < margin + 130) newPage();
    draw(`${row.channel === 'blocket' ? 'Blocket' : 'Wayke'} · Annons-ID: ${row.listingId}`);
    draw(`Publicerings-ID: ${row.publicationId} · Antal: 1`, 9, muted);
    draw(`Original ${invoiceMoney(row.originalOre)} · Nedsättning ${invoiceMoney(row.reductionOre)}`, 9);
    draw(`Netto ${invoiceMoney(row.netOre)} · Moms ${invoiceMoney(row.vatOre!)} · Inklusive moms ${invoiceMoney(row.grossOre!)}`, 9);
  }
  section('Sparade källor');
  draw(`Fakturautkast: ${saved.draft.id} · Version ${saved.draft.version}`, 9);
  draw(`Beräkningsversion: ${saved.calculationVersion}`, 9);
  draw(`Fakturautkastets SHA-256: ${saved.draft.sourceHash}`, 8);
  draw(`Inställningarnas SHA-256: ${saved.settings.reviewToken}`, 8);
  draw(`Granskad källas SHA-256: ${saved.sourceReviewToken}`, 8);
  draw(`Underlagets SHA-256: ${assessment.sourceHash}`, 8);
  draw('Senare ändringar i faktureringsuppgifter, rättelser, moms eller betalningsvillkor ändrar inte detta underlag. Kontrollera aktuell granskningsstatus i appen inför fakturautställning.', 9, muted);
  const pages = document.getPages();
  pages.forEach((current, index) => {
    current.drawText('GRANSKAT UTKAST — EJ UTFÄRDAD FAKTURA', { x: margin, y: height - margin, size: 11, font, color: accent });
    current.drawLine({ start: { x: margin, y: margin }, end: { x: width - margin, y: margin }, thickness: 0.5, color: muted });
    current.drawText(`Trafexa · Granskat utkast v${assessment.version} · ${index + 1}/${pages.length}`, { x: margin, y: margin - 15, size: 8, font, color: muted });
  });
  return document.save();
}
