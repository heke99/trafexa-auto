'use server';
import { revalidatePath } from 'next/cache';
import { CrmError } from '@/lib/crm/context';
import { requireDealerSigningContext, requireCustomerSigningContext } from '@/lib/contracts/signing-context';
import { signing, hash, email, signatureStrokes } from '@/lib/contracts/signing-validation';
import { input, record, id, integer, text } from '@/lib/contracts/validation';
import { CONTRACT_SIGNING_CONSENT_VERSION, type ContractSigning, type ContractSigningPage, type SignContractInput } from '@/lib/contracts/signing-types';
import type { ContractResult } from '@/lib/contracts/types';
type Dealer = Awaited<ReturnType<typeof requireDealerSigningContext>>;
type Customer = Awaited<ReturnType<typeof requireCustomerSigningContext>>;
type Context = Dealer | Customer;
function failure(e: unknown, validation = false): ContractResult<never> {
  const raw = e && typeof e === 'object' && 'code' in e ? e.code : null;
  const code = e instanceof CrmError ? e.code : validation ? 'invalid_input' : raw === '40001' ? 'conflict' : raw === '42501' ? 'access_denied' : raw === '22023' ? 'invalid_input' : 'unavailable';
  return { ok: false, code, message: code === 'invalid_input' ? 'Kontrollera namn, namnteckning och bekräftelse av avtalets villkor.' : code === 'conflict' ? 'Affären har redan en signering eller underlaget har ändrats. Uppdatera för att se det aktuella avtalet.' : code === 'access_denied' || code === 'unauthenticated' ? 'Din inloggning eller behörighet till avtalet kunde inte verifieras.' : 'Resultatet kunde inte bekräftas. Uppdatera och försök vid behov igen med samma begäran.' };
}
async function context(companyId?: string, write = false): Promise<Context> { return companyId ? requireDealerSigningContext(companyId, write) : requireCustomerSigningContext(); }
function scope(r: Record<string, unknown>, c: Context, requestId?: string) {
  if (id(r.actorUserId) !== c.userId || requestId && id(r.requestId) !== requestId) throw Error('Invalid actor receipt');
  if ('companyId' in c) { if (id(r.companyId) !== c.companyId || r.actorRole !== c.role) throw Error('Invalid company receipt'); }
  else if (email(r.recipientEmail) !== c.email || r.actorRole !== undefined && r.actorRole !== 'customer') throw Error('Invalid customer receipt');
}
function parse(v: unknown, c: Context, dealId?: string) { return signing(v, c.userId, 'companyId' in c ? { companyId: c.companyId, dealId, role: c.role } : { customerEmail: c.email }); }
async function fresh(c: Context, write = false) { const n = await context('companyId' in c ? c.companyId : undefined, write); if (n.userId !== c.userId || 'role' in c && (!('role' in n) || n.role !== c.role) || 'email' in c && (!('email' in n) || n.email !== c.email)) throw new CrmError('access_denied'); }
function invalidate() { revalidatePath('/deals'); revalidatePath('/my-contracts'); }
async function dispatch(kind: 'contract_invitation' | 'contract_completed' | 'contract_completed_company', signingId: string) {
  if (process.env.TRANSACTIONAL_EMAIL_ENABLED !== 'true') return;
  try { const { dispatchTransactionalEvent } = await import('@/lib/email/server'); await dispatchTransactionalEvent(kind, signingId); } catch { /* The committed outbox remains the delivery receipt; business state is already saved. */ }
}
export async function listDealContractSigningsAction(value: { companyId: string; dealId: string }): Promise<ContractResult<ContractSigningPage>> {
  let companyId: string, dealId: string;
  try { const r = input(value, ['companyId', 'dealId']); companyId = id(r.companyId); dealId = id(r.dealId); } catch (e) { return failure(e, true); }
  try { const c = await requireDealerSigningContext(companyId), response = await c.db.rpc('list_deal_contract_signings', { p_company_id: companyId, p_deal_id: dealId }); if (response.error) throw response.error;
    const r = record(response.data); scope(r, c); if (id(r.dealId) !== dealId || !Array.isArray(r.signings) || r.signings.length > 50 || r.nextBeforeId !== null) throw Error('Invalid page');
    const signings = r.signings.map(v => parse(v, c, dealId)); if (new Set(signings.map(s => s.id)).size !== signings.length) throw Error('Duplicate signing'); await fresh(c); return { ok: true, signings, nextBeforeId: null };
  } catch (e) { return failure(e); }
}
export async function listMyContractSigningsAction(value: { beforeId?: string | null } = {}): Promise<ContractResult<ContractSigningPage>> {
  let beforeId: string | null;
  try { const r = input(value, ['beforeId']); beforeId = r.beforeId === undefined || r.beforeId === null ? null : id(r.beforeId); } catch (e) { return failure(e, true); }
  try { const c = await requireCustomerSigningContext(), response = await c.db.rpc('list_my_contract_signings', { p_before_id: beforeId }); if (response.error) throw response.error;
    const r = record(response.data); scope(r, c); if (!Array.isArray(r.signings) || r.signings.length > 50) throw Error('Invalid page'); const signings = r.signings.map(v => parse(v, c)), nextBeforeId = r.nextBeforeId === null ? null : id(r.nextBeforeId);
    if (new Set(signings.map(s => s.id)).size !== signings.length || signings.some((s, i) => beforeId !== null && s.id >= beforeId || i > 0 && s.id >= signings[i - 1].id) || nextBeforeId !== null && (signings.length !== 50 || nextBeforeId !== signings.at(-1)?.id)) throw Error('Invalid cursor');
    await fresh(c); return { ok: true, signings, nextBeforeId };
  } catch (e) { return failure(e); }
}
export async function getContractSigningAction(value: { signingId: string; companyId?: string }): Promise<ContractResult<{ signing: ContractSigning }>> {
  let signingId: string, companyId: string | undefined;
  try { const r = input(value, ['signingId', 'companyId']); signingId = id(r.signingId); companyId = r.companyId === undefined ? undefined : id(r.companyId); } catch (e) { return failure(e, true); }
  try { const c = await context(companyId), response = await c.db.rpc('get_contract_signing', { p_signing_id: signingId, p_company_id: companyId ?? null }); if (response.error) throw response.error;
    const r = record(response.data); scope(r, c); const saved = parse(r.signing, c); if (saved.id !== signingId) throw Error('Invalid signing'); await fresh(c); return { ok: true, signing: saved };
  } catch (e) { return failure(e); }
}
export async function requestContractSigningAction(value: { companyId: string; dealId: string; draftId: string; reviewAcknowledged: boolean; requestId: string }): Promise<ContractResult<{ signing: ContractSigning }>> {
  let v: typeof value;
  try { const r = input(value, ['companyId', 'dealId', 'draftId', 'reviewAcknowledged', 'requestId']); if (r.reviewAcknowledged !== true) throw Error('Review required'); v = { companyId: id(r.companyId), dealId: id(r.dealId), draftId: id(r.draftId), reviewAcknowledged: true, requestId: id(r.requestId) }; } catch (e) { return failure(e, true); }
  try { const c = await requireDealerSigningContext(v.companyId, true), response = await c.db.rpc('request_contract_signing', { p_company_id: v.companyId, p_deal_id: v.dealId, p_draft_id: v.draftId, p_acknowledged: true, p_request_id: v.requestId }); if (response.error) throw response.error;
    const r = record(response.data); scope(r, c, v.requestId); const saved = parse(r.signing, c, v.dealId); if (saved.draftId !== v.draftId || saved.revision !== 1 || saved.status !== 'pending') throw Error('Invalid request receipt'); await fresh(c, true); await dispatch('contract_invitation', saved.id); await fresh(c, true); invalidate(); return { ok: true, signing: saved };
  } catch (e) { return failure(e); }
}
export async function signContractAction(value: SignContractInput): Promise<ContractResult<{ signing: ContractSigning }>> {
  let v: SignContractInput;
  try { const r = input(value, ['signingId', 'companyId', 'expectedRevision', 'documentHash', 'fullName', 'strokes', 'acknowledged', 'consentVersion', 'requestId']); if (r.acknowledged !== true || r.consentVersion !== CONTRACT_SIGNING_CONSENT_VERSION) throw Error('Consent required');
    v = { signingId: id(r.signingId), ...(r.companyId === undefined ? {} : { companyId: id(r.companyId) }), expectedRevision: integer(r.expectedRevision, 1, 2), documentHash: hash(r.documentHash), fullName: text(r.fullName, 2, 160), strokes: signatureStrokes(r.strokes), acknowledged: true, consentVersion: CONTRACT_SIGNING_CONSENT_VERSION, requestId: id(r.requestId) };
  } catch (e) { return failure(e, true); }
  try { const c = await context(v.companyId, true), response = await c.db.rpc('sign_contract', { p_signing_id: v.signingId, p_company_id: v.companyId ?? null, p_expected_revision: v.expectedRevision, p_document_hash: v.documentHash, p_full_name: v.fullName, p_strokes: v.strokes, p_acknowledged: true, p_consent_version: v.consentVersion, p_request_id: v.requestId }); if (response.error) throw response.error;
    const r = record(response.data); scope(r, c, v.requestId); const saved = parse(r.signing, c), receipt = 'companyId' in c ? saved.companySignature : saved.customerSignature;
    if (saved.id !== v.signingId || saved.documentHash !== v.documentHash || saved.revision !== v.expectedRevision + 1 || !receipt || receipt.fullName !== v.fullName || JSON.stringify(receipt.strokes) !== JSON.stringify(v.strokes)) throw Error('Invalid signature receipt');
    await fresh(c, true); if (saved.status === 'completed') { await dispatch('contract_completed', saved.id); await dispatch('contract_completed_company', saved.id); } await fresh(c, true); invalidate(); return { ok: true, signing: saved };
  } catch (e) { return failure(e); }
}
