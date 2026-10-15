'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { PlatformAdminError, requirePlatformAdminContext } from './context';
import type { ApplicationInvitation, ApplicationInvitationDatabase, ApplicationInvitationResult } from './application-invitation-types';
import { ApplicationInvitationError, invitationRecord, parseApplicationInvitation, parseApplicationInvitationReadInput, parsePrepareApplicationInvitationInput } from './application-invitation-validation';

function failure(error: unknown): ApplicationInvitationResult<never> {
  const code = error instanceof PlatformAdminError ? error.code === 'unavailable' ? 'unavailable' : 'access_denied' : error instanceof ApplicationInvitationError ? error.code : 'unavailable';
  const messages = { existing_account: 'Ett befintligt konto behöver hanteras separat i kontoadministrationen.', access_denied: 'Du har inte tillgång till kontoinbjudningar.', invalid_input: 'Kontrollera ansökan, orsaken och granskningsbekräftelsen.', conflict: 'Ansökan eller kontot har ändrats. Läs in aktuell information innan du försöker igen.', not_found: 'Ansökan kunde inte hittas.', unavailable: 'Kontoinbjudan kunde inte verifieras. Försök igen med samma uppgifter.' };
  return { ok: false, code, message: messages[code] };
}
function rpcError(error: { code?: string } | null) {
  if (error) throw new ApplicationInvitationError(error.code === '42501' ? 'access_denied' : error.code === '23505' ? 'existing_account' : error.code === '40001' ? 'conflict' : error.code === 'P0002' ? 'not_found' : error.code === '22023' ? 'invalid_input' : 'unavailable');
}

export async function getPlatformApplicationInvitationAction(value: unknown): Promise<ApplicationInvitationResult<{ invitation: ApplicationInvitation | null }>> {
  try {
    const { db, userId } = await requirePlatformAdminContext();
    const { applicationId } = parseApplicationInvitationReadInput(value);
    const result = await (db as unknown as SupabaseClient<ApplicationInvitationDatabase>).rpc('get_platform_application_invitation', { p_application_id: applicationId });
    rpcError(result.error);
    const row = invitationRecord(result.data);
    if (row.applicationId !== applicationId) throw new ApplicationInvitationError('unavailable');
    const invitation = row.invitation === null ? null : parseApplicationInvitation(row.invitation);
    if (invitation && invitation.applicationId !== applicationId) throw new ApplicationInvitationError('unavailable');
    const fresh = await requirePlatformAdminContext();
    if (fresh.userId !== userId) throw new ApplicationInvitationError('access_denied');
    return { ok: true, invitation };
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
