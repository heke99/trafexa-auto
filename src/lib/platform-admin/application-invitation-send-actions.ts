'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformAdminContext, PlatformAdminError } from './context';
import { getPlatformApplicationInvitationAction, preparePlatformApplicationInvitationAction } from './application-invitation-actions';
import { invitationRecord, parsePrepareApplicationInvitationInput, ApplicationInvitationError } from './application-invitation-validation';
import { accountInvitationConfigured, dispatchAccountInvitation } from '@/lib/email/account-invitation-server';

type Result = { ok: true; invitationId: string; email: string; status: 'sent' | 'already_sent' | 'unknown' | 'not_configured' } | { ok: false; code: 'forbidden' | 'conflict' | 'invalid_input' | 'unavailable' | 'existing_account' };
export async function inviteApprovedApplicationAction(value: unknown): Promise<Result> {
  try {
    const actor = await requirePlatformAdminContext();
    const raw = invitationRecord(value);
    if (Object.keys(raw).some(key => !['applicationId', 'expectedVersion', 'reason', 'requestId', 'acknowledged'].includes(key)) || raw.acknowledged !== true) return { ok: false, code: 'invalid_input' };
    const input = parsePrepareApplicationInvitationInput({ applicationId: raw.applicationId, expectedVersion: raw.expectedVersion, reason: raw.reason, requestId: raw.requestId, reviewAcknowledged: true });
    if (!accountInvitationConfigured()) return { ok: true, invitationId: '', email: '', status: 'not_configured' };
    const existing = await getPlatformApplicationInvitationAction({ applicationId: input.applicationId });
    if (!existing.ok) return { ok: false, code: existing.code === 'access_denied' ? 'forbidden' : 'unavailable' };
    if (existing.invitation && (existing.invitation.actorUserId !== actor.userId || existing.invitation.applicationVersion !== input.expectedVersion || existing.invitation.reason !== input.reason)) return { ok: false, code: 'conflict' };
    const prepared = existing.invitation && existing.invitation.status !== 'expired' ? { ok: true as const, invitation: existing.invitation } : await preparePlatformApplicationInvitationAction(existing.invitation ? { ...input, requestId: existing.invitation.requestId } : input);
    if (!prepared.ok) return { ok: false, code: prepared.code === 'access_denied' ? 'forbidden' : ['conflict', 'invalid_input', 'existing_account'].includes(prepared.code) ? prepared.code as 'conflict' | 'invalid_input' | 'existing_account' : 'unavailable' };
    if (prepared.invitation.actorUserId !== actor.userId || prepared.invitation.applicationVersion !== input.expectedVersion || prepared.invitation.reason !== input.reason) return { ok: false, code: 'conflict' };
    const status = await dispatchAccountInvitation(prepared.invitation);
    if (status === 'busy' || status === 'retryable') return { ok: false, code: 'unavailable' };
    try { revalidatePath('/admin'); } catch { /* A persisted delivery remains independently readable. */ }
    return { ok: true, invitationId: prepared.invitation.id, email: prepared.invitation.email, status };
  } catch (error) {
    return { ok: false, code: error instanceof PlatformAdminError && error.code !== 'unavailable' ? 'forbidden' : error instanceof ApplicationInvitationError && error.code === 'invalid_input' ? 'invalid_input' : 'unavailable' };
  }
}
