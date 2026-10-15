export type CustomerCreateInput = { companyId: string; requestId: string; name: string; kind: 'person' | 'business'; email: string; phone: string; address: string; notes: string };
export type FinanceIntakeCreateInput = { companyId: string; requestId: string; product: 'purchase' | 'stock'; dealId: string | null; requestedAmount: string; deposit: string; termMonths: string; note: string };
export type DealerCreateReceipt = { companyId: string; actorId: string; requestId: string; kind: 'customer' | 'finance_intake'; recordId: string; createdAt: string };
export type DealerCreateResult = { ok: true; receipt: DealerCreateReceipt } | { ok: false; code: 'invalid_input' | 'access_denied' | 'company_changed' | 'conflict' | 'unavailable'; message: string };
