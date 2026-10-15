import { OWNERSHIP_ATTESTATION_VERSION, type OwnershipMember, type OwnershipPage, type OwnershipTransfer } from './types';

export class OwnershipError extends Error {
  constructor(readonly code: 'invalid_input' | 'access_denied' | 'conflict' | 'unavailable') { super('Ownership transfer could not be verified'); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new OwnershipError('invalid_input');
  return value as Record<string, unknown>;
}
export function input(value: unknown, keys: string[]) {
  const row = object(value);
  if (Object.keys(row).some(key => !keys.includes(key))) throw new OwnershipError('invalid_input');
  return row;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new OwnershipError('invalid_input');
  return value.toLowerCase();
}
export function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647) throw new OwnershipError('invalid_input');
  return value;
}
export function reason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value].length > 500 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new OwnershipError('invalid_input');
  return value.trim();
}
export function acknowledgment(row: Record<string, unknown>) {
  if (row.acknowledged !== true || row.attestationVersion !== OWNERSHIP_ATTESTATION_VERSION) throw new OwnershipError('invalid_input');
}
function bool(value: unknown): boolean { if (typeof value !== 'boolean') throw new OwnershipError('unavailable'); return value; }
function instant(value: unknown): string {
  if (typeof value !== 'string' || value.length > 80 || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) throw new OwnershipError('unavailable');
  return value;
}
export function member(value: unknown): OwnershipMember {
  const row = object(value);
  if (typeof row.email !== 'string' || row.email.length > 254 || row.email !== row.email.trim().toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) || /[\u0000-\u001f\u007f-\u009f]/.test(row.email)) throw new OwnershipError('unavailable');
  return { membershipId: uuid(row.membershipId), userId: uuid(row.userId), email: row.email, version: version(row.version) };
}
export function transfer(value: unknown, companyId: string): OwnershipTransfer {
  const row = object(value), from = member(row.from), to = member(row.to);
  const status = row.status;
  if (uuid(row.companyId) !== companyId || !['pending', 'accepted', 'cancelled', 'expired'].includes(String(status)) || from.membershipId === to.membershipId || from.userId === to.userId || row.attestationVersion !== OWNERSHIP_ATTESTATION_VERSION) throw new OwnershipError('unavailable');
  const createdAt = instant(row.createdAt), expiresAt = instant(row.expiresAt), resolvedAt = row.resolvedAt === null ? null : instant(row.resolvedAt);
  const cancelReason = row.cancelReason === null ? null : reason(row.cancelReason);
  if (Date.parse(expiresAt) - Date.parse(createdAt) !== 86400000 || (status === 'pending') !== (resolvedAt === null) || (status === 'cancelled') !== (cancelReason !== null) || resolvedAt !== null && Date.parse(resolvedAt) < Date.parse(createdAt) || status === 'expired' && resolvedAt !== expiresAt) throw new OwnershipError('unavailable');
  const content = reason(row.reason);
  if (content !== row.reason || cancelReason !== row.cancelReason) throw new OwnershipError('unavailable');
  return { id: uuid(row.id), companyId, from, to, status: status as OwnershipTransfer['status'], version: version(row.version), teamVersionAtRequest: version(row.teamVersionAtRequest), reason: content, attestationVersion: OWNERSHIP_ATTESTATION_VERSION, createdAt, expiresAt, resolvedAt, cancelReason };
}
export function page(value: unknown, companyId: string, userId: string, role: 'owner' | 'admin', after: string | null, limit: number): OwnershipPage {
  const row = object(value);
  if (uuid(row.companyId) !== companyId || uuid(row.actorUserId) !== userId || row.actorRole !== role || !Array.isArray(row.candidates) || row.candidates.length > limit) throw new OwnershipError('unavailable');
  const candidates = row.candidates.map(member), owner = row.owner === null ? null : member(row.owner), current = row.transfer === null ? null : transfer(row.transfer, companyId);
  if (candidates.some((item, i) => item.membershipId <= (i ? candidates[i - 1].membershipId : after ?? '') || item.userId === owner?.userId) || new Set(candidates.map(item => item.userId)).size !== candidates.length) throw new OwnershipError('unavailable');
  const nextPageKey = row.nextPageKey === null ? null : uuid(row.nextPageKey);
  if (nextPageKey && (candidates.length !== limit || candidates.at(-1)?.membershipId !== nextPageKey) || role !== 'owner' && (candidates.length !== 0 || nextPageKey !== null)) throw new OwnershipError('unavailable');
  const serverNow = instant(row.serverNow), canRequest = bool(row.canRequest), canAccept = bool(row.canAccept), canCancel = bool(row.canCancel);
  if (![null, 'owner_missing', 'multiple_owners', 'pending_transfer', 'not_owner'].includes(row.blockReason as null | string)) throw new OwnershipError('unavailable');
  if (canRequest && (role !== 'owner' || owner?.userId !== userId || row.blockReason !== null || current?.status === 'pending') || canAccept && (role !== 'admin' || current?.status !== 'pending' || current.to.userId !== userId) || canCancel && (role !== 'owner' || current?.status !== 'pending' || current.from.userId !== userId)) throw new OwnershipError('unavailable');
  if (current?.status === 'pending' && Date.parse(current.expiresAt) <= Date.parse(serverNow) || current?.status === 'expired' && Date.parse(current.expiresAt) > Date.parse(serverNow)) throw new OwnershipError('unavailable');
  return { companyId, actorUserId: userId, actorRole: role, teamVersion: version(row.teamVersion), serverNow, owner, candidates, nextPageKey, transfer: current, canRequest, canAccept, canCancel, blockReason: row.blockReason as OwnershipPage['blockReason'] };
}
export function output<T>(parse: () => T): T {
  try { return parse(); } catch { throw new OwnershipError('unavailable'); }
}
