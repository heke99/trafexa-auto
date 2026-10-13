import 'server-only';
import { createHash } from 'node:crypto';
import { generateOfferPdf, parseOfferSnapshot } from './offer-pdf';
import type { OfferSnapshot } from './offer-pdf';

export const OFFER_ARCHIVE_BUCKET = 'dealer-documents';
export const MAX_OFFER_ARCHIVE_BYTES = 50 * 1024 * 1024;
export type OfferArchiveInput = { offerId: string; companyId: string; submissionId: string };
export type OfferArchiveProof = {
  companyId: string; offerId: string; dealId: string; version: number;
  pdfSha256: string; snapshotSha256: string; objectPath: string;
  documentId: string; documentName: string; documentKind: 'other';
  storageBucket: 'dealer-documents'; storageVisibility: 'private';
  submissionId: string; archivedBy: string; createdAt: string;
};
export type OfferArchiveAuthorization = { companyId: string; userId: string; role: string; companyActive: boolean; membershipActive: boolean };
export type OfferArchiveRegistration = { companyId: string; offerId: string; version: number; pdfSha256: string; snapshotSha256: string; objectPath: string; submissionId: string; actorUserId: string };
type Control = { signal: AbortSignal };
export interface OfferArchiveDependencies {
  authorize(companyId: string, control: Control): Promise<OfferArchiveAuthorization>;
  getSource(companyId: string, offerId: string, control: Control): Promise<unknown>;
  getArchive(companyId: string, offerId: string, control: Control): Promise<unknown | null>;
  prepareRegistration?: (authorization: OfferArchiveAuthorization, control: Control) => Promise<void>;
  upload(path: string, bytes: Uint8Array, control: Control): Promise<void>;
  download(path: string, control: Control): Promise<Uint8Array>;
  register(input: OfferArchiveRegistration, control: Control): Promise<unknown>;
  generatePdf?: (snapshot: OfferSnapshot, offerId: string) => Promise<Uint8Array>;
  timeoutMs?: number;
}
export class OfferArchiveError extends Error {
  readonly code: 'configuration_missing' | 'invalid_input' | 'unauthenticated' | 'company_changed' | 'forbidden' | 'not_found' | 'source_invalid' | 'storage_unverified' | 'conflict' | 'persistence_unknown' | 'unavailable';
  constructor(code: OfferArchiveError['code']) { super('Offertarkivet kunde inte verifieras.'); this.name = 'OfferArchiveError'; this.code = code; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const fail = (code: OfferArchiveError['code']): never => { throw new OfferArchiveError(code); };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
function uuid(value: unknown, code: OfferArchiveError['code'] = 'source_invalid'): string { if (typeof value !== 'string' || !UUID.test(value)) return fail(code); return value.toLowerCase(); }
function version(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 2147483647) return fail('source_invalid'); return value as number; }
function hash(value: unknown): string { if (typeof value !== 'string' || !SHA.test(value)) return fail('source_invalid'); return value; }
function text(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.length > 240 || /[\u0000-\u001f\u007f]/.test(value)) return fail('source_invalid'); return value; }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
function pdfBytes(value: unknown): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength < 5 || value.byteLength > MAX_OFFER_ARCHIVE_BYTES) return fail('storage_unverified');
  const result = Buffer.from(value);
  if (!result.subarray(0, 5).equals(Buffer.from('%PDF-'))) return fail('storage_unverified');
  return result;
}
export function offerArchivePath(companyId: string, offerId: string, offerVersion: number, sha256: string): string {
  return `${uuid(companyId)}/offers/${uuid(offerId)}/v${version(offerVersion)}/${hash(sha256)}.pdf`;
}
export function parseOfferArchiveInput(value: unknown): OfferArchiveInput {
  if (!record(value) || Object.keys(value).some(key => !['offerId', 'companyId', 'submissionId'].includes(key))) return fail('invalid_input');
  return freeze({ offerId: uuid(value.offerId, 'invalid_input'), companyId: uuid(value.companyId, 'invalid_input'), submissionId: uuid(value.submissionId, 'invalid_input') });
}
/** Parse a USER-RLS RPC privacy receipt; no client-provided storage flags are accepted. */
export function parseOfferArchiveProof(value: unknown, expectedCompany?: string, expectedOffer?: string): OfferArchiveProof {
  if (!record(value) || value.document_kind !== 'other' || value.storage_bucket !== OFFER_ARCHIVE_BUCKET || value.storage_visibility !== 'private') return fail('source_invalid');
  const companyId = uuid(value.company_id), offerId = uuid(value.offer_id), offerVersion = version(value.offer_version), pdfSha256 = hash(value.pdf_sha256);
  if ((expectedCompany && companyId !== uuid(expectedCompany)) || (expectedOffer && offerId !== uuid(expectedOffer))) return fail('conflict');
  const objectPath = offerArchivePath(companyId, offerId, offerVersion, pdfSha256);
  if (value.object_path !== objectPath || typeof value.created_at !== 'string' || value.created_at.length > 64 || !Number.isFinite(Date.parse(value.created_at))) return fail('source_invalid');
  return freeze({ companyId, offerId, dealId: uuid(value.deal_id), version: offerVersion, pdfSha256, snapshotSha256: hash(value.snapshot_sha256), objectPath, documentId: uuid(value.document_id), documentName: text(value.document_name), documentKind: 'other', storageBucket: OFFER_ARCHIVE_BUCKET, storageVisibility: 'private', submissionId: uuid(value.submission_id), archivedBy: uuid(value.archived_by), createdAt: value.created_at });
}
/** Verify actual authenticated-download bytes, never a metadata-only claimed hash. */
export function verifyOfferArchiveBytes(proof: OfferArchiveProof, value: Uint8Array): Uint8Array {
  const bytes = pdfBytes(value);
  if (createHash('sha256').update(bytes).digest('hex') !== proof.pdfSha256) return fail('storage_unverified');
  return bytes;
}
type Source = { companyId: string; offerId: string; dealId: string; version: number; snapshot: OfferSnapshot; snapshotSha256: string; documentName: string };
function source(value: unknown, input: OfferArchiveInput): Source {
  if (!record(value) || value.company_id !== input.companyId || value.offer_id !== input.offerId || value.document_kind !== 'other' || value.storage_bucket !== OFFER_ARCHIVE_BUCKET || value.storage_visibility !== 'private') return fail('source_invalid');
  let snapshot: OfferSnapshot;
  try { snapshot = parseOfferSnapshot(value.snapshot); } catch { return fail('source_invalid'); }
  const offerVersion = version(value.offer_version), dealId = uuid(value.deal_id), documentName = text(value.document_name);
  if (snapshot.company.id.toLowerCase() !== input.companyId || snapshot.deal_id.toLowerCase() !== dealId || snapshot.version !== offerVersion || documentName !== `Offert v${offerVersion} – ${snapshot.vehicle.registration_number}`) return fail('source_invalid');
  return freeze({ companyId: input.companyId, offerId: input.offerId, dealId, version: offerVersion, snapshot, snapshotSha256: hash(value.snapshot_sha256), documentName });
}
function matchingProof(value: unknown, expected: Source): OfferArchiveProof {
  const proof = parseOfferArchiveProof(value, expected.companyId, expected.offerId);
  if (proof.dealId !== expected.dealId || proof.version !== expected.version || proof.snapshotSha256 !== expected.snapshotSha256 || proof.documentName !== expected.documentName) return fail('conflict');
  return proof;
}

/** Archive exactly one immutable stored offer; this never approves a signing source. */
export async function archiveStoredOffer(rawInput: unknown, deps: OfferArchiveDependencies): Promise<OfferArchiveProof> {
  try {
    const input = parseOfferArchiveInput(rawInput);
    const timeoutMs = deps.timeoutMs ?? 15000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) return fail('invalid_input');
    async function bounded<T>(operation: (control: Control) => Promise<T>): Promise<T> {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new OfferArchiveError('unavailable')); }, timeoutMs); });
        return await Promise.race([operation({ signal: controller.signal }), timeout]);
      } finally { if (timer) clearTimeout(timer); }
    }
    const authorized = await bounded(control => deps.authorize(input.companyId, control));
    if (!authorized || uuid(authorized.companyId) !== input.companyId) return fail('company_changed');
    uuid(authorized.userId, 'unauthenticated');
    if (authorized.companyActive !== true || authorized.membershipActive !== true || !['owner', 'admin', 'finance'].includes(authorized.role)) return fail('forbidden');
    const storedSource = source(await bounded(control => deps.getSource(input.companyId, input.offerId, control)), input);
    const verifyStored = async (proof: OfferArchiveProof) => {
      verifyOfferArchiveBytes(proof, await bounded(control => deps.download(proof.objectPath, control)));
      // Recheck the catalog privacy receipt after the download as well; a bucket
      // becoming public or a revoked role cannot produce an archived success.
      const current = matchingProof(await bounded(control => deps.getArchive(input.companyId, input.offerId, control)), storedSource);
      if (current.documentId !== proof.documentId || current.objectPath !== proof.objectPath || current.pdfSha256 !== proof.pdfSha256 || current.submissionId !== proof.submissionId || current.archivedBy !== proof.archivedBy) return fail('conflict');
      return proof;
    };
    const existing = await bounded(control => deps.getArchive(input.companyId, input.offerId, control));
    if (existing !== null) return await verifyStored(matchingProof(existing, storedSource));
    if (deps.prepareRegistration) await bounded(control => deps.prepareRegistration!(authorized, control));

    let rendered: Uint8Array;
    try { rendered = await bounded(() => (deps.generatePdf ?? generateOfferPdf)(storedSource.snapshot, input.offerId)); }
    catch { return fail('source_invalid'); }
    const bytes = pdfBytes(rendered);
    const pdfSha256 = createHash('sha256').update(bytes).digest('hex');
    const objectPath = offerArchivePath(input.companyId, input.offerId, storedSource.version, pdfSha256);
    let uploadUnconfirmed = false;
    try { await bounded(control => deps.upload(objectPath, bytes, control)); }
    catch { uploadUnconfirmed = true; }
    // A lost upload response or competing upsert:false upload is safe only when
    // authenticated readback proves these exact bytes already exist at this path.
    try {
      const actual = pdfBytes(await bounded(control => deps.download(objectPath, control)));
      if (actual.byteLength !== bytes.byteLength || createHash('sha256').update(actual).digest('hex') !== pdfSha256) return fail('storage_unverified');
    } catch (error) { if (error instanceof OfferArchiveError && error.code === 'storage_unverified') throw error; return fail(uploadUnconfirmed ? 'persistence_unknown' : 'storage_unverified'); }
    const registration = freeze({ companyId: input.companyId, offerId: input.offerId, version: storedSource.version, pdfSha256, snapshotSha256: storedSource.snapshotSha256, objectPath, submissionId: input.submissionId, actorUserId: uuid(authorized.userId, 'unauthenticated') });
    try {
      const proof = matchingProof(await bounded(control => deps.register(registration, control)), storedSource);
      return await verifyStored(proof);
    } catch (error) {
      // A registration may have committed before its response was lost. Re-read
      // the immutable offer scope and verify the original winning artifact.
      try {
        const recovered = await bounded(control => deps.getArchive(input.companyId, input.offerId, control));
        if (recovered !== null) return await verifyStored(matchingProof(recovered, storedSource));
      } catch { /* No unverified success; the same offer can be safely retried. */ }
      if (error instanceof OfferArchiveError && ['forbidden', 'conflict', 'storage_unverified'].includes(error.code)) throw error;
      return fail('persistence_unknown');
    }
  } catch (error) { if (error instanceof OfferArchiveError) throw error; return fail('unavailable'); }
}

/** Registration capability used only by this server boundary after trusted rendering/readback. */
export function createOfferArchiveRegistrationClient(config: { supabaseUrl: string; serviceKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
  let base: URL;
  try { base = new URL(config.supabaseUrl); } catch { return fail('configuration_missing'); }
  const key = config.serviceKey;
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/' || typeof key !== 'string' || key.length > 8192 || /[\u0000-\u0020\u007f]/.test(key)) return fail('configuration_missing');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', apikey: key };
  if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return fail('configuration_missing');
    let claims: unknown;
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')); } catch { return fail('configuration_missing'); }
    // Configuration shape only; the Supabase gateway verifies the JWT signature.
    if (!record(claims) || claims.role !== 'service_role') return fail('configuration_missing');
    headers.Authorization = `Bearer ${key}`;
  }
  const timeoutMs = config.timeoutMs ?? 15000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) return fail('configuration_missing');
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return fail('configuration_missing');
  return {
    async register(input: OfferArchiveRegistration, control?: Control): Promise<unknown> {
      const payload = { p_company_id: uuid(input.companyId), p_offer_id: uuid(input.offerId), p_offer_version: version(input.version), p_pdf_sha256: hash(input.pdfSha256), p_snapshot_sha256: hash(input.snapshotSha256), p_object_path: offerArchivePath(input.companyId, input.offerId, input.version, input.pdfSha256), p_submission_id: uuid(input.submissionId), p_actor_user_id: uuid(input.actorUserId) };
      if (payload.p_object_path !== input.objectPath || control?.signal.aborted) return fail('invalid_input');
      const controller = new AbortController();
      const abort = () => controller.abort();
      control?.signal.addEventListener('abort', abort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const operation = (async () => {
          const response = await fetchImpl(`${base.origin}/rest/v1/rpc/register_offer_document_archive`, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal, redirect: 'error', cache: 'no-store' });
          const length = response.headers.get('content-length');
          if (length && (!/^\d+$/.test(length) || Number(length) > 1024 * 1024)) return fail('persistence_unknown');
          if (!response.body) return fail('persistence_unknown');
          const reader = response.body.getReader(), chunks: Uint8Array[] = [];
          let size = 0, value: unknown;
          try {
            for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 1024 * 1024) { void reader.cancel().catch(() => {}); return fail('persistence_unknown'); } chunks.push(part.value); }
            value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch { return fail('persistence_unknown'); }
          finally { reader.releaseLock(); }
          if (!response.ok) {
            if (record(value) && value.code === '42501') return fail('forbidden');
            if (record(value) && ['40001', '23505'].includes(value.code as string)) return fail('conflict');
            return fail('persistence_unknown');
          }
          return value;
        })();
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new OfferArchiveError('persistence_unknown')); }, timeoutMs); });
        return await Promise.race([operation, timeout]);
      } catch (error) { if (error instanceof OfferArchiveError) throw error; return fail('persistence_unknown'); }
      finally { if (timer) clearTimeout(timer); control?.signal.removeEventListener('abort', abort); }
    },
  };
}
