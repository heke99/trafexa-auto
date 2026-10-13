'use server';

import { revalidatePath } from 'next/cache';
import { PlatformAdminError, requirePlatformAdminContext, requirePlatformAuthenticatedContext } from './context';
import type { AdminResult, CompanyPage, CompanyStatus, ContactPage, PlatformCompany, PlatformContact, StatusReceipt } from './database.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
class AdminActionError extends Error { constructor(readonly code: 'invalid_input' | 'conflict' | 'not_found' | 'unavailable' | 'access_denied') { super('Admin action failed'); } }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new AdminActionError('invalid_input');
  return value as Record<string, unknown>;
}
function input(value: unknown, allowed: string[]) {
  const obj = record(value);
  if (Object.keys(obj).some(key => !allowed.includes(key))) throw new AdminActionError('invalid_input');
  return obj;
}
function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) throw new AdminActionError('invalid_input'); return value.toLowerCase(); }
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || CONTROLS.test(value) || (!empty && !value.trim())) throw new AdminActionError('invalid_input');
  return value;
}
function status(value: unknown): CompanyStatus { if (value !== 'active' && value !== 'suspended') throw new AdminActionError('invalid_input'); return value; }
function singleLine(value: string): string { if (/[\u0000-\u001f\u007f]/.test(value)) throw new AdminActionError('invalid_input'); return value; }
function timestamp(value: unknown): string { const result = text(value, 80); if (!Number.isFinite(Date.parse(result))) throw new AdminActionError('unavailable'); return result; }
function count(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new AdminActionError('unavailable'); return value; }
function pagination(obj: Record<string, unknown>) {
  const pageKey = obj.pageKey == null ? null : uuid(obj.pageKey);
  const limit = obj.limit === undefined ? 50 : obj.limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new AdminActionError('invalid_input');
  return { pageKey, limit };
}
function rpcError(error: { code?: string } | null) {
  if (!error) return;
  throw new AdminActionError(error.code === '42501' ? 'access_denied' : error.code === '40001' ? 'conflict' : error.code === 'P0002' ? 'not_found' : 'unavailable');
}
function failure(error: unknown): AdminResult<never> {
  const code = error instanceof PlatformAdminError ? (error.code === 'unavailable' ? 'unavailable' : 'access_denied') : error instanceof AdminActionError ? error.code : 'unavailable';
  const messages = { access_denied: 'Du har inte tillgång till plattformsadministrationen.', invalid_input: 'Kontrollera uppgifterna och försök igen.', conflict: 'Företagets status eller begäran har ändrats. Läs in aktuell information innan du försöker igen.', not_found: 'Företaget kunde inte hittas.', unavailable: 'Åtgärden kunde inte verifieras. Försök igen med samma uppgifter.' };
  return { ok: false, code, message: messages[code] };
}

export async function listPlatformCompaniesAction(value: unknown = {}): Promise<AdminResult<CompanyPage>> {
  try {
    const { db } = await requirePlatformAdminContext();
    const obj = input(value, ['search', 'pageKey', 'limit']);
    const { pageKey, limit } = pagination(obj);
    const search = singleLine(text(obj.search ?? '', 160, true)).trim();
    const result = await db.rpc('list_platform_companies', { p_search: search, p_page_key: pageKey, p_limit: limit });
    rpcError(result.error);
    try {
      const row = record(result.data);
      if (!Array.isArray(row.companies) || row.companies.length > limit) throw new Error();
      const companies: PlatformCompany[] = row.companies.map(value => {
        const company = record(value);
        const organisationNumber = text(company.organisation_number, 10);
        if (!/^\d{10}$/.test(organisationNumber)) throw new Error();
        return { id: uuid(company.id), name: text(company.name, 300), organisationNumber, status: status(company.status), createdAt: timestamp(company.created_at), membershipCount: count(company.membership_count), stockCount: count(company.stock_count) };
      });
      if (companies.some((company, index) => company.id <= (index ? companies[index - 1].id : pageKey ?? ''))) throw new Error();
      const nextPageKey = row.next_page_key === null ? null : uuid(row.next_page_key);
      if (nextPageKey && nextPageKey !== companies.at(-1)?.id) throw new Error();
      return { ok: true, companies, nextPageKey };
    } catch { throw new AdminActionError('unavailable'); }
  } catch (error) { return failure(error); }
}

export async function listPlatformContactRequestsAction(value: unknown = {}): Promise<AdminResult<ContactPage>> {
  try {
    const { db } = await requirePlatformAdminContext();
    const { pageKey, limit } = pagination(input(value, ['pageKey', 'limit']));
    const result = await db.rpc('list_platform_contact_requests', { p_page_key: pageKey, p_limit: limit });
    rpcError(result.error);
    try {
      const row = record(result.data);
      if (!Array.isArray(row.requests) || row.requests.length > limit) throw new Error();
      const requests: PlatformContact[] = row.requests.map(value => {
        const contact = record(value);
        return { id: uuid(contact.id), name: text(contact.name, 500), email: text(contact.email, 254), company: text(contact.company, 500, true), phone: contact.phone == null ? null : text(contact.phone, 200, true), message: contact.message == null ? null : text(contact.message, 10000, true), createdAt: timestamp(contact.created_at) };
      });
      if (new Set(requests.map(item => item.id)).size !== requests.length || requests.some((item, index) => index > 0 && (Date.parse(item.createdAt) > Date.parse(requests[index - 1].createdAt) || Date.parse(item.createdAt) === Date.parse(requests[index - 1].createdAt) && item.id >= requests[index - 1].id))) throw new Error();
      const nextPageKey = row.next_page_key === null ? null : uuid(row.next_page_key);
      if (nextPageKey && nextPageKey !== requests.at(-1)?.id) throw new Error();
      return { ok: true, requests, nextPageKey };
    } catch { throw new AdminActionError('unavailable'); }
  } catch (error) { return failure(error); }
}

export async function setPlatformCompanyStatusAction(value: unknown): Promise<AdminResult<{ receipt: StatusReceipt }>> {
  try {
    const { db, userId } = await requirePlatformAdminContext();
    const obj = input(value, ['companyId', 'expectedStatus', 'status', 'reason', 'requestId']);
    const companyId = uuid(obj.companyId), requestId = uuid(obj.requestId);
    const expectedStatus = status(obj.expectedStatus), targetStatus = status(obj.status);
    const reason = singleLine(text(obj.reason, 500)).trim();
    const result = await db.rpc('set_platform_company_status', { p_company_id: companyId, p_expected_status: expectedStatus, p_status: targetStatus, p_reason: reason, p_request_id: requestId });
    rpcError(result.error);
    try {
      const row = record(result.data);
      if (uuid(row.company_id) !== companyId || uuid(row.request_id) !== requestId || row.actor_user_id !== userId || row.status !== targetStatus || row.previous_status !== expectedStatus || row.reason !== reason || row.changed !== (expectedStatus !== targetStatus)) throw new Error();
      const receipt: StatusReceipt = { companyId, requestId, status: targetStatus, previousStatus: expectedStatus, changed: row.changed as boolean, reason, createdAt: timestamp(row.created_at) };
      // Receipt is an immutable retry result; the UI reloads current state separately.
      try { revalidatePath('/admin'); } catch { /* Persisted receipt remains valid. */ }
      return { ok: true, receipt };
    } catch { throw new AdminActionError('unavailable'); }
  } catch (error) { return failure(error); }
}

/** Explicit POST only. SQL checks the private reservation against the actual verified Auth record. */
export async function activatePlatformAdminAction(value: unknown = {}): Promise<AdminResult<{ activated: true }>> {
  try {
    const { db, userId } = await requirePlatformAuthenticatedContext();
    input(value, []);
    const result = await db.rpc('claim_platform_admin_access', {});
    rpcError(result.error);
    try {
      const row = record(result.data);
      if (row.is_platform_admin !== true || row.user_id !== userId || typeof row.claimed !== 'boolean') throw new Error();
    } catch { throw new AdminActionError('unavailable'); }
    await requirePlatformAdminContext();
    try { revalidatePath('/admin'); } catch { /* Successful activation is independently verified. */ }
    return { ok: true, activated: true };
  } catch (error) { return failure(error); }
}
