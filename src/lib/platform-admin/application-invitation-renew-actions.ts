'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { PlatformAdminError, requirePlatformAdminContext } from './context';
import type { ApplicationInvitationDatabase } from './application-invitation-types';
import { getPlatformApplicationInvitationAction } from './application-invitation-actions';
import { ApplicationInvitationError, invitationRecord, invitationUuid, parseApplicationInvitation, parseRenewApplicationInvitationInput } from './application-invitation-validation';
import { accountInvitationConfigured, dispatchAccountInvitation } from '@/lib/email/account-invitation-server';

type Result = { ok: true; invitationId: string; email: string; status: 'sent' | 'already_sent' | 'unknown' | 'not_configured' } | { ok: false; code: 'forbidden' | 'conflict' | 'invalid_input' | 'unavailable' | 'existing_account' };

/** An explicit second review replaces the prior personal link. Unknown outcomes never trigger this action automatically. */
export async function renewPlatformApplicationInvitationAction(value: unknown): Promise<Result> {
  try {
    const actor = await requirePlatformAdminContext();
    const input = parseRenewApplicationInvitationInput(value);
    if (!accountInvitationConfigured()) return { ok: true, invitationId: input.invitationId, email: '', status: 'not_configured' };
    const existing = await getPlatformApplicationInvitationAction({ applicationId: input.applicationId });
    if (!existing.ok) return { ok: false, code: existing.code === 'access_denied' ? 'forbidden' : 'unavailable' };
    if (!existing.invitation || existing.invitation.id !== input.invitationId || existing.invitation.actorUserId !== actor.userId) return { ok: false, code: 'conflict' };
    const result = await (actor.db as unknown as SupabaseClient<ApplicationInvitationDatabase>).rpc('renew_platform_application_invitation', {
      p_invitation_id: input.invitationId, p_expected_delivery_id: input.expectedDeliveryId, p_expected_version: input.expectedVersion, p_reason: input.reason, p_request_id: input.requestId,
    });
    if (result.error) return { ok: false, code: result.error.code === '42501' ? 'forbidden' : result.error.code === '40001' ? 'conflict' : result.error.code === '22023' ? 'invalid_input' : 'unavailable' };
    const receipt = invitationRecord(result.data), invitation = parseApplicationInvitation(receipt.invitation);
    const deliveryId = invitationUuid(receipt.deliveryId);
    const immutableFields = ['id', 'applicationId', 'applicationVersion', 'actorUserId', 'requestId', 'email', 'name', 'reason', 'userId', 'createdAt', 'consumedAt'] as const;
    if (immutableFields.some(field => invitation[field] !== existing.invitation![field])) return { ok: false, code: 'unavailable' };
    if (invitation.id !== input.invitationId || invitation.applicationId !== input.applicationId || invitation.actorUserId !== actor.userId || !invitation.userId || deliveryId === input.expectedDeliveryId || receipt.previousDeliveryId !== input.expectedDeliveryId || receipt.applicationVersion !== input.expectedVersion || receipt.requestId !== input.requestId || receipt.reason !== input.reason) return { ok: false, code: 'unavailable' };
    const fresh = await requirePlatformAdminContext();
    if (fresh.userId !== actor.userId) return { ok: false, code: 'forbidden' };
    const status = await dispatchAccountInvitation(invitation, { expectedDeliveryId: deliveryId });
    if (status === 'busy' || status === 'retryable') return { ok: false, code: 'unavailable' };
    try { revalidatePath('/admin'); } catch { /* Persisted generation and outcome remain readable. */ }
    return { ok: true, invitationId: invitation.id, email: invitation.email, status };
  } catch (error) {
    return { ok: false, code: error instanceof PlatformAdminError && error.code !== 'unavailable' ? 'forbidden' : error instanceof ApplicationInvitationError && error.code === 'invalid_input' ? 'invalid_input' : 'unavailable' };
  }
}
