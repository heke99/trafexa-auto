'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActiveCompanyContext } from './company-context';
import { object, keys, uuid, parseCalculationSource, parseInventoryDashboardTotals } from '../calculations/source';
import { calculateVehicle, parseOre, type VehicleCalculation, type VehicleCalculationSource, type InventoryDashboardTotals } from '../calculations/vehicle-calculation';
import type { CalculationDatabase } from '../calculations/database.types';
import { requireInternalFinanceContext } from '@/lib/access/internal-finance-context';
import { requireCrmContext, CrmError } from '@/lib/crm/context';
import { requireApprovedAccountAccess } from '@/lib/account-access/context';

type CalculationFailureCode = 'invalid_input' | 'access_denied' | 'conflict' | 'unavailable';
export type CalculationResult = { ok: true; source: VehicleCalculationSource; calculation: VehicleCalculation } | { ok: false; code: CalculationFailureCode; message: string; conflict?: boolean };
export type CalculationMetadataInput = { stockItemId: string; companyId: string; expectedVersion: string; purchaseVatOre: string | null; vatBasisConfirmed: boolean; costVat: { costId: string; deductibleVatOre: string | null }[] };
export type { InventoryDashboardTotals } from '../calculations/vehicle-calculation';
function fail(code: CalculationFailureCode = 'unavailable'): CalculationResult { return { ok: false, code, conflict: code === 'conflict', message: code === 'access_denied' ? 'Din aktuella behörighet till kalkylen kunde inte verifieras. Läs in sidan igen.' : code === 'conflict' ? 'Pris eller kostnadsunderlag har ändrats. Läs in kalkylen igen innan du bekräftar momsen.' : 'Kalkylens underlag kunde inte verifieras. Kontrollera företagsvalet och försök igen.' }; }
function failure(error: unknown): CalculationResult {
  const raw = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return fail(['42501','access_denied','unauthenticated'].includes(String(raw)) ? 'access_denied' : raw === '40001' ? 'conflict' : raw === '22023' ? 'invalid_input' : 'unavailable');
}
async function context(expectedCompany?: string, write = false, financial = true) {
  const session = await getActiveCompanyContext();
  const companyId = uuid(session.company);
  if (expectedCompany !== undefined && companyId !== uuid(expectedCompany)) throw new CrmError('access_denied');
  const current = financial ? await requireInternalFinanceContext(companyId, write) : await requireCrmContext(companyId);
  if (current.userId !== session.user) throw new CrmError('access_denied');
  if (!financial && (await requireApprovedAccountAccess()).userId !== current.userId) throw new CrmError('access_denied');
  return { ...current, db: current.db as unknown as SupabaseClient<CalculationDatabase>, companyId };
}
async function fresh(initial: Awaited<ReturnType<typeof context>>, write = false, financial = true) {
  const current = await context(initial.companyId, write, financial);
  if (current.userId !== initial.userId || current.role !== initial.role) throw new CrmError('access_denied');
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
    if (error) return failure(error);
    const result = proof(data, session.companyId, stockItemId);
    await fresh(session);
    return result;
  } catch (error) { return failure(error); }
}
export async function saveVehicleCalculationMetadataAction(value: unknown): Promise<CalculationResult> {
  let validated = false;
  try {
    const input = object(value); keys(input, ['stockItemId', 'companyId', 'expectedVersion', 'purchaseVatOre', 'vatBasisConfirmed', 'costVat']);
    const stockItemId = uuid(input.stockItemId), companyId = uuid(input.companyId);
    const version = parseOre(input.expectedVersion); if (version < 1n) throw new Error();
    const purchaseVatOre = input.purchaseVatOre === null ? null : parseOre(input.purchaseVatOre).toString();
    if (typeof input.vatBasisConfirmed !== 'boolean' || !Array.isArray(input.costVat) || input.costVat.length > 10000) throw new Error();
    const costVat = input.costVat.map(value => { const row = object(value); keys(row, ['costId', 'deductibleVatOre']);
      return { costId: uuid(row.costId), deductibleVatOre: row.deductibleVatOre === null ? null : parseOre(row.deductibleVatOre).toString() }; });
    if (new Set(costVat.map(cost => cost.costId)).size !== costVat.length) throw new Error();
    validated = true;
    const session = await context(companyId, true);
    const { data, error } = await session.db.rpc('save_vehicle_calculation_metadata', { p_company_id: companyId, p_stock_item_id: stockItemId, p_expected_version: version.toString(), p_purchase_vat_ore: purchaseVatOre, p_vat_basis_confirmed: input.vatBasisConfirmed, p_cost_vat: costVat });
    if (error?.code === '22023') return { ok: false, code: 'invalid_input', message: 'Momsavdraget måste följa underlaget och får inte överstiga momsandelen vid 25 % moms. Kontrollera beloppen och VMB-villkoren.' };
    if (error) return failure(error);
    const result = proof(data, companyId, stockItemId);
    if (!result.ok || BigInt(result.source.version) < version || result.source.purchaseVatOre !== purchaseVatOre || result.source.vatBasisConfirmed !== input.vatBasisConfirmed
      || result.source.costs.length !== costVat.length || result.source.costs.some(cost => !costVat.some(row => row.costId === cost.id && row.deductibleVatOre === cost.deductibleVatOre))) return fail();
    await fresh(session, true);
    try { revalidatePath('/inventory'); } catch { /* Verified persisted source remains usable. */ }
    return result;
  } catch (error) { return validated ? failure(error) : fail('invalid_input'); }
}
export async function getInventoryDashboardTotalsAction(expectedCompany: string): Promise<{ ok: true; totals: InventoryDashboardTotals } | { ok: false; message: string }> {
  try {
    const session = await context(uuid(expectedCompany), false, false);
    const { data, error } = await session.db.rpc('inventory_dashboard_totals', { p_company_id: session.companyId });
    if (error) throw new Error();
    const totals = parseInventoryDashboardTotals(data, session.companyId, session.role);
    await fresh(session, false, false);
    return { ok: true, totals };
  } catch { return { ok: false, message: 'Företagets totalsiffror kunde inte verifieras.' }; }
}
