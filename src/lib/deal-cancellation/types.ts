export type CancellableDealStatus = 'draft' | 'reserved';
export type CancelDealInput = { companyId: string; dealId: string; expectedStatus: CancellableDealStatus; reason: string; requestId: string };
export type DealCancellationReceipt = { companyId: string; requestId: string; dealId: string; status: 'cancelled'; previousStatus: CancellableDealStatus; reason: string; releasedReservations: number; stockId: string };
export type DealCancellationResult = ({ ok: true } & DealCancellationReceipt) | { ok: false; code: 'invalid_input' | 'unauthenticated' | 'access_denied' | 'conflict' | 'unavailable'; message: string };
