import { parseAdvertisingPaymentEntry, parseAdvertisingPaymentPage } from './payment-validation.ts';
import type { AdvertisingPaymentEntry, AdvertisingPaymentPage } from './payment-types';

export const PAYMENT_EXPORT_MAX_ENTRIES = 10000;
export const PAYMENT_EXPORT_MAX_CSV_BYTES = 2 * 1024 * 1024;
export const PAYMENT_EXPORT_MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
export class AdvertisingPaymentExportLimitError extends Error {}

/** Quote every cell; hidden Unicode prefixes must never enable spreadsheet formulas. */
function cell(value: string) {
  const guarded = /^[\s\p{Default_Ignorable_Code_Point}\p{Cc}]*[=+@-]/u.test(value) || /^[\p{Default_Ignorable_Code_Point}\p{Cc}]/u.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g,'""')}"`;
}
function kronor(value: string) {
  const amount = BigInt(value);
  return `${amount / 100n},${(amount % 100n).toString().padStart(2,'0')}`;
}
/** Revalidates a COMPLETE immutable journal, independently of the paging adapter. */
export function generateAdvertisingPaymentCsv(value: { page: AdvertisingPaymentPage; entries: AdvertisingPaymentEntry[] }): string {
  const raw = value.page, page = parseAdvertisingPaymentPage(raw,raw.companyId,raw.invoiceId,raw.actorUserId,raw.actorRole);
  if (!Array.isArray(value.entries) || value.entries.length > PAYMENT_EXPORT_MAX_ENTRIES) throw new AdvertisingPaymentExportLimitError('Entry limit');
  if (BigInt(page.entryCount) !== BigInt(value.entries.length)) throw Error('Incomplete payment journal');
  const entries = value.entries.map(parseAdvertisingPaymentEntry), byId = new Map<string,AdvertisingPaymentEntry>();
  let last = BigInt(page.latestSequence) + 1n, paid = 0n;
  for (const entry of entries) {
    if (entry.companyId !== page.companyId || entry.invoiceId !== page.invoiceId || entry.invoiceSourceHash !== page.invoiceSourceHash || entry.invoiceNumber !== page.invoiceNumber || byId.has(entry.id) || BigInt(entry.sequence) >= last) throw Error('Wrong payment journal scope or order');
    last = BigInt(entry.sequence); byId.set(entry.id,entry);
    paid += (entry.kind === 'receipt' ? 1n : -1n) * BigInt(entry.amountOre);
  }
  if (entries.length && entries[0].sequence !== page.latestSequence || paid !== BigInt(page.receivedOre)) throw Error('Wrong payment journal total');
  const reversed = new Set<string>();
  for (const entry of entries) if (entry.kind === 'reversal') {
    const original = byId.get(entry.reversesEntryId!);
    if (!original || original.kind !== 'receipt' || reversed.has(original.id) || BigInt(original.sequence) >= BigInt(entry.sequence) || original.amountOre !== entry.amountOre || original.paymentIdentifier !== entry.paymentIdentifier || original.bankReference !== entry.bankReference || original.bookedDate !== entry.bookedDate || original.sellerOrganisationNumber !== entry.sellerOrganisationNumber) throw Error('Invalid local reversal');
    reversed.add(original.id);
  }
  for (const entry of entries) if (entry.kind === 'receipt' && entry.replacesEntryId && byId.has(entry.replacesEntryId)) {
    const original = byId.get(entry.replacesEntryId)!;
    if (original.kind !== 'receipt' || !reversed.has(original.id) || original.paymentIdentifier !== entry.paymentIdentifier || original.sellerOrganisationNumber !== entry.sellerOrganisationNumber || BigInt(original.sequence) >= BigInt(entry.sequence)) throw Error('Invalid local correction');
  }
  const labels = {unpaid:'Obetald',partial:'Delbetald',settled:'Avstämd',overpaid:'Överskott',credited:'Krediterad'};
  const rows: string[][] = [
    ['Manuell avstämning av annonsfaktura','Administrativt register; inte bankverifiering, bokföringsverifikation eller återbetalningskvitto'],
    ['Företags-ID',page.companyId],['Faktura-ID',page.invoiceId],['Fakturanummer',page.invoiceNumber],
    ['Fakturans SHA-256',page.invoiceSourceHash],['Avstämningens SHA-256',page.reviewToken],['Avstämningsdag',page.businessDate],['Tidszon för avstämningsdag','Europe/Stockholm'],
    ['Valuta','SEK'],['Status',labels[page.status]],['Antal journalposter',page.entryCount],
    ['Belopp','Exakta heltalsören och kronor med två decimaler. Bevara öreskolumnerna som text vid kalkylbladsimport.'],
    ['Sammanfattning','Belopp i öre','Belopp i kronor'],
    ['Fakturans ursprungliga bruttobelopp',page.grossTotalOre,kronor(page.grossTotalOre)],
    ['Krediterat bruttobelopp',page.credit?.grossTotalOre ?? '0',kronor(page.credit?.grossTotalOre ?? '0')],
    ['Återstående fordran före avstämda inbetalningar',page.receivableOre,kronor(page.receivableOre)],
    ['Manuellt avstämda inbetalningar efter administrativa återföringar',page.receivedOre,kronor(page.receivedOre)],
    ['Kvar att betala',page.outstandingOre,kronor(page.outstandingOre)],['Överskott att hantera separat',page.surplusOre,kronor(page.surplusOre)],
    ['Kreditfaktura-ID',page.credit?.id ?? ''],['Kreditfakturanummer',page.credit?.creditNumber ?? ''],['Kreditfakturans SHA-256',page.credit?.sourceHash ?? ''],[],
    ['Journalnummer','Post-ID','Händelse','Riktning i avstämningen','Belopp i öre','Belopp i kronor','Transaktions-ID','Bankreferens / OCR','Bokföringsdag enligt manuellt granskat bankunderlag','Registrerad tidpunkt','Registrerad av','Motivering','Återför post-ID','Rättar post-ID','Postens SHA-256'],
  ];
  // No foreign correction details or mutable isReplaced/isReversed flags are exported.
  for (const entry of entries) rows.push([
    entry.sequence,entry.id,entry.kind === 'reversal' ? 'Administrativ återföring' : entry.replacesEntryId ? 'Rättad inbetalningsregistrering' : 'Manuellt registrerad inbetalning',
    entry.kind === 'reversal' ? 'Minskning' : 'Ökning',entry.amountOre,kronor(entry.amountOre),entry.paymentIdentifier,entry.bankReference,entry.bookedDate,entry.createdAt,entry.createdBy,entry.reason,entry.reversesEntryId ?? '',entry.replacesEntryId ?? '',entry.sourceHash,
  ]);
  rows.push([],['Alla journalposter för fakturan ingår. Inga pengar flyttas genom denna export.'],['Kredit och överskott anger inte att återbetalning har skett.']);
  let bytes = 3; const lines: string[] = [];
  for (const row of rows) {
    const line = row.map(cell).join(';') + '\r\n'; bytes += Buffer.byteLength(line,'utf8');
    if (bytes > PAYMENT_EXPORT_MAX_CSV_BYTES) throw new AdvertisingPaymentExportLimitError('CSV byte limit');
    lines.push(line);
  }
  return '\uFEFF' + lines.join('');
}
