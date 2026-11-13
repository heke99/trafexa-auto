'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireFulfilmentContext } from './context';
import type { FulfilmentMutation, FulfilmentPage, FulfilmentResult, FulfilmentScope } from './types';

const uuid = z.string().uuid().transform(v => v.toLowerCase());
const scope = z.object({ companyId: uuid, dealId: uuid }).strict();
const text = z.string().trim().min(2).max(300).regex(/^[^\u0000-\u001f\u007f]+$/);
const amount = z.string().regex(/^[1-9][0-9]{0,12}$/).refine(v=>/^[0-9]+$/.test(v)&&BigInt(v)<=1999999999998n);
const nonnegative=z.string().regex(/^(0|[1-9][0-9]{0,12})$/).refine(v=>/^[0-9]+$/.test(v)&&BigInt(v)<=1999999999998n);
const signed=z.string().regex(/^-?(0|[1-9][0-9]{0,12})$/).refine(v=>/^-?[0-9]+$/.test(v)&&BigInt(v)>=-1999999999998n&&BigInt(v)<=1999999999998n);
const category=z.enum(['customer_incoming','customer_payout','lender_payment']);
const trade=z.object({tradeInId:uuid,tradeInVersion:z.number().int().positive(),salePriceOre:amount.refine(v=>BigInt(v)<=999999999999n),valueOre:amount.refine(v=>BigInt(v)<=999999999999n),debtOre:nonnegative.refine(v=>BigInt(v)<=999999999999n),netCashOre:signed,customerIncomingOre:nonnegative,customerPayoutOre:nonnegative,lenderPaymentOre:nonnegative,acquisitionId:uuid.nullable(),acquired:z.boolean()}).strict().superRefine((t,c)=>{const net=BigInt(t.salePriceOre)-BigInt(t.valueOre)+BigInt(t.debtOre);if(net!==BigInt(t.netCashOre)||BigInt(t.customerIncomingOre)!==(net>0n?net:0n)||BigInt(t.customerPayoutOre)!==(net<0n?-net:0n)||t.lenderPaymentOre!==t.debtOre||t.acquired!==(t.acquisitionId!==null))c.addIssue({code:'custom',message:'Settlement arithmetic mismatch'});});
const mutation = scope.extend({ requestId: uuid, expectedVersion: z.number().int().min(0).max(2147483646), operation: z.enum(['payment', 'reverse', 'deliver']), category:category.optional(),acknowledged:z.literal(true).optional(),expectedDocumentHash:z.string().regex(/^[a-f0-9]{64}$/).optional(), amountOre: amount.optional(), bankReference: text.optional(), bookedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), reversalOf: uuid.optional(), reason: text }).strict().superRefine((v, ctx) => {
  const valid = v.operation === 'payment' ? !!v.amountOre && !!v.bankReference && !!v.bookedOn && !v.reversalOf : v.operation === 'reverse' ? !!v.reversalOf && !v.amountOre && !v.bankReference && !v.bookedOn : !v.reversalOf && !v.amountOre && !v.bankReference && !v.bookedOn;
  if(v.amountOre&&/^[0-9]+$/.test(v.amountOre)&&!v.expectedDocumentHash&&BigInt(v.amountOre)>999999999999n)ctx.addIssue({code:'custom',message:'Ordinary payment cap'});
  if (v.operation!=='payment'&&v.category!==undefined||!!v.acknowledged!==!!v.expectedDocumentHash)ctx.addIssue({code:'custom',message:'Invalid settlement review'});
  if (!valid) ctx.addIssue({ code: 'custom', message: 'Invalid operation' });
});
const pageSchema = z.object({ companyId: uuid, dealId: uuid, actorId: uuid, role: z.enum(['owner', 'admin', 'finance']), version: z.number().int().nonnegative(), businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source: z.object({ offerId: uuid.nullable(), sourceKind:z.literal('direct_deal').optional(),documentHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),tradeIn:trade.optional(),signingId: uuid, archiveId: uuid, amountDueOre: nonnegative }).strict().superRefine((source,ctx)=>{if(source.offerId===null?(source.sourceKind!=='direct_deal'||!source.documentHash):(source.sourceKind!==undefined||source.documentHash!==undefined&&!source.tradeIn))ctx.addIssue({code:'custom',message:'Invalid fulfilment origin'});}).nullable(), blockedReason: z.enum(['accepted_offer_required', 'contract_required', 'original_required', 'trade_in_settlement_unsupported', 'deal_unavailable']).nullable(), settlement:z.object({customerIncomingOre:signed,customerPayoutOre:signed,lenderPaymentOre:signed}).strict().optional(),entries: z.array(z.object({ category:category.optional(),id: uuid, amountOre: z.string().regex(/^-?[1-9][0-9]{0,12}$/).refine(v=>/^-?[0-9]+$/.test(v)&&BigInt(v)>=-1999999999998n&&BigInt(v)<=1999999999998n), bankReference: text, bookedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reversalOf: uuid.nullable(), reason: text, actorLabel: z.enum(['Du', 'Kollega']), recordedAt: z.string().datetime({ offset: true }) }).strict()).max(500), registeredOre: z.string().regex(/^-?(0|[1-9][0-9]{0,14})$/), delivery: z.object({ id: uuid, deliveredAt: z.string().datetime({ offset: true }), actorLabel: z.enum(['Du', 'Kollega']), note: text }).strict().nullable(), canDeliver: z.boolean() }).strict().superRefine((p,c)=>{const t=p.source?.tradeIn;if(!t)return;const sums={customer_incoming:0n,customer_payout:0n,lender_payment:0n};for(const e of p.entries){sums[e.category??'customer_incoming']+=BigInt(e.amountOre);}const totals=p.settlement;if(!p.source?.documentHash||p.source.amountDueOre!==t.customerIncomingOre||!totals||BigInt(p.registeredOre)!==sums.customer_incoming||BigInt(totals.customerIncomingOre)!==sums.customer_incoming||BigInt(totals.customerPayoutOre)!==sums.customer_payout||BigInt(totals.lenderPaymentOre)!==sums.lender_payment||sums.customer_incoming<0n||sums.customer_incoming>BigInt(t.customerIncomingOre)||sums.customer_payout<0n||sums.customer_payout>BigInt(t.customerPayoutOre)||sums.lender_payment<0n||sums.lender_payment>BigInt(t.lenderPaymentOre)||p.canDeliver&&(!t.acquired||sums.customer_incoming!==BigInt(t.customerIncomingOre)||sums.customer_payout!==BigInt(t.customerPayoutOre)||sums.lender_payment!==BigInt(t.lenderPaymentOre)))c.addIssue({code:'custom',message:'Settlement ledger mismatch'});});
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
