'use server';

import { revalidatePath } from 'next/cache';
import { CrmError } from '@/lib/crm/context';
import { requireDealCancellationContext } from '@/lib/deal-cancellation/context';
import type { CancelDealInput, DealCancellationResult } from '@/lib/deal-cancellation/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('invalid');
  return value.toLowerCase();
}
function reason(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid');
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 500 || /[\u0000-\u001f\u007f]/.test(trimmed)) throw new Error('invalid');
  return trimmed;
}
function failure(error: unknown, invalid = false): DealCancellationResult {
  const raw = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const code = invalid ? 'invalid_input' : error instanceof CrmError ? error.code : raw === '40001' ? 'conflict' : raw === '42501' ? 'access_denied' : 'unavailable';
  return { ok: false, code, message: code === 'invalid_input' ? 'Ange en anledning på 2–500 tecken utan radbrytningar.' : code === 'conflict' ? 'Affären har ändrats eller offerten har accepterats. Uppdatera affären. En accepterad offert behöver hanteras genom en separat överenskommelse.' : code === 'access_denied' || code === 'unauthenticated' ? 'Din behörighet kunde inte verifieras. Öppna affären igen.' : 'Avbrytningen kunde inte bekräftas. Uppdatera affären eller försök igen med exakt samma anledning och begäran.' };
}

export async function cancelDealAction(value: CancelDealInput): Promise<DealCancellationResult> {
  let args: CancelDealInput;
  try {
    const input = record(value);
    if (Object.keys(input).some(key => !['companyId', 'dealId', 'expectedStatus', 'reason', 'requestId'].includes(key)) || !['draft', 'reserved'].includes(String(input.expectedStatus))) throw new Error('invalid');
    args = { companyId: id(input.companyId), dealId: id(input.dealId), expectedStatus: input.expectedStatus as CancelDealInput['expectedStatus'], reason: reason(input.reason), requestId: id(input.requestId) };
  } catch (error) { return failure(error, true); }
  try {
    const context = await requireDealCancellationContext(args.companyId);
    const { data, error } = await context.db.rpc('cancel_deal', { p_company_id: args.companyId, p_deal_id: args.dealId, p_expected_status: args.expectedStatus, p_reason: args.reason, p_request_id: args.requestId });
    if (error) throw error;
    const receipt = record(data);
    if (id(receipt.companyId) !== args.companyId || id(receipt.actorUserId) !== context.userId || id(receipt.requestId) !== args.requestId || id(receipt.dealId) !== args.dealId || receipt.status !== 'cancelled' || receipt.previousStatus !== args.expectedStatus || receipt.reason !== args.reason || !Number.isSafeInteger(receipt.releasedReservations) || Number(receipt.releasedReservations) < 0 || Number(receipt.releasedReservations) > 2147483647) throw new Error('invalid receipt');
    const stockId = id(receipt.stockId);
    const fresh = await requireDealCancellationContext(args.companyId);
    if (fresh.userId !== context.userId || fresh.role !== context.role) throw new CrmError('access_denied');
    revalidatePath('/deals'); revalidatePath('/inventory'); revalidatePath('/dashboard');
    return { ok: true, companyId: args.companyId, requestId: args.requestId, dealId: args.dealId, status: 'cancelled', previousStatus: args.expectedStatus, reason: args.reason, releasedReservations: receipt.releasedReservations as number, stockId };
  } catch (error) { return failure(error); }
}
