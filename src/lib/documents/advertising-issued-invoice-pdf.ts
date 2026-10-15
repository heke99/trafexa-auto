import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { wrapOfferText } from './offer-pdf.ts';
import { invoiceMoney } from './advertising-invoice-pdf.ts';
import { BILLING_UUID } from '../advertising/billing-validation.ts';
import { parseAdvertisingIssuedInvoice } from '../advertising/issuance-validation.ts';
import type { AdvertisingIssuedInvoice } from '../advertising/issuance-types';

let fontBytes: Promise<Buffer> | undefined;
function getFontBytes() {
  fontBytes ??= readFile(join(process.cwd(), 'assets', 'fonts', 'DejaVuSans.ttf')).catch(error => { fontBytes = undefined; throw error; });
  return fontBytes;
}

/** Renderer version 1: an issued invoice always renders its immutable saved source. */
export async function generateAdvertisingIssuedInvoicePdf(value: unknown): Promise<Uint8Array> {
  if (!value || typeof value !== 'object') throw Error('Invalid issued invoice');
  const raw = value as AdvertisingIssuedInvoice;
  if (typeof raw.companyId !== 'string' || !BILLING_UUID.test(raw.companyId) || typeof raw.id !== 'string' || !BILLING_UUID.test(raw.id)) throw Error('Invalid invoice identity');
  const invoice = parseAdvertisingIssuedInvoice(value, raw.companyId, raw.id), saved = invoice.snapshot;
  const financial = saved.assessment.snapshot, draft = financial.draft.snapshot;
  const document = await PDFDocument.create(); document.registerFontkit(fontkit);
  const font = await document.embedFont(await getFontBytes(), { subset: true }), supported = new Set(font.getCharacterSet());
  const created = new Date(invoice.createdAt);
  document.setTitle(`Faktura ${invoice.invoiceNumber}`); document.setAuthor('Trafexa'); document.setCreator('Trafexa');
  document.setSubject('Utfärdad faktura för annonsering'); document.setCreationDate(created); document.setModificationDate(created);
  const width = 595.28, height = 841.89, margin = 46, contentWidth = width - 2 * margin;
  const ink = rgb(0.10, 0.16, 0.24), muted = rgb(0.34, 0.39, 0.45), accent = rgb(0.08, 0.41, 0.49);
  let page = document.addPage([width, height]), y = height - margin - 30;
  function newPage() { if (document.getPageCount() >= 1000) throw Error('Invoice PDF too large'); page = document.addPage([width, height]); y = height - margin - 30; }
  function draw(text: string, size = 10, color = ink, gap = 4) {
    if (Array.from(text.replace(/[\n\r\t]/g, '')).some(character => !supported.has(character.codePointAt(0)!))) throw Error('Fakturan innehåller tecken som PDF-teckensnittet inte stöder.');
    for (const line of wrapOfferText(text, font, size, contentWidth)) {
      if (y < margin + 40 + size) newPage();
      page.drawText(line, { x: margin, y: y - size, size, font, color }); y -= size * 1.5;
    }
    y -= gap;
  }
  function section(title: string) { if (y < margin + 100) newPage(); y -= 8; draw(title, 13, accent, 8); }
  draw('Faktura', 25, accent, 10);
  draw(`Fakturanummer: ${invoice.invoiceNumber}`, 14);
  draw(`Fakturadatum: ${invoice.invoiceDate} · Förfallodatum: ${invoice.dueDate}`, 11);
  draw(`Faktureringsperiod: ${invoice.month} · Valuta: SEK`, 11);
  for (const [title, profile] of [['Säljare', draft.sellerProfile], ['Köpare', draft.buyerProfile]] as const) {
    section(title);
    const fields = profile.fields;
    draw(fields.legalName!, 12); draw(`Organisationsnummer: ${fields.organisationNumber}`);
    if (title === 'Säljare') { draw(`Momsregistreringsnummer: ${financial.settings.fields.sellerVatNumber}`); draw(`Styrelsens registrerade säte: ${saved.series.sellerRegisteredSeat}`); }
    draw(`Postadress: ${fields.addressLine1}`); if (fields.addressLine2) draw(fields.addressLine2);
    draw(`${fields.postalCode} ${fields.city} · ${fields.countryCode}`);
    draw(`Faktureringsmejl: ${fields.invoiceEmail}`); if (fields.reference) draw(`Referens: ${fields.reference}`);
  }
  section('Belopp och betalning');
  draw(`Summa exklusive moms: ${invoiceMoney(saved.netTotalOre)}`, 12);
  draw(`Moms 25 %: ${invoiceMoney(saved.vatTotalOre)}`, 12);
  draw(`Att betala: ${invoiceMoney(saved.grossTotalOre)}`, 16, accent);
  draw(`Betalningsvillkor: ${financial.settings.fields.paymentDays} dagar från fakturadatum.`);
  const methods = { bankgiro: 'Bankgiro', plusgiro: 'PlusGiro', iban: 'IBAN', unresolved: 'Ej fastställt' };
  draw(`${methods[financial.settings.fields.paymentMethod]}: ${financial.settings.fields.paymentAccount}`);
  draw(`Ange fakturanummer ${invoice.invoiceNumber} som betalningsreferens.`);
  section(`Specifikation · ${saved.lines.length} unika publiceringar`);
  for (const row of saved.lines) {
    if (y < margin + 160) newPage();
    const channel = row.channel === 'blocket' ? 'Blocket' : 'Wayke';
    draw(`Publicering av unik fordonsannons på ${channel}`, 11);
    draw(`Tjänstedatum (granskat): ${row.serviceDate} · Antal: ${row.quantity}`, 10);
    draw(`Annons-ID: ${row.listingId} · Publicerings-ID: ${row.publicationId}`, 8, muted);
    draw(`Enhetspris exkl. moms: ${invoiceMoney(row.originalOre)} · Nedsättning: ${invoiceMoney(row.reductionOre)}`, 9);
    draw(`Radbelopp exkl. moms: ${invoiceMoney(row.netOre)} · Momssats: 25 % · Moms: ${invoiceMoney(row.vatOre!)}`, 9);
    draw(`Radbelopp inkl. moms: ${invoiceMoney(row.grossOre!)}`, 9);
  }
  section('Dokumentreferenser');
  draw(`Fakturareferens: ${invoice.id}`, 9);
  draw(`Granskat underlag: ${saved.assessment.id} · Version ${saved.assessment.version}`, 9);
  draw(financial.calculationVersion === 1
    ? 'Moms avrundas per nettorad till närmaste öre med halva ören uppåt och summeras sedan. Betalningsbeloppet avrundas inte till hela kronor.'
    : 'Moms beräknas på hela nettobeloppet och avrundas till närmaste öre med halva ören uppåt. Örena fördelas på raderna efter störst decimalrest, sedan publicerings-ID. Betalningsbeloppet avrundas inte till hela kronor.', 9, muted);
  draw(`Fakturans SHA-256: ${invoice.sourceHash}`, 8, muted);
  draw('Detta dokument är en utfärdad faktura och utgör inte ett betalningskvitto.', 9, muted);
  const pages = document.getPages();
  pages.forEach((current, index) => {
    current.drawText(`FAKTURA ${invoice.invoiceNumber}`, { x: margin, y: height - margin, size: 11, font, color: accent });
    current.drawLine({ start: { x: margin, y: margin }, end: { x: width - margin, y: margin }, thickness: 0.5, color: muted });
    current.drawText(`Faktura ${invoice.invoiceNumber} · Sida ${index + 1}/${pages.length}`, { x: margin, y: margin - 15, size: 8, font, color: muted });
  });
  return document.save();
}
