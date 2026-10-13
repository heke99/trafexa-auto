import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import { z } from 'zod';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && !value.startsWith('0000');
});
const ore = z.string().regex(/^(0|[1-9]\d{0,11})$/);
const snapshotSchema = z.object({
  schema_version: z.literal(1), document_type: z.literal('offer'), version: z.number().int().positive(),
  deal_id: uuid, issued_at: z.string().datetime({ offset: true }), valid_until: date,
  terms: z.string().max(2000), currency: z.literal('SEK'), price_basis: z.literal('gross'), sale_price_ore: ore.refine((value) => BigInt(value) > BigInt(0)),
  company: z.object({ id: uuid, name: z.string().min(2).max(160), organisation_number: z.string().regex(/^\d{10}$/) }),
  customer: z.object({ id: uuid, kind: z.enum(['person', 'business']), name: z.string().min(2).max(160), email: z.string().max(254).nullable(), phone: z.string().max(60).nullable(), address: z.string().max(500).nullable() }),
  stock: z.object({ id: uuid, vat_scheme: z.enum(['standard', 'vmb', 'unknown']) }),
  vehicle: z.object({ id: uuid, registration_number: z.string().min(2).max(15), vin: z.string().max(100).nullable(), make: z.string().min(1).max(160), model: z.string().min(1).max(160), model_year: z.number().int().min(1900).max(2100), mileage_km: z.number().int().nonnegative(), fuel: z.enum(['petrol', 'diesel', 'electric', 'hybrid', 'other']), gearbox: z.enum(['automatic', 'manual']) }),
  vat: z.object({ rate_percent: z.literal(25).nullable(), amount_ore: ore.nullable(), net_price_ore: ore.nullable() }),
}).superRefine((snapshot, context) => {
  const gross = BigInt(snapshot.sale_price_ore);
  const vat = (gross + BigInt(2)) / BigInt(5);
  if (snapshot.stock.vat_scheme === 'standard') {
    if (snapshot.vat.rate_percent !== 25 || snapshot.vat.amount_ore !== vat.toString() || snapshot.vat.net_price_ore !== (gross - vat).toString()) context.addIssue({ code: 'custom', message: 'Invalid standard VAT breakdown' });
  } else if (snapshot.vat.rate_percent !== null || snapshot.vat.amount_ore !== null || snapshot.vat.net_price_ore !== null) {
    context.addIssue({ code: 'custom', message: 'VAT may not be separated for this VAT scheme' });
  }
});

export type OfferSnapshot = z.infer<typeof snapshotSchema>;
export function parseOfferSnapshot(snapshot: unknown): OfferSnapshot { return snapshotSchema.parse(snapshot); }

export function formatOfferMoney(value: string): string {
  if (!/^(0|[1-9]\d{0,11})$/.test(value)) throw new Error('Invalid amount');
  const amount = BigInt(value);
  const whole = (amount / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${whole},${(amount % BigInt(100)).toString().padStart(2, '0')} SEK`;
}

/** Wrap by actual font width, including a single token longer than one line. */
export function wrapOfferText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!(maxWidth > 0) || !(size > 0)) throw new Error('Invalid text dimensions');
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n').split('\n')) {
    let line = '';
    for (const word of paragraph.replace(/\t/g, '    ').split(/ +/).filter(Boolean)) {
      const combined = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(combined, size) <= maxWidth) { line = combined; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const character of Array.from(word)) {
        if (line && font.widthOfTextAtSize(line + character, size) > maxWidth) { lines.push(line); line = ''; }
        if (font.widthOfTextAtSize(character, size) > maxWidth) throw new Error('Font glyph exceeds line width');
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

let fontBytes: Promise<Buffer> | undefined;
function getFontBytes(): Promise<Buffer> {
  fontBytes ??= readFile(join(process.cwd(), 'assets', 'fonts', 'DejaVuSans.ttf')).catch((error) => { fontBytes = undefined; throw error; });
  return fontBytes;
}

/** Only a stored snapshot is accepted: downloading never reads current prices or customers. */
export async function generateOfferPdf(rawSnapshot: unknown, offerId: string): Promise<Uint8Array> {
  uuid.parse(offerId);
  const snapshot = parseOfferSnapshot(rawSnapshot);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(await getFontBytes(), { subset: true });
  // Fail clearly if a customer's characters cannot be represented; never emit
  // a misleading replacement glyph in an offer document.
  const supported = new Set(font.getCharacterSet());
  const printable = JSON.stringify(snapshot).replace(/\\[nrt]/g, '');
  if (Array.from(printable).some((character) => !supported.has(character.codePointAt(0)!))) throw new Error('Offertunderlaget innehåller tecken som PDF-teckensnittet inte stöder.');
  const issued = new Date(snapshot.issued_at);
  document.setTitle(`Offert v${snapshot.version} – ${snapshot.vehicle.registration_number}`);
  document.setAuthor(snapshot.company.name);
  document.setSubject('Offertunderlag. Ingen signering eller finansieringsprövning.');
  document.setCreator('Trafexa');
  document.setCreationDate(issued);
  document.setModificationDate(issued);
  const width = 595.28, height = 841.89, margin = 46, contentWidth = width - margin * 2;
  const ink = rgb(0.10, 0.16, 0.24), muted = rgb(0.34, 0.39, 0.45), accent = rgb(0.08, 0.41, 0.49);
  let page = document.addPage([width, height]), y = height - margin;
  function newPage() { page = document.addPage([width, height]); y = height - margin; }
  function text(value: string, size = 10, color = ink, gap = 5) {
    for (const line of wrapOfferText(value, font, size, contentWidth)) {
      if (y < margin + 36 + size) newPage();
      page.drawText(line, { x: margin, y: y - size, size, font, color });
      y -= size * 1.5;
    }
    y -= gap;
  }
  function section(title: string) { if (y < margin + 95) newPage(); y -= 10; text(title, 13, accent, 8); }
  const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium' });
  const fuel = { petrol: 'Bensin', diesel: 'Diesel', electric: 'El', hybrid: 'Hybrid', other: 'Övrigt' };
  text('OFFERT', 26, accent, 12);
  text(`${snapshot.company.name} · Organisationsnummer ${snapshot.company.organisation_number}`, 11);
  text(`Version ${snapshot.version} · Upprättad ${dateFormat.format(issued)} · Giltig till ${snapshot.valid_until}`, 10, muted);
  text(`Offert-ID: ${offerId}`, 8, muted);
  section('Kund');
  text(`${snapshot.customer.name} · ${snapshot.customer.kind === 'business' ? 'Företag' : 'Privatperson'}`);
  if (snapshot.customer.email) text(`E-post: ${snapshot.customer.email}`);
  if (snapshot.customer.phone) text(`Telefon: ${snapshot.customer.phone}`);
  if (snapshot.customer.address) text(`Adress: ${snapshot.customer.address}`);
  section('Fordon');
  text(`${snapshot.vehicle.make} ${snapshot.vehicle.model} · ${snapshot.vehicle.model_year}`, 12);
  text(`Registreringsnummer: ${snapshot.vehicle.registration_number}`);
  if (snapshot.vehicle.vin) text(`Chassinummer: ${snapshot.vehicle.vin}`);
  text(`Mätarställning: ${snapshot.vehicle.mileage_km.toLocaleString('sv-SE')} km · ${fuel[snapshot.vehicle.fuel]} · ${snapshot.vehicle.gearbox === 'automatic' ? 'Automat' : 'Manuell'}`);
  section('Pris och moms');
  text(`Totalpris inklusive eventuell moms: ${formatOfferMoney(snapshot.sale_price_ore)}`, 13, accent, 10);
  if (snapshot.stock.vat_scheme === 'standard') {
    text('Standardmoms 25 %. Försäljningspriset inkluderar moms.');
    text(`Pris exklusive moms: ${formatOfferMoney(snapshot.vat.net_price_ore!)}`);
    text(`Moms: ${formatOfferMoney(snapshot.vat.amount_ore!)}`);
  } else if (snapshot.stock.vat_scheme === 'vmb') {
    text('Vinstmarginalbeskattning (VMB). Moms redovisas inte separat.');
  } else {
    text('Momsmodellen är inte klassificerad och behöver bekräftas före avtal. Moms redovisas inte separat.');
  }
  section('Villkor');
  text(snapshot.terms || 'Inga ytterligare villkor angivna.');
  section('Om underlaget');
  text('Detta dokument är en offert. Det är inte signerat och utgör inget kreditbeslut eller finansieringsgodkännande. Ingen ansökan har skickats till en finanspartner genom detta dokument.', 9, muted);
  text('Uppgifterna sparades när den här versionen skapades. Senare ändringar av kund, fordon eller pris ändrar inte denna offertversion.', 9, muted);
  const pages = document.getPages();
  pages.forEach((current, index) => {
    current.drawLine({ start: { x: margin, y: margin }, end: { x: width - margin, y: margin }, thickness: 0.5, color: muted });
    current.drawText(`Trafexa · Offert v${snapshot.version} · ${index + 1}/${pages.length}`, { x: margin, y: margin - 15, size: 8, font, color: muted });
  });
  return document.save();
}
