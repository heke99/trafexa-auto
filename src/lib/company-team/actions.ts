'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { CompanyTeamError, requireCompanyTeamContext, requireInvitationContext } from './context';
import type { AcceptedInvitation, CompanyTeamPage, InvitationReceipt, InvitationStatus, InviteRole, MemberReceipt, MemberStatus, MyCompanyInvitation, MyInvitationsPage, TeamInvitation, TeamMember, TeamResult, TeamRole } from './database.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: TeamRole[] = ['owner', 'admin', 'sales', 'finance', 'viewer'];
class TeamActionError extends Error { constructor(readonly code: 'invalid_input' | 'conflict' | 'not_found' | 'unavailable' | 'access_denied') { super('Team action failed'); } }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TeamActionError('invalid_input');
  return value as Record<string, unknown>;
}
function input(value: unknown, keys: string[]) {
  const row = object(value);
  if (Object.keys(row).some(key => !keys.includes(key))) throw new TeamActionError('invalid_input');
  return row;
}
function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) throw new TeamActionError('invalid_input'); return value.toLowerCase(); }
function version(value: unknown): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647) throw new TeamActionError('invalid_input'); return value; }
function text(value: unknown, max: number): string { if (typeof value !== 'string' || value.length > max || !value.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new TeamActionError('invalid_input'); return value; }
function email(value: unknown): string { const result = text(value, 254).trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new TeamActionError('invalid_input'); return result; }
function role(value: unknown): TeamRole { if (!ROLES.includes(value as TeamRole)) throw new TeamActionError('invalid_input'); return value as TeamRole; }
function inviteRole(value: unknown): InviteRole { const result = role(value); if (result === 'owner') throw new TeamActionError('invalid_input'); return result; }
function memberStatus(value: unknown): MemberStatus { if (value !== 'active' && value !== 'suspended') throw new TeamActionError('invalid_input'); return value; }
function invitationStatus(value: unknown): InvitationStatus { if (value !== 'pending' && value !== 'accepted' && value !== 'revoked' && value !== 'expired') throw new TeamActionError('unavailable'); return value; }
function timestamp(value: unknown): string { const result = text(value, 80); if (!Number.isFinite(Date.parse(result))) throw new TeamActionError('unavailable'); return result; }
function limit(value: unknown): number { const count = value ?? 50; if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 50) throw new TeamActionError('invalid_input'); return count; }
function cursor(value: unknown): string | null { return value == null ? null : uuid(value); }
function invitation(value: unknown): TeamInvitation {
  const row = object(value);
  const status = invitationStatus(row.status);
  const createdAt = timestamp(row.createdAt), expiresAt = timestamp(row.expiresAt);
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) throw new TeamActionError('unavailable');
  return { id: uuid(row.id), email: email(row.email), role: inviteRole(row.role), status, version: version(row.version), createdAt, expiresAt };
}
function member(value: unknown): TeamMember {
  const row = object(value);
  return { id: uuid(row.id), userId: uuid(row.userId), email: email(row.email), role: role(row.role), status: memberStatus(row.status), version: version(row.version), createdAt: timestamp(row.createdAt) };
}
function pageItems<T extends { id: string }>(value: unknown, count: number, after: string | null, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > count) throw new TeamActionError('unavailable');
  const items = value.map(parse);
  if (items.some((item, index) => item.id <= (index ? items[index - 1].id : after ?? ''))) throw new TeamActionError('unavailable');
  return items;
}
function nextCursor(value: unknown, items: { id: string }[]): string | null {
  const next = value === null ? null : uuid(value);
  if (next && next !== items.at(-1)?.id) throw new TeamActionError('unavailable');
  return next;
}
function rpcError(error: { code?: string } | null) {
  if (error) throw new TeamActionError(error.code === '42501' ? 'access_denied' : error.code === '40001' || error.code === '23505' ? 'conflict' : error.code === 'P0002' ? 'not_found' : error.code === '22023' ? 'invalid_input' : 'unavailable');
}
function failure(error: unknown): TeamResult<never> {
  const code = error instanceof CompanyTeamError || error instanceof TeamActionError ? error.code : 'unavailable';
  const messages = { unauthenticated: 'Logga in igen för att fortsätta.', access_denied: 'Du har inte behörighet att göra detta. Kontrollera att kontot är verifierat och åtkomsten fortfarande gäller.', invalid_input: 'Kontrollera uppgifterna och försök igen.', conflict: 'Uppgifterna eller begäran har ändrats. Läs in aktuell information innan du försöker igen.', not_found: 'Posten kunde inte hittas.', unavailable: 'Resultatet kunde inte verifieras. Försök igen med samma uppgifter.' };
  return { ok: false, code, message: messages[code] };
}
function output<T>(parse: () => T): T { try { return parse(); } catch { throw new TeamActionError('unavailable'); } }
function receiptIdentity(row: Record<string, unknown>, userId: string, requestId: string, companyId?: string) {
  if (row.actorUserId !== userId || uuid(row.requestId) !== requestId || companyId && uuid(row.companyId) !== companyId) throw new TeamActionError('unavailable');
}
function revalidateTeam() {
  try { revalidatePath('/settings'); revalidatePath('/invitations'); } catch { /* A committed receipt remains valid if refreshing fails. */ }
}

export async function listCompanyTeamAction(value: unknown): Promise<TeamResult<CompanyTeamPage>> {
  try {
    const row = input(value, ['companyId', 'membersPageKey', 'invitationsPageKey', 'limit']);
    const companyId = uuid(row.companyId), membersPageKey = cursor(row.membersPageKey), invitationsPageKey = cursor(row.invitationsPageKey), count = limit(row.limit);
    const { db, userId, role: actorRole } = await requireCompanyTeamContext(companyId);
    const result = await db.rpc('list_company_team', { p_company_id: companyId, p_members_page_key: membersPageKey, p_invitations_page_key: invitationsPageKey, p_limit: count });
    rpcError(result.error);
    return output(() => {
      const page = object(result.data);
      if (uuid(page.companyId) !== companyId || page.actorUserId !== userId || page.actorRole !== actorRole) throw new Error();
      const members = pageItems(page.members, count, membersPageKey, member), invitations = pageItems(page.invitations, count, invitationsPageKey, invitation);
      return { ok: true, companyId, actorUserId: userId, actorRole, teamVersion: version(page.teamVersion), members, invitations, nextMembersPageKey: nextCursor(page.nextMembersPageKey, members), nextInvitationsPageKey: nextCursor(page.nextInvitationsPageKey, invitations) };
    });
  } catch (error) { return failure(error); }
}

export async function inviteCompanyMemberAction(value: unknown): Promise<TeamResult<{ receipt: InvitationReceipt }>> {
  try {
    const row = input(value, ['companyId', 'email', 'role', 'expectedTeamVersion', 'requestId']);
    const companyId = uuid(row.companyId), requestedEmail = email(row.email), requestedRole = inviteRole(row.role), expectedTeamVersion = version(row.expectedTeamVersion), requestId = uuid(row.requestId);
    const { db, userId, role: actorRole } = await requireCompanyTeamContext(companyId);
    if (actorRole === 'admin' && requestedRole === 'admin') throw new TeamActionError('access_denied');
    const result = await db.rpc('create_company_invitation', { p_company_id: companyId, p_email: requestedEmail, p_role: requestedRole, p_expected_team_version: expectedTeamVersion, p_request_id: requestId });
    rpcError(result.error);
    const receipt = output(() => {
      const receipt = object(result.data); receiptIdentity(receipt, userId, requestId, companyId);
      const created = invitation(receipt.invitation);
      if (created.email !== requestedEmail || created.role !== requestedRole || created.status !== 'pending' || created.version !== 1 || version(receipt.teamVersion) !== expectedTeamVersion + 1) throw new Error();
      return { companyId, teamVersion: receipt.teamVersion as number, invitation: created };
    });
    revalidateTeam(); return { ok: true, receipt };
  } catch (error) { return failure(error); }
}

export async function cancelCompanyInvitationAction(value: unknown): Promise<TeamResult<{ receipt: InvitationReceipt }>> {
  try {
    const row = input(value, ['companyId', 'invitationId', 'expectedVersion', 'reason', 'requestId']);
    const companyId = uuid(row.companyId), invitationId = uuid(row.invitationId), expectedVersion = version(row.expectedVersion), reason = text(row.reason, 500).trim(), requestId = uuid(row.requestId);
    const { db, userId, role: actorRole } = await requireCompanyTeamContext(companyId);
    const result = await db.rpc('revoke_company_invitation', { p_company_id: companyId, p_invitation_id: invitationId, p_expected_version: expectedVersion, p_reason: reason, p_request_id: requestId });
    rpcError(result.error);
    const receipt = output(() => {
      const receipt = object(result.data); receiptIdentity(receipt, userId, requestId, companyId);
      const revoked = invitation(receipt.invitation);
      if (revoked.id !== invitationId || revoked.status !== 'revoked' || revoked.version !== expectedVersion + 1 || actorRole === 'admin' && revoked.role === 'admin') throw new Error();
      return { companyId, teamVersion: version(receipt.teamVersion), invitation: revoked };
    });
    revalidateTeam(); return { ok: true, receipt };
  } catch (error) { return failure(error); }
}

export async function updateCompanyMemberAction(value: unknown): Promise<TeamResult<{ receipt: MemberReceipt }>> {
  try {
    const row = input(value, ['companyId', 'membershipId', 'expectedVersion', 'role', 'status', 'reason', 'requestId']);
    const companyId = uuid(row.companyId), membershipId = uuid(row.membershipId), expectedVersion = version(row.expectedVersion), requestedRole = inviteRole(row.role), requestedStatus = memberStatus(row.status), reason = text(row.reason, 500).trim(), requestId = uuid(row.requestId);
    const { db, userId, role: actorRole } = await requireCompanyTeamContext(companyId);
    if (actorRole === 'admin' && requestedRole === 'admin') throw new TeamActionError('access_denied');
    const result = await db.rpc('update_company_team_member', { p_company_id: companyId, p_membership_id: membershipId, p_expected_version: expectedVersion, p_role: requestedRole, p_status: requestedStatus, p_reason: reason, p_request_id: requestId });
    rpcError(result.error);
    const receipt = output(() => {
      const receipt = object(result.data); receiptIdentity(receipt, userId, requestId, companyId);
      const updated = member(receipt.member);
      if (updated.id !== membershipId || updated.userId === userId || updated.role !== requestedRole || updated.status !== requestedStatus || ![expectedVersion, expectedVersion + 1].includes(updated.version)) throw new Error();
      return { companyId, teamVersion: version(receipt.teamVersion), member: updated };
    });
    revalidateTeam(); return { ok: true, receipt };
  } catch (error) { return failure(error); }
}

export async function getMyInvitationsAction(value: unknown = {}): Promise<TeamResult<MyInvitationsPage>> {
  try {
    const row = input(value, ['pageKey', 'limit']);
    const pageKey = cursor(row.pageKey), count = limit(row.limit);
    const { db } = await requireInvitationContext();
    const result = await db.rpc('list_my_company_invitations', { p_page_key: pageKey, p_limit: count });
    rpcError(result.error);
    return output(() => {
      const page = object(result.data);
      const invitations = pageItems<MyCompanyInvitation>(page.invitations, count, pageKey, value => {
        const item = object(value);
        const createdAt = timestamp(item.createdAt), expiresAt = timestamp(item.expiresAt);
        if (item.status !== 'pending' || Date.parse(expiresAt) <= Date.parse(createdAt)) throw new Error();
        return { id: uuid(item.id), companyId: uuid(item.companyId), companyName: text(item.companyName, 300), role: inviteRole(item.role), status: 'pending', version: version(item.version), createdAt, expiresAt };
      });
      return { ok: true, invitations, nextPageKey: nextCursor(page.nextPageKey, invitations) };
    });
  } catch (error) { return failure(error); }
}

export async function acceptCompanyInvitationAction(value: unknown): Promise<TeamResult<AcceptedInvitation>> {
  try {
    const row = input(value, ['invitationId', 'expectedVersion', 'requestId']);
    const invitationId = uuid(row.invitationId), expectedVersion = version(row.expectedVersion), requestId = uuid(row.requestId);
    const { db, userId } = await requireInvitationContext();
    const result = await db.rpc('accept_company_invitation', { p_invitation_id: invitationId, p_expected_version: expectedVersion, p_request_id: requestId });
    rpcError(result.error);
    const receipt = output(() => {
      const receipt = object(result.data); receiptIdentity(receipt, userId, requestId);
      if (receipt.invitationId !== invitationId || receipt.userId !== userId || receipt.status !== 'active' || version(receipt.version) !== 1) throw new Error();
      inviteRole(receipt.role);
      return { companyId: uuid(receipt.companyId), membershipId: uuid(receipt.membershipId) };
    });
    // Never infer present access from an immutable historical acceptance receipt.
    const current = await db.from('memberships').select('id,user_id,company_id,role,status,companies!inner(id,status)')
      .eq('id', receipt.membershipId).eq('user_id', userId).eq('company_id', receipt.companyId).eq('status', 'active').eq('companies.status', 'active').maybeSingle();
    if (current.error) throw new TeamActionError('unavailable');
    if (!current.data) throw new TeamActionError('access_denied');
    const active = output(() => {
      const member = object(current.data), company = object(member.companies);
      if (member.id !== receipt.membershipId || member.user_id !== userId || member.company_id !== receipt.companyId || member.status !== 'active' || company.id !== receipt.companyId || company.status !== 'active') throw new Error();
      return { companyId: receipt.companyId, role: role(member.role) };
    });
    const store = await cookies();
    store.set('trafexa-company', active.companyId, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
    revalidateTeam(); return { ok: true, ...active };
  } catch (error) { return failure(error); }
}
