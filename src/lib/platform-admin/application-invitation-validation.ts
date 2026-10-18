import type { ApplicationInvitation, ApplicationInvitationLifecycle, PrepareApplicationInvitationInput, ReprepareApplicationInvitationInput, RenewApplicationInvitationInput } from './application-invitation-types';

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
export function parseRenewApplicationInvitationInput(value: unknown): RenewApplicationInvitationInput {
  const row = strict(value, ['applicationId', 'invitationId', 'expectedDeliveryId', 'expectedVersion', 'reason', 'requestId', 'acknowledged', 'invalidatesPreviousLink']);
  if (row.acknowledged !== true || row.invalidatesPreviousLink !== true || typeof row.expectedVersion !== 'number' || !Number.isInteger(row.expectedVersion) || row.expectedVersion < 1 || row.expectedVersion > 2147483647) throw new ApplicationInvitationError('invalid_input');
  return { applicationId: invitationUuid(row.applicationId), invitationId: invitationUuid(row.invitationId), expectedDeliveryId: invitationUuid(row.expectedDeliveryId), expectedVersion: row.expectedVersion, reason: text(row.reason, 2, 500), requestId: invitationUuid(row.requestId), acknowledged: true, invalidatesPreviousLink: true };
}
export function parseReprepareApplicationInvitationInput(value: unknown): ReprepareApplicationInvitationInput {
  const row = strict(value, ['applicationId', 'invitationId', 'expectedApplicationVersion', 'expectedVersion', 'reason', 'requestId', 'reviewAcknowledged']);
  const prepared = parsePrepareApplicationInvitationInput({ applicationId: row.applicationId, expectedVersion: row.expectedVersion, reason: row.reason, requestId: row.requestId, reviewAcknowledged: row.reviewAcknowledged });
  if (typeof row.expectedApplicationVersion !== 'number' || !Number.isInteger(row.expectedApplicationVersion) || row.expectedApplicationVersion < 1 || row.expectedApplicationVersion >= prepared.expectedVersion) throw new ApplicationInvitationError('invalid_input');
  return { ...prepared, invitationId: invitationUuid(row.invitationId), expectedApplicationVersion: row.expectedApplicationVersion };
}
export function parseApplicationInvitationLifecycle(value: unknown, invitation: ApplicationInvitation | null): ApplicationInvitationLifecycle {
  try {
    const row = invitationRecord(value), delivery = invitationRecord(row.delivery), account = invitationRecord(row.account);
    if (typeof row.applicationVersion !== 'number' || !Number.isInteger(row.applicationVersion) || row.applicationVersion < 1 || row.applicationVersion > 2147483647 || typeof row.canRenew !== 'boolean' || typeof delivery.canRetry !== 'boolean' || !['not_started', 'generating', 'sending', 'sent', 'retryable', 'rejected', 'unknown'].includes(String(delivery.state)) || typeof delivery.attemptCount !== 'number' || !Number.isInteger(delivery.attemptCount) || delivery.attemptCount < 0 || delivery.attemptCount > 5 || account.emailVerified !== null && typeof account.emailVerified !== 'boolean' || account.approvalStatus !== null && !['pending', 'approved', 'rejected', 'suspended'].includes(String(account.approvalStatus))) throw new Error();
    const result: ApplicationInvitationLifecycle = {
      applicationVersion: row.applicationVersion,
      delivery: { id: delivery.id === null ? null : invitationUuid(delivery.id), state: delivery.state as ApplicationInvitationLifecycle['delivery']['state'], attemptCount: delivery.attemptCount, firstAttemptAt: delivery.firstAttemptAt === null ? null : timestamp(delivery.firstAttemptAt), updatedAt: delivery.updatedAt === null ? null : timestamp(delivery.updatedAt), canRetry: delivery.canRetry },
      account: { emailVerified: account.emailVerified as boolean | null, approvalStatus: account.approvalStatus as ApplicationInvitationLifecycle['account']['approvalStatus'] }, canRenew: row.canRenew,
    };
    if ((result.delivery.attemptCount === 0) !== (result.delivery.firstAttemptAt === null) || result.delivery.id === null && (result.delivery.state !== 'not_started' || result.delivery.updatedAt !== null || result.delivery.attemptCount !== 0) || !invitation && (result.delivery.id !== null || result.account.emailVerified !== null || result.account.approvalStatus !== null || result.canRenew || result.delivery.canRetry) || !invitation?.userId && (result.account.emailVerified !== null || result.account.approvalStatus !== null) || result.delivery.canRetry && !['not_started', 'retryable', 'generating'].includes(result.delivery.state) || result.canRenew && (!invitation?.userId || result.account.emailVerified !== false || result.account.approvalStatus !== 'approved' || result.delivery.id === null || !['sent', 'rejected', 'unknown'].includes(result.delivery.state))) throw new Error();
    return result;
  } catch { throw new ApplicationInvitationError('unavailable'); }
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
