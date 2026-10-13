export const MAX_AMOUNT_ORE = 9223372036854775807n;
export const MAX_TOTAL_ORE = 10n ** 38n - 1n;
export type VatScheme = 'standard' | 'vmb' | 'unknown';
export type InventoryDashboardTotals = { companyId: string; activeStockCount: string; availableStockCount: string; purchaseValueOre: string; activeDealCount: string; reservedDealCount: string; customerCount: string };
export type CalculationCost = { id: string; description: string; grossOre: string; deductibleVatOre: string | null };
export type VehicleCalculationSource = {
  companyId: string; stockItemId: string; version: string; purchaseGrossOre: string; saleGrossOre: string;
  vatScheme: VatScheme; purchaseVatOre: string | null; vatBasisConfirmed: boolean; costs: CalculationCost[];
};
export type VehicleCalculation = {
  costGrossOre: string; grossDifferenceOre: string; outputVatOre: string | null;
  deductibleCostVatOre: string | null; netResultOre: string | null;
  missing: ('vat_scheme' | 'vmb_basis' | 'purchase_vat' | 'cost_vat')[];
};
export function parseOre(value: unknown, maximum = MAX_AMOUNT_ORE): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 38) throw new Error('Ogiltigt belopp i ören.');
  const result = BigInt(value);
  if (result > maximum) throw new Error('Beloppet är för stort.');
  return result;
}
export function roundRatioHalfUp(value: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Ogiltig nämnare.');
  const magnitude = value < 0n ? -value : value;
  const rounded = magnitude / denominator + (magnitude % denominator * 2n >= denominator ? 1n : 0n);
  return value < 0n ? -rounded : rounded;
}
function bounded(value: bigint): string {
  if (value > MAX_TOTAL_ORE || value < -MAX_TOTAL_ORE) throw new Error('Kalkylens totalbelopp är för stort.');
  return value.toString();
}
/** Every input is exact ore. A null deduction means unknown, never an assumed zero. */
export function calculateVehicle(source: VehicleCalculationSource): VehicleCalculation {
  const purchase = parseOre(source.purchaseGrossOre), sale = parseOre(source.saleGrossOre);
  if (!['standard', 'vmb', 'unknown'].includes(source.vatScheme) || typeof source.vatBasisConfirmed !== 'boolean'
    || !Array.isArray(source.costs) || source.costs.length > 10000) throw new Error('Ogiltigt kalkylunderlag.');
  const purchaseVat = source.purchaseVatOre === null ? null : parseOre(source.purchaseVatOre);
  if (purchaseVat !== null && purchaseVat > roundRatioHalfUp(purchase, 5n) || source.vatScheme === 'vmb' && purchaseVat !== null && purchaseVat !== 0n) throw new Error('Inköpsmomsen stämmer inte med underlaget.');
  let costGross = 0n, costVat = 0n, missingCostVat = false;
  for (const cost of source.costs) {
    const amount = parseOre(cost.grossOre);
    const vat = cost.deductibleVatOre === null ? null : parseOre(cost.deductibleVatOre);
    if (vat !== null && vat > roundRatioHalfUp(amount, 5n)) throw new Error('Kostnadsmomsen överstiger högsta svenska momsandel.');
    costGross += amount;
    if (vat === null) missingCostVat = true; else costVat += vat;
  }
  const grossDifference = sale - purchase - costGross;
  const missing: VehicleCalculation['missing'] = [];
  let outputVat: bigint | null = null, net: bigint | null = null;
  if (source.vatScheme === 'unknown') missing.push('vat_scheme');
  else if (source.vatScheme === 'vmb' && !source.vatBasisConfirmed) missing.push('vmb_basis');
  else {
    // Skatteverket: standard VAT is 25/125 of gross; individual VMB is
    // 25/125 of positive sale-minus-purchase, excluding repair/other costs.
    const margin = sale > purchase ? sale - purchase : 0n;
    outputVat = roundRatioHalfUp(source.vatScheme === 'standard' ? sale : margin, 5n);
    if (source.vatScheme === 'standard' && purchaseVat === null) missing.push('purchase_vat');
    if (missingCostVat) missing.push('cost_vat');
    if (!missing.length) net = grossDifference - outputVat + costVat + (source.vatScheme === 'standard' ? purchaseVat! : 0n);
  }
  return { costGrossOre: bounded(costGross), grossDifferenceOre: bounded(grossDifference), outputVatOre: outputVat === null ? null : bounded(outputVat),
    deductibleCostVatOre: missingCostVat ? null : bounded(costVat), netResultOre: net === null ? null : bounded(net), missing };
}
/** Exact display; never converts a database monetary amount to Number. */
export function formatOre(value: string): string {
  if (!/^-?(0|[1-9][0-9]*)$/.test(value) || value.length > 40) throw new Error('Ogiltigt belopp.');
  const amount = BigInt(value), absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '−' : ''}${(absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${(absolute % 100n).toString().padStart(2, '0')} kr`;
}
export function kronorToOre(value: string): string | null {
  if (value.trim() === '') return null;
  if (!/^(0|[1-9][0-9]*)(?:[,.][0-9]{1,2})?$/.test(value.trim())) throw new Error('Ange kronor med högst två decimaler.');
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.');
  const ore = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return parseOre(ore.toString()).toString();
}
