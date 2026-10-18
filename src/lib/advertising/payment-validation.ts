import { createHash } from 'node:crypto';
import { record, ore } from './billing-validation.ts';
import { invoiceUuid, BILLING_TOKEN, issuanceText } from './issuance-validation.ts';
import { invoiceDueDate, invoiceDateInStockholm } from './issuance-format.ts';
import type { AdvertisingPaymentEntry, AdvertisingPaymentEntrySource, AdvertisingPaymentPage } from './payment-types';

export function paymentExact(v: unknown, keys: string[]) {
  const r = record(v);
  if (Object.keys(r).length !== keys.length || keys.some(k => !(k in r))) throw Error('Invalid payment fields');
  return r;
}
export function paymentHash(v: unknown): string {
  if (typeof v !== 'string' || !BILLING_TOKEN.test(v)) throw Error('Invalid payment hash');
  return v;
}
/** Aggregates can exceed int64; never coerce them to JavaScript numbers. */
export function paymentTotal(v: unknown): string {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,99})$/.test(v)) throw Error('Invalid payment total');
  return v;
}
export function paymentSequence(v: unknown, zero = false): string {
  const s = ore(v);
  if (!zero && s === '0') throw Error('Invalid payment sequence');
  return s;
}
export function paymentAmount(v: unknown): string {
  const amount = ore(v);
  if (amount === '0') throw Error('Positive payment required');
  return amount;
}
export function paymentIdentifier(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(v)) throw Error('Invalid transaction identifier');
  return v;
}
export function paymentDay(v: unknown): string {
  if (typeof v !== 'string' || !/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(v)) throw Error('Invalid booking day');
  invoiceDueDate(v, 1);
  return v;
}
function nullableUuid(v: unknown) { return v === null ? null : invoiceUuid(v); }
function canonical(v: unknown, h: unknown) {
  if (typeof v !== 'string' || v.length > 30000 || createHash('sha256').update(v, 'utf8').digest('hex') !== paymentHash(h)) throw Error('Invalid payment provenance');
  return v;
}
const entryKeys = ['id','sequence','companyId','invoiceId','invoiceNumber','invoiceSourceHash','sellerOrganisationNumber','kind','amountOre','paymentIdentifier','bankReference','bookedDate','reason','createdAt','createdBy','reversesEntryId','replacesEntryId'];
function entrySource(value: unknown): AdvertisingPaymentEntrySource {
  const r = paymentExact(value, entryKeys), kind = r.kind;
  if (kind !== 'receipt' && kind !== 'reversal') throw Error('Invalid payment direction');
  const reversesEntryId = nullableUuid(r.reversesEntryId), replacesEntryId = nullableUuid(r.replacesEntryId);
  if (kind === 'receipt' ? reversesEntryId !== null : reversesEntryId === null || replacesEntryId !== null) throw Error('Invalid payment reference');
  const createdAt = issuanceText(r.createdAt, 40); invoiceDateInStockholm(createdAt);
  const sellerOrganisationNumber = issuanceText(r.sellerOrganisationNumber, 10);
  if (!/^[0-9]{10}$/.test(sellerOrganisationNumber)) throw Error('Invalid payment seller');
  const source: AdvertisingPaymentEntrySource = {
    id: invoiceUuid(r.id), sequence: paymentSequence(r.sequence), companyId: invoiceUuid(r.companyId), invoiceId: invoiceUuid(r.invoiceId),
    invoiceNumber: issuanceText(r.invoiceNumber, 100), invoiceSourceHash: paymentHash(r.invoiceSourceHash), sellerOrganisationNumber,
    kind, amountOre: paymentAmount(r.amountOre), paymentIdentifier: paymentIdentifier(r.paymentIdentifier),
    bankReference: issuanceText(r.bankReference, 200), bookedDate: paymentDay(r.bookedDate), reason: issuanceText(r.reason, 500),
    createdAt, createdBy: invoiceUuid(r.createdBy), reversesEntryId, replacesEntryId,
  };
  if (source.bookedDate > invoiceDateInStockholm(createdAt) || [source.reversesEntryId,source.replacesEntryId].includes(source.id)) throw Error('Invalid payment timing/reference');
  return source;
}
export function parseAdvertisingPaymentEntry(value: unknown): AdvertisingPaymentEntry {
  const r = paymentExact(value, [...entryKeys, 'sourceHash','canonicalSnapshot','isReversed','isReplaced']);
  const source = entrySource(Object.fromEntries(entryKeys.map(k => [k,r[k]])));
  const canonicalSnapshot = canonical(r.canonicalSnapshot, r.sourceHash), proof = entrySource(JSON.parse(canonicalSnapshot));
  if (JSON.stringify(source) !== JSON.stringify(proof) || typeof r.isReversed !== 'boolean' || typeof r.isReplaced !== 'boolean' || source.kind === 'reversal' && (r.isReversed || r.isReplaced) || r.isReplaced && !r.isReversed) throw Error('Invalid payment entry proof');
  return {...source,sourceHash:paymentHash(r.sourceHash),canonicalSnapshot,isReversed:r.isReversed,isReplaced:r.isReplaced};
}
export function parseAdvertisingPaymentPage(value: unknown, companyId: string, invoiceId: string, actorUserId: string, actorRole: AdvertisingPaymentPage['actorRole'], beforeSequence: string | null = null): AdvertisingPaymentPage {
  const r = paymentExact(value,['companyId','invoiceId','invoiceNumber','invoiceSourceHash','actorUserId','actorRole','currency','businessDate','grossTotalOre','credit','receivableOre','receivedOre','outstandingOre','surplusOre','status','entries','nextBeforeSequence','latestSequence','entryCount','reviewToken','canonicalReview','canWrite']);
  if (r.companyId !== companyId || r.invoiceId !== invoiceId || r.actorUserId !== actorUserId || r.actorRole !== actorRole || !['platform_admin','owner','admin','finance'].includes(actorRole) || r.currency !== 'SEK' || r.canWrite !== (actorRole === 'platform_admin')) throw Error('Invalid payment scope');
  const invoiceNumber = issuanceText(r.invoiceNumber,100), invoiceSourceHash = paymentHash(r.invoiceSourceHash), businessDate = paymentDay(r.businessDate), grossTotalOre = ore(r.grossTotalOre);
  let credit: AdvertisingPaymentPage['credit'] = null;
  if (r.credit !== null) {
    const c = paymentExact(r.credit,['id','creditNumber','sourceHash','grossTotalOre']);
    credit = {id:invoiceUuid(c.id),creditNumber:issuanceText(c.creditNumber,100),sourceHash:paymentHash(c.sourceHash),grossTotalOre:ore(c.grossTotalOre)};
    if (credit.grossTotalOre !== grossTotalOre) throw Error('Invalid full credit');
  }
  const receivableOre = paymentTotal(r.receivableOre), receivedOre = paymentTotal(r.receivedOre), outstandingOre = paymentTotal(r.outstandingOre), surplusOre = paymentTotal(r.surplusOre);
  const due = BigInt(credit ? '0' : grossTotalOre), paid = BigInt(receivedOre), outstanding = due > paid ? due - paid : 0n, surplus = paid > due ? paid - due : 0n;
  const status = credit ? 'credited' : surplus > 0n ? 'overpaid' : outstanding === 0n ? 'settled' : paid > 0n ? 'partial' : 'unpaid';
  if (receivableOre !== String(due) || outstandingOre !== String(outstanding) || surplusOre !== String(surplus) || r.status !== status) throw Error('Invalid payment balances');
  if (!Array.isArray(r.entries) || r.entries.length > 50) throw Error('Invalid payment pagination');
  const entries = r.entries.map(parseAdvertisingPaymentEntry), latestSequence = paymentSequence(r.latestSequence,true), entryCount = paymentTotal(r.entryCount);
  const seen = new Set<string>(); let last = beforeSequence === null ? BigInt(latestSequence) + 1n : BigInt(beforeSequence);
  for (const entry of entries) {
    if (entry.companyId !== companyId || entry.invoiceId !== invoiceId || entry.invoiceNumber !== invoiceNumber || entry.invoiceSourceHash !== invoiceSourceHash || seen.has(entry.id) || BigInt(entry.sequence) >= last || BigInt(entry.sequence) > BigInt(latestSequence)) throw Error('Invalid payment row scope/order');
    seen.add(entry.id); last = BigInt(entry.sequence);
  }
  const nextBeforeSequence = r.nextBeforeSequence === null ? null : paymentSequence(r.nextBeforeSequence);
  if (nextBeforeSequence !== null && (entries.length !== 50 || nextBeforeSequence !== entries.at(-1)?.sequence) || BigInt(entryCount) < BigInt(entries.length) || entryCount === '0' && (latestSequence !== '0' || receivedOre !== '0')) throw Error('Invalid payment cursor');
  const canonicalReview = canonical(r.canonicalReview,r.reviewToken), c = paymentExact(JSON.parse(canonicalReview),['companyId','invoiceId','invoiceSourceHash','creditSourceHash','latestSequence','entryCount','businessDate','receivableOre','receivedOre']);
  const expected = {companyId,invoiceId,invoiceSourceHash,creditSourceHash:credit?.sourceHash ?? null,latestSequence,entryCount,businessDate,receivableOre,receivedOre};
  if (Object.entries(expected).some(([k,v])=>c[k]!==v)) throw Error('Invalid payment review proof');
  return {companyId,invoiceId,invoiceNumber,invoiceSourceHash,actorUserId,actorRole,currency:'SEK',businessDate,grossTotalOre,credit,receivableOre,receivedOre,outstandingOre,surplusOre,status,entries,nextBeforeSequence,latestSequence,entryCount,reviewToken:paymentHash(r.reviewToken),canonicalReview,canWrite:r.canWrite as boolean};
}
