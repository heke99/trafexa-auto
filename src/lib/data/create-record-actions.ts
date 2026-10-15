'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/database.types';
import { getActiveCompanyContext } from './company-context';
import { requireCrmContext } from '@/lib/crm/context';
import { requireApprovedAccountAccess } from '@/lib/account-access/context';
import { integerField, moneyField } from './validation';
import type { CustomerCreateInput, FinanceIntakeCreateInput, DealerCreateReceipt, DealerCreateResult } from './create-record-types';
export type { CustomerCreateInput, FinanceIntakeCreateInput, DealerCreateReceipt, DealerCreateResult } from './create-record-types';

type Kind = DealerCreateReceipt['kind'];
type ErrorCode = Extract<DealerCreateResult, { ok: false }>['code'];
class CreateError extends Error { constructor(readonly code: ErrorCode) { super('Creation could not be verified'); } }
type CreateDatabase = Omit<Database, 'public'> & { public: Omit<Database['public'], 'Functions'> & { Functions: Database['public']['Functions'] & {
  create_customer_request: { Args: { p_company_id: string; p_request_id: string; p_name: string; p_kind: string; p_email: string; p_phone: string; p_address: string; p_notes: string }; Returns: Json };
  create_finance_intake_request: { Args: { p_company_id: string; p_request_id: string; p_product: string; p_deal_id: string | null; p_requested_amount_ore: number; p_deposit_ore: number; p_term_months: number | null; p_note: string }; Returns: Json };
} } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) throw new CreateError('invalid_input'); return value.toLowerCase(); }
function object(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new CreateError('invalid_input');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) throw new CreateError('invalid_input');
  return row;
}
function text(value: unknown, max: number, min = 0, multiline = false): string {
  if (typeof value !== 'string') throw new CreateError('invalid_input');
  const result = value.trim();
  if (result.length < min || result.length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/ : /[\u0000-\u001f\u007f-\u009f]/).test(result)) throw new CreateError('invalid_input');
  return result;
}
async function context(companyId: string, kind: Kind) {
  let selected;
  try { selected = await getActiveCompanyContext(); } catch { throw new CreateError('access_denied'); }
  if (selected.company.toLowerCase() !== companyId) throw new CreateError('company_changed');
  const current = await requireCrmContext(companyId);
  const access = await requireApprovedAccountAccess();
  if (selected.user !== current.userId || access.userId !== current.userId || !(['owner', 'admin', 'sales', ...(kind === 'finance_intake' ? ['finance'] : [])].includes(current.role))) throw new CreateError('access_denied');
  return { ...current, db: current.db as unknown as SupabaseClient<CreateDatabase> };
}
async function fresh(initial: Awaited<ReturnType<typeof context>>, kind: Kind) {
  const current = await context(initial.companyId, kind);
  if (current.userId !== initial.userId || current.role !== initial.role) throw new CreateError('access_denied');
}
function receipt(value: unknown, companyId: string, actorId: string, requestId: string, kind: Kind): DealerCreateReceipt {
  try {
    const row = object(value, ['companyId', 'actorId', 'requestId', 'kind', 'recordId', 'createdAt']);
    if (id(row.companyId) !== companyId || id(row.actorId) !== actorId || id(row.requestId) !== requestId || row.kind !== kind
      || typeof row.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(row.createdAt) || !Number.isFinite(Date.parse(row.createdAt))) throw new Error();
    return { companyId, actorId, requestId, kind, recordId: id(row.recordId), createdAt: row.createdAt };
  } catch { throw new CreateError('unavailable'); }
}
function failure(error: unknown, validation = false): DealerCreateResult {
  const source = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const code: ErrorCode = validation ? 'invalid_input' : error instanceof CreateError ? error.code : source === '42501' || source === 'access_denied' || source === 'unauthenticated' ? 'access_denied'
    : source === '40001' ? 'conflict' : source === '22023' || source === '22P02' || source === '23503' ? 'invalid_input' : 'unavailable';
  const messages: Record<ErrorCode, string> = {
    invalid_input: 'Kontrollera formulärets uppgifter och eventuell kopplad affär.',
    access_denied: 'Din aktuella inloggning eller företagsbehörighet kunde inte verifieras. Öppna formuläret igen.',
    company_changed: 'Det aktiva företaget har ändrats. Öppna formuläret igen innan du sparar.',
    conflict: 'Begäran har redan använts med andra uppgifter. Granska formuläret och starta en ny begäran.',
    unavailable: 'Sparandet kunde inte bekräftas. Försök igen med samma uppgifter och samma begäran.',
  };
  return { ok: false, code, message: messages[code] };
}
function invalidate(path: string) { try { revalidatePath('/dashboard'); revalidatePath(path); } catch { /* The verified durable receipt remains valid. */ } }

export async function createCustomerRequestAction(value: CustomerCreateInput): Promise<DealerCreateResult> {
  let input: CustomerCreateInput;
  try {
    const row = object(value, ['companyId', 'requestId', 'name', 'kind', 'email', 'phone', 'address', 'notes']);
    if (row.kind !== 'person' && row.kind !== 'business') throw new CreateError('invalid_input');
    const email = text(row.email, 254).toLowerCase();
    if (email.length > 254 || email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CreateError('invalid_input');
    input = { companyId: id(row.companyId), requestId: id(row.requestId), name: text(row.name, 160, 2), kind: row.kind, email, phone: text(row.phone, 60), address: text(row.address, 500, 0, true), notes: text(row.notes, 2000, 0, true) };
  } catch (error) { return failure(error, true); }
  try {
    const current = await context(input.companyId, 'customer');
    const result = await current.db.rpc('create_customer_request', { p_company_id: input.companyId, p_request_id: input.requestId, p_name: input.name, p_kind: input.kind, p_email: input.email, p_phone: input.phone, p_address: input.address, p_notes: input.notes }).abortSignal(AbortSignal.timeout(15000));
    if (result.error) throw result.error;
    const saved = receipt(result.data, input.companyId, current.userId, input.requestId, 'customer');
    await fresh(current, 'customer'); invalidate('/customers');
    return { ok: true, receipt: saved };
  } catch (error) { return failure(error); }
}

export async function createFinanceIntakeRequestAction(value: FinanceIntakeCreateInput): Promise<DealerCreateResult> {
  let input: FinanceIntakeCreateInput; let amount: number; let deposit: number; let term: number | null;
  try {
    const row = object(value, ['companyId', 'requestId', 'product', 'dealId', 'requestedAmount', 'deposit', 'termMonths', 'note']);
    if (row.product !== 'purchase' && row.product !== 'stock') throw new CreateError('invalid_input');
    input = { companyId: id(row.companyId), requestId: id(row.requestId), product: row.product, dealId: row.dealId === null ? null : id(row.dealId), requestedAmount: text(row.requestedAmount, 160, 1), deposit: text(row.deposit, 160), termMonths: text(row.termMonths, 160), note: text(row.note, 2000, 0, true) };
    const fields = new FormData(); fields.set('amount', input.requestedAmount); fields.set('deposit', input.deposit || '0'); fields.set('term', input.termMonths);
    amount = moneyField(fields, 'amount'); deposit = moneyField(fields, 'deposit', true); term = input.termMonths ? integerField(fields, 'term', 1, 120) : null;
  } catch (error) { return failure(error, true); }
  try {
    const current = await context(input.companyId, 'finance_intake');
    const result = await current.db.rpc('create_finance_intake_request', { p_company_id: input.companyId, p_request_id: input.requestId, p_product: input.product, p_deal_id: input.dealId, p_requested_amount_ore: amount, p_deposit_ore: deposit, p_term_months: term, p_note: input.note }).abortSignal(AbortSignal.timeout(15000));
    if (result.error) throw result.error;
    const saved = receipt(result.data, input.companyId, current.userId, input.requestId, 'finance_intake');
    await fresh(current, 'finance_intake'); invalidate('/finance');
    return { ok: true, receipt: saved };
  } catch (error) { return failure(error); }
}
