'use server';

import { z } from 'zod';
import { requireInternalFinanceContext } from '@/lib/access/internal-finance-context';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import type { VehicleCost } from './workspace';
import type { DealerRegisterScope } from '../registers/types';
import { revalidatePath } from 'next/cache';
import type { Json } from '../supabase/database.types';
import { moneyField } from './validation';
import type { VehicleCostCreateInput, VehicleCostCreateReceipt, VehicleCostCreateResult } from './vehicle-cost-create-types';

export type VehicleCostsInput = { stockItemId: string; expectedCompanyId: string };
export type VehicleCostsResult = ({ ok: true; stockItemId: string; costs: VehicleCost[] } & DealerRegisterScope) | { ok: false; error: string };
const inputSchema = z.object({ stockItemId: z.string().uuid(), expectedCompanyId: z.string().uuid() }).strict();
const roleSchema = z.enum(['owner', 'admin', 'finance']);
const rowSchema = z.object({
  id: z.string().uuid(), company_id: z.string().uuid(), stock_item_id: z.string().uuid(),
  category: z.enum(['repair', 'transport', 'inspection', 'finance', 'other']),
  description: z.string(), amount_ore: z.number().int().nonnegative().safe(),
  incurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), created_at: z.string().datetime({ offset: true }),
});
const failure = (): VehicleCostsResult => ({ ok: false, error: 'Bilens kostnader kunde inte verifieras. Kontrollera ditt företagsval och försök igen.' });
async function freshScope(companyId: string) {
  const current = await requireInternalFinanceContext(companyId);
  return { ...current, role: roleSchema.parse(current.role), db: current.db as unknown as SupabaseClient<Database> };
}

/** Invoked only for an opened vehicle. Never infer a zero from a failed read. */
export async function loadVehicleCosts(value: unknown): Promise<VehicleCostsResult> {
  try {
    const input = inputSchema.parse(value);
    const requestedCompany = input.expectedCompanyId.toLowerCase();
    const initial = await freshScope(requestedCompany);
    const { db, role } = initial;
    const companyId = z.string().uuid().parse(initial.companyId).toLowerCase();
    const actorId = z.string().uuid().parse(initial.userId).toLowerCase();
    const stockItemId = input.stockItemId.toLowerCase();
    if (companyId !== requestedCompany) return failure();
    const stock = await db.from('stock_items').select('id,company_id').eq('company_id', companyId).eq('id', stockItemId).maybeSingle();
    if (stock.error || !stock.data || stock.data.id !== stockItemId || stock.data.company_id !== companyId) return failure();
    const costs: VehicleCost[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      let query = db.from('vehicle_costs').select('id,company_id,stock_item_id,category,description,amount_ore,incurred_on,created_at', { count: 'exact' })
        .eq('company_id', companyId).eq('stock_item_id', stockItemId).order('id').limit(500);
      if (cursor) query = query.gt('id', cursor);
      const { data, error, count } = await query;
      if (error || !data || count === null || !Number.isSafeInteger(count) || count < data.length) return failure();
      const rows = z.array(rowSchema).parse(data);
      for (const row of rows) {
        if (row.company_id !== companyId || row.stock_item_id !== stockItemId || seen.has(row.id) || (cursor && row.id <= cursor)) return failure();
        seen.add(row.id); cursor = row.id;
        costs.push({ id: row.id, stock_item_id: row.stock_item_id, category: row.category, description: row.description, amount_ore: row.amount_ore, incurred_on: row.incurred_on, created_at: row.created_at });
      }
      // Count is scoped after the cursor. It also handles Data API row caps
      // below 500 without silently treating a short page as the whole result.
      if (count === rows.length) break;
      if (!rows.length) return failure();
    }
    const fresh = await freshScope(requestedCompany);
    if (fresh.companyId !== companyId || fresh.userId !== actorId || fresh.role !== role) return failure();
    const currentStock = await fresh.db.from('stock_items').select('id,company_id').eq('company_id', companyId).eq('id', stockItemId).maybeSingle();
    if (currentStock.error || !currentStock.data || currentStock.data.id !== stockItemId || currentStock.data.company_id !== companyId) return failure();
    costs.sort((left, right) => right.incurred_on.localeCompare(left.incurred_on) || right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
    return { ok: true, companyId, actorId, role, stockItemId, costs };
  } catch { return failure(); }
}

const createInput = z.object({
  companyId: z.string().uuid(), requestId: z.string().uuid(), stockItemId: z.string().uuid(),
  category: rowSchema.shape.category,
  description: z.string().trim().min(1).max(500).refine(value => !/[\u0000-\u001f\u007f-\u009f]/.test(value)),
  amount: z.string().trim().min(1).max(160), incurredOn: z.string().regex(/^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
}).strict();
const createReceipt = z.object({
  companyId: z.string().uuid(), actorId: z.string().uuid(), requestId: z.string().uuid(), kind: z.literal('vehicle_cost'),
  recordId: z.string().uuid(), stockItemId: z.string().uuid(), category: rowSchema.shape.category,
  description: z.string(), amountOre: z.string().regex(/^(0|[1-9][0-9]*)$/), incurredOn: z.string(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
type CostCreateDatabase = Omit<Database, 'public'> & { public: Omit<Database['public'], 'Functions'> & { Functions: Database['public']['Functions'] & {
  create_vehicle_cost_request: { Args: { p_company_id: string; p_request_id: string; p_stock_item_id: string; p_category: string; p_description: string; p_amount_ore: number; p_incurred_on: string }; Returns: Json };
} } };

/** A durable request is replayed, never deduplicated by description or amount. */
export async function createVehicleCostRequestAction(value: VehicleCostCreateInput): Promise<VehicleCostCreateResult> {
  let input: VehicleCostCreateInput, amount: number;
  try {
    const parsed = createInput.parse(value);
    input = { ...parsed, companyId: parsed.companyId.toLowerCase(), stockItemId: parsed.stockItemId.toLowerCase(), requestId: parsed.requestId.toLowerCase() };
    const date = new Date(`${input.incurredOn}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.incurredOn) throw Error('Invalid cost date');
    const fields = new FormData(); fields.set('amount', input.amount); amount = moneyField(fields, 'amount', true);
  } catch { return { ok: false, code: 'invalid_input', message: 'Kontrollera kostnadstyp, beskrivning, belopp och kostnadsdatum.' }; }
  try {
    const initial = await requireInternalFinanceContext(input.companyId, true);
    const db = initial.db as unknown as SupabaseClient<CostCreateDatabase>;
    const result = await db.rpc('create_vehicle_cost_request', {
      p_company_id: input.companyId, p_request_id: input.requestId, p_stock_item_id: input.stockItemId,
      p_category: input.category, p_description: input.description, p_amount_ore: amount, p_incurred_on: input.incurredOn,
    }).abortSignal(AbortSignal.timeout(15000));
    if (result.error) throw result.error;
    const receipt: VehicleCostCreateReceipt = createReceipt.parse(result.data);
    if (receipt.companyId !== input.companyId || receipt.actorId !== initial.userId || receipt.requestId !== input.requestId
      || receipt.stockItemId !== input.stockItemId || receipt.category !== input.category || receipt.description !== input.description
      || receipt.amountOre !== String(amount) || receipt.incurredOn !== input.incurredOn) throw Error('Cost receipt mismatch');
    const fresh = await requireInternalFinanceContext(input.companyId, true);
    if (fresh.userId !== initial.userId || fresh.companyId !== initial.companyId || fresh.role !== initial.role) throw Object.assign(Error('Access changed'), { code: 'access_denied' });
    try { revalidatePath('/dashboard'); revalidatePath('/inventory'); } catch { /* A durable, verified receipt still confirms the write. */ }
    return { ok: true, receipt };
  } catch (error) {
    const raw = error && typeof error === 'object' && 'code' in error ? error.code : null;
    const code = ['42501', 'access_denied', 'unauthenticated'].includes(String(raw)) ? 'access_denied' as const
      : raw === '40001' || raw === '23505' ? 'conflict' as const : ['22023', '22007', '22008', '22P02', '23503'].includes(String(raw)) ? 'invalid_input' as const : 'unavailable' as const;
    return { ok: false, code, message: code === 'access_denied' ? 'Din behörighet till bilens kostnader kunde inte verifieras. Läs in sidan igen.'
      : code === 'conflict' ? 'Begäran har redan använts med andra uppgifter. Kontrollera tidigare kostnader innan du startar en ny registrering.'
      : code === 'invalid_input' ? 'Kostnadsuppgifterna kunde inte godkännas. Kontrollera bilen, beloppet och datumet.'
      : 'Kostnaden kunde inte bekräftas. Behåll samma uppgifter och kontrollera samma begäran igen.' };
  }
}
