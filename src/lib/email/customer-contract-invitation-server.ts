import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { encryptInvitationBody, decryptInvitationBody } from './account-invitation-content';
import { sendAccountInvitation } from './account-invitation-transport';
import { renderCustomerContractInvitationBody } from './customer-contract-invitation-content';
import { validRecipient } from './templates';

export type CustomerInvitationKind = 'contract_invitation' | 'offer_invitation' | 'contract_completed';
export type ClaimedCustomerEmail = { id: string; leaseId: string; reference: string; recipient: string; kind: CustomerInvitationKind; createdAt: string };
/** Frozen database renewal receipt; never construct this from browser fields. */
export type ReviewedCustomerDocumentEmail = { companyId: string; actorUserId: string; invitationId: string; recipientEmail: string; documentHash: string; documentVersion: number; generation: number };
export type CustomerInvitationClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
type Job = { emailId: string; leaseId: string; referenceId: string; kind: CustomerInvitationKind; recipient: string; mode: 'guest'; invitationId: string; userId: null; expiresAt: string; ciphertext: string | null; firstAttemptAt: string | null };
type Outcome = { status: 'accepted'; providerId: string } | { status: 'retryable' | 'rejected' | 'unknown' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Customer invitation unavailable'); return value as Record<string, unknown>; }
function timestamp(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)); }
export function parseReviewedCustomerDocumentEmail(value: unknown, recipient: string, generation: number): ReviewedCustomerDocumentEmail {
  const r = record(value), keys = ['companyId','actorUserId','invitationId','recipientEmail','documentHash','documentVersion','generation'];
  if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r,k)) || ![r.companyId,r.actorUserId,r.invitationId].every(id => typeof id === 'string' && UUID.test(id)) || r.recipientEmail !== recipient || !validRecipient(r.recipientEmail) || typeof r.documentHash !== 'string' || !/^[0-9a-f]{64}$/.test(r.documentHash) || typeof r.documentVersion !== 'number' || !Number.isSafeInteger(r.documentVersion) || r.documentVersion < 1 || r.documentVersion > 2147483647 || typeof r.generation !== 'number' || !Number.isSafeInteger(r.generation) || r.generation < 1 || r.generation > 2147483647 || r.generation !== generation) throw Error('Renewal review unavailable');
  return r as ReviewedCustomerDocumentEmail;
}
function job(value: unknown, email: ClaimedCustomerEmail, review?: ReviewedCustomerDocumentEmail): Job {
  const r = record(value);
  if (r.emailId !== email.id || r.leaseId !== email.leaseId || r.referenceId !== email.reference || r.kind !== email.kind || r.recipient !== email.recipient || r.mode !== 'guest' || typeof r.invitationId !== 'string' || !UUID.test(r.invitationId) || r.userId !== null || !timestamp(r.expiresAt) || Date.parse(r.expiresAt) <= Date.now() || r.ciphertext !== null && (typeof r.ciphertext !== 'string' || r.ciphertext.length > 36_000) || r.firstAttemptAt !== null && !timestamp(r.firstAttemptAt)) throw Error('Document invitation scope mismatch');
  if (review && (r.companyId !== review.companyId || r.dealerActorUserId !== review.actorUserId || r.invitationId !== review.invitationId || r.recipient !== review.recipientEmail || r.documentHash !== review.documentHash || r.documentVersion !== review.documentVersion || r.generation !== review.generation)) throw Error('Renewal document review changed');
  return r as Job;
}
async function rpc(db: CustomerInvitationClient, name: string, args: Record<string, unknown>) { const result = await db.rpc(name, args); if (result.error) throw Error('Customer invitation unavailable'); return result.data; }

/** Called only for an independently claimed and verified persisted domain email.
 * The generic dispatcher owns queue finishing; this worker never accepts a browser recipient. */
export async function sendClaimedCustomerContractInvitation(db: CustomerInvitationClient, email: ClaimedCustomerEmail, config: { apiKey: string; secret: string }, review?: ReviewedCustomerDocumentEmail): Promise<Outcome> {
  if (![email.id, email.leaseId, email.reference].every(id => UUID.test(id)) || !validRecipient(email.recipient) || !['contract_invitation', 'offer_invitation', 'contract_completed'].includes(email.kind)) return { status: 'rejected' };
  const identity = { p_email_id: email.id, p_lease_id: email.leaseId };
  let attemptStarted = false;
  try {
    if (review) parseReviewedCustomerDocumentEmail(review,email.recipient,review.generation);
    let current = job(await rpc(db, 'prepare_customer_contract_invitation', identity), email,review);
    const refresh = async () => job(await rpc(db, 'current_customer_contract_invitation', { ...identity, p_invitation_id: current.invitationId }), email,review);
    if (!current.ciphertext) {
      const token = randomBytes(32).toString('base64url');
      const tokenSha256 = createHash('sha256').update(token, 'utf8').digest('hex');
      const body = renderCustomerContractInvitationBody({ emailId: email.id, invitationId: current.invitationId, referenceId: email.reference, kind: email.kind, recipient: email.recipient, token, expiresAt: current.expiresAt });
      const ciphertext = encryptInvitationBody(body, email.id, config.secret);
      const invitationId = current.invitationId;
      current = job(await rpc(db, 'bind_guest_document_invitation', { ...identity, p_invitation_id: invitationId, p_token_sha256: tokenSha256, p_ciphertext: ciphertext }), email,review);
      if (current.invitationId !== invitationId || current.ciphertext !== ciphertext) throw Error('Document invitation payload changed');
    }
    current = await refresh();
    if (!current.ciphertext) throw Error('Customer invitation not bound');
    const body = decryptInvitationBody(current.ciphertext, email.id, config.secret);
    const envelope = record(JSON.parse(body));
    if (!Array.isArray(envelope.to) || envelope.to.length !== 1 || envelope.to[0] !== email.recipient) throw Error('Customer invitation recipient mismatch');
    // If this acknowledgement is lost, a provider attempt can no longer be ruled out.
    attemptStarted = true;
    const started = record(await rpc(db, 'begin_customer_contract_invitation_send', identity));
    if (started.ok !== true || !timestamp(started.firstAttemptAt) || current.firstAttemptAt !== null && current.firstAttemptAt !== started.firstAttemptAt) return { status: 'unknown' };
    const result = await sendAccountInvitation({ invitationId: email.id, firstAttemptAt: started.firstAttemptAt, body, apiKey: config.apiKey, idempotencyKey: `trafexa/${email.id}` });
    return result.status === 'sent' ? { status: 'accepted', providerId: result.providerId } : result;
  } catch { return { status: attemptStarted ? 'unknown' : 'retryable' }; }
}
