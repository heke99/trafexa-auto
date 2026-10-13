/** Service-only ledger transport. Never import from a client component or expose its config. */
import type { DocuSealSignerInput, DocuSealWebhookEvent } from './docuseal.ts';
import { validateSigningJob } from './signing-state.ts';
import type { SigningJob } from './signing-state.ts';

export class SigningStoreError extends Error {
  readonly code: 'invalid_configuration' | 'invalid_input' | 'conflict' | 'forbidden' | 'not_found' | 'unavailable' | 'invalid_response';
  constructor(code: SigningStoreError['code']) { super('Signing ledger operation could not be completed.'); this.name = 'SigningStoreError'; this.code = code; }
}
if (typeof window !== 'undefined') throw new SigningStoreError('invalid_configuration');

export type StoredSigningJob = {
  snapshot: SigningJob;
  sourceObjectPath: string;
  createdBy: string;
  providerInstance: 'docuseal-main';
  documentKind: 'purchase' | 'contract';
  signers: (DocuSealSignerInput & { externalId: string })[];
  claimToken: string | null;
  claimExpiresAt: string | null;
  errorCode: string | null;
};
export type SigningInboxEntry = {
  id: string;
  providerInstance: 'docuseal-main';
  bodySha256: string;
  event: DocuSealWebhookEvent;
  submissionId: number;
  jobId: string | null;
  status: 'pending' | 'processed' | 'quarantined';
};
export type SaveSigningJobInput = { jobId: string; expectedVersion: number; claimToken: string | null; snapshot: SigningJob; errorCode?: string | null };
export type ApplySigningWebhookInput = { inboxId: string; expectedJobVersion: number; snapshot: SigningJob };
export type ApprovedSigner = DocuSealSignerInput & { externalId: string };
export type RegisterDocumentVersionInput = { companyId: string; documentId: string; documentVersion: number; sourceSha256: string; sourceObjectPath: string; actorUserId: string; approvedSigners: ApprovedSigner[]; templateId: number; templateVersion: number; templateSha256: string };
export type RegisteredDocumentVersion = Omit<RegisterDocumentVersionInput, 'actorUserId'> & { registeredBy: string; createdAt: string };
export interface SigningStore {
  registerDocumentVersion(input: RegisterDocumentVersionInput): Promise<RegisteredDocumentVersion>;
  getJob(id: string): Promise<StoredSigningJob | null>;
  claim(id: string, expectedVersion: number, claimToken: string): Promise<StoredSigningJob>;
  markExpiredDispatch(id: string, expectedVersion: number): Promise<StoredSigningJob>;
  save(input: SaveSigningJobInput): Promise<StoredSigningJob>;
  enqueue(bodySha256: string, event: DocuSealWebhookEvent): Promise<SigningInboxEntry>;
  getInbox(id: string): Promise<SigningInboxEntry | null>;
  applyWebhook(input: ApplySigningWebhookInput): Promise<SigningInboxEntry>;
}
export type SigningStoreConfig = { supabaseUrl: string; serviceKey: string; timeoutMs?: number; fetchImpl?: typeof fetch };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_BYTES = 1024 * 1024;
const JOB_COLUMNS = 'id,company_id,document_id,deal_id,document_version,source_sha256,source_object_path,template_id,template_version,template_sha256,document_kind,created_by,provider_instance,provider_submission_id,state,version,snapshot,signers,claim_token,claim_expires_at,error_code';
const INBOX_COLUMNS = 'id,provider_instance,body_sha256,event,provider_submission_id,job_id,status';
const EVENTS = ['form.viewed', 'form.started', 'form.completed', 'form.declined', 'submission.created', 'submission.completed', 'submission.expired', 'submission.archived'];
function fail(code: SigningStoreError['code']): never { throw new SigningStoreError(code); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype; }
function uuid(value: unknown, code: SigningStoreError['code'] = 'invalid_input'): string { if (typeof value !== 'string' || !UUID.test(value)) return fail(code); return value; }
function positive(value: unknown, code: SigningStoreError['code'] = 'invalid_input'): number { if (!Number.isSafeInteger(value) || (value as number) < 1) return fail(code); return value as number; }
function hash(value: unknown, code: SigningStoreError['code'] = 'invalid_input'): string { if (typeof value !== 'string' || !SHA256.test(value)) return fail(code); return value; }
function text(value: unknown, max: number, code: SigningStoreError['code']): string { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return fail(code); return value; }
function path(value: unknown, companyId: string): string {
  if (typeof value !== 'string' || value.length > 1024 || !value.startsWith(`${companyId}/`) || value.split('/').some(part => !/^[a-zA-Z0-9._-]+$/.test(part) || part === '.' || part === '..')) return fail('invalid_response');
  return value;
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function canonical(value: unknown, depth = 0): string {
  if (depth > 20) return fail('invalid_response');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) return fail('invalid_response'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(',')}]`;
  if (!record(value)) return fail('invalid_response');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}

export function validateApprovedSigners(value: unknown): asserts value is ApprovedSigner[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return fail('invalid_response');
  const roles = new Set<string>();
  const externalIds = new Set<string>();
  for (const signer of value) {
    if (!record(signer) || Object.keys(signer).some(key => !['role', 'email', 'name', 'externalId', 'values'].includes(key))) return fail('invalid_response');
    const role = text(signer.role, 200, 'invalid_response');
    const email = text(signer.email, 254, 'invalid_response');
    const externalId = text(signer.externalId, 200, 'invalid_response');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || roles.has(role) || externalIds.has(externalId)) return fail('invalid_response');
    roles.add(role); externalIds.add(externalId);
    if (signer.name !== undefined) text(signer.name, 200, 'invalid_response');
    if (signer.values !== undefined) {
      if (!record(signer.values) || Object.keys(signer.values).length > 100) return fail('invalid_response');
      const primitive = (v: unknown) => typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 10000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v));
      for (const [field, fieldValue] of Object.entries(signer.values)) {
        text(field, 200, 'invalid_response');
        if (fieldValue !== null && !(Array.isArray(fieldValue) ? fieldValue.length <= 100 && fieldValue.every(primitive) : primitive(fieldValue))) return fail('invalid_response');
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 64 * 1024) return fail('invalid_response');
}

export function validateStoredSigningJob(value: unknown): asserts value is StoredSigningJob {
  if (!record(value)) return fail('invalid_response');
  try { validateSigningJob(value.snapshot); } catch { return fail('invalid_response'); }
  const snapshot = value.snapshot as SigningJob;
  path(value.sourceObjectPath, snapshot.companyId);
  uuid(value.createdBy, 'invalid_response');
  if (value.providerInstance !== 'docuseal-main' || !['purchase', 'contract'].includes(value.documentKind as string)) return fail('invalid_response');
  if (value.claimToken !== null) uuid(value.claimToken, 'invalid_response');
  if (value.claimExpiresAt !== null && (typeof value.claimExpiresAt !== 'string' || !Number.isFinite(Date.parse(value.claimExpiresAt)))) return fail('invalid_response');
  if (value.errorCode !== null && !['provider_rejected', 'outcome_unknown'].includes(value.errorCode as string)) return fail('invalid_response');
  validateApprovedSigners(value.signers);
  if (value.signers.length !== snapshot.expectedSignerExternalIds.length || value.signers.some(signer => !snapshot.expectedSignerExternalIds.includes(signer.externalId))) return fail('invalid_response');
}

export function parseStoredSigningJob(value: unknown): StoredSigningJob {
  if (!record(value) || !record(value.snapshot)) return fail('invalid_response');
  validateApprovedSigners(value.signers);
  const snapshot = clone(value.snapshot);
  try { validateSigningJob(snapshot); } catch { return fail('invalid_response'); }
  const keys: [string, keyof SigningJob][] = [['id', 'id'], ['company_id', 'companyId'], ['document_id', 'documentId'], ['deal_id', 'dealId'], ['document_version', 'documentVersion'], ['source_sha256', 'sourceSha256'], ['template_id', 'templateId'], ['template_version', 'templateVersion'], ['template_sha256', 'templateSha256'], ['provider_submission_id', 'submissionId'], ['state', 'state'], ['version', 'version']];
  if (keys.some(([column, field]) => value[column] !== snapshot[field])) return fail('invalid_response');
  const result = { snapshot, sourceObjectPath: value.source_object_path, createdBy: value.created_by, providerInstance: value.provider_instance, documentKind: value.document_kind, signers: clone(value.signers), claimToken: value.claim_token, claimExpiresAt: value.claim_expires_at, errorCode: value.error_code };
  validateStoredSigningJob(result);
  return freeze(result);
}

export function validateSigningEvent(value: unknown): asserts value is DocuSealWebhookEvent {
  if (!record(value) || Object.keys(value).some(key => !['eventType', 'occurredAt', 'entity', 'submissionId', 'submitterId'].includes(key)) || !EVENTS.includes(value.eventType as string) || typeof value.occurredAt !== 'string' || value.occurredAt.length > 64 || !/^\d{4}-\d{2}-\d{2}T/.test(value.occurredAt) || !Number.isFinite(Date.parse(value.occurredAt))) return fail('invalid_input');
  positive(value.submissionId);
  if ((value.eventType as string).startsWith('form.')) { if (value.entity !== 'submitter') return fail('invalid_input'); positive(value.submitterId); }
  else if (value.entity !== 'submission' || value.submitterId !== null) return fail('invalid_input');
}

function inbox(value: unknown): SigningInboxEntry {
  if (!record(value)) return fail('invalid_response');
  try { validateSigningEvent(value.event); } catch { return fail('invalid_response'); }
  if (value.provider_instance !== 'docuseal-main' || !['pending', 'processed', 'quarantined'].includes(value.status as string) || value.provider_submission_id !== value.event.submissionId) return fail('invalid_response');
  const jobId = value.job_id === null ? null : uuid(value.job_id, 'invalid_response');
  if ((value.status === 'quarantined' && jobId !== null) || (value.status !== 'quarantined' && jobId === null)) return fail('invalid_response');
  return freeze({ id: uuid(value.id, 'invalid_response'), providerInstance: 'docuseal-main', bodySha256: hash(value.body_sha256, 'invalid_response'), event: clone(value.event), submissionId: positive(value.provider_submission_id, 'invalid_response'), jobId, status: value.status as SigningInboxEntry['status'] });
}

export function validateSigningInboxEntry(value: unknown): asserts value is SigningInboxEntry {
  if (!record(value)) return fail('invalid_response');
  uuid(value.id, 'invalid_response'); hash(value.bodySha256, 'invalid_response'); positive(value.submissionId, 'invalid_response');
  try { validateSigningEvent(value.event); } catch { return fail('invalid_response'); }
  if (value.providerInstance !== 'docuseal-main' || value.event.submissionId !== value.submissionId || !['pending', 'processed', 'quarantined'].includes(value.status as string)) return fail('invalid_response');
  if (value.jobId !== null) uuid(value.jobId, 'invalid_response');
  if ((value.status === 'quarantined' && value.jobId !== null) || (value.status !== 'quarantined' && value.jobId === null)) return fail('invalid_response');
}

function serviceHeaders(serviceKey: unknown): Record<string, string> {
  const key = text(serviceKey, 8192, 'invalid_configuration');
  if (key !== key.trim()) return fail('invalid_configuration');
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) return { apikey: key };
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return fail('invalid_configuration');
  let claims: unknown;
  try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')); } catch { return fail('invalid_configuration'); }
  // This is a configuration shape check; the Supabase gateway verifies the actual JWT.
  if (!record(claims) || claims.role !== 'service_role') return fail('invalid_configuration');
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function json(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) return fail('invalid_response');
  if (!response.body) return fail('invalid_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) { void reader.cancel().catch(() => {}); return fail('invalid_response'); } chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return fail('invalid_response'); }
  finally { reader.releaseLock(); }
}

export function createSigningStore(config: SigningStoreConfig): SigningStore {
  if (!record(config)) return fail('invalid_configuration');
  let base: URL;
  try { base = new URL(config.supabaseUrl); } catch { return fail('invalid_configuration'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') return fail('invalid_configuration');
  const headers = { ...serviceHeaders(config.serviceKey), 'Content-Type': 'application/json', Accept: 'application/json' };
  const timeoutMs = config.timeoutMs ?? 8000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) return fail('invalid_configuration');
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return fail('invalid_configuration');

  async function request(path: string, method: 'GET' | 'POST', args?: Record<string, unknown>): Promise<unknown> {
    let body: string | undefined;
    try { body = args === undefined ? undefined : JSON.stringify(args); } catch { return fail('invalid_input'); }
    if (body && Buffer.byteLength(body) > MAX_BYTES) return fail('invalid_input');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = (async () => {
        const response = await fetchImpl(`${base.origin}/rest/v1/${path}`, { method, body, signal: controller.signal, redirect: 'error', cache: 'no-store', headers });
        const result = await json(response);
        if (!response.ok) {
          const code = record(result) ? result.code : undefined;
          if (code === '40001' || code === '23505') return fail('conflict');
          if (response.status === 401 || response.status === 403 || code === '42501') return fail('forbidden');
          if (response.status === 404 || code === 'P0002') return fail('not_found');
          return fail('unavailable');
        }
        return result;
      })();
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new SigningStoreError('unavailable')); }, timeoutMs); });
      return await Promise.race([operation, timeout]);
    } catch (error) { if (error instanceof SigningStoreError) throw error; return fail('unavailable'); }
    finally { if (timer) clearTimeout(timer); }
  }
  async function lookup(table: string, columns: string, value: string): Promise<unknown | null> {
    uuid(value);
    const params = new URLSearchParams({ select: columns, id: `eq.${value}`, limit: '1' });
    const result = await request(`${table}?${params}`, 'GET');
    if (!Array.isArray(result) || result.length > 1) return fail('invalid_response');
    if (!result.length) return null;
    if (!record(result[0]) || result[0].id !== value) return fail('invalid_response');
    return result[0];
  }
  const rpc = (name: string, args: Record<string, unknown>) => request(`rpc/${name}`, 'POST', args);
  return {
    async registerDocumentVersion(input) {
      if (!record(input)) return fail('invalid_input');
      uuid(input.companyId); uuid(input.documentId); positive(input.documentVersion); hash(input.sourceSha256); uuid(input.actorUserId); path(input.sourceObjectPath, input.companyId);
      positive(input.templateId); positive(input.templateVersion); hash(input.templateSha256);
      validateApprovedSigners(input.approvedSigners);
      const approved = clone(input.approvedSigners);
      const result = await rpc('register_signing_document_version', { p_company_id: input.companyId, p_document_id: input.documentId, p_document_version: input.documentVersion, p_source_sha256: input.sourceSha256, p_source_object_path: input.sourceObjectPath, p_actor_user_id: input.actorUserId, p_approved_signers: approved, p_approved_template_id: input.templateId, p_approved_template_version: input.templateVersion, p_approved_template_sha256: input.templateSha256 });
      if (!record(result) || result.company_id !== input.companyId || result.document_id !== input.documentId || result.document_version !== input.documentVersion || result.source_sha256 !== input.sourceSha256 || result.source_object_path !== input.sourceObjectPath || result.approved_template_id !== input.templateId || result.approved_template_version !== input.templateVersion || result.approved_template_sha256 !== input.templateSha256 || canonical(result.approved_signers) !== canonical(approved) || typeof result.created_at !== 'string' || !Number.isFinite(Date.parse(result.created_at))) return fail('invalid_response');
      return freeze({ companyId: input.companyId, documentId: input.documentId, documentVersion: input.documentVersion, sourceSha256: input.sourceSha256, sourceObjectPath: input.sourceObjectPath, approvedSigners: approved, templateId: input.templateId, templateVersion: input.templateVersion, templateSha256: input.templateSha256, registeredBy: uuid(result.registered_by, 'invalid_response'), createdAt: result.created_at });
    },
    async getJob(id) { const result = await lookup('signing_jobs', JOB_COLUMNS, id); return result === null ? null : parseStoredSigningJob(result); },
    async claim(id, expectedVersion, claimToken) { return parseStoredSigningJob(await rpc('claim_signing_job', { p_job_id: uuid(id), p_expected_version: positive(expectedVersion), p_claim_token: uuid(claimToken) })); },
    async markExpiredDispatch(id, expectedVersion) { return parseStoredSigningJob(await rpc('mark_expired_signing_dispatch', { p_job_id: uuid(id), p_expected_version: positive(expectedVersion) })); },
    async save(input) {
      if (!record(input)) return fail('invalid_input');
      uuid(input.jobId); positive(input.expectedVersion); if (input.claimToken !== null) uuid(input.claimToken);
      try { validateSigningJob(input.snapshot); } catch { return fail('invalid_input'); }
      if (input.snapshot.id !== input.jobId) return fail('invalid_input');
      if (input.errorCode != null && !['provider_rejected', 'outcome_unknown'].includes(input.errorCode)) return fail('invalid_input');
      return parseStoredSigningJob(await rpc('save_signing_job', { p_job_id: input.jobId, p_expected_version: input.expectedVersion, p_claim_token: input.claimToken, p_snapshot: clone(input.snapshot), p_error_code: input.errorCode ?? null }));
    },
    async enqueue(bodySha256, event) { hash(bodySha256); validateSigningEvent(event); return inbox(await rpc('enqueue_signing_webhook', { p_body_sha256: bodySha256, p_event: clone(event) })); },
    async getInbox(id) { const result = await lookup('signing_webhook_inbox', INBOX_COLUMNS, id); return result === null ? null : inbox(result); },
    async applyWebhook(input) {
      if (!record(input)) return fail('invalid_input');
      uuid(input.inboxId); positive(input.expectedJobVersion);
      try { validateSigningJob(input.snapshot); } catch { return fail('invalid_input'); }
      return inbox(await rpc('apply_signing_webhook', { p_inbox_id: input.inboxId, p_expected_job_version: input.expectedJobVersion, p_snapshot: clone(input.snapshot) }));
    },
  };
}
