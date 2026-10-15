'use server';

import { z } from 'zod';
import { requireCrmContext } from '../crm/context';
import { requireApprovedAccountAccess } from '../account-access/context';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import type { VehicleCost } from './workspace';
import type { DealerRegisterScope } from '../registers/types';

export type VehicleCostsInput = { stockItemId: string; expectedCompanyId: string };
export type VehicleCostsResult = ({ ok: true; stockItemId: string; costs: VehicleCost[] } & DealerRegisterScope) | { ok: false; error: string };
const inputSchema = z.object({ stockItemId: z.string().uuid(), expectedCompanyId: z.string().uuid() }).strict();
const roleSchema = z.enum(['owner', 'admin', 'sales', 'finance', 'viewer']);
const rowSchema = z.object({
  id: z.string().uuid(), company_id: z.string().uuid(), stock_item_id: z.string().uuid(),
  category: z.enum(['repair', 'transport', 'inspection', 'finance', 'other']),
  description: z.string(), amount_ore: z.number().int().nonnegative().safe(),
  incurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), created_at: z.string().datetime({ offset: true }),
});
const failure = (): VehicleCostsResult => ({ ok: false, error: 'Bilens kostnader kunde inte verifieras. Kontrollera ditt företagsval och försök igen.' });
async function freshScope(companyId: string) {
  const current = await requireCrmContext(companyId);
  // Approval is checked without the request's React company-session cache.
  const access = await requireApprovedAccountAccess();
  if (access.userId !== current.userId) throw new Error('Scope changed');
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
