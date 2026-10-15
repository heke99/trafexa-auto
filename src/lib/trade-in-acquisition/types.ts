import type { OfferSnapshot } from '../documents/offer-pdf';

export const TRADE_IN_ACQUISITION_ATTESTATION_VERSION = '2026-10-15' as const;
export type TradeInAcquisitionRole = 'owner' | 'admin' | 'finance';
export type TradeInAcquisitionReason = 'no_accepted_trade_in' | 'contract_incomplete' | 'deal_unavailable' | 'vehicle_exists' | 'already_acquired';
export type TradeInAcquisitionSource = {
  companyId: string; dealId: string; offerId: string; offerVersion: number; tradeInId: string; tradeInVersion: number;
  sellerCustomerId: string; signingId: string; signingDocumentSha256: string; signingRevision: 3;
  offerSnapshot: OfferSnapshot & { trade_in: NonNullable<OfferSnapshot['trade_in']> };
  sourceSha256: string;
};
export type TradeInAcquisition = {
  id: string; companyId: string; dealId: string; source: TradeInAcquisitionSource; vehicleId: string; stockItemId: string;
  acquiredOn: string; purchaseAgreementReference: string; debtConfirmedOre: string; debtConfirmedOn: string; debtEvidenceReference: string;
  fuel: 'petrol' | 'diesel' | 'electric' | 'hybrid' | 'other'; gearbox: 'automatic' | 'manual';
  askingPriceOre: string; purchasePriceOre: string; vatScheme: 'unknown';
  attestationVersion: typeof TRADE_IN_ACQUISITION_ATTESTATION_VERSION;
  createdAt: string; actorLabel: 'Du' | 'Kollega';
};
export type TradeInAcquisitionPage = {
  actorId: string; role: TradeInAcquisitionRole; companyId: string; dealId: string; businessDate: string;
  canAcquire: boolean; reason: TradeInAcquisitionReason | null;
  source: TradeInAcquisitionSource | null; acquisition: TradeInAcquisition | null;
};
export type RecordTradeInAcquisitionInput = {
  companyId: string; dealId: string; expectedSourceSha256: string; acquiredOn: string; purchaseAgreementReference: string;
  debtConfirmedOre: string; debtConfirmedOn: string; debtEvidenceReference: string;
  fuel: TradeInAcquisition['fuel']; gearbox: TradeInAcquisition['gearbox']; askingPriceOre: string;
  purchaseConfirmed: boolean; receivedConfirmed: boolean; debtConfirmed: boolean; reviewAcknowledged: boolean;
  attestationVersion: typeof TRADE_IN_ACQUISITION_ATTESTATION_VERSION; requestId: string;
};
export type TradeInAcquisitionReadInput = { companyId: string; dealId: string };
export type TradeInAcquisitionReceipt = { actorId: string; role: TradeInAcquisitionRole; companyId: string; dealId: string; requestId: string; acquisition: TradeInAcquisition };
export type TradeInAcquisitionCode = 'unauthenticated' | 'access_denied' | 'invalid_input' | 'conflict' | 'unavailable';
export type TradeInAcquisitionResult<T> = ({ ok: true } & T) | { ok: false; code: TradeInAcquisitionCode; error: string };
