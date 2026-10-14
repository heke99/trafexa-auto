'use server';

import { revalidatePath } from 'next/cache';
import { PlatformAdminError, requirePlatformAdminContext, requirePlatformAuthenticatedContext } from './context';
import type { AdminResult, CompanyPage, CompanyStatus, ContactPage, PlatformCompany, PlatformContact, StatusReceipt, WebApplicationAudit, WebApplicationStatusReceipt } from './database.types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WebApplicationDatabase, WebApplicationSeeking, WebApplicationStatus } from '@/lib/web-applications/database.types';
import { APPLICATION_SEEKING, normalizeApplicationOrganisationNumber } from '@/lib/web-applications/validation';

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
function applicationStatus(value:unknown):WebApplicationStatus {if(!['new','in_review','contacted','closed'].includes(String(value)))throw new AdminActionError('invalid_input');return value as WebApplicationStatus;}
function applicationContact(value:unknown):PlatformContact {
 const row=record(value);
 if(typeof row.legacy!=='boolean'||!Array.isArray(row.seeking)||row.seeking.length>6||new Set(row.seeking).size!==row.seeking.length||row.seeking.some(item=>!APPLICATION_SEEKING.includes(item as WebApplicationSeeking)))throw new AdminActionError('unavailable');
 const version=count(row.version);if(version<1)throw new AdminActionError('unavailable');
 const result:PlatformContact={id:uuid(row.id),name:text(row.name,500),email:text(row.email,254),company:text(row.company,500,true),phone:row.phone===null?null:text(row.phone,200,true),message:row.message===null?null:text(row.message,10000,true),createdAt:timestamp(row.created_at),organisationNumber:row.organisation_number===null?null:text(row.organisation_number,10),seeking:row.seeking as WebApplicationSeeking[],privacyVersion:row.privacy_version===null?null:text(row.privacy_version,40),privacyAcknowledgedAt:row.privacy_acknowledged_at===null?null:timestamp(row.privacy_acknowledged_at),legacy:row.legacy,status:applicationStatus(row.status),version};
 if(!result.legacy&&(!result.phone||!result.message||!result.seeking.length||!result.organisationNumber||normalizeApplicationOrganisationNumber(result.organisationNumber)!==result.organisationNumber||!result.privacyVersion||!result.privacyAcknowledgedAt))throw new AdminActionError('unavailable');
 return result;
}
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
  const messages = { access_denied: 'Du har inte tillgång till plattformsadministrationen.', invalid_input: 'Kontrollera uppgifterna och försök igen.', conflict: 'Uppgifterna eller begäran har ändrats. Läs in aktuell information innan du försöker igen.', not_found: 'Posten kunde inte hittas.', unavailable: 'Åtgärden kunde inte verifieras. Försök igen med samma uppgifter.' };
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
      const requests: PlatformContact[] = row.requests.map(applicationContact);
      if (new Set(requests.map(item => item.id)).size !== requests.length || requests.some((item, index) => index > 0 && (Date.parse(item.createdAt) > Date.parse(requests[index - 1].createdAt) || Date.parse(item.createdAt) === Date.parse(requests[index - 1].createdAt) && item.id >= requests[index - 1].id))) throw new Error();
      const nextPageKey = row.next_page_key === null ? null : uuid(row.next_page_key);
      if (nextPageKey && nextPageKey !== requests.at(-1)?.id) throw new Error();
      return { ok: true, requests, nextPageKey };
    } catch { throw new AdminActionError('unavailable'); }
  } catch (error) { return failure(error); }
}

export async function getPlatformWebApplicationAction(value:unknown):Promise<AdminResult<{application:PlatformContact;audit:WebApplicationAudit[]}>> {
 try {
  const {db}=await requirePlatformAdminContext();const obj=input(value,['applicationId']);const applicationId=uuid(obj.applicationId);
  const result=await (db as unknown as SupabaseClient<WebApplicationDatabase>).rpc('get_platform_web_application',{p_application_id:applicationId});rpcError(result.error);
  const row=record(result.data);const application=applicationContact(row.application);
  if(application.id!==applicationId||!Array.isArray(row.audit)||row.audit.length>1000)throw new AdminActionError('unavailable');
  const audit:WebApplicationAudit[]=row.audit.map(value=>{const item=record(value);return {status:applicationStatus(item.status),reason:text(item.reason,500),createdAt:timestamp(item.created_at)};});
  return {ok:true,application,audit};
 }catch(error){return failure(error);}
}

export async function setPlatformWebApplicationStatusAction(value:unknown):Promise<AdminResult<{receipt:WebApplicationStatusReceipt}>> {
 try {
  const {db,userId}=await requirePlatformAdminContext();const obj=input(value,['applicationId','expectedVersion','status','reason','requestId']);
  const applicationId=uuid(obj.applicationId),requestId=uuid(obj.requestId),target=applicationStatus(obj.status),expectedVersion=count(obj.expectedVersion),reason=singleLine(text(obj.reason,500)).trim();
  if(expectedVersion<1||expectedVersion>2147483647||reason.length<2)throw new AdminActionError('invalid_input');
  const result=await (db as unknown as SupabaseClient<WebApplicationDatabase>).rpc('set_platform_web_application_status',{p_application_id:applicationId,p_expected_version:expectedVersion,p_status:target,p_reason:reason,p_request_id:requestId});rpcError(result.error);
  const row=record(result.data);const previousStatus=applicationStatus(row.previous_status),version=count(row.version);
  if(row.application_id!==applicationId||row.request_id!==requestId||row.actor_user_id!==userId||row.status!==target||row.reason!==reason||row.changed!==(previousStatus!==target)||version!==expectedVersion+(row.changed===true?1:0))throw new AdminActionError('unavailable');
  const receipt={applicationId,requestId,status:target,previousStatus,version,reason,createdAt:timestamp(row.created_at)};
  try{revalidatePath('/admin');}catch{}
  return {ok:true,receipt};
 }catch(error){return failure(error);}
}

export async function erasePlatformWebApplicationAction(value:unknown):Promise<AdminResult<{receipt:{applicationId:string;requestId:string;erased:true;createdAt:string}}>> {
 try {
  const {db,userId}=await requirePlatformAdminContext();const obj=input(value,['applicationId','expectedVersion','reason','requestId']);
  const applicationId=uuid(obj.applicationId),requestId=uuid(obj.requestId),expectedVersion=count(obj.expectedVersion);
  if(expectedVersion<1||expectedVersion>2147483647||(obj.reason!=='rights_request'&&obj.reason!=='no_longer_needed'))throw new AdminActionError('invalid_input');
  const result=await (db as unknown as SupabaseClient<WebApplicationDatabase>).rpc('erase_platform_web_application',{p_application_id:applicationId,p_expected_version:expectedVersion,p_reason:obj.reason,p_request_id:requestId});rpcError(result.error);
  const row=record(result.data);
  if(row.application_id!==applicationId||row.request_id!==requestId||row.actor_user_id!==userId||row.expected_version!==expectedVersion||row.reason!==obj.reason||row.erased!==true)throw new AdminActionError('unavailable');
  const receipt={applicationId,requestId,erased:true as const,createdAt:timestamp(row.created_at)};
  try{revalidatePath('/admin');}catch{}
  return {ok:true,receipt};
 }catch(error){return failure(error);}
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
