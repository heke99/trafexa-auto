import type { ApplicationInvitation, PrepareApplicationInvitationInput } from './application-invitation-types';

export class ApplicationInvitationError extends Error {
  constructor(readonly code: 'invalid_input' | 'unavailable' | 'access_denied' | 'conflict' | 'not_found' | 'existing_account') { super('Application invitation unavailable'); }
}
export function invitationRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new ApplicationInvitationError('invalid_input');
  return value as Record<string, unknown>;
}
function strict(value: unknown, keys: string[]) {
  const row = invitationRecord(value);
  if (Object.keys(row).some(key => !keys.includes(key))) throw new ApplicationInvitationError('invalid_input');
  return row;
}
export function invitationUuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new ApplicationInvitationError('invalid_input');
  return value.toLowerCase();
}
function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string' || value !== value.trim() || value.length < min || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new ApplicationInvitationError('invalid_input');
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 80 || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) throw new ApplicationInvitationError('unavailable');
  return value;
}
export function parsePrepareApplicationInvitationInput(value: unknown): PrepareApplicationInvitationInput {
  const row = strict(value, ['applicationId', 'expectedVersion', 'reason', 'requestId', 'reviewAcknowledged']);
  if (typeof row.expectedVersion !== 'number' || !Number.isInteger(row.expectedVersion) || row.expectedVersion < 1 || row.expectedVersion > 2147483647 || row.reviewAcknowledged !== true) throw new ApplicationInvitationError('invalid_input');
  return { applicationId: invitationUuid(row.applicationId), expectedVersion: row.expectedVersion, reason: text(row.reason, 2, 500), requestId: invitationUuid(row.requestId), reviewAcknowledged: true };
}
export function parseApplicationInvitationReadInput(value: unknown): { applicationId: string } {
  const row = strict(value, ['applicationId']);
  return { applicationId: invitationUuid(row.applicationId) };
}
export function parseApplicationInvitation(value: unknown): ApplicationInvitation {
  try {
    const row = invitationRecord(value);
    if (!['prepared', 'expired', 'created'].includes(String(row.status)) || typeof row.applicationVersion !== 'number' || !Number.isInteger(row.applicationVersion) || row.applicationVersion < 1 || row.applicationVersion > 2147483647) throw new Error();
    const email = text(row.email, 3, 254);
    if (email !== email.toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error();
    const result: ApplicationInvitation = {
      id: invitationUuid(row.id), applicationId: invitationUuid(row.applicationId), applicationVersion: row.applicationVersion,
      actorUserId: invitationUuid(row.actorUserId), requestId: invitationUuid(row.requestId), email, name: text(row.name, 2, 160), reason: text(row.reason, 2, 500),
      status: row.status as ApplicationInvitation['status'], userId: row.userId === null ? null : invitationUuid(row.userId),
      createdAt: timestamp(row.createdAt), expiresAt: timestamp(row.expiresAt), consumedAt: row.consumedAt === null ? null : timestamp(row.consumedAt),
    };
    if (Date.parse(result.expiresAt) < Date.parse(result.createdAt) || (result.status === 'created') !== (result.userId !== null && result.consumedAt !== null) || result.status !== 'created' && (result.userId !== null || result.consumedAt !== null)) throw new Error();
    return result;
  } catch { throw new ApplicationInvitationError('unavailable'); }
}
