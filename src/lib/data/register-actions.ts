'use server';

import { requireCrmContext, type CrmContext } from '@/lib/crm/context';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json } from '@/lib/supabase/database.types';
import type { Customer, InventoryItem, Vehicle } from './workspace';
import type { RegisterDatabase } from '@/lib/registers/database.types';
import type { DealerRegisterInput, DealerRegisterKind, DealerRegisterPage, DealerRegisterResult, DealerRegisterDeal, DealerRegisterSort, DealOptionsInput, DealOptionsResult, DealerRegisterRole } from '@/lib/registers/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = { inventory: ['all', 'available', 'reserved', 'sold', 'archived'], customers: ['all', 'person', 'business'], deals: ['all', 'draft', 'reserved', 'cancelled'] };
const roles: DealerRegisterRole[] = ['owner', 'admin', 'sales', 'finance', 'viewer'];
type Request = { kind: DealerRegisterKind; companyId: string; query: string; status: string; sort: DealerRegisterSort; cursor: Record<string, Json> | null; options: boolean; selectedId: string | null };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid record');
  return value as Record<string, unknown>;
}
function id(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) throw new Error('invalid id'); return value.toLowerCase(); }
function text(value: unknown, max: number, min = 0): string { if (typeof value !== 'string' || value.length > max || value.length < min || value.includes('\0')) throw new Error('invalid text'); return value; }
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('invalid timestamp');
  const day = new Date(value.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error('invalid timestamp');
  return value;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('invalid date');
  timestamp(value + 'T00:00:00Z'); return value;
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value === 'string' && /^\d{1,16}$/.test(value)) value = Number(value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw new Error('invalid integer');
  return value;
}
function nullableText(value: unknown, max: number): string | null { return value === null ? null : text(value, max); }
function validateCursor(value: unknown, req: Request, ctx?: CrmContext): Record<string, Json> {
  const row = record(value);
  const keys = ['version', 'companyId', 'actorId', 'role', 'kind', 'query', 'status', 'sort', 'options', 'id', 'createdAt', 'priceOre'];
  if (Object.keys(row).length !== keys.length || Object.keys(row).some((key) => !keys.includes(key)) || row.version !== 1 || id(row.companyId) !== req.companyId || row.kind !== req.kind || row.query !== req.query || row.status !== req.status || row.sort !== req.sort || row.options !== req.options || !roles.includes(row.role as DealerRegisterRole)) throw new Error('invalid cursor scope');
  id(row.actorId); id(row.id); timestamp(row.createdAt);
  if (typeof row.priceOre !== 'string' || !/^\d{1,19}$/.test(row.priceOre) || BigInt(row.priceOre) > BigInt('9223372036854775807')) throw new Error('invalid price cursor');
  if (ctx && (id(row.actorId) !== ctx.userId || row.role !== ctx.role)) throw new Error('invalid actor cursor');
  return row as Record<string, Json>;
}
function request(value: unknown, options: boolean): Request {
  const row = record(value), allowed = options ? ['kind', 'expectedCompanyId', 'query', 'cursor', 'selectedId'] : ['kind', 'expectedCompanyId', 'query', 'status', 'sort', 'cursor'];
  if (Object.keys(row).some((key) => !allowed.includes(key)) || !['inventory', 'customers', ...(options ? [] : ['deals'])].includes(String(row.kind))) throw new Error('invalid request');
  const kind = row.kind as DealerRegisterKind;
  let query = row.query === undefined ? '' : text(row.query, 120);
  if (/[\u0000-\u001f\u007f]/.test(query)) throw new Error('invalid search');
  query = query.normalize('NFC').trim().replace(/\s+/g, ' ');
  const status = options ? kind === 'inventory' ? 'available' : 'all' : row.status ?? 'all';
  const sort = options ? 'recent' : row.sort ?? 'recent';
  if (typeof status !== 'string' || !statuses[kind].includes(status) || !['recent', ...(kind === 'customers' ? [] : ['price_asc', 'price_desc'])].includes(String(sort))) throw new Error('invalid filter');
  const req: Request = { kind, companyId: id(row.expectedCompanyId), query, status, sort: sort as DealerRegisterSort, cursor: null, options, selectedId: options && row.selectedId !== null && row.selectedId !== undefined ? id(row.selectedId) : null };
  if (row.cursor !== undefined && row.cursor !== null) {
    const encoded = text(row.cursor, 6000, 1);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('invalid cursor encoding');
    const decoded = Buffer.from(encoded, 'base64url');
    if (decoded.toString('base64url') !== encoded || decoded.length > 4096) throw new Error('invalid cursor encoding');
    req.cursor = validateCursor(JSON.parse(decoded.toString('utf8')), req);
  }
  return req;
}
function companyRow(value: unknown, ctx: CrmContext) { const row = record(value); if (id(row.company_id) !== ctx.companyId) throw new Error('invalid row company'); return row; }
function vehicle(value: unknown, ctx: CrmContext): Vehicle {
  const row = companyRow(value, ctx);
  if (!['petrol', 'diesel', 'electric', 'hybrid', 'other'].includes(String(row.fuel)) || !['automatic', 'manual'].includes(String(row.gearbox))) throw new Error('invalid vehicle');
  const year = integer(row.model_year, 2100); if (year < 1900) throw new Error('invalid year');
  return { id: id(row.id), registration_number: text(row.registration_number, 15, 2), make: text(row.make, 160, 1), model: text(row.model, 160, 1), model_year: year, mileage_km: integer(row.mileage_km, 2147483647), fuel: row.fuel as string, gearbox: row.gearbox as string };
}
function inventory(value: unknown, ctx: CrmContext): InventoryItem {
  const row = companyRow(value, ctx);
  if (!statuses.inventory.slice(1).includes(String(row.status)) || !['standard', 'vmb', 'unknown'].includes(String(row.vat_scheme))) throw new Error('invalid stock');
  timestamp(row.created_at);
  return { id: id(row.id), status: row.status as string, acquired_on: date(row.acquired_on), purchase_price_ore: integer(row.purchase_price_ore), asking_price_ore: integer(row.asking_price_ore), vat_scheme: row.vat_scheme as string, vehicles: vehicle(row.vehicles, ctx) };
}
function customer(value: unknown, ctx: CrmContext): Customer {
  const row = companyRow(value, ctx);
  if (!['person', 'business'].includes(String(row.kind))) throw new Error('invalid customer');
  return { id: id(row.id), name: text(row.name, 160, 2), kind: row.kind as string, email: nullableText(row.email, 254), phone: nullableText(row.phone, 60), address: nullableText(row.address, 500), notes: nullableText(row.notes, 2000), created_at: timestamp(row.created_at) };
}
function deal(value: unknown, ctx: CrmContext): DealerRegisterDeal {
  const row = companyRow(value, ctx);
  const relatedCustomer = customer(row.customer, ctx), stockItem = inventory(row.stockItem, ctx);
  if (!statuses.deals.slice(1).includes(String(row.status)) || relatedCustomer.id !== id(row.customer_id) || stockItem.id !== id(row.stock_item_id)) throw new Error('invalid deal relation');
  const price = integer(row.sale_price_ore); if (price < 1) throw new Error('invalid deal price');
  return { id: id(row.id), status: row.status as string, sale_price_ore: price, customer_id: relatedCustomer.id, stock_item_id: stockItem.id, created_at: timestamp(row.created_at), customer: relatedCustomer, stockItem };
}
async function load(req: Request): Promise<DealerRegisterPage & { selected?: Customer | InventoryItem | null }> {
  const ctx = await requireCrmContext(req.companyId);
  if (!roles.includes(ctx.role)) throw new Error('invalid role');
  if (req.cursor) validateCursor(req.cursor, req, ctx);
  const db = ctx.db as unknown as SupabaseClient<RegisterDatabase>;
  const { data, error } = await db.rpc('dealer_register_page', { p_company_id: ctx.companyId, p_kind: req.kind, p_query: req.query, p_status: req.status, p_sort: req.sort, p_cursor: req.cursor, p_options: req.options, p_selected_id: req.selectedId });
  if (error) throw error;
  const page = record(data);
  if (id(page.companyId) !== ctx.companyId || id(page.actorId) !== ctx.userId || page.role !== ctx.role || page.kind !== req.kind || page.options !== req.options) throw new Error('invalid response scope');
  const totalCount = integer(page.totalCount), filteredCount = integer(page.filteredCount);
  if (filteredCount > totalCount || !Array.isArray(page.rows) || page.rows.length > 50 || page.rows.length > filteredCount) throw new Error('invalid totals');
  const parse = req.kind === 'inventory' ? inventory : req.kind === 'customers' ? customer : deal;
  const rows = page.rows.map((row) => parse(row, ctx));
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error('duplicate row');
  if (rows.some((row) => req.status !== 'all' && (req.kind === 'customers' ? (row as Customer).kind : (row as InventoryItem).status) !== req.status)) throw new Error('invalid filtered row');
  const rawCounts = record(page.counts), counts: Record<string, number> = {};
  for (const key of statuses[req.kind]) counts[key] = integer(rawCounts[key]);
  if (counts.all !== totalCount || statuses[req.kind].slice(1).reduce((sum, key) => sum + counts[key], 0) !== totalCount) throw new Error('invalid tab totals');
  let nextCursor: string | null = null;
  if (page.nextCursor !== null) {
    const next = validateCursor(page.nextCursor, req, ctx);
    if (rows.length !== 50 || id(next.id) !== rows.at(-1)?.id) throw new Error('invalid next cursor');
    nextCursor = Buffer.from(JSON.stringify(next), 'utf8').toString('base64url');
  }
  const selected = req.options && page.selected !== null ? req.kind === 'inventory' ? inventory(page.selected, ctx) : customer(page.selected, ctx) : null;
  if (selected && (selected.id !== req.selectedId || req.kind === 'inventory' && (selected as InventoryItem).status !== 'available')) throw new Error('invalid selected option');
  const fresh = await requireCrmContext(req.companyId);
  if (fresh.userId !== ctx.userId || fresh.role !== ctx.role || fresh.companyId !== ctx.companyId) throw new Error('scope changed');
  return { kind: req.kind, companyId: ctx.companyId, actorId: ctx.userId, role: ctx.role, rows, totalCount, filteredCount, counts, nextCursor, ...(req.options ? { selected } : {}) } as DealerRegisterPage & { selected?: Customer | InventoryItem | null };
}

export async function loadDealerRegisterPage(input: DealerRegisterInput): Promise<DealerRegisterResult> {
  let req: Request;
  try { req = request(input, false); } catch { return { ok: false, error: 'Sökningen eller sidmarkören är ogiltig. Återställ filtren och försök igen.' }; }
  try { return { ok: true, page: await load(req) }; }
  catch { return { ok: false, error: 'Registret kunde inte verifieras. Kontrollera din inloggning och det aktiva företaget, och försök igen.' }; }
}

export async function searchDealOptions(input: DealOptionsInput): Promise<DealOptionsResult> {
  let req: Request;
  try { req = request(input, true); } catch { return { ok: false, error: 'Sökningen eller sidmarkören är ogiltig. Sök igen.' }; }
  try {
    const page = await load(req);
    if (page.kind === 'deals') throw new Error('invalid options kind');
    return { ok: true, page: { kind: page.kind, companyId: page.companyId, actorId: page.actorId, role: page.role, rows: page.rows, selected: page.selected ?? null, totalCount: page.totalCount, filteredCount: page.filteredCount, nextCursor: page.nextCursor } as Extract<DealOptionsResult, { ok: true }>['page'] };
  } catch { return { ok: false, error: 'Valen kunde inte verifieras. Kontrollera din inloggning och det aktiva företaget, och sök igen.' }; }
}
