'use server';
import { revalidatePath } from 'next/cache';
import { requireDealerSigningContext } from '@/lib/contracts/signing-context';
import { requireDealerReviewContext } from '@/lib/offer-review/context';
import { requireApprovedAccountAccess } from '@/lib/account-access/context';
import { input, id, integer, record } from '@/lib/contracts/validation';
import { email, hash } from '@/lib/contracts/signing-validation';
import { contractEmailConfigurationStatus, dispatchGuestInvitationEmail } from '@/lib/email/server';
import type { GuestInvitationRenewalInput, GuestInvitationRenewalReview, RenewGuestDocumentInvitationInput, GuestInvitationRenewalReceipt, GuestInvitationRenewalFailure } from '@/lib/guest-customer/renewal-types';

type Context = Awaited<ReturnType<typeof requireDealerSigningContext>> | Awaited<ReturnType<typeof requireDealerReviewContext>>;
type RpcClient = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> };
function failure(error: unknown, invalid = false): GuestInvitationRenewalFailure {
  const raw = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const code = invalid || raw === '22023' ? 'invalid_input' : ['42501', 'access_denied', 'unauthenticated'].includes(String(raw)) ? 'access_denied' : raw === '40001' ? 'conflict' : 'unavailable';
  return { ok: false, code, message: code === 'invalid_input' ? 'Kontrollera underlaget och bekräfta att du har granskat den nya länken.' : code === 'access_denied' ? 'Din behörighet till dokumentet kunde inte verifieras.' : code === 'conflict' ? 'Dokumentet eller kundlänken har ändrats. Läs in en ny granskning.' : 'Resultatet kunde inte bekräftas. Försök igen med samma granskning och begäran.' };
}
function parse(value: unknown, write = false): GuestInvitationRenewalInput {
  const r = input(value, ['companyId', 'dealId', 'kind', 'referenceId', ...(write ? ['expectedEmailId', 'expectedGeneration', 'expectedDocumentHash', 'requestId', 'reviewAcknowledged'] : [])]);
  if (r.kind !== 'offer_invitation' && r.kind !== 'contract_invitation') throw Error('Invalid invitation kind');
  return { companyId: id(r.companyId), dealId: id(r.dealId), kind: r.kind, referenceId: id(r.referenceId) };
}
function writable(v: GuestInvitationRenewalInput, role: string) { return (v.kind === 'contract_invitation' ? ['owner', 'admin'] : ['owner', 'admin', 'sales']).includes(role); }
async function context(v: GuestInvitationRenewalInput, write = false): Promise<Context> {
  const c = v.kind === 'contract_invitation' ? await requireDealerSigningContext(v.companyId, write) : await requireDealerReviewContext(v.companyId, write ? 'write' : 'read');
  const roles = v.kind === 'contract_invitation' ? ['owner', 'admin', 'finance'] : ['owner', 'admin', 'sales', 'finance', 'viewer'];
  const approved = await requireApprovedAccountAccess();
  if (c.companyId !== v.companyId || !roles.includes(c.role) || write && !writable(v, c.role) || approved.userId !== c.userId) throw Object.assign(Error('Access denied'), { code: 'access_denied' });
  return c;
}
async function fresh(v: GuestInvitationRenewalInput, c: Context, write = false) {
  const current = await context(v, write);
  if (current.userId !== c.userId || current.role !== c.role) throw Object.assign(Error('Actor changed'), { code: 'access_denied' });
}
function args(v: GuestInvitationRenewalInput) { return { p_company_id: v.companyId, p_deal_id: v.dealId, p_kind: v.kind, p_reference_id: v.referenceId }; }
function scoped(r: Record<string, unknown>, v: GuestInvitationRenewalInput, c: Context) {
  if (id(r.companyId) !== v.companyId || id(r.dealId) !== v.dealId || r.kind !== v.kind || id(r.referenceId) !== v.referenceId || id(r.actorUserId) !== c.userId || r.actorRole !== c.role) throw Error('Invalid renewal scope');
}
function review(value: unknown, v: GuestInvitationRenewalInput, c: Context): GuestInvitationRenewalReview {
  const r = record(value); scoped(r, v, c);
  const emailId = r.emailId === null ? null : id(r.emailId), invitationId = r.invitationId === null ? null : id(r.invitationId), generation = integer(r.generation, 0);
  if (r.status !== null && !['pending', 'processing', 'accepted', 'rejected', 'unknown', 'cancelled'].includes(String(r.status)) || typeof r.canWrite !== 'boolean' || r.canWrite !== writable(v, c.role) || typeof r.canRenew !== 'boolean') throw Error('Invalid renewal status');
  const expiresAt = r.expiresAt === null ? null : r.expiresAt;
  if (expiresAt !== null && (typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))) || (emailId === null) !== (r.status === null) || emailId === null && (generation !== 0 || invitationId !== null || expiresAt !== null) || (invitationId === null) !== (expiresAt === null)) throw Error('Invalid invitation state');
  if (r.canRenew && (!r.canWrite || r.status !== 'accepted' || !emailId || !invitationId || !expiresAt || Date.parse(expiresAt as string) > Date.now())) throw Error('Invalid renewal eligibility');
  return { ...v, actorUserId: c.userId, actorRole: c.role, recipientEmail: email(r.recipientEmail), documentHash: hash(r.documentHash), documentVersion: integer(r.documentVersion), emailId, invitationId, generation, status: r.status as GuestInvitationRenewalReview['status'], expiresAt: expiresAt as string | null, canWrite: r.canWrite, canRenew: r.canRenew, transport: contractEmailConfigurationStatus().transport };
}
export async function getGuestInvitationRenewalReviewAction(value: GuestInvitationRenewalInput): Promise<{ ok: true; review: GuestInvitationRenewalReview } | GuestInvitationRenewalFailure> {
  let v: GuestInvitationRenewalInput; try { v = parse(value); } catch (e) { return failure(e, true); }
  try {
    const c = await context(v), result = await (c.db as unknown as RpcClient).rpc('get_guest_invitation_renewal_review', args(v));
    if (result.error) throw result.error;
    const saved = review(result.data, v, c); await fresh(v, c); return { ok: true, review: saved };
  } catch (e) { return failure(e); }
}
export async function renewGuestDocumentInvitationAction(value: RenewGuestDocumentInvitationInput): Promise<{ ok: true; renewal: GuestInvitationRenewalReceipt } | GuestInvitationRenewalFailure> {
  let v: RenewGuestDocumentInvitationInput;
  try {
    const base = parse(value, true), r = record(value);
    if (r.reviewAcknowledged !== true) throw Error('Review required');
    v = { ...base, expectedEmailId: id(r.expectedEmailId), expectedGeneration: integer(r.expectedGeneration, 0, 2147483646), expectedDocumentHash: hash(r.expectedDocumentHash), requestId: id(r.requestId), reviewAcknowledged: true };
  } catch (e) { return failure(e, true); }
  try {
    const c = await context(v, true);
    const source = await (c.db as unknown as RpcClient).rpc('get_guest_invitation_renewal_review', args(v));
    if (source.error) throw source.error;
    const frozen = review(source.data, v, c);
    // SQL checks the latest generation atomically and replays an immutable receipt
    // for the same request. This read checks source binding only: an eligibility
    // gate here would break retries after a lost response changed the generation.
    const result = await (c.db as unknown as RpcClient).rpc('renew_guest_document_invitation', { ...args(v), p_expected_email_id: v.expectedEmailId, p_expected_generation: v.expectedGeneration, p_expected_document_hash: v.expectedDocumentHash, p_request_id: v.requestId });
    if (result.error) throw result.error;
    const r = record(result.data); scoped(r, v, c);
    const emailId = id(r.emailId), generation = integer(r.generation);
    if (id(r.requestId) !== v.requestId || id(r.expectedEmailId) !== v.expectedEmailId || integer(r.expectedGeneration, 0) !== v.expectedGeneration || hash(r.documentHash) !== v.expectedDocumentHash || hash(r.documentHash) !== frozen.documentHash || email(r.recipientEmail) !== frozen.recipientEmail || integer(r.documentVersion) !== frozen.documentVersion || generation !== v.expectedGeneration + 1 || emailId === v.expectedEmailId) throw Error('Invalid renewal receipt');
    const saved: GuestInvitationRenewalReceipt = { companyId: v.companyId, dealId: v.dealId, kind: v.kind, referenceId: v.referenceId, actorUserId: c.userId, actorRole: c.role, expectedEmailId: v.expectedEmailId, expectedGeneration: v.expectedGeneration, requestId: v.requestId, emailId, generation, recipientEmail: email(r.recipientEmail), documentHash: hash(r.documentHash), documentVersion: integer(r.documentVersion), dispatchStatus: 'unavailable' };
    await fresh(v, c, true);
    try { saved.dispatchStatus = (await dispatchGuestInvitationEmail(v.kind, v.referenceId, emailId)).status; } catch { /* Persisted renewal remains replayable under the same request UUID. */ }
    await fresh(v, c, true);
    try { revalidatePath('/deals'); } catch { /* A cache failure does not discard the immutable receipt. */ }
    return { ok: true, renewal: saved };
  } catch (e) { return failure(e); }
}
