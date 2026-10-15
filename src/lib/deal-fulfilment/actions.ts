'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireFulfilmentContext } from './context';
import type { FulfilmentMutation, FulfilmentPage, FulfilmentResult, FulfilmentScope } from './types';

const uuid = z.string().uuid().transform(v => v.toLowerCase());
const scope = z.object({ companyId: uuid, dealId: uuid }).strict();
const text = z.string().trim().min(2).max(300).regex(/^[^\u0000-\u001f\u007f]+$/);
const amount = z.string().regex(/^[1-9][0-9]{0,11}$/);
const mutation = scope.extend({ requestId: uuid, expectedVersion: z.number().int().min(0).max(2147483646), operation: z.enum(['payment', 'reverse', 'deliver']), amountOre: amount.optional(), bankReference: text.optional(), bookedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), reversalOf: uuid.optional(), reason: text }).strict().superRefine((v, ctx) => {
  const valid = v.operation === 'payment' ? !!v.amountOre && !!v.bankReference && !!v.bookedOn && !v.reversalOf : v.operation === 'reverse' ? !!v.reversalOf && !v.amountOre && !v.bankReference && !v.bookedOn : !v.reversalOf && !v.amountOre && !v.bankReference && !v.bookedOn;
  if (!valid) ctx.addIssue({ code: 'custom', message: 'Invalid operation' });
});
const pageSchema = z.object({ companyId: uuid, dealId: uuid, actorId: uuid, role: z.enum(['owner', 'admin', 'finance']), version: z.number().int().nonnegative(), businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source: z.object({ offerId: uuid, signingId: uuid, archiveId: uuid, amountDueOre: amount }).strict().nullable(), blockedReason: z.enum(['accepted_offer_required', 'contract_required', 'original_required', 'trade_in_settlement_unsupported', 'deal_unavailable']).nullable(), entries: z.array(z.object({ id: uuid, amountOre: z.string().regex(/^-?[1-9][0-9]{0,11}$/), bankReference: text, bookedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reversalOf: uuid.nullable(), reason: text, actorLabel: z.enum(['Du', 'Kollega']), recordedAt: z.string().datetime({ offset: true }) }).strict()).max(500), registeredOre: z.string().regex(/^-?(0|[1-9][0-9]{0,14})$/), delivery: z.object({ id: uuid, deliveredAt: z.string().datetime({ offset: true }), actorLabel: z.enum(['Du', 'Kollega']), note: text }).strict().nullable(), canDeliver: z.boolean() }).strict();
function failure(error: unknown): FulfilmentResult {
  const code = error instanceof z.ZodError ? 'invalid_input' : error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unavailable';
  const mapped = code === '40001' || code === '23505' ? 'conflict' : code === '42501' ? 'access_denied' : code === '22023' || code === '22007' || code === '22008' ? 'invalid_input' : ['invalid_input', 'unauthenticated', 'access_denied'].includes(code) ? code as 'invalid_input' | 'unauthenticated' | 'access_denied' : 'unavailable';
  return { ok: false, code: mapped, message: mapped === 'conflict' ? 'Affären eller avstämningen har ändrats. Läs in och granska uppgifterna igen.' : mapped === 'invalid_input' ? 'Kontrollera belopp, bankreferens, datum och anledning.' : mapped === 'access_denied' || mapped === 'unauthenticated' ? 'Din aktuella behörighet kunde inte verifieras. Öppna affären igen.' : 'Resultatet kunde inte bekräftas. Försök igen med exakt samma granskade begäran.' };
}
async function execute(input: FulfilmentScope | FulfilmentMutation, write: boolean): Promise<FulfilmentResult> {
  const initial = await requireFulfilmentContext(input.companyId, write);
  const db = initial.db as unknown as SupabaseClient;
  const { data, error } = write ? await db.rpc('mutate_deal_fulfilment', { p_company_id: input.companyId, p_deal_id: input.dealId, p_input: input }) : await db.rpc('get_deal_fulfilment', { p_company_id: input.companyId, p_deal_id: input.dealId });
  if (error) throw error;
  const page: FulfilmentPage = pageSchema.parse(data);
  if (page.companyId !== input.companyId || page.dealId !== input.dealId || page.actorId !== initial.userId || page.role !== initial.role) throw { code: '42501' };
  const current = await requireFulfilmentContext(input.companyId, write);
  if (current.userId !== initial.userId || current.role !== initial.role) throw { code: '42501' };
  if (write) { revalidatePath('/deals'); revalidatePath('/inventory'); revalidatePath('/dashboard'); }
  return { ok: true, page };
}
export async function getDealFulfilmentAction(value: FulfilmentScope): Promise<FulfilmentResult> { try { return await execute(scope.parse(value), false); } catch (e) { return failure(e); } }
export async function mutateDealFulfilmentAction(value: FulfilmentMutation): Promise<FulfilmentResult> { try { return await execute(mutation.parse(value), true); } catch (e) { return failure(e); } }
