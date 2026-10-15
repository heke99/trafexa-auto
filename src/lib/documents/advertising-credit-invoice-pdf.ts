import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { wrapOfferText } from './offer-pdf.ts';
import { invoiceMoney } from './advertising-invoice-pdf.ts';
import { BILLING_UUID } from '../advertising/billing-validation.ts';
import { parseAdvertisingCreditInvoice } from '../advertising/credit-validation.ts';
import type { AdvertisingCreditInvoice } from '../advertising/credit-types';

let fontBytes: Promise<Buffer> | undefined;
function getFontBytes() {
  fontBytes ??= readFile(join(process.cwd(), 'assets', 'fonts', 'DejaVuSans.ttf')).catch(error => { fontBytes = undefined; throw error; });
  return fontBytes;
}

/** Renderer version 1: credit magnitudes and parties come from the frozen original. */
export async function generateAdvertisingCreditInvoicePdf(value: unknown): Promise<Uint8Array> {
  if (!value || typeof value !== 'object') throw Error('Invalid credit invoice');
  const raw = value as AdvertisingCreditInvoice;
  if (typeof raw.companyId !== 'string' || !BILLING_UUID.test(raw.companyId) || typeof raw.id !== 'string' || !BILLING_UUID.test(raw.id)) throw Error('Invalid credit identity');
  const credit = parseAdvertisingCreditInvoice(value, raw.companyId, raw.id), saved = credit.snapshot;
  const original = saved.originalInvoice, financial = original.snapshot.assessment.snapshot, draft = financial.draft.snapshot;
  const creditMoney = (ore: string) => `${BigInt(ore) === 0n ? '' : '-'}${invoiceMoney(ore)}`;
  const document = await PDFDocument.create(); document.registerFontkit(fontkit);
  const font = await document.embedFont(await getFontBytes(), { subset: true }), supported = new Set(font.getCharacterSet());
  const created = new Date(credit.createdAt);
  document.setTitle(`Kreditfaktura ${credit.creditNumber}`); document.setAuthor('Trafexa'); document.setCreator('Trafexa');
  document.setSubject('Full kreditering av utfärdad annonsfaktura'); document.setCreationDate(created); document.setModificationDate(created);
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
  draw('Kreditfaktura', 25, accent, 10);
  draw(`Kreditfakturanummer: ${credit.creditNumber}`, 14);
  draw(`Kreditfakturadatum: ${credit.creditDate}`, 11);
  draw(`Avser faktura: ${original.invoiceNumber} · Fakturadatum: ${original.invoiceDate}`, 11);
  draw(`Ursprunglig faktureringsperiod: ${original.month} · Valuta: SEK`, 11);
  draw(`Orsak till full kreditering: ${saved.reason}`, 11);
  for (const [title, profile] of [['Säljare', draft.sellerProfile], ['Köpare', draft.buyerProfile]] as const) {
    section(title);
    const fields = profile.fields;
    draw(fields.legalName!, 12); draw(`Organisationsnummer: ${fields.organisationNumber}`);
    if (title === 'Säljare') { draw(`Momsregistreringsnummer: ${financial.settings.fields.sellerVatNumber}`); draw(`Styrelsens registrerade säte: ${saved.series.sellerRegisteredSeat}`); }
    draw(`Postadress: ${fields.addressLine1}`); if (fields.addressLine2) draw(fields.addressLine2);
    draw(`${fields.postalCode} ${fields.city} · ${fields.countryCode}`);
    draw(`Faktureringsmejl: ${fields.invoiceEmail}`); if (fields.reference) draw(`Referens: ${fields.reference}`);
  }
  section('Full kreditering');
  draw(`Krediteras exklusive moms: ${creditMoney(saved.netTotalOre)}`, 12);
  draw(`Krediterad moms 25 %: ${creditMoney(saved.vatTotalOre)}`, 12);
  draw(`Krediteras inklusive moms: ${creditMoney(saved.grossTotalOre)}`, 16, accent);
  draw('Beloppen minskar originalfakturan i sin helhet. Minustecken anger kreditering.', 10);
  draw('Detta dokument bekräftar ingen betalning eller återbetalning.', 10);
  section(`Specifikation · ${saved.lines.length} unika publiceringar`);
  for (const row of saved.lines) {
    if (y < margin + 160) newPage();
    const channel = row.channel === 'blocket' ? 'Blocket' : 'Wayke';
    draw(`Publicering av unik fordonsannons på ${channel}`, 11);
    draw(`Tjänstedatum (granskat): ${row.serviceDate} · Antal: ${row.quantity}`, 10);
    draw(`Annons-ID: ${row.listingId} · Publicerings-ID: ${row.publicationId}`, 8, muted);
    draw(`Originalets enhetspris exkl. moms: ${invoiceMoney(row.originalOre)} · Ursprunglig nedsättning: ${invoiceMoney(row.reductionOre)}`, 9);
    draw(`Radbelopp exkl. moms: ${creditMoney(row.netOre)} · Momssats: 25 % · Moms: ${creditMoney(row.vatOre!)}`, 9);
    draw(`Radbelopp inkl. moms: ${creditMoney(row.grossOre!)}`, 9);
  }
  section('Dokumentreferenser');
  draw(`Kreditfakturareferens: ${credit.id}`, 9);
  draw(`Originalfakturareferens: ${original.id}`, 9);
  draw(`Originalfakturans SHA-256: ${original.sourceHash}`, 8, muted);
  draw('Rader och moms krediteras med exakt de belopp som sparades på originalfakturan. Ingen ny momsberäkning görs.', 9, muted);
  draw(`Kreditfakturans SHA-256: ${credit.sourceHash}`, 8, muted);
  const pages = document.getPages();
  pages.forEach((current, index) => {
    current.drawText(`KREDITFAKTURA ${credit.creditNumber}`, { x: margin, y: height - margin, size: 11, font, color: accent });
    current.drawLine({ start: { x: margin, y: margin }, end: { x: width - margin, y: margin }, thickness: 0.5, color: muted });
    current.drawText(`Kreditfaktura ${credit.creditNumber} · Sida ${index + 1}/${pages.length}`, { x: margin, y: margin - 15, size: 8, font, color: muted });
  });
  return document.save();
}
