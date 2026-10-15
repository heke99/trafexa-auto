'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PlatformAdminError, requirePlatformAdminContext } from './context';
import type { AdminResult } from './database.types';
import type { AccountStatus } from '../account-access/types';
import type { PlatformAccountMembershipsPage, PlatformCompanyMember, PlatformCompanyMembersPage, PlatformMembershipDatabase, PlatformMembershipEditableRole, PlatformMembershipReceipt, PlatformMembershipRole, PlatformMembershipStatus, UpdatePlatformCompanyMemberInput } from './membership-types';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/;
type ErrorCode = 'invalid_input' | 'access_denied' | 'conflict' | 'not_found' | 'unavailable';
class MembershipError extends Error {
  constructor(readonly code: ErrorCode) { super('Membership operation could not be verified'); }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new MembershipError('invalid_input');
  return value as Record<string, unknown>;
}
function input(value: unknown, keys: readonly string[]) {
  const row = object(value);
  if (Object.keys(row).some(key => !keys.includes(key))) throw new MembershipError('invalid_input');
  return row;
}
function output(value: unknown, keys: readonly string[]) {
  const row = object(value);
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) throw new MembershipError('unavailable');
  return row;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new MembershipError('invalid_input');
  return value.toLowerCase();
}
function integer(value: unknown, minimum = 1, maximum = 2147483647): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) throw new MembershipError('invalid_input');
  return value;
}
function text(value: unknown, maximum: number, normalize = false): string {
  if (typeof value !== 'string' || value.length > maximum * 2 || CONTROLS.test(value)) throw new MembershipError('invalid_input');
  const clean = normalize ? value.trim() : value;
  if (clean !== clean.trim() || Array.from(clean).length < 1 || Array.from(clean).length > maximum || /[\ud800-\udfff]/u.test(clean)) throw new MembershipError('invalid_input');
  return clean;
}
function email(value: unknown): string | null {
  if (value === null) return null;
  const clean = text(value, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new MembershipError('unavailable');
  return clean;
}
function role(value: unknown): PlatformMembershipRole {
  if (value !== 'owner' && value !== 'admin' && value !== 'sales' && value !== 'finance' && value !== 'viewer') throw new MembershipError('invalid_input');
  return value;
}
function membershipStatus(value: unknown): PlatformMembershipStatus {
  if (value !== 'active' && value !== 'suspended') throw new MembershipError('invalid_input');
  return value;
}
function accountStatus(value: unknown): AccountStatus {
  if (value !== 'pending' && value !== 'approved' && value !== 'rejected' && value !== 'suspended') throw new MembershipError('invalid_input');
  return value;
}
function pagination(row: Record<string, unknown>) {
  return { pageKey: row.pageKey == null ? null : uuid(row.pageKey), limit: row.limit === undefined ? 50 : integer(row.limit, 1, 50) };
}
function member(value: unknown): PlatformCompanyMember {
  const row = output(value, ['membershipId', 'userId', 'email', 'role', 'status', 'version', 'companyId', 'companyName', 'companyStatus', 'accountStatus', 'emailVerified', 'isPlatformAdmin']);
  if (typeof row.emailVerified !== 'boolean' || typeof row.isPlatformAdmin !== 'boolean') throw new MembershipError('unavailable');
  return { membershipId: uuid(row.membershipId), userId: uuid(row.userId), email: email(row.email), role: role(row.role), status: membershipStatus(row.status), version: integer(row.version), companyId: uuid(row.companyId), companyName: text(row.companyName, 160), companyStatus: membershipStatus(row.companyStatus), accountStatus: accountStatus(row.accountStatus), emailVerified: row.emailVerified, isPlatformAdmin: row.isPlatformAdmin };
}
function pageRows(value: unknown, pageKey: string | null, limit: number) {
  if (!Array.isArray(value) || value.length > limit) throw new MembershipError('unavailable');
  const rows = value.map(member);
  if (rows.some((row, index) => row.membershipId <= (index ? rows[index - 1].membershipId : pageKey ?? ''))) throw new MembershipError('unavailable');
  return rows;
}
function nextPage(value: unknown, rows: PlatformCompanyMember[], limit: number) {
  const next = value === null ? null : uuid(value);
  if (next && (rows.length !== limit || next !== rows.at(-1)?.membershipId)) throw new MembershipError('unavailable');
  return next;
}
function rpcError(error: { code?: string } | null) {
  if (error) throw new MembershipError(error.code === '42501' ? 'access_denied' : error.code === '40001' || error.code === '23505' ? 'conflict' : error.code === 'P0002' ? 'not_found' : error.code === '22023' ? 'invalid_input' : 'unavailable');
}
function failure(error: unknown, invalid = false): AdminResult<never> {
  const code: ErrorCode = invalid ? 'invalid_input' : error instanceof PlatformAdminError ? error.code === 'unavailable' ? 'unavailable' : 'access_denied' : error instanceof MembershipError ? error.code : 'unavailable';
  const messages: Record<ErrorCode, string> = {
    invalid_input: 'Kontrollera medlemsrollen, åtkomsten och motiveringen.',
    access_denied: 'Din aktuella administratörsbehörighet eller åtkomsten till medlemskapet kunde inte verifieras.',
    conflict: 'Medlemskapet har ändrats. Läs in aktuell information och granska beslutet på nytt.',
    not_found: 'Medlemskapet eller kontot kunde inte hittas.',
    unavailable: 'Resultatet kunde inte bekräftas. Försök igen med samma uppgifter och begäran.',
  };
  return { ok: false, code, message: messages[code] };
}
async function bounded<T>(operation: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new MembershipError('unavailable')); }, 15000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function fresh(actor: string) {
  const current = await requirePlatformAdminContext();
  if (current.userId !== actor) throw new MembershipError('access_denied');
}
function parseOutput<T>(parse: () => T): T {
  try { return parse(); } catch { throw new MembershipError('unavailable'); }
}

export async function listPlatformCompanyMembersAction(value: unknown): Promise<AdminResult<PlatformCompanyMembersPage>> {
  let companyId: string; let paging: ReturnType<typeof pagination>;
  try { const row = input(value, ['companyId', 'pageKey', 'limit']); companyId = uuid(row.companyId); paging = pagination(row); } catch (error) { return failure(error, true); }
  try {
    const current = await bounded(() => requirePlatformAdminContext());
    const db = current.db as unknown as SupabaseClient<PlatformMembershipDatabase>;
    const result = await bounded(signal => db.rpc('list_platform_company_members', { p_company_id: companyId, p_page_key: paging.pageKey, p_limit: paging.limit }).abortSignal(signal)); rpcError(result.error);
    const page = parseOutput<PlatformCompanyMembersPage>(() => {
      const row = output(result.data, ['companyId', 'companyName', 'companyStatus', 'actorUserId', 'teamVersion', 'members', 'nextPageKey']);
      if (uuid(row.companyId) !== companyId || uuid(row.actorUserId) !== current.userId) throw new MembershipError('unavailable');
      const companyName = text(row.companyName, 160), companyStatus = membershipStatus(row.companyStatus), members = pageRows(row.members, paging.pageKey, paging.limit);
      if (members.some(member => member.companyId !== companyId || member.companyName !== companyName || member.companyStatus !== companyStatus) || new Set(members.map(member => member.userId)).size !== members.length) throw new MembershipError('unavailable');
      return { companyId, companyName, companyStatus, actorUserId: current.userId, teamVersion: integer(row.teamVersion), members, nextPageKey: nextPage(row.nextPageKey, members, paging.limit) };
    });
    await bounded(() => fresh(current.userId)); return { ok: true, ...page };
  } catch (error) { return failure(error); }
}

export async function listPlatformAccountMembershipsAction(value: unknown): Promise<AdminResult<PlatformAccountMembershipsPage>> {
  let userId: string; let paging: ReturnType<typeof pagination>;
  try { const row = input(value, ['userId', 'pageKey', 'limit']); userId = uuid(row.userId); paging = pagination(row); } catch (error) { return failure(error, true); }
  try {
    const current = await bounded(() => requirePlatformAdminContext());
    const db = current.db as unknown as SupabaseClient<PlatformMembershipDatabase>;
    const result = await bounded(signal => db.rpc('list_platform_account_memberships', { p_user_id: userId, p_page_key: paging.pageKey, p_limit: paging.limit }).abortSignal(signal)); rpcError(result.error);
    const page = parseOutput<PlatformAccountMembershipsPage>(() => {
      const row = output(result.data, ['userId', 'actorUserId', 'email', 'accountStatus', 'emailVerified', 'memberships', 'nextPageKey']);
      if (uuid(row.userId) !== userId || uuid(row.actorUserId) !== current.userId || typeof row.emailVerified !== 'boolean') throw new MembershipError('unavailable');
      const accountEmail = email(row.email), status = accountStatus(row.accountStatus), memberships = pageRows(row.memberships, paging.pageKey, paging.limit);
      if (memberships.some(member => member.userId !== userId || member.email !== accountEmail || member.accountStatus !== status || member.emailVerified !== row.emailVerified) || new Set(memberships.map(member => member.companyId)).size !== memberships.length) throw new MembershipError('unavailable');
      return { userId, actorUserId: current.userId, email: accountEmail, accountStatus: status, emailVerified: row.emailVerified, memberships, nextPageKey: nextPage(row.nextPageKey, memberships, paging.limit) };
    });
    await bounded(() => fresh(current.userId)); return { ok: true, ...page };
  } catch (error) { return failure(error); }
}

export async function updatePlatformCompanyMemberAction(value: unknown): Promise<AdminResult<{ receipt: PlatformMembershipReceipt }>> {
  let parsed: UpdatePlatformCompanyMemberInput;
  try {
    const row = input(value, ['companyId', 'membershipId', 'expectedVersion', 'role', 'status', 'reason', 'requestId']), targetRole = role(row.role);
    if (targetRole === 'owner') throw new MembershipError('invalid_input');
    parsed = { companyId: uuid(row.companyId), membershipId: uuid(row.membershipId), expectedVersion: integer(row.expectedVersion, 1, 2147483646), role: targetRole as PlatformMembershipEditableRole, status: membershipStatus(row.status), reason: text(row.reason, 500, true), requestId: uuid(row.requestId) };
  } catch (error) { return failure(error, true); }
  try {
    const current = await bounded(() => requirePlatformAdminContext());
    const db = current.db as unknown as SupabaseClient<PlatformMembershipDatabase>;
    // No mutable target preflight: SQL authorizes current protection and resolves
    // exact historical nonces before target state, CAS and activation conditions.
    const result = await bounded(signal => db.rpc('update_platform_company_member', { p_company_id: parsed.companyId, p_membership_id: parsed.membershipId, p_expected_version: parsed.expectedVersion, p_role: parsed.role, p_status: parsed.status, p_reason: parsed.reason, p_request_id: parsed.requestId }).abortSignal(signal)); rpcError(result.error);
    const receipt = parseOutput<PlatformMembershipReceipt>(() => {
      const row = output(result.data, ['companyId', 'actorUserId', 'requestId', 'teamVersion', 'member']), updated = member(row.member);
      if (uuid(row.companyId) !== parsed.companyId || uuid(row.actorUserId) !== current.userId || uuid(row.requestId) !== parsed.requestId
        || updated.companyId !== parsed.companyId || updated.membershipId !== parsed.membershipId || updated.version !== parsed.expectedVersion + 1
        || updated.role !== parsed.role || updated.status !== parsed.status || updated.userId === current.userId || updated.isPlatformAdmin
        || updated.status === 'active' && (updated.accountStatus !== 'approved' || !updated.emailVerified || updated.companyStatus !== 'active')) throw new MembershipError('unavailable');
      return { companyId: parsed.companyId, actorUserId: current.userId, requestId: parsed.requestId, teamVersion: integer(row.teamVersion), member: updated };
    });
    await bounded(() => fresh(current.userId));
    try { revalidatePath('/admin'); revalidatePath('/settings'); } catch { /* A verified durable receipt survives cache failures. */ }
    return { ok: true, receipt };
  } catch (error) { return failure(error); }
}
