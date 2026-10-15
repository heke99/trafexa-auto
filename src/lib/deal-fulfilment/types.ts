export type FulfilmentRole = 'owner' | 'admin' | 'finance';
export type PaymentEntry = { id: string; amountOre: string; bankReference: string; bookedOn: string; reversalOf: string | null; reason: string; actorLabel: 'Du' | 'Kollega'; recordedAt: string };
export type DeliveryReceipt = { id: string; deliveredAt: string; actorLabel: 'Du' | 'Kollega'; note: string };
export type FulfilmentPage = { companyId: string; dealId: string; actorId: string; role: FulfilmentRole; version: number; businessDate: string; source: { offerId: string; signingId: string; archiveId: string; amountDueOre: string } | null; blockedReason: 'accepted_offer_required' | 'contract_required' | 'original_required' | 'trade_in_settlement_unsupported' | 'deal_unavailable' | null; entries: PaymentEntry[]; registeredOre: string; delivery: DeliveryReceipt | null; canDeliver: boolean };
export type FulfilmentResult = { ok: true; page: FulfilmentPage } | { ok: false; code: 'invalid_input' | 'unauthenticated' | 'access_denied' | 'conflict' | 'unavailable'; message: string };
export type FulfilmentScope = { companyId: string; dealId: string };
export type FulfilmentMutation = FulfilmentScope & { requestId: string; expectedVersion: number; operation: 'payment' | 'reverse' | 'deliver'; amountOre?: string; bankReference?: string; bookedOn?: string; reversalOf?: string; reason: string };
