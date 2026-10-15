import { canReadInternalFinance } from '@/lib/access/dealer-capabilities';
import { object, uuid } from '@/lib/calculations/source';
import type { InventoryItem } from './workspace';

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid inventory amount');
  return value;
}
function text(value: unknown): string { if (typeof value !== 'string') throw new Error('Invalid inventory text'); return value; }

/** Project only ordinary stock fields. A privileged/old/mis-scoped response
 * cannot smuggle purchase values, VAT evidence or aliases into a restricted DTO. */
export function parseWorkspaceInventory(value: unknown, companyId: string, actorId: string, role: string): InventoryItem[] {
  const page = object(value);
  if (page.companyId !== companyId || page.actorId !== actorId || page.role !== role || !['owner', 'admin', 'sales', 'finance', 'viewer'].includes(role)
    || !Array.isArray(page.rows) || page.rows.length > 500) throw new Error('Invalid inventory scope');
  const rows = page.rows.map(value => {
    const row = object(value), vehicle = object(row.vehicles);
    if (row.company_id !== companyId || vehicle.company_id !== companyId || !['available', 'reserved', 'sold', 'archived'].includes(String(row.status))
      || !['standard', 'vmb', 'unknown'].includes(String(row.vat_scheme)) || !['petrol', 'diesel', 'electric', 'hybrid', 'other'].includes(String(vehicle.fuel))
      || !['automatic', 'manual'].includes(String(vehicle.gearbox))) throw new Error('Invalid inventory relation');
    if (!canReadInternalFinance(role) && row.purchase_price_ore !== null) throw new Error('Invalid financial visibility');
    return { id: uuid(row.id), status: text(row.status), acquired_on: text(row.acquired_on), purchase_price_ore: canReadInternalFinance(role) ? integer(row.purchase_price_ore) : null,
      asking_price_ore: integer(row.asking_price_ore), vat_scheme: text(row.vat_scheme), vehicles: { id: uuid(vehicle.id), registration_number: text(vehicle.registration_number), make: text(vehicle.make), model: text(vehicle.model),
        model_year: integer(vehicle.model_year), mileage_km: integer(vehicle.mileage_km), fuel: text(vehicle.fuel), gearbox: text(vehicle.gearbox) } };
  });
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate inventory rows');
  return rows;
}
