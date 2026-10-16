import { generateSignedContractArtifacts, parseCompletedContract, sha256 } from './signed-contract-pdf.ts';
import { z } from 'zod';
import { CONTRACT_ARCHIVE_BUCKET, CONTRACT_ARCHIVE_RENDERER_VERSION } from '../contracts/archive-types.ts';
import type { ContractArchive, ContractArchiveCode, ContractArchiveInput } from '../contracts/archive-types.ts';

export { CONTRACT_ARCHIVE_BUCKET };
export const MAX_CONTRACT_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_CONTRACT_EVIDENCE_BYTES = 1024 * 1024;
export class NativeContractArchiveError extends Error {
  readonly code: ContractArchiveCode;
  constructor(code: ContractArchiveCode) { super('Avtalets originalarkiv kunde inte verifieras.'); this.name = 'NativeContractArchiveError'; this.code = code; }
}
const fail = (code: ContractArchiveCode): never => { throw new NativeContractArchiveError(code); };
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.number().int().positive().max(2147483647);
const timestamp = z.string().datetime({ offset: true });
const file = z.object({ objectPath: z.string().min(1).max(500), sha256: hash, bytes: z.number().int().positive().safe(), mimeType: z.string() }).strict();
const archiveSchema = z.object({
  id: uuid, signingId: uuid, companyId: uuid, dealId: uuid, draftId: uuid, draftVersion: version,
  documentContentSha256: hash, signingRevision: z.literal(3), rendererVersion: z.literal(CONTRACT_ARCHIVE_RENDERER_VERSION), evidenceSchemaVersion: z.literal(1),
  pdf: file.extend({ mimeType: z.literal('application/pdf'), bytes: z.number().int().min(5).max(MAX_CONTRACT_PDF_BYTES) }),
  evidence: file.extend({ mimeType: z.literal('application/json'), bytes: z.number().int().min(2).max(MAX_CONTRACT_EVIDENCE_BYTES) }),
  archivedAt: timestamp,
}).strict();
type Completed = ReturnType<typeof parseCompletedContract>;
export type ContractArchiveControl = { signal: AbortSignal };
export type NativeArchiveAuthorization = { companyId: string; actorId: string; role: 'owner' | 'admin' | 'finance' | 'customer' };
export type NativeArchiveRegistration = {
  companyId: string; signingId: string; actorUserId: string; requestId: string; documentContentSha256: string; revision: number;
  pdfSha256: string; pdfBytes: number; evidenceSha256: string; evidenceBytes: number; rendererVersion: typeof CONTRACT_ARCHIVE_RENDERER_VERSION;
};
export interface NativeContractArchiveDependencies {
  authorize(companyId: string, control: ContractArchiveControl): Promise<NativeArchiveAuthorization>;
  getSigning(companyId: string, signingId: string, control: ContractArchiveControl): Promise<unknown>;
  /** A successful RPC is also a fresh catalog proof that the bucket is private. */
  getArchive(companyId: string, signingId: string, control: ContractArchiveControl): Promise<unknown>;
  prepareRegistration(control: ContractArchiveControl): Promise<void>;
  upload(path: string, bytes: Uint8Array, mimeType: 'application/pdf' | 'application/json', control: ContractArchiveControl): Promise<void>;
  download(path: string, control: ContractArchiveControl): Promise<Uint8Array>;
  register(input: NativeArchiveRegistration, control: ContractArchiveControl): Promise<unknown>;
  generateArtifacts?: (source: Completed) => Promise<{ pdf: Uint8Array; evidence: Uint8Array }>;
  timeoutMs?: number;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function contractArchivePaths(companyId: string, signingId: string, pdfHash: string, evidenceHash: string) {
  const base = `${uuid.parse(companyId)}/native-contracts/${uuid.parse(signingId)}/v1`;
  return { pdf: `${base}/signed-${hash.parse(pdfHash)}.pdf`, evidence: `${base}/evidence-${hash.parse(evidenceHash)}.json` };
}
export function parseContractArchiveInput(value: unknown): ContractArchiveInput {
  try { return freeze(z.object({ companyId: uuid, signingId: uuid, requestId: uuid }).strict().parse(value)); }
  catch { return fail('invalid_input'); }
}
export function parseContractArchive(value: unknown, expected?: { companyId: string; signingId: string }): ContractArchive {
  try {
    const result = archiveSchema.parse(value);
    if (expected && (result.companyId !== expected.companyId || result.signingId !== expected.signingId)) return fail('conflict');
    const paths = contractArchivePaths(result.companyId, result.signingId, result.pdf.sha256, result.evidence.sha256);
    if (result.pdf.objectPath !== paths.pdf || result.evidence.objectPath !== paths.evidence) return fail('storage_unverified');
    return freeze(result);
  } catch (error) { if (error instanceof NativeContractArchiveError) throw error; return fail('source_invalid'); }
}
export function parseContractArchiveEnvelope(value: unknown, expected: { companyId?: string; signingId: string; actorId: string }) {
  try {
    const envelope = z.object({ actorId: uuid, companyId: uuid, signingId: uuid, archive: z.unknown() }).strict().parse(value);
    if (envelope.actorId !== expected.actorId || envelope.signingId !== expected.signingId || expected.companyId !== undefined && envelope.companyId !== expected.companyId) return fail('access_denied');
    const archive = envelope.archive === null ? null : parseContractArchive(envelope.archive, envelope);
    return { actorId: envelope.actorId, companyId: envelope.companyId, signingId: envelope.signingId, archive };
  } catch (error) { if (error instanceof NativeContractArchiveError) throw error; return fail('source_invalid'); }
}
function source(value: unknown, expected: { companyId: string; signingId: string }): Completed {
  try {
    const result = parseCompletedContract(value);
    if (result.id !== expected.signingId || result.companyId !== expected.companyId || result.revision !== 3) return fail('source_invalid');
    return freeze(result);
  } catch { return fail('source_invalid'); }
}
export function assertContractArchiveSource(archive: ContractArchive, signed: Completed) {
  if (archive.companyId !== signed.companyId || archive.signingId !== signed.id || archive.dealId !== signed.dealId || archive.draftId !== signed.draftId || archive.draftVersion !== signed.draftVersion || archive.documentContentSha256 !== signed.documentHash || archive.signingRevision !== signed.revision) return fail('conflict');
}
function bytes(value: unknown, max: number, kind: 'pdf' | 'evidence'): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength < (kind === 'pdf' ? 5 : 2) || value.byteLength > max) return fail('storage_unverified');
  const copy = new Uint8Array(value);
  if (kind === 'pdf' && new TextDecoder('ascii').decode(copy.subarray(0, 5)) !== '%PDF-') return fail('storage_unverified');
  return copy;
}
function evidenceProof(value: Uint8Array, signed?: Completed) {
  try {
    const receipt = z.object({ party: z.enum(['customer', 'company']), fullName: z.string().min(2).max(160), signedAt: timestamp, documentHash: hash, consentVersion: z.literal('2026-10-14'),authenticationMethod:z.literal('email_link').optional(),approvalMethod:z.literal('typed_name').optional(),guestInvitationId:uuid.optional(),recipientEmail:z.string().email().optional() }).strict();
    const result = z.object({ schemaVersion: z.literal(1), method: z.literal('trafexa-simple-electronic-signature'), signingId: uuid, draftId: uuid, draftVersion: version, documentContentSha256: hash, signedPdfSha256: hash, completedAt: timestamp, receipts: z.array(receipt).length(2), assurance: z.string().min(1).max(1000) }).strict().parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)));
    if (result.receipts[0].party !== 'customer' || result.receipts[1].party !== 'company' || result.receipts.some(row => row.documentHash !== result.documentContentSha256)) return fail('storage_unverified');
    for(const receipt of result.receipts){if(receipt.authenticationMethod==='email_link'){if(receipt.party!=='customer'||receipt.approvalMethod!=='typed_name'||!receipt.guestInvitationId||!receipt.recipientEmail)return fail('storage_unverified');}else if(receipt.approvalMethod!==undefined||receipt.guestInvitationId!==undefined||receipt.recipientEmail!==undefined)return fail('storage_unverified');}
    if (signed) {
      if (result.signingId !== signed.id || result.draftId !== signed.draftId || result.draftVersion !== signed.draftVersion || result.documentContentSha256 !== signed.documentHash || result.completedAt !== signed.completedAt) return fail('storage_unverified');
      for (const [index, expected] of [signed.customerSignature, signed.companySignature].entries()) {
        const actual = result.receipts[index];
        if (actual.party !== expected.party || actual.fullName !== expected.fullName || actual.signedAt !== expected.signedAt || actual.consentVersion !== expected.consentVersion || actual.authenticationMethod!==expected.authenticationMethod || actual.approvalMethod!==expected.approvalMethod || actual.guestInvitationId!==expected.guestInvitationId || actual.recipientEmail!==expected.recipientEmail) return fail('storage_unverified');
      }
    }
    return result;
  } catch (error) { if (error instanceof NativeContractArchiveError) throw error; return fail('storage_unverified'); }
}
/** Checks actual bytes and their pair binding, not just storage metadata. */
export function verifyContractArchiveFiles(archive: ContractArchive, values: { pdf: Uint8Array; evidence: Uint8Array }, signed?: Completed) {
  const pdf = bytes(values.pdf, MAX_CONTRACT_PDF_BYTES, 'pdf'), evidence = bytes(values.evidence, MAX_CONTRACT_EVIDENCE_BYTES, 'evidence');
  if (pdf.byteLength !== archive.pdf.bytes || evidence.byteLength !== archive.evidence.bytes || sha256(pdf) !== archive.pdf.sha256 || sha256(evidence) !== archive.evidence.sha256) return fail('storage_unverified');
  const proof = evidenceProof(evidence, signed);
  if (proof.signedPdfSha256 !== archive.pdf.sha256 || proof.signingId !== archive.signingId || proof.draftId !== archive.draftId || proof.draftVersion !== archive.draftVersion || proof.documentContentSha256 !== archive.documentContentSha256) return fail('storage_unverified');
  return { pdf, evidence };
}

/** A shared deadline bounds all I/O, including lost responses and recovery. */
export function nativeArchiveOperation(timeoutMs = 30000) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) return fail('invalid_input');
  const deadline = Date.now() + timeoutMs;
  return async function bounded<T>(work: (control: ContractArchiveControl) => Promise<T>): Promise<T> {
    const remaining = Math.min(deadline - Date.now(), 15000);
    if (remaining <= 0) return fail('unavailable');
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([Promise.resolve().then(() => work({ signal: controller.signal })), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new NativeContractArchiveError('unavailable')); }, remaining);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  };
}

export async function archiveNativeContract(rawInput: unknown, deps: NativeContractArchiveDependencies): Promise<ContractArchive> {
  try {
    const input = parseContractArchiveInput(rawInput), bounded = nativeArchiveOperation(deps.timeoutMs);
    const initial = await bounded(control => deps.authorize(input.companyId, control));
    if (initial.companyId !== input.companyId || !z.string().uuid().safeParse(initial.actorId).success || !['owner', 'admin'].includes(initial.role)) return fail('access_denied');
    const expected = { ...input, actorId: initial.actorId };
    const signed = source(await bounded(control => deps.getSigning(input.companyId, input.signingId, control)), input);
    async function fresh() {
      const current = await bounded(control => deps.authorize(input.companyId, control));
      if (current.companyId !== initial.companyId || current.actorId !== initial.actorId || current.role !== initial.role) return fail('access_denied');
    }
    async function readArchive() { return parseContractArchiveEnvelope(await bounded(control => deps.getArchive(input.companyId, input.signingId, control)), expected).archive; }
    async function verifiedOriginal(archive: ContractArchive): Promise<ContractArchive> {
      assertContractArchiveSource(archive, signed);
      await fresh();
      const before = await readArchive();
      if (JSON.stringify(before) !== JSON.stringify(archive)) return fail('conflict');
      const [pdf, evidence] = await Promise.all([bounded(control => deps.download(archive.pdf.objectPath, control)), bounded(control => deps.download(archive.evidence.objectPath, control))]);
      verifyContractArchiveFiles(archive, { pdf, evidence }, signed);
      const after = await readArchive();
      if (JSON.stringify(after) !== JSON.stringify(archive)) return fail('conflict');
      const current = source(await bounded(control => deps.getSigning(input.companyId, input.signingId, control)), input);
      if (JSON.stringify(current) !== JSON.stringify(signed)) return fail('conflict');
      await fresh(); return archive;
    }
    const existing = await readArchive();
    if (existing !== null) return await verifiedOriginal(existing);
    await bounded(control => deps.prepareRegistration(control));
    await fresh();
    const rendered = await bounded(() => (deps.generateArtifacts ?? generateSignedContractArtifacts)(signed));
    const pdf = bytes(rendered.pdf, MAX_CONTRACT_PDF_BYTES, 'pdf'), evidence = bytes(rendered.evidence, MAX_CONTRACT_EVIDENCE_BYTES, 'evidence');
    const evidenceData = evidenceProof(evidence, signed);
    const pdfSha256 = sha256(pdf), evidenceSha256 = sha256(evidence);
    if (evidenceData.signedPdfSha256 !== pdfSha256) return fail('storage_unverified');
    const paths = contractArchivePaths(input.companyId, input.signingId, pdfSha256, evidenceSha256);
    // A competitor may have registered while this server rendered. Its original
    // always wins, even when this renderer would now produce different bytes.
    const winner = await readArchive();
    if (winner !== null) return await verifiedOriginal(winner);
    await fresh();
    for (const part of [{ path: paths.pdf, content: pdf, type: 'application/pdf' as const }, { path: paths.evidence, content: evidence, type: 'application/json' as const }]) {
      // An upload response can be lost, or upsert:false can find an own orphan.
      // Only exact authenticated readback can turn either result into success.
      try { await bounded(control => deps.upload(part.path, new Uint8Array(part.content), part.type, control)); }
      catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        if (code === 'access_denied' || code === 'unauthenticated' || code === 'configuration_missing' || code === '42501') throw error;
        // Network/duplicate responses remain unknown until actual readback.
      }
      const stored = await bounded(control => deps.download(part.path, control));
      if (!(stored instanceof Uint8Array) || stored.byteLength !== part.content.byteLength || sha256(stored) !== sha256(part.content)) return fail('storage_unverified');
    }
    const winnerAfterUpload = await readArchive();
    if (winnerAfterUpload !== null) return await verifiedOriginal(winnerAfterUpload);
    await fresh();
    const registration: NativeArchiveRegistration = freeze({ companyId: input.companyId, signingId: input.signingId, actorUserId: initial.actorId, requestId: input.requestId, documentContentSha256: signed.documentHash, revision: signed.revision, pdfSha256, pdfBytes: pdf.byteLength, evidenceSha256, evidenceBytes: evidence.byteLength, rendererVersion: CONTRACT_ARCHIVE_RENDERER_VERSION });
    let receipt: unknown;
    try { receipt = await bounded(control => deps.register(registration, control)); }
    catch {
      // Recover only the registered first winner, never a guessed local bundle.
      const recovered = await readArchive();
      if (recovered !== null) return await verifiedOriginal(recovered);
      return fail('persistence_unknown');
    }
    const registered = parseContractArchiveEnvelope(receipt, expected).archive;
    if (!registered) return fail('persistence_unknown');
    return await verifiedOriginal(registered);
  } catch (error) {
    if (error instanceof NativeContractArchiveError) throw error;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code === 'unauthenticated') return fail('unauthenticated');
    if (code === 'access_denied' || code === '42501') return fail('access_denied');
    if (code === 'conflict' || code === '40001' || code === '23505') return fail('conflict');
    return fail('unavailable');
  }
}

/** Exact Storage POST used because this SDK version cannot abort upload().
 * The token is transport only; the action verifies getUser(token) first. */
export function createNativeContractArchiveUploader(config: { supabaseUrl: string; publishableKey: string; fetchImpl?: typeof fetch }) {
  let base: URL;
  try { base = new URL(config.supabaseUrl); } catch { return fail('configuration_missing'); }
  const key = config.publishableKey;
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/' || typeof key !== 'string' || !key || key.length > 8192 || /[\u0000-\u0020\u007f]/.test(key)) return fail('configuration_missing');
  if (!/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key)) {
    try { const parts = key.split('.'); if (parts.length !== 3 || JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role !== 'anon') return fail('configuration_missing'); }
    catch { return fail('configuration_missing'); }
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  return { async upload(path: string, value: Uint8Array, mimeType: 'application/pdf' | 'application/json', userToken: string, { signal }: ContractArchiveControl) {
    const match = /^([a-f0-9-]{36})\/native-contracts\/([a-f0-9-]{36})\/v1\/(signed|evidence)-([a-f0-9]{64})\.(pdf|json)$/.exec(path);
    if (!match || !uuid.safeParse(match[1]).success || !uuid.safeParse(match[2]).success || (match[3] === 'signed') !== (match[5] === 'pdf') || mimeType !== (match[3] === 'signed' ? 'application/pdf' : 'application/json')) return fail('invalid_input');
    if (typeof userToken !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(userToken) || userToken.length > 16384) return fail('access_denied');
    try { if (JSON.parse(Buffer.from(userToken.split('.')[1], 'base64url').toString()).role !== 'authenticated') return fail('access_denied'); }
    catch { return fail('access_denied'); }
    const content = bytes(value, mimeType === 'application/pdf' ? MAX_CONTRACT_PDF_BYTES : MAX_CONTRACT_EVIDENCE_BYTES, mimeType === 'application/pdf' ? 'pdf' : 'evidence');
    if (sha256(content) !== match[4]) return fail('storage_unverified');
    const response = await fetchImpl(new URL(`/storage/v1/object/${CONTRACT_ARCHIVE_BUCKET}/${path}`, base), {
      method: 'POST', redirect: 'error', cache: 'no-store', signal,
      headers: { apikey: key, Authorization: `Bearer ${userToken}`, 'Content-Type': mimeType, 'Cache-Control': 'max-age=0', 'x-upsert': 'false' },
      body: new Uint8Array(content),
    });
    if (!response.ok || !response.body) { void response.body?.cancel().catch(() => {}); return fail('storage_unverified'); }
    const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 32768) { void reader.cancel().catch(() => {}); return fail('storage_unverified'); } chunks.push(item.value); } }
    finally { reader.releaseLock(); }
    let result: unknown;
    try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return fail('storage_unverified'); }
    if (!result || typeof result !== 'object' || !('Key' in result) || result.Key !== `${CONTRACT_ARCHIVE_BUCKET}/${path}`) return fail('storage_unverified');
  } };
}

/** Server registration capability; never used for Auth, uploads or downloads. */
export function createNativeContractArchiveRegistrationClient(config: { supabaseUrl: string; serviceKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
  let base: URL;
  try { base = new URL(config.supabaseUrl); } catch { return fail('configuration_missing'); }
  const key = config.serviceKey;
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/' || typeof key !== 'string' || !key || key.length > 8192 || /[\u0000-\u0020\u007f]/.test(key)) return fail('configuration_missing');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', apikey: key };
  if (!key.startsWith('sb_secret_')) {
    try {
      const parts = key.split('.');
      if (parts.length !== 3 || JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role !== 'service_role') return fail('configuration_missing');
    } catch { return fail('configuration_missing'); }
    headers.Authorization = `Bearer ${key}`;
  } else if (!/^sb_secret_[A-Za-z0-9_-]{16,}$/.test(key)) return fail('configuration_missing');
  const fetchImpl = config.fetchImpl ?? fetch;
  // Validate configuration now, but start each I/O budget at the actual call.
  if (config.timeoutMs !== undefined && (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 60000)) return fail('configuration_missing');
  return { async register(value: NativeArchiveRegistration, control?: ContractArchiveControl): Promise<unknown> {
    const bounded = nativeArchiveOperation(config.timeoutMs ?? 15000);
    return bounded(async ({ signal }) => {
      const requestSignal = control ? AbortSignal.any([signal, control.signal]) : signal;
      const response = await fetchImpl(new URL('/rest/v1/rpc/register_contract_signing_archive', base), {
        method: 'POST', headers, redirect: 'error', cache: 'no-store', signal: requestSignal,
        body: JSON.stringify({ p_company_id: value.companyId, p_signing_id: value.signingId, p_actor_user_id: value.actorUserId, p_request_id: value.requestId, p_document_content_sha256: value.documentContentSha256, p_revision: value.revision, p_pdf_sha256: value.pdfSha256, p_pdf_bytes: value.pdfBytes, p_evidence_sha256: value.evidenceSha256, p_evidence_bytes: value.evidenceBytes, p_renderer_version: value.rendererVersion }),
      });
      if (!response.ok || !response.body) return fail('persistence_unknown');
      const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
      try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 32768) { void reader.cancel().catch(() => {}); return fail('persistence_unknown'); } chunks.push(item.value); } }
      finally { reader.releaseLock(); }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return fail('persistence_unknown'); }
    });
  } };
}
