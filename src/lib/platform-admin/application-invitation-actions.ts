'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { PlatformAdminError, requirePlatformAdminContext } from './context';
import type { ApplicationInvitation, ApplicationInvitationDatabase, ApplicationInvitationLifecycle, ApplicationInvitationResult } from './application-invitation-types';
import { ApplicationInvitationError, invitationRecord, invitationUuid, parseApplicationInvitation, parseApplicationInvitationLifecycle, parseApplicationInvitationReadInput, parsePrepareApplicationInvitationInput, parseReprepareApplicationInvitationInput } from './application-invitation-validation';

function failure(error: unknown): ApplicationInvitationResult<never> {
  const code = error instanceof PlatformAdminError ? error.code === 'unavailable' ? 'unavailable' : 'access_denied' : error instanceof ApplicationInvitationError ? error.code : 'unavailable';
  const messages = { existing_account: 'Ett befintligt konto behöver hanteras separat i kontoadministrationen.', access_denied: 'Du har inte tillgång till kontoinbjudningar.', invalid_input: 'Kontrollera ansökan, orsaken och granskningsbekräftelsen.', conflict: 'Ansökan eller kontot har ändrats. Läs in aktuell information innan du försöker igen.', not_found: 'Ansökan kunde inte hittas.', unavailable: 'Kontoinbjudan kunde inte verifieras. Försök igen med samma uppgifter.' };
  return { ok: false, code, message: messages[code] };
}
function rpcError(error: { code?: string } | null) {
  if (error) throw new ApplicationInvitationError(error.code === '42501' ? 'access_denied' : error.code === '23505' ? 'existing_account' : error.code === '40001' ? 'conflict' : error.code === 'P0002' ? 'not_found' : error.code === '22023' ? 'invalid_input' : 'unavailable');
}

export async function getPlatformApplicationInvitationAction(value: unknown): Promise<ApplicationInvitationResult<{ invitation: ApplicationInvitation | null; lifecycle: ApplicationInvitationLifecycle }>> {
  try {
    const { db, userId } = await requirePlatformAdminContext();
    const { applicationId } = parseApplicationInvitationReadInput(value);
    const result = await (db as unknown as SupabaseClient<ApplicationInvitationDatabase>).rpc('get_platform_application_invitation', { p_application_id: applicationId });
    rpcError(result.error);
    const row = invitationRecord(result.data);
    if (row.applicationId !== applicationId) throw new ApplicationInvitationError('unavailable');
    const invitation = row.invitation === null ? null : parseApplicationInvitation(row.invitation);
    if (invitation && invitation.applicationId !== applicationId) throw new ApplicationInvitationError('unavailable');
    const lifecycle = parseApplicationInvitationLifecycle(row.lifecycle, invitation);
    const fresh = await requirePlatformAdminContext();
    if (fresh.userId !== userId) throw new ApplicationInvitationError('access_denied');
    return { ok: true, invitation, lifecycle };
  } catch (error) { return failure(error); }
}

/** Approval records a trusted invitation intent; Auth creation/email delivery follow separately. */
export async function preparePlatformApplicationInvitationAction(value: unknown): Promise<ApplicationInvitationResult<{ invitation: ApplicationInvitation }>> {
  try {
    const { db, userId } = await requirePlatformAdminContext();
    const input = parsePrepareApplicationInvitationInput(value);
    const result = await (db as unknown as SupabaseClient<ApplicationInvitationDatabase>).rpc('prepare_platform_application_invitation', {
      p_application_id: input.applicationId, p_expected_version: input.expectedVersion, p_reason: input.reason, p_request_id: input.requestId,
    });
    rpcError(result.error);
    const invitation = parseApplicationInvitation(result.data);
    if (invitation.applicationId !== input.applicationId || invitation.applicationVersion !== input.expectedVersion || invitation.actorUserId !== userId || invitation.requestId !== input.requestId || invitation.reason !== input.reason) throw new ApplicationInvitationError('unavailable');
    try { revalidatePath('/admin'); } catch { /* Persisted approval remains independently verifiable. */ }
    const fresh = await requirePlatformAdminContext();
    if (fresh.userId !== userId) throw new ApplicationInvitationError('access_denied');
    return { ok: true, invitation };
  } catch (error) { return failure(error); }
}

/** An unconsumed review can be superseded only after a separate fresh case review. */
export async function repreparePlatformApplicationInvitationAction(value: unknown): Promise<ApplicationInvitationResult<{ invitation: ApplicationInvitation; deliveryId: string | null }>> {
  try {
    const { db, userId } = await requirePlatformAdminContext();
    const input = parseReprepareApplicationInvitationInput(value);
    const existing = await getPlatformApplicationInvitationAction({ applicationId: input.applicationId });
    if (!existing.ok) throw new ApplicationInvitationError(existing.code);
    if (!existing.invitation || existing.invitation.id !== input.invitationId || existing.invitation.actorUserId !== userId || existing.invitation.userId || existing.lifecycle.applicationVersion !== input.expectedVersion) throw new ApplicationInvitationError('conflict');
    const result = await (db as unknown as SupabaseClient<ApplicationInvitationDatabase>).rpc('reprepare_platform_application_invitation', {
      p_invitation_id: input.invitationId, p_expected_application_version: input.expectedApplicationVersion, p_expected_version: input.expectedVersion, p_reason: input.reason, p_request_id: input.requestId,
    });
    rpcError(result.error);
    const row = invitationRecord(result.data), invitation = parseApplicationInvitation(row.invitation);
    const deliveryId = row.deliveryId === null ? null : invitationUuid(row.deliveryId);
    if (row.previousApplicationVersion !== input.expectedApplicationVersion || invitation.id !== input.invitationId || invitation.applicationId !== input.applicationId || invitation.applicationVersion !== input.expectedVersion || invitation.actorUserId !== userId || invitation.requestId !== input.requestId || invitation.reason !== input.reason || invitation.userId !== null || invitation.status !== 'prepared' || invitation.email !== existing.invitation.email || invitation.name !== existing.invitation.name || (deliveryId === null) !== (existing.lifecycle.delivery.id === null) || deliveryId !== null && deliveryId === existing.lifecycle.delivery.id && existing.invitation.applicationVersion === input.expectedApplicationVersion) throw new ApplicationInvitationError('unavailable');
    const fresh = await requirePlatformAdminContext();
    if (fresh.userId !== userId) throw new ApplicationInvitationError('access_denied');
    try { revalidatePath('/admin'); } catch { /* A reviewed preparation remains independently readable. */ }
    return { ok: true, invitation, deliveryId };
  } catch (error) { return failure(error); }
}
