/**
 * Server-only signing worker. Persistent claims/CAS are mandatory before provider dispatch.
 * Trusted readers must authorize private storage and enforce download origin/redirect policy.
 * Runtime checks cannot establish storage ACLs: the callbacks below are server capabilities.
 * A template with several PDFs needs one approved canonical byte bundle supplied by its reader.
 */
import { createHash, randomUUID } from 'node:crypto';
import { DocuSealError, parseVerifiedDocuSealWebhook } from './docuseal.ts';
import type { DocuSealCreateInput, DocuSealSubmission, DocuSealSubmitter } from './docuseal.ts';
import { applyVerifiedEvent, bindSubmission, completeArchive, dispatchRejected, dispatchUnknown, startDispatch, validateSigningJob } from './signing-state.ts';
import type { ArchiveEvidence, SigningContext, SigningJob } from './signing-state.ts';
import { SigningStoreError, validateApprovedSigners, validateSigningInboxEntry, validateStoredSigningJob } from './signing-store.ts';
import type { ApprovedSigner } from './signing-store.ts';
import type { SigningInboxEntry, SigningStore, StoredSigningJob } from './signing-store.ts';

export class SigningWorkerError extends Error {
  readonly code: 'disabled' | 'invalid_input' | 'not_found' | 'conflict' | 'source_mismatch' | 'template_mismatch' | 'dispatch_rejected' | 'outcome_unknown' | 'persistence_unknown' | 'archive_invalid' | 'unavailable';
  constructor(code: SigningWorkerError['code']) { super('Signing worker operation could not be completed.'); this.name = 'SigningWorkerError'; this.code = code; }
}
if (typeof window !== 'undefined') throw new SigningWorkerError('invalid_input');

export type TrustedSourceEvidence = {
  context: SigningContext;
  document: { id: string; companyId: string; dealId: string | null; documentVersion: number; documentKind: string; sourceObjectPath: string };
  company: { id: string; active: boolean };
  deal: { id: string; companyId: string; active: boolean } | null;
  initiator: { id: string; companyId: string; active: boolean; mayDispatch: boolean };
  storageVisibility: 'private';
  objectPath: string;
  approvedSigners: ApprovedSigner[];
  templateId: number;
  templateVersion: number;
  templateSha256: string;
  bytes: Uint8Array;
};
export interface TrustedPrivateSource { load(job: StoredSigningJob): Promise<TrustedSourceEvidence> }
export type TrustedTemplateEvidence = {
  companyId: string;
  providerInstance: 'docuseal-main';
  templateId: number;
  templateVersion: number;
  documentKind: string;
  active: boolean;
  bytes: Uint8Array;
  fieldSchema: unknown;
};
export interface TrustedTemplateSource { load(job: StoredSigningJob): Promise<TrustedTemplateEvidence> }
export type ArchivedDownload = { path: string; downloadedBytes: Uint8Array };
export type StoredArchiveResult = {
  context: SigningContext;
  submissionId: number;
  storageVisibility: 'private';
  signedPdf: ArchivedDownload;
  audit: ArchivedDownload;
};
export interface TrustedPrivateArchive {
  /** Fetch only these authenticated provider GET URLs, enforce egress limits, then store privately. */
  store(input: { context: SigningContext; submissionId: number; signedPdfSourceUrl: string; auditSourceUrl: string }): Promise<StoredArchiveResult>;
  /** Re-read actual stored object bytes under this company context, independently of a claimed hash. */
  readStored(input: { context: SigningContext; path: string }): Promise<{ context: SigningContext; path: string; storageVisibility: 'private'; bytes: Uint8Array }>;
}
export type SigningProvider = {
  createSubmission(input: DocuSealCreateInput): Promise<{ submissionId: number; submitters: DocuSealSubmitter[] }>;
  getSubmission(submissionId: number): Promise<DocuSealSubmission>;
};
export type SigningWorkerConfig = {
  enabled?: boolean;
  store: SigningStore;
  provider: SigningProvider;
  privateSource: TrustedPrivateSource;
  templateSource: TrustedTemplateSource;
  archive?: TrustedPrivateArchive;
  webhookSecret?: string;
  now?: () => number;
  claimToken?: () => string;
};

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTEXT_KEYS: (keyof SigningContext)[] = ['id', 'companyId', 'documentId', 'dealId', 'documentVersion', 'sourceSha256', 'templateId', 'templateVersion', 'templateSha256'];
function fail(code: SigningWorkerError['code']): never { throw new SigningWorkerError(code); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
function identity(id: string, version: number) { if (typeof id !== 'string' || !UUID.test(id) || !Number.isSafeInteger(version) || version < 1) return fail('invalid_input'); }
function context(job: SigningContext): SigningContext { return Object.fromEntries(CONTEXT_KEYS.map(key => [key, job[key]])) as SigningContext; }
function sameContext(job: SigningContext, value: unknown, code: SigningWorkerError['code']) {
  if (!record(value) || Object.keys(value).some(key => !CONTEXT_KEYS.includes(key as keyof SigningContext)) || CONTEXT_KEYS.some(key => job[key] !== value[key])) return fail(code);
}
function fileBytes(value: unknown, code: SigningWorkerError['code']): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > MAX_FILE_BYTES) return fail(code);
  return Buffer.from(value);
}
function sha256(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function privatePath(value: unknown, companyId: string, pdf = false): string {
  if (typeof value !== 'string' || value.length > 1024 || !value.startsWith(`${companyId}/`) || value.split('/').some(part => !/^[a-zA-Z0-9._-]+$/.test(part) || part === '.' || part === '..') || (pdf && !value.endsWith('.pdf'))) return fail('archive_invalid');
  return value;
}
function snapshotEqual(left: SigningJob, right: SigningJob): boolean {
  // Snapshot keys are fixed by the domain validator; object key insertion order is irrelevant.
  return canonicalJSON(left) === canonicalJSON(right);
}
function canonicalJSON(value: unknown, depth = 0, count = { value: 0 }, strictStrings = false): string {
  if (depth > 20 || ++count.value > 10000) return fail('invalid_input');
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) return fail('invalid_input'); return JSON.stringify(value); }
  if (typeof value === 'string') { if (strictStrings && /[\u0000-\u001f\u007f]/.test(value)) return fail('invalid_input'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(item => canonicalJSON(item, depth + 1, count, strictStrings)).join(',')}]`;
  if (!record(value)) return fail('invalid_input');
  return `{${Object.keys(value).sort().map(key => `${canonicalJSON(key, depth + 1, count, strictStrings)}:${canonicalJSON(value[key], depth + 1, count, strictStrings)}`).join(',')}}`;
}

/** SHA256(domain || uint64be(schema bytes) || canonical schema || uint64be(PDF/bundle bytes) || raw bytes). */
export function hashSigningTemplate(bytes: Uint8Array, fieldSchema: unknown): string {
  const bundle = fileBytes(bytes, 'invalid_input');
  if (!Array.isArray(fieldSchema) && !record(fieldSchema)) return fail('invalid_input');
  const schema = Buffer.from(canonicalJSON(fieldSchema, 0, { value: 0 }, true), 'utf8');
  if (schema.byteLength > 64 * 1024) return fail('invalid_input');
  const lengths = (value: number) => { const result = Buffer.alloc(8); result.writeBigUInt64BE(BigInt(value)); return result; };
  return createHash('sha256').update('trafexa.signing-template.v1\0', 'utf8').update(lengths(schema.byteLength)).update(schema).update(lengths(bundle.byteLength)).update(bundle).digest('hex');
}

function validateSource(job: StoredSigningJob, evidence: TrustedSourceEvidence): string {
  const snapshot = job.snapshot;
  if (!evidence || typeof evidence !== 'object') return fail('source_mismatch');
  sameContext(snapshot, evidence.context, 'source_mismatch');
  try { validateApprovedSigners(evidence.approvedSigners); } catch { return fail('source_mismatch'); }
  if (evidence.templateId !== snapshot.templateId || evidence.templateVersion !== snapshot.templateVersion || evidence.templateSha256 !== snapshot.templateSha256 || canonicalJSON(evidence.approvedSigners) !== canonicalJSON(job.signers)) return fail('source_mismatch');
  const document = evidence.document;
  const company = evidence.company;
  const initiator = evidence.initiator;
  if (!record(document) || !record(company) || !record(initiator) || document.id !== snapshot.documentId || document.companyId !== snapshot.companyId || document.dealId !== snapshot.dealId || document.documentVersion !== snapshot.documentVersion || document.sourceObjectPath !== job.sourceObjectPath || document.documentKind !== job.documentKind || company.id !== snapshot.companyId || company.active !== true || initiator.id !== job.createdBy || initiator.companyId !== snapshot.companyId || initiator.active !== true || initiator.mayDispatch !== true || evidence.storageVisibility !== 'private' || evidence.objectPath !== job.sourceObjectPath) return fail('source_mismatch');
  if (snapshot.dealId === null) { if (evidence.deal !== null) return fail('source_mismatch'); }
  else if (!record(evidence.deal) || evidence.deal.id !== snapshot.dealId || evidence.deal.companyId !== snapshot.companyId || evidence.deal.active !== true) return fail('source_mismatch');
  if (sha256(fileBytes(evidence.bytes, 'source_mismatch')) !== snapshot.sourceSha256) return fail('source_mismatch');
  return document.documentKind;
}

function validateTemplate(job: StoredSigningJob, documentKind: string, evidence: TrustedTemplateEvidence) {
  const snapshot = job.snapshot;
  if (!evidence || typeof evidence !== 'object' || evidence.companyId !== snapshot.companyId || evidence.providerInstance !== job.providerInstance || evidence.templateId !== snapshot.templateId || evidence.templateVersion !== snapshot.templateVersion || evidence.documentKind !== documentKind || evidence.active !== true) return fail('template_mismatch');
  try { if (hashSigningTemplate(evidence.bytes, evidence.fieldSchema) !== snapshot.templateSha256) return fail('template_mismatch'); }
  catch { return fail('template_mismatch'); }
}

function trustedJob(value: StoredSigningJob | null, id: string, version?: number): StoredSigningJob {
  if (!value) return fail('not_found');
  try { validateStoredSigningJob(value); } catch { return fail('invalid_input'); }
  if (value.snapshot.id !== id) return fail('invalid_input');
  if (version !== undefined && value.snapshot.version !== version) return fail('conflict');
  return freeze(clone(value));
}

function savedJob(value: StoredSigningJob, previous: StoredSigningJob, expected: SigningJob): StoredSigningJob {
  const saved = trustedJob(value, previous.snapshot.id);
  if (!snapshotEqual(saved.snapshot, expected) || saved.sourceObjectPath !== previous.sourceObjectPath || saved.createdBy !== previous.createdBy || saved.providerInstance !== previous.providerInstance || saved.documentKind !== previous.documentKind || canonicalJSON(saved.signers) !== canonicalJSON(previous.signers)) return fail('persistence_unknown');
  return saved;
}

export function createSigningWorker(config: SigningWorkerConfig) {
  if (!record(config)) return fail('invalid_input');
  const enabled = config.enabled === true;
  const clock = config.now ?? Date.now;
  const now = () => { const value = clock(); if (!Number.isSafeInteger(value) || value < 0) return fail('invalid_input'); return value; };
  const token = config.claimToken ?? randomUUID;
  const store = config.store;
  const provider = config.provider;
  async function getJob(id: string, version?: number) { return trustedJob(await store.getJob(id), id, version); }
  async function verifySource(job: StoredSigningJob) {
    const kind = validateSource(job, await config.privateSource.load(job));
    validateTemplate(job, kind, await config.templateSource.load(job));
  }
  async function saveDispatch(job: StoredSigningJob, snapshot: SigningJob, errorCode: string | null = null) {
    try { return savedJob(await store.save({ jobId: job.snapshot.id, expectedVersion: job.snapshot.version, claimToken: job.claimToken, snapshot, errorCode }), job, snapshot); }
    catch { return fail('persistence_unknown'); }
  }
  const operations = {
    async dispatch(jobId: string, expectedVersion: number): Promise<StoredSigningJob> {
      identity(jobId, expectedVersion);
      if (!enabled) return fail('disabled');
      const prepared = await getJob(jobId, expectedVersion);
      if (prepared.snapshot.state !== 'prepared') return fail('conflict');
      await verifySource(prepared);
      const started = startDispatch(prepared.snapshot);
      const claimToken = token();
      if (typeof claimToken !== 'string' || !UUID.test(claimToken)) return fail('invalid_input');
      let claimed: StoredSigningJob;
      try { claimed = trustedJob(await store.claim(jobId, expectedVersion, claimToken), jobId); }
      catch (error) { if (error instanceof SigningStoreError && error.code === 'conflict') return fail('conflict'); throw error; }
      if (!snapshotEqual(claimed.snapshot, started) || claimed.claimToken !== claimToken || !claimed.claimExpiresAt || Date.parse(claimed.claimExpiresAt) <= now() || claimed.sourceObjectPath !== prepared.sourceObjectPath || claimed.createdBy !== prepared.createdBy || claimed.documentKind !== prepared.documentKind || canonicalJSON(claimed.signers) !== canonicalJSON(prepared.signers)) return fail('persistence_unknown');
      const input = freeze({ templateId: claimed.snapshot.templateId, sendEmail: false as const, signers: clone(claimed.signers), order: 'preserved' as const });
      let confirmation: { submissionId: number; submitters: DocuSealSubmitter[] };
      try { confirmation = clone(await provider.createSubmission(input)); }
      catch (error) {
        const knownRejection = error instanceof DocuSealError && ['disabled', 'invalid_input', 'invalid_configuration', 'provider_rejected'].includes(error.code);
        if (knownRejection) { await saveDispatch(claimed, dispatchRejected(claimed.snapshot), 'provider_rejected'); return fail('dispatch_rejected'); }
        await saveDispatch(claimed, dispatchUnknown(claimed.snapshot), 'outcome_unknown');
        return fail('outcome_unknown');
      }
      let bound: SigningJob;
      try {
        for (const signer of confirmation.submitters) {
          const expected = claimed.signers.find(value => value.externalId === signer.externalId);
          if (!expected || signer.role !== expected.role || typeof signer.email !== 'string' || signer.email.toLowerCase() !== expected.email.toLowerCase()) return fail('outcome_unknown');
        }
        bound = bindSubmission(claimed.snapshot, { context: context(claimed.snapshot), provider: confirmation });
      }
      catch { await saveDispatch(claimed, dispatchUnknown(claimed.snapshot), 'outcome_unknown'); return fail('outcome_unknown'); }
      // If this save fails after a successful POST, retain the durable claim and reconcile.
      // Never call createSubmission again, even if the database operation may have committed.
      return saveDispatch(claimed, bound);
    },
    async expireDispatch(jobId: string, expectedVersion: number): Promise<StoredSigningJob> {
      identity(jobId, expectedVersion);
      const job = await getJob(jobId, expectedVersion);
      if (job.snapshot.state !== 'dispatching' || !job.claimExpiresAt || Date.parse(job.claimExpiresAt) > now()) return fail('conflict');
      const expected = dispatchUnknown(job.snapshot);
      return savedJob(await store.markExpiredDispatch(jobId, expectedVersion), job, expected);
    },
    async receiveWebhook(rawBody: Uint8Array, signatureHeader: string | null): Promise<{ inboxId: string; status: SigningInboxEntry['status'] }> {
      const event = parseVerifiedDocuSealWebhook(rawBody, signatureHeader, config.webhookSecret ?? '', Math.floor(now() / 1000));
      const bodyHash = sha256(rawBody);
      const entry = await store.enqueue(bodyHash, event);
      validateSigningInboxEntry(entry);
      if (entry.bodySha256 !== bodyHash || entry.submissionId !== event.submissionId || canonicalJSON(entry.event) !== canonicalJSON(event)) return fail('persistence_unknown');
      return { inboxId: entry.id, status: entry.status };
    },
    async processWebhook(inboxId: string): Promise<{ inboxId: string; status: SigningInboxEntry['status'] }> {
      if (typeof inboxId !== 'string' || !UUID.test(inboxId)) return fail('invalid_input');
      const entry = await store.getInbox(inboxId);
      if (!entry || entry.id !== inboxId) return fail('not_found');
      validateSigningInboxEntry(entry);
      if (entry.status !== 'pending') return { inboxId, status: entry.status };
      if (!entry.jobId) return fail('invalid_input');
      const job = await getJob(entry.jobId);
      if (job.snapshot.submissionId !== entry.submissionId) return fail('conflict');
      const next = applyVerifiedEvent(job.snapshot, entry.event);
      const applied = await store.applyWebhook({ inboxId, expectedJobVersion: job.snapshot.version, snapshot: next });
      validateSigningInboxEntry(applied);
      if (applied.id !== inboxId || applied.status !== 'processed' || applied.jobId !== job.snapshot.id || applied.bodySha256 !== entry.bodySha256) return fail('persistence_unknown');
      return { inboxId, status: applied.status };
    },
    async archiveCompleted(jobId: string, expectedVersion: number): Promise<StoredSigningJob> {
      identity(jobId, expectedVersion);
      const job = await getJob(jobId, expectedVersion);
      if (job.snapshot.state === 'completed') return job;
      if (job.snapshot.state !== 'awaiting_archive' || !job.snapshot.submissionId || !config.archive) return fail('conflict');
      await verifySource(job);
      const providerSubmission = clone(await provider.getSubmission(job.snapshot.submissionId));
      if (providerSubmission.id !== job.snapshot.submissionId || providerSubmission.status !== 'completed' || !providerSubmission.completedAt || providerSubmission.submitters.length !== job.snapshot.submitters.length) return fail('archive_invalid');
      const ids = new Set<number>();
      for (const signer of providerSubmission.submitters) {
        const bound = job.snapshot.submitters.find(value => value.id === signer.id && value.externalId === signer.externalId);
        if (!bound || ids.has(signer.id) || signer.submissionId !== providerSubmission.id || signer.status !== 'completed' || !signer.completedAt) return fail('archive_invalid');
        ids.add(signer.id);
      }
      const signedPdfSourceUrl = providerSubmission.documents.length === 1 ? providerSubmission.documents[0].url : providerSubmission.combinedDocumentUrl;
      const auditSourceUrl = providerSubmission.auditLogUrl;
      if (!signedPdfSourceUrl || !auditSourceUrl || !providerSubmission.documents.length) return fail('archive_invalid');
      for (const value of [signedPdfSourceUrl, auditSourceUrl]) {
        let url: URL;
        try { url = new URL(value); } catch { return fail('archive_invalid'); }
        if (value.length > 8192 || url.protocol !== 'https:' || url.username || url.password || url.hash) return fail('archive_invalid');
      }
      const saved = await config.archive.store({ context: context(job.snapshot), submissionId: providerSubmission.id, signedPdfSourceUrl, auditSourceUrl });
      sameContext(job.snapshot, saved.context, 'archive_invalid');
      if (saved.submissionId !== job.snapshot.submissionId || saved.storageVisibility !== 'private' || !saved.signedPdf || !saved.audit) return fail('archive_invalid');
      const proof = async (object: ArchivedDownload) => {
        const path = privatePath(object.path, job.snapshot.companyId, true);
        const downloaded = fileBytes(object.downloadedBytes, 'archive_invalid');
        if (!downloaded.subarray(0, 5).equals(Buffer.from('%PDF-'))) return fail('archive_invalid');
        const stored = await config.archive!.readStored({ context: context(job.snapshot), path });
        sameContext(job.snapshot, stored.context, 'archive_invalid');
        if (stored.path !== path || stored.storageVisibility !== 'private') return fail('archive_invalid');
        const actual = fileBytes(stored.bytes, 'archive_invalid');
        const actualHash = sha256(actual);
        if (actual.byteLength !== downloaded.byteLength || actualHash !== sha256(downloaded)) return fail('archive_invalid');
        return { path, sha256: actualHash };
      };
      if (saved.signedPdf.path === saved.audit.path) return fail('archive_invalid');
      const evidence: ArchiveEvidence = { context: context(job.snapshot), submissionId: providerSubmission.id, storageVisibility: 'private', signedPdf: await proof(saved.signedPdf), audit: await proof(saved.audit) };
      const next = completeArchive(job.snapshot, evidence);
      try { return savedJob(await store.save({ jobId, expectedVersion, claimToken: null, snapshot: next }), job, next); }
      catch { return fail('persistence_unknown'); }
    },
  };
  async function guarded<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof SigningWorkerError) throw error;
      if (error instanceof SigningStoreError && error.code === 'conflict') return fail('conflict');
      if (error instanceof DocuSealError && error.code === 'invalid_webhook') return fail('invalid_input');
      return fail('unavailable');
    }
  }
  return {
    dispatch: (jobId: string, expectedVersion: number) => guarded(() => operations.dispatch(jobId, expectedVersion)),
    expireDispatch: (jobId: string, expectedVersion: number) => guarded(() => operations.expireDispatch(jobId, expectedVersion)),
    receiveWebhook: (rawBody: Uint8Array, signatureHeader: string | null) => guarded(() => operations.receiveWebhook(rawBody, signatureHeader)),
    processWebhook: (inboxId: string) => guarded(() => operations.processWebhook(inboxId)),
    archiveCompleted: (jobId: string, expectedVersion: number) => guarded(() => operations.archiveCompleted(jobId, expectedVersion)),
  };
}
