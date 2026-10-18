import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { requirePlatformAdminContext } from '@/lib/platform-admin/context';
import type { ApplicationInvitation } from '@/lib/platform-admin/application-invitation-types';
import { invitationRecord, invitationUuid } from '@/lib/platform-admin/application-invitation-validation';
import { decryptInvitationBody, encryptInvitationBody, renderAccountInvitationBody } from './account-invitation-content';
import { sendAccountInvitation } from './account-invitation-transport';
import { validAccountInvitationToken } from '@/lib/auth/account-invitation-token';

const PROJECT_URL = 'https://buqdtssxrotkzndublrt.supabase.co';
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
type Delivery = { invitationId: string; deliveryId: string; actorUserId: string; leaseId: string | null; status: string; email: string; userId: string | null; firstAttemptAt: string | null; ciphertext?: string | null };
export function accountInvitationConfigured() {
  return process.env.TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED === 'true' && process.env.NEXT_PUBLIC_SUPABASE_URL === PROJECT_URL && Boolean(process.env.RESEND_API_KEY) && Boolean(process.env.SUPABASE_SECRET_KEY);
}
async function rpc(db: RpcClient, name: string, args: Record<string, unknown>) {
  const result = await db.rpc(name, args); if (result.error) throw Error('Invitation unavailable'); return result.data;
}
function delivery(value: unknown, invitation: ApplicationInvitation): Delivery {
  const row = invitationRecord(value);
  if (row.invitationId !== invitation.id || row.actorUserId !== invitation.actorUserId || row.email !== invitation.email || !['generate', 'send', 'sent', 'unknown', 'busy'].includes(String(row.status))) throw Error('Invitation scope mismatch');
  invitationUuid(row.deliveryId);
  if (row.leaseId !== null) invitationUuid(row.leaseId);
  if (row.userId !== null) invitationUuid(row.userId);
  if (invitation.userId && row.userId !== invitation.userId) throw Error('Invited user changed');
  if (row.firstAttemptAt !== null && (typeof row.firstAttemptAt !== 'string' || !Number.isFinite(Date.parse(row.firstAttemptAt)))) throw Error('Invalid delivery');
  if ('ciphertext' in row && row.ciphertext !== null && typeof row.ciphertext !== 'string') throw Error('Invalid delivery');
  return row as Delivery;
}

/** Explicit reviewed approval only. A crash before storing the payload can regenerate an unsent token;
 * after sending begins, ambiguous outcomes never rotate or automatically resend the link. */
export async function dispatchAccountInvitation(invitation: ApplicationInvitation, options: { expectedDeliveryId?: string } = {}): Promise<'sent' | 'already_sent' | 'unknown' | 'retryable' | 'busy'> {
  if (!accountInvitationConfigured()) throw Error('Invitation not configured');
  const actor = await requirePlatformAdminContext();
  if (actor.userId !== invitation.actorUserId) throw Error('Invitation actor mismatch');
  const service = createClient(PROJECT_URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }) } });
  const expectedDeliveryId = options.expectedDeliveryId === undefined ? null : invitationUuid(options.expectedDeliveryId);
  const claimed = delivery(await rpc(actor.db as unknown as RpcClient, 'claim_platform_application_invitation_delivery_v2', { p_invitation_id: invitation.id, p_expected_delivery_id: expectedDeliveryId }), invitation);
  if (expectedDeliveryId && claimed.deliveryId !== expectedDeliveryId) throw Error('Invitation delivery changed');
  if (claimed.status === 'sent') return 'already_sent';
  if (claimed.status === 'unknown' || claimed.status === 'busy') return claimed.status;
  if (!claimed.leaseId) throw Error('Missing delivery lease');
  const args = { p_invitation_id: invitation.id, p_lease_id: claimed.leaseId, p_actor_user_id: actor.userId };
  const current = async () => {
    const fresh = await requirePlatformAdminContext();
    if (fresh.userId !== actor.userId) throw Error('Invitation access changed');
    const freshJob = delivery(await rpc(service as unknown as RpcClient, 'get_platform_application_invitation_delivery', args), invitation);
    if (freshJob.deliveryId !== claimed.deliveryId) throw Error('Invitation delivery changed');
    return freshJob;
  };
  const finish = async (outcome: 'sent' | 'retryable' | 'rejected' | 'unknown', providerId: string | null = null) => {
    try {
      const row = invitationRecord(await rpc(service as unknown as RpcClient, 'finish_platform_application_invitation_delivery', { ...args, p_outcome: outcome, p_provider_id: providerId }));
      if (row.invitationId !== invitation.id || row.deliveryId !== claimed.deliveryId || row.actorUserId !== actor.userId || row.leaseId !== claimed.leaseId || row.outcome !== outcome || row.providerId !== providerId) return 'unknown' as const;
      await requirePlatformAdminContext();
      return outcome === 'rejected' ? 'unknown' as const : outcome;
    } catch { return 'unknown' as const; }
  };
  let job = await current();
  if (job.status === 'generate') {
    // generateLink does not send via Supabase SMTP. Recipient comes from the approved private intent.
    const generated = await service.auth.admin.generateLink({ type: 'invite', email: invitation.email, options: { redirectTo: 'https://app.trafexa.com/activate-account' } });
    if (generated.error) throw Error('Invitation link unavailable');
    const token = generated.data?.properties?.hashed_token, user = generated.data?.user;
    if (!validAccountInvitationToken(token) || generated.data.properties.verification_type !== 'invite' || !user || user.email?.toLowerCase() !== invitation.email) throw Error('Invalid invitation link');
    // Auth's deferred gate binds the actual created user before this request can continue.
    job = await current();
    if (job.userId !== user.id) throw Error('Invited user mismatch');
    const body = renderAccountInvitationBody({ invitationId: invitation.id, email: invitation.email, name: invitation.name, tokenHash: token });
    const ciphertext = encryptInvitationBody(body, job.deliveryId, process.env.SUPABASE_SECRET_KEY!);
    job = delivery(await rpc(service as unknown as RpcClient, 'bind_platform_application_invitation_delivery', { ...args, p_ciphertext: ciphertext }), invitation);
    if (job.deliveryId !== claimed.deliveryId) throw Error('Invitation delivery changed');
  }
  job = await current();
  if (job.status !== 'send' || !job.ciphertext || !job.firstAttemptAt || !job.userId) return finish('rejected');
  let body: string;
  try { body = decryptInvitationBody(job.ciphertext, job.deliveryId, process.env.SUPABASE_SECRET_KEY!); } catch { return finish('rejected'); }
  const result = await sendAccountInvitation({ invitationId: invitation.id, deliveryId: job.deliveryId, firstAttemptAt: job.firstAttemptAt, body, apiKey: process.env.RESEND_API_KEY! });
  return finish(result.status, result.status === 'sent' ? result.providerId : null);
}
