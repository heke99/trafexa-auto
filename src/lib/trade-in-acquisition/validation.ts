import { parseOfferSnapshot } from '../documents/offer-pdf';
import { TRADE_IN_ACQUISITION_ATTESTATION_VERSION } from './types';
import type { RecordTradeInAcquisitionInput, TradeInAcquisition, TradeInAcquisitionPage, TradeInAcquisitionReadInput, TradeInAcquisitionReceipt, TradeInAcquisitionRole, TradeInAcquisitionSource } from './types';

export type AcquisitionScope = { companyId: string; userId: string; role: TradeInAcquisitionRole };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const CONTROLS = /[\u0000-\u001f\u007f]/;
const MAX_ORE = 999999999999n;
const readKeys = ['companyId', 'dealId'];
const writeKeys = [...readKeys, 'expectedSourceSha256', 'acquiredOn', 'purchaseAgreementReference', 'debtConfirmedOre', 'debtConfirmedOn', 'debtEvidenceReference', 'fuel', 'gearbox', 'askingPriceOre', 'purchaseConfirmed', 'receivedConfirmed', 'debtConfirmed', 'reviewAcknowledged', 'attestationVersion', 'requestId'];
const sourceKeys = ['companyId', 'dealId', 'offerId', 'offerVersion', 'tradeInId', 'tradeInVersion', 'sellerCustomerId', 'signingId', 'signingDocumentSha256', 'signingRevision', 'offerSnapshot', 'sourceSha256'];
const acquisitionKeys = ['id', 'companyId', 'dealId', 'source', 'vehicleId', 'stockItemId', 'acquiredOn', 'purchaseAgreementReference', 'debtConfirmedOre', 'debtConfirmedOn', 'debtEvidenceReference', 'fuel', 'gearbox', 'askingPriceOre', 'purchasePriceOre', 'vatScheme', 'attestationVersion', 'createdAt', 'actorLabel'];
function invalid(): never { throw new Error('Ogiltigt inbytesinköpsunderlag.'); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || Object.keys(result).some(key => !keys.includes(key))) return invalid();
  return result;
}
function id(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) return invalid(); return value.toLowerCase(); }
function hash(value: unknown): string { if (typeof value !== 'string' || !HASH.test(value)) return invalid(); return value; }
function integer(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2147483647) return invalid(); return value; }
function role(value: unknown): TradeInAcquisitionRole { if (value !== 'owner' && value !== 'admin' && value !== 'finance') return invalid(); return value; }
function reference(value: unknown, normalize = false): string {
  if (typeof value !== 'string' || value.length > 320 || CONTROLS.test(value)) return invalid();
  const result = normalize ? value.trim() : value;
  if (result !== result.trim() || Array.from(result).length < 2 || Array.from(result).length > 160) return invalid();
  return result;
}
function ore(value: unknown, positive = false): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,11})$/.test(value)) return invalid();
  const amount = BigInt(value); if (amount > MAX_ORE || positive && amount === 0n) return invalid();
  return value;
}
export function acquisitionDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return invalid();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return invalid();
  return value;
}
export function stockholmAcquisitionBusinessDate(now = new Date()): string {
  if (!Number.isFinite(now.getTime())) return invalid();
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function timestamp(value: unknown, businessDate: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return invalid();
  acquisitionDate(value.slice(0, 10));
  if (stockholmAcquisitionBusinessDate(new Date(value)) > businessDate) return invalid();
  return value;
}
function fuel(value: unknown): TradeInAcquisition['fuel'] { if (value !== 'petrol' && value !== 'diesel' && value !== 'electric' && value !== 'hybrid' && value !== 'other') return invalid(); return value; }
function gearbox(value: unknown): TradeInAcquisition['gearbox'] { if (value !== 'automatic' && value !== 'manual') return invalid(); return value; }
function attestation(value: unknown): typeof TRADE_IN_ACQUISITION_ATTESTATION_VERSION { if (value !== TRADE_IN_ACQUISITION_ATTESTATION_VERSION) return invalid(); return value; }
export function sameAcquisitionValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameAcquisitionValue(value, right[index]));
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>, keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameAcquisitionValue(a[key], b[key]));
}
export function parseTradeInAcquisitionReadInput(value: unknown): TradeInAcquisitionReadInput {
  const row = record(value, readKeys); return { companyId: id(row.companyId), dealId: id(row.dealId) };
}
export function parseRecordTradeInAcquisitionInput(value: unknown): RecordTradeInAcquisitionInput {
  const row = record(value, writeKeys);
  if (row.purchaseConfirmed !== true || row.receivedConfirmed !== true || row.debtConfirmed !== true || row.reviewAcknowledged !== true) return invalid();
  return {
    companyId: id(row.companyId), dealId: id(row.dealId), expectedSourceSha256: hash(row.expectedSourceSha256),
    acquiredOn: acquisitionDate(row.acquiredOn), purchaseAgreementReference: reference(row.purchaseAgreementReference, true),
    debtConfirmedOre: ore(row.debtConfirmedOre), debtConfirmedOn: acquisitionDate(row.debtConfirmedOn), debtEvidenceReference: reference(row.debtEvidenceReference, true),
    fuel: fuel(row.fuel), gearbox: gearbox(row.gearbox), askingPriceOre: ore(row.askingPriceOre, true),
    purchaseConfirmed: true, receivedConfirmed: true, debtConfirmed: true, reviewAcknowledged: true,
    attestationVersion: attestation(row.attestationVersion), requestId: id(row.requestId),
  };
}
export function parseTradeInAcquisitionSource(value: unknown, expected: { companyId: string; dealId: string }): TradeInAcquisitionSource {
  const row = record(value, sourceKeys), companyId = id(row.companyId), dealId = id(row.dealId);
  if (companyId !== expected.companyId || dealId !== expected.dealId || row.signingRevision !== 3) return invalid();
  const snapshot = parseOfferSnapshot(row.offerSnapshot), trade = snapshot.trade_in;
  if (!trade || !sameAcquisitionValue(row.offerSnapshot, snapshot)) return invalid();
  const offerVersion = integer(row.offerVersion), tradeInVersion = integer(row.tradeInVersion), sellerCustomerId = id(row.sellerCustomerId), tradeInId = id(row.tradeInId);
  if (id(snapshot.company.id) !== companyId || id(snapshot.deal_id) !== dealId || snapshot.version !== offerVersion || id(trade.id) !== tradeInId || trade.version !== tradeInVersion || id(snapshot.customer.id) !== sellerCustomerId) return invalid();
  reference(snapshot.customer.name); ore(trade.value_ore, true); ore(trade.debt_ore);
  return { companyId, dealId, offerId: id(row.offerId), offerVersion, tradeInId, tradeInVersion, sellerCustomerId, signingId: id(row.signingId), signingDocumentSha256: hash(row.signingDocumentSha256), signingRevision: 3, offerSnapshot: { ...snapshot, trade_in: trade }, sourceSha256: hash(row.sourceSha256) };
}
export function parseTradeInAcquisition(value: unknown, expected: { companyId: string; dealId: string }, businessDate = stockholmAcquisitionBusinessDate()): TradeInAcquisition {
  const row = record(value, acquisitionKeys), companyId = id(row.companyId), dealId = id(row.dealId);
  if (companyId !== expected.companyId || dealId !== expected.dealId || row.vatScheme !== 'unknown') return invalid();
  const source = parseTradeInAcquisitionSource(row.source, expected);
  const acquiredOn = acquisitionDate(row.acquiredOn), debtConfirmedOn = acquisitionDate(row.debtConfirmedOn);
  if (acquiredOn > businessDate || debtConfirmedOn > businessDate) return invalid();
  const purchasePriceOre = ore(row.purchasePriceOre, true), debtConfirmedOre = ore(row.debtConfirmedOre);
  if (purchasePriceOre !== source.offerSnapshot.trade_in.value_ore || debtConfirmedOre !== source.offerSnapshot.trade_in.debt_ore || row.actorLabel !== 'Du' && row.actorLabel !== 'Kollega') return invalid();
  const vehicleId = id(row.vehicleId), stockItemId = id(row.stockItemId);
  if (vehicleId === id(source.offerSnapshot.vehicle.id) || stockItemId === id(source.offerSnapshot.stock.id)) return invalid();
  return { id: id(row.id), companyId, dealId, source, vehicleId, stockItemId, acquiredOn, purchaseAgreementReference: reference(row.purchaseAgreementReference), debtConfirmedOre, debtConfirmedOn, debtEvidenceReference: reference(row.debtEvidenceReference), fuel: fuel(row.fuel), gearbox: gearbox(row.gearbox), askingPriceOre: ore(row.askingPriceOre, true), purchasePriceOre, vatScheme: 'unknown', attestationVersion: attestation(row.attestationVersion), createdAt: timestamp(row.createdAt, businessDate), actorLabel: row.actorLabel };
}
function scope(row: Record<string, unknown>, expected: AcquisitionScope & { dealId: string }) {
  if (id(row.companyId) !== expected.companyId || id(row.dealId) !== expected.dealId || id(row.actorId) !== expected.userId || role(row.role) !== expected.role) return invalid();
}
export function parseTradeInAcquisitionPage(value: unknown, expected: AcquisitionScope & { dealId: string }, now = new Date()): TradeInAcquisitionPage {
  const row = record(value, ['actorId', 'role', 'companyId', 'dealId', 'businessDate', 'canAcquire', 'reason', 'source', 'acquisition']); scope(row, expected);
  const businessDate = acquisitionDate(row.businessDate);
  if (businessDate !== stockholmAcquisitionBusinessDate(now) || typeof row.canAcquire !== 'boolean') return invalid();
  const source = row.source === null ? null : parseTradeInAcquisitionSource(row.source, expected);
  const acquisition = row.acquisition === null ? null : parseTradeInAcquisition(row.acquisition, expected, businessDate);
  const reason = row.reason;
  if (reason !== null && reason !== 'no_accepted_trade_in' && reason !== 'contract_incomplete' && reason !== 'deal_unavailable' && reason !== 'vehicle_exists' && reason !== 'already_acquired') return invalid();
  if (acquisition) {
    if (reason !== 'already_acquired' || row.canAcquire || !source || !sameAcquisitionValue(source, acquisition.source)) return invalid();
  } else if (reason === 'already_acquired') return invalid();
  else if (reason === null) { if (!source || row.canAcquire !== (expected.role === 'owner' || expected.role === 'admin')) return invalid(); }
  else {
    if (row.canAcquire || (reason === 'vehicle_exists' ? !source : source !== null)) return invalid();
  }
  return { actorId: expected.userId, role: expected.role, companyId: expected.companyId, dealId: expected.dealId, businessDate, canAcquire: row.canAcquire, reason, source, acquisition };
}
export function parseTradeInAcquisitionReceipt(value: unknown, expected: AcquisitionScope, input: RecordTradeInAcquisitionInput, businessDate = stockholmAcquisitionBusinessDate()): TradeInAcquisitionReceipt {
  const row = record(value, ['actorId', 'role', 'companyId', 'dealId', 'requestId', 'acquisition']); scope(row, { ...expected, dealId: input.dealId });
  if (id(row.requestId) !== input.requestId || expected.role === 'finance') return invalid();
  const acquisition = parseTradeInAcquisition(row.acquisition, input, businessDate);
  if (acquisition.source.sourceSha256 !== input.expectedSourceSha256 || acquisition.actorLabel !== 'Du') return invalid();
  for (const key of ['acquiredOn', 'purchaseAgreementReference', 'debtConfirmedOre', 'debtConfirmedOn', 'debtEvidenceReference', 'fuel', 'gearbox', 'askingPriceOre', 'attestationVersion'] as const) if (acquisition[key] !== input[key]) return invalid();
  return { actorId: expected.userId, role: expected.role, companyId: input.companyId, dealId: input.dealId, requestId: input.requestId, acquisition };
}
