import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { z } from 'zod';
import { CONTRACT_PLACEHOLDERS, type ContractDraft } from '../contracts/types.ts';
import { parseOfferSnapshot, formatOfferMoney, formatOfferSignedMoney, wrapOfferText, type OfferSnapshot } from './offer-pdf.ts';

const uuid = z.string().uuid();
const positive = z.number().int().min(1).max(2147483647);
const text = (minimum: number, maximum: number, multiline = false) => z.string().refine(value => {
  const length = Array.from(value).length;
  return length >= minimum && length <= maximum && value === value.trim() && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value);
});
const allowedTokens = new Set<string>(CONTRACT_PLACEHOLDERS);

/** Finite plaintext tokens only: no expression evaluation, HTML interpretation or recursive expansion. */
export function renderContractTemplate(body: string, source: OfferSnapshot): string {
  text(2, 12000, true).parse(body);
  const remainder = body.replace(/\{\{([^{}]*)\}\}/g, (_match, token: string) => {
    if (!allowedTokens.has(token)) throw new Error('Unknown contract placeholder');
    return '';
  });
  if (/[{}]/.test(remainder)) throw new Error('Malformed contract placeholder');
  const offer = parseOfferSnapshot(source), trade = offer.trade_in;
  const values: Record<(typeof CONTRACT_PLACEHOLDERS)[number], string> = {
    'company.name': offer.company.name, 'company.organisation_number': offer.company.organisation_number,
    'customer.name': offer.customer.name, 'customer.email': offer.customer.email || 'Ingen uppgift',
    'vehicle.registration': offer.vehicle.registration_number, 'vehicle.make': offer.vehicle.make, 'vehicle.model': offer.vehicle.model,
    'vehicle.model_year': String(offer.vehicle.model_year), 'offer.version': String(offer.version), 'offer.price_ore': formatOfferMoney(offer.sale_price_ore),
    'trade_in.value_ore': trade ? formatOfferMoney(trade.value_ore) : 'Inget inbyte',
    'trade_in.amount_to_pay_ore': trade ? formatOfferSignedMoney(trade.amount_to_pay_ore) : 'Inget inbyte',
  };
  // Replacement values are returned literally. Braces or $& in customer text
  // are data and never become a second template instruction.
  return body.replace(/\{\{([^{}]*)\}\}/g, (_match, token: keyof typeof values) => values[token]);
}

const schema = z.object({
  id: uuid, companyId: uuid, dealId: uuid, version: positive, offerId: uuid, offerVersion: positive,
  template: z.object({ id: uuid, templateId: uuid, version: positive, approvalVersion: positive, title: text(2, 160), body: text(2, 12000, true) }),
  sourceOffer: z.unknown().transform(parseOfferSnapshot), createdAt: z.string().datetime({ offset: true }), actorLabel: z.enum(['Du', 'Kollega']),
}).superRefine((draft, context) => {
  if (draft.sourceOffer.company.id.toLowerCase() !== draft.companyId.toLowerCase() || draft.sourceOffer.deal_id.toLowerCase() !== draft.dealId.toLowerCase() || draft.sourceOffer.version !== draft.offerVersion) context.addIssue({ code: 'custom', message: 'Contract source binding mismatch' });
  try { renderContractTemplate(draft.template.body, draft.sourceOffer); } catch { context.addIssue({ code: 'custom', message: 'Invalid contract template' }); }
});

/** Only the server-stored draft is accepted; unknown provider/Auth fields are stripped. */
export function parseContractDraft(value: unknown): ContractDraft { return schema.parse(value); }
let fontBytes: Promise<Buffer> | undefined;
function getFontBytes(): Promise<Buffer> {
  fontBytes ??= readFile(join(process.cwd(), 'assets', 'fonts', 'DejaVuSans.ttf')).catch(error => { fontBytes = undefined; throw error; });
  return fontBytes;
}

/** The source offer and approved template version are frozen; this renders no signature or payment state. */
export type ContractPdfSignature = { authenticationMethod?: 'email_link'; party: 'customer' | 'company'; fullName: string; signedAt: string; strokes: { points: { x: number; y: number }[] }[] };
export type ContractPdfCompletion = { documentHash: string; completedAt: string; signatures: ContractPdfSignature[] };

export async function generateContractPdf(value: unknown): Promise<Uint8Array> { return renderContractPdf(value); }

/** Internal rendering boundary: completion is validated by signed-contract-pdf before use. */
export async function renderContractPdf(value: unknown, completion?: ContractPdfCompletion): Promise<Uint8Array> {
  const draft = parseContractDraft(value), offer = draft.sourceOffer;
  const document = await PDFDocument.create(); document.registerFontkit(fontkit);
  const font = await document.embedFont(await getFontBytes(), { subset: true }), supported = new Set(font.getCharacterSet());
  const created = new Date(draft.createdAt);
  document.setTitle(`${completion ? 'SIGNERAT AVTAL' : 'AVTALSUTKAST – OSIGNERAT'} – v${draft.version} – ${offer.vehicle.registration_number}`);
  document.setAuthor(offer.company.name); document.setCreator('Trafexa');
  document.setSubject(completion ? 'Elektroniskt undertecknat avtal med två signeringskvitton.' : 'Osignerat avtalsutkast från sparad offert och godkänd mallversion.');
  document.setCreationDate(created); document.setModificationDate(completion ? new Date(completion.completedAt) : created);
  const width = 595.28, height = 841.89, margin = 46, contentWidth = width - margin * 2;
  const ink = rgb(0.10, 0.16, 0.24), muted = rgb(0.34, 0.39, 0.45), accent = rgb(0.08, 0.41, 0.49);
  let page = document.addPage([width, height]), y = height - margin;
  function newPage() { page = document.addPage([width, height]); y = height - margin; }
  function draw(value: string, size = 10, color = ink, gap = 5) {
    if (Array.from(value.replace(/[\n\r\t]/g, '')).some(character => !supported.has(character.codePointAt(0)!))) throw new Error('Avtalsunderlaget innehåller tecken som PDF-teckensnittet inte stöder.');
    for (const line of wrapOfferText(value, font, size, contentWidth)) {
      if (y < margin + 36 + size) newPage();
      page.drawText(line, { x: margin, y: y - size, size, font, color }); y -= size * 1.5;
    }
    y -= gap;
  }
  function section(title: string) { if (y < margin + 95) newPage(); y -= 10; draw(title, 13, accent, 8); }
  const dateTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium', timeStyle: 'short' });
  draw(completion ? 'SIGNERAT AVTAL' : 'AVTALSUTKAST', 26, accent, 10); draw(completion ? 'ELEKTRONISKT UNDERTECKNAT' : 'OSIGNERAT', 16, accent, 10);
  draw(`Utkastversion ${draft.version} · Sparad ${dateTime.format(created)}`, 10, muted);
  draw(`Godkänd mallversion: ${draft.template.title} · Version ${draft.template.version}`, 10, muted);
  draw(`Underlag: accepterad offertversion ${draft.offerVersion}`, 10, muted);
  draw(completion ? (completion.signatures.some(signature=>signature.authenticationMethod==='email_link')?'Kunden har godkänt avtalet via en personlig mejllänk och bolaget med sitt Trafexa-konto. Godkännandet bekräftar ingen genomförd betalning, leverans eller finansiering.':'Kunden och bolaget har undertecknat samma avtalsinnehåll med inloggade, verifierade konton. Underskriften bekräftar ingen genomförd betalning, leverans eller finansiering.') : 'Detta är ett osignerat utkast. Dokumentet bekräftar ingen genomförd signering, betalning, leverans eller finansiering.', 10, muted);
  section('Säljare och kund');
  draw(`${offer.company.name} · Organisationsnummer ${offer.company.organisation_number}`, 11);
  draw(`${offer.customer.name} · ${offer.customer.kind === 'business' ? 'Företag' : 'Privatperson'}`);
  if (offer.customer.email) draw(`E-post: ${offer.customer.email}`);
  if (offer.customer.phone) draw(`Telefon: ${offer.customer.phone}`);
  if (offer.customer.address) draw(`Adress: ${offer.customer.address}`);
  section('Fordon');
  draw(`${offer.vehicle.make} ${offer.vehicle.model} · ${offer.vehicle.model_year}`, 12);
  draw(`Registreringsnummer: ${offer.vehicle.registration_number}`);
  if (offer.vehicle.vin) draw(`Chassinummer: ${offer.vehicle.vin}`);
  const fuel = { petrol: 'Bensin', diesel: 'Diesel', electric: 'El', hybrid: 'Hybrid', other: 'Övrigt' };
  draw(`Mätarställning: ${offer.vehicle.mileage_km.toLocaleString('sv-SE')} km · ${fuel[offer.vehicle.fuel]} · ${offer.vehicle.gearbox === 'automatic' ? 'Automat' : 'Manuell'}`);
  section('Pris och moms från offertversionen');
  draw(`Totalpris inklusive eventuell moms: ${formatOfferMoney(offer.sale_price_ore)}`, 13, accent);
  if (offer.stock.vat_scheme === 'standard') {
    draw('Standardmoms 25 %. Försäljningspriset inkluderar moms.');
    draw(`Pris exklusive moms: ${formatOfferMoney(offer.vat.net_price_ore!)}`); draw(`Moms: ${formatOfferMoney(offer.vat.amount_ore!)}`);
  } else draw(offer.stock.vat_scheme === 'vmb' ? 'Vinstmarginalbeskattning (VMB). Moms redovisas inte separat.' : 'Momsmodellen är inte klassificerad. Moms redovisas inte separat.');
  if (offer.trade_in) {
    const trade = offer.trade_in; section('Inbyte från offertversionen');
    draw(`${trade.make} ${trade.model} · ${trade.model_year}`, 12); draw(`Registreringsnummer: ${trade.registration}`);
    draw(`Mätarställning: ${trade.mileage_km.toLocaleString('sv-SE')} km · Inbytesunderlag version ${trade.version}`);
    draw(`Inbytesvärde: ${formatOfferMoney(trade.value_ore)}`); draw(`Bekräftad skuld: ${formatOfferMoney(trade.debt_ore)}`);
    draw(`Inbytets nettovärde efter skuld: ${formatOfferSignedMoney(trade.net_trade_in_ore)}`);
    draw(`Belopp att betala enligt offertunderlaget: ${formatOfferSignedMoney(trade.amount_to_pay_ore)}`, 13, accent);
    if (BigInt(trade.amount_to_pay_ore) < BigInt(0)) draw('Det negativa beloppet innebär ett överskott till kunden enligt offertunderlaget.', 9, muted);
    draw('Beloppet är en uppgift i underlaget och bekräftar ingen genomförd betalning.', 9, muted);
  }
  section('Originalvillkor från offertversionen'); draw(offer.terms || 'Inga ytterligare offertvillkor angivna.');
  section('Villkor från den godkända mallversionen'); draw(renderContractTemplate(draft.template.body, offer));
  section('Om utkastet');
  draw('Offertuppgifter, originalvillkor och malltext sparades när denna utkastversion skapades. Senare ändringar påverkar inte versionen.', 9, muted);
  if (completion) {
    section('Underskrifter och signeringsbevis');
    draw('Enkel elektronisk underskrift via Trafexa. Ingen BankID-identifikation eller certifikatbaserad PDF-signatur.', 9, muted);
    draw(`Avtalsinnehållets SHA-256: ${completion.documentHash}`, 8, muted);
    for (const signature of completion.signatures) {
      if (y < margin + 180) newPage();
      draw(`${signature.party === 'customer' ? 'Kund' : 'Bolag'}: ${signature.fullName}`, 12, accent);
      draw(`Undertecknat ${dateTime.format(new Date(signature.signedAt))}`, 9, muted);
      if(signature.authenticationMethod==='email_link'){draw('Godkänt med angivet namn och bekräftelse via personlig mejllänk.',9,muted);y-=16;continue;}
      const points = signature.strokes.flatMap(stroke => stroke.points);
      const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
      const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
      const scale = Math.min(280 / Math.max(1, maxX-minX), 65 / Math.max(1, maxY-minY));
      for (const stroke of signature.strokes) for (let i = 1; i < stroke.points.length; i++) {
        const a = stroke.points[i-1], b = stroke.points[i];
        page.drawLine({start:{x:margin+(a.x-minX)*scale,y:y-(a.y-minY)*scale},end:{x:margin+(b.x-minX)*scale,y:y-(b.y-minY)*scale},thickness:1.1,color:ink});
      }
      y -= 80;
    }
  } else draw('OSIGNERAT AVTALSUTKAST. Ingen signeringsleverantör har slutfört detta dokument genom denna PDF-generering.', 9, muted);
  const pages = document.getPages();
  pages.forEach((current, index) => {
    current.drawLine({ start: { x: margin, y: margin }, end: { x: width - margin, y: margin }, thickness: 0.5, color: muted });
    current.drawText(`Trafexa · ${completion ? 'SIGNERAT AVTAL' : 'OSIGNERAT AVTALSUTKAST'} v${draft.version} · ${index + 1}/${pages.length}`, { x: margin, y: margin - 15, size: 8, font, color: muted });
  });
  return document.save();
}
