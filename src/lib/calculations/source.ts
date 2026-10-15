import { calculateVehicle, parseOre, MAX_TOTAL_ORE, type VehicleCalculationSource, type InventoryDashboardTotals } from './vehicle-calculation';
import { canReadInternalFinance } from '@/lib/access/dealer-capabilities';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Ogiltig referens.'); return value.toLowerCase(); }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Ogiltigt underlag.');
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Okända uppgifter.'); }
export function parseInventoryDashboardTotals(value: unknown, companyId: string, role: string): InventoryDashboardTotals {
  const row = object(value); if (uuid(row.companyId) !== companyId) throw new Error('Totalsiffrorna hör till ett annat företag.');
  const totals: InventoryDashboardTotals = { companyId, activeStockCount: '', availableStockCount: '', purchaseValueOre: '', activeDealCount: '', reservedDealCount: '', customerCount: '' };
  for (const key of ['activeStockCount', 'availableStockCount', 'activeDealCount', 'reservedDealCount', 'customerCount'] as const) totals[key] = parseOre(row[key], MAX_TOTAL_ORE).toString();
  if (canReadInternalFinance(role)) totals.purchaseValueOre = parseOre(row.purchaseValueOre, MAX_TOTAL_ORE).toString();
  else { if (row.purchaseValueOre !== null) throw new Error('Inköpsvärdet får inte lämnas ut för den här rollen.'); totals.purchaseValueOre = null; }
  if (BigInt(totals.availableStockCount) > BigInt(totals.activeStockCount) || BigInt(totals.reservedDealCount) > BigInt(totals.activeDealCount)) throw new Error('Totalsiffrorna stämmer inte.');
  return totals;
}
export function parseCalculationSource(value: unknown, companyId: string, stockItemId: string): VehicleCalculationSource {
  const row = object(value);
  if (uuid(row.companyId) !== companyId || uuid(row.stockItemId) !== stockItemId || parseOre(row.version) < BigInt(1)
    || !['standard', 'vmb', 'unknown'].includes(String(row.vatScheme)) || typeof row.vatBasisConfirmed !== 'boolean'
    || !Array.isArray(row.costs) || row.costs.length > 10000) throw new Error('Kalkylen kunde inte verifieras.');
  const source: VehicleCalculationSource = { companyId, stockItemId, version: row.version as string,
    purchaseGrossOre: parseOre(row.purchaseGrossOre).toString(), saleGrossOre: parseOre(row.saleGrossOre).toString(),
    vatScheme: row.vatScheme as VehicleCalculationSource['vatScheme'], vatBasisConfirmed: row.vatBasisConfirmed,
    purchaseVatOre: row.purchaseVatOre === null ? null : parseOre(row.purchaseVatOre).toString(),
    costs: row.costs.map(value => { const cost = object(value); if (typeof cost.description !== 'string' || cost.description.length > 10000) throw new Error('Ogiltig kostnad.');
      return { id: uuid(cost.id), description: cost.description, grossOre: parseOre(cost.grossOre).toString(), deductibleVatOre: cost.deductibleVatOre === null ? null : parseOre(cost.deductibleVatOre).toString() }; }) };
  if (new Set(source.costs.map(cost => cost.id)).size !== source.costs.length) throw new Error('Dubblerade kostnader.');
  calculateVehicle(source);
  return source;
}
