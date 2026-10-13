'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActiveCompanyContext } from './company-context';
import { object, keys, uuid, parseCalculationSource, parseInventoryDashboardTotals } from '../calculations/source';
import { calculateVehicle, parseOre, type VehicleCalculation, type VehicleCalculationSource, type InventoryDashboardTotals } from '../calculations/vehicle-calculation';
import type { CalculationDatabase } from '../calculations/database.types';

export type CalculationResult = { ok: true; source: VehicleCalculationSource; calculation: VehicleCalculation } | { ok: false; message: string; conflict?: boolean };
export type CalculationMetadataInput = { stockItemId: string; companyId: string; expectedVersion: string; purchaseVatOre: string | null; vatBasisConfirmed: boolean; costVat: { costId: string; deductibleVatOre: string | null }[] };
export type { InventoryDashboardTotals } from '../calculations/vehicle-calculation';
function fail(conflict = false): CalculationResult { return { ok: false, conflict, message: conflict ? 'Pris eller kostnadsunderlag har ändrats. Läs in kalkylen igen innan du bekräftar momsen.' : 'Kalkylens underlag kunde inte verifieras. Kontrollera företagsvalet och försök igen.' }; }
async function context(expectedCompany?: string) {
  const session = await getActiveCompanyContext();
  const companyId = uuid(session.company);
  if (expectedCompany !== undefined && companyId !== uuid(expectedCompany)) throw new Error();
  const { data, error } = await session.db.auth.getUser();
  if (error || !data?.user || data.user.id !== session.user || data.user.is_anonymous || !data.user.email_confirmed_at || !Number.isFinite(Date.parse(data.user.email_confirmed_at))) throw new Error();
  return { ...session, db: session.db as unknown as SupabaseClient<CalculationDatabase>, companyId };
}
function proof(value: unknown, companyId: string, stockItemId: string): CalculationResult {
  const source = parseCalculationSource(value, companyId, stockItemId);
  return { ok: true, source, calculation: calculateVehicle(source) };
}
export async function getVehicleCalculationAction(value: unknown): Promise<CalculationResult> {
  try {
    const input = object(value); keys(input, ['stockItemId', 'companyId']);
    const stockItemId = uuid(input.stockItemId);
    const session = await context(input.companyId === undefined ? undefined : uuid(input.companyId));
    const { data, error } = await session.db.rpc('get_vehicle_calculation', { p_company_id: session.companyId, p_stock_item_id: stockItemId });
    if (error) return fail();
    return proof(data, session.companyId, stockItemId);
  } catch { return fail(); }
}
export async function saveVehicleCalculationMetadataAction(value: unknown): Promise<CalculationResult> {
  try {
    const input = object(value); keys(input, ['stockItemId', 'companyId', 'expectedVersion', 'purchaseVatOre', 'vatBasisConfirmed', 'costVat']);
    const stockItemId = uuid(input.stockItemId), companyId = uuid(input.companyId);
    const version = parseOre(input.expectedVersion); if (version < 1n) throw new Error();
    const purchaseVatOre = input.purchaseVatOre === null ? null : parseOre(input.purchaseVatOre).toString();
    if (typeof input.vatBasisConfirmed !== 'boolean' || !Array.isArray(input.costVat) || input.costVat.length > 10000) throw new Error();
    const costVat = input.costVat.map(value => { const row = object(value); keys(row, ['costId', 'deductibleVatOre']);
      return { costId: uuid(row.costId), deductibleVatOre: row.deductibleVatOre === null ? null : parseOre(row.deductibleVatOre).toString() }; });
    if (new Set(costVat.map(cost => cost.costId)).size !== costVat.length) throw new Error();
    const session = await context(companyId);
    if (!['owner', 'admin', 'sales'].includes(session.role)) return fail();
    const { data, error } = await session.db.rpc('save_vehicle_calculation_metadata', { p_company_id: companyId, p_stock_item_id: stockItemId, p_expected_version: version.toString(), p_purchase_vat_ore: purchaseVatOre, p_vat_basis_confirmed: input.vatBasisConfirmed, p_cost_vat: costVat });
    if (error?.code === '22023') return { ok: false, message: 'Momsavdraget måste följa underlaget och får inte överstiga momsandelen vid 25 % moms. Kontrollera beloppen och VMB-villkoren.' };
    if (error) return fail(error.code === '40001');
    const result = proof(data, companyId, stockItemId);
    if (!result.ok || BigInt(result.source.version) < version || result.source.purchaseVatOre !== purchaseVatOre || result.source.vatBasisConfirmed !== input.vatBasisConfirmed
      || result.source.costs.length !== costVat.length || result.source.costs.some(cost => !costVat.some(row => row.costId === cost.id && row.deductibleVatOre === cost.deductibleVatOre))) return fail();
    try { revalidatePath('/inventory'); } catch { /* Verified persisted source remains usable. */ }
    return result;
  } catch { return fail(); }
}
export async function getInventoryDashboardTotalsAction(expectedCompany: string): Promise<{ ok: true; totals: InventoryDashboardTotals } | { ok: false; message: string }> {
  try {
    const session = await context(uuid(expectedCompany));
    const { data, error } = await session.db.rpc('inventory_dashboard_totals', { p_company_id: session.companyId });
    if (error) throw new Error();
    const totals = parseInventoryDashboardTotals(data, session.companyId);
    return { ok: true, totals };
  } catch { return { ok: false, message: 'Företagets totalsiffror kunde inte verifieras.' }; }
}
