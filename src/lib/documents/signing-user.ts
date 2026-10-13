/**
 * Server boundary for preparing a signing job under the authenticated user's RLS.
 * An approved-render reader is a trusted server capability, never a request adapter:
 * it must obtain the PDF and signer values from the same immutable approved render.
 * This helper registers/prepares the ledger only; it never calls the signing provider.
 */
import { createHash } from 'node:crypto';
import { validateDocuSealCreateInput } from './docuseal.ts';
import { parseStoredSigningJob, SigningStoreError, validateApprovedSigners } from './signing-store.ts';
import type { ApprovedSigner, RegisteredDocumentVersion, RegisterDocumentVersionInput } from './signing-store.ts';
import type { SigningJob } from './signing-state.ts';

export class SigningUserError extends Error {
  readonly code: 'invalid_configuration' | 'invalid_input' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'unverified_source' | 'unavailable';
  constructor(code: SigningUserError['code']) { super('Signing preparation could not be completed.'); this.name = 'SigningUserError'; this.code = code; }
}
if (typeof window !== 'undefined') throw new SigningUserError('invalid_configuration');

export type SigningUserInput = { companyId: string; documentId: string; documentVersion: number; templateId: number; idempotencyKey: string };
export type ApprovedRenderReadContext = {
  userId: string;
  companyId: string;
  documentId: string;
  dealId: string | null;
  documentKind: 'purchase' | 'contract';
  documentVersion: number;
  sourceObjectPath: string;
  templateId: number;
  templateVersion: number;
  templateSha256: string;
};
export type ApprovedRenderEvidence = {
  approvalId: string;
  document: { id: string; companyId: string; dealId: string | null; documentKind: 'purchase' | 'contract'; documentVersion: number; sourceObjectPath: string };
  storageVisibility: 'private';
  objectPath: string;
  bytes: Uint8Array;
  /** Protected immutable approval-record hash; the boundary recomputes actual PDF bytes. */
  sourceSha256: string;
  approvedSigners: ApprovedSigner[];
  templateId: number;
  templateVersion: number;
  templateSha256: string;
};
export interface TrustedApprovedRenderReader { load(context: ApprovedRenderReadContext, options?: { signal: AbortSignal }): Promise<ApprovedRenderEvidence> }
export type SigningUserConfig = {
  supabaseUrl: string;
  publishableKey: string;
  serviceStore: { registerDocumentVersion(input: RegisterDocumentVersionInput, options?: { signal: AbortSignal }): Promise<RegisteredDocumentVersion> };
  approvedRenderReader: TrustedApprovedRenderReader;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const JOB_COLUMNS = 'id,company_id,document_id,deal_id,document_version,source_sha256,source_object_path,template_id,template_version,template_sha256,document_kind,created_by,idempotency_key,provider_instance,provider_submission_id,state,version,snapshot,signers,claim_token,claim_expires_at,error_code';
function fail(code: SigningUserError['code']): never { throw new SigningUserError(code); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype; }
function uuid(value: unknown, code: SigningUserError['code'] = 'invalid_input'): string { if (typeof value !== 'string' || !UUID.test(value)) return fail(code); return value; }
function positive(value: unknown, code: SigningUserError['code'] = 'invalid_input'): number { if (!Number.isSafeInteger(value) || (value as number) < 1) return fail(code); return value as number; }
function checksum(value: unknown, code: SigningUserError['code']): string { if (typeof value !== 'string' || !SHA256.test(value)) return fail(code); return value; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!record(value)) return fail('unavailable');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function sourcePath(value: unknown, companyId: string): string {
  if (typeof value !== 'string' || value.length > 1024 || !value.startsWith(`${companyId}/`) || value.split('/').some(part => !/^[a-zA-Z0-9._-]+$/.test(part) || part === '.' || part === '..')) return fail('unverified_source');
  return value;
}
function validateInput(value: unknown): SigningUserInput {
  if (!record(value) || Object.keys(value).some(key => !['companyId', 'documentId', 'documentVersion', 'templateId', 'idempotencyKey'].includes(key))) return fail('invalid_input');
  const documentVersion = positive(value.documentVersion);
  if (documentVersion > 2147483647) return fail('invalid_input');
  return freeze({ companyId: uuid(value.companyId), documentId: uuid(value.documentId), documentVersion, templateId: positive(value.templateId), idempotencyKey: uuid(value.idempotencyKey) });
}

async function boundedJSON(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) return fail('unavailable');
  if (!response.body) return fail('unavailable');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_RESPONSE_BYTES) { void reader.cancel().catch(() => {}); return fail('unavailable'); } parts.push(value); }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch { return fail('unavailable'); }
  finally { reader.releaseLock(); }
}

function validateRender(evidence: ApprovedRenderEvidence, expected: ApprovedRenderReadContext): { sourceSha256: string; signers: ApprovedSigner[] } {
  if (!record(evidence) || !record(evidence.document)) return fail('unverified_source');
  uuid(evidence.approvalId, 'unverified_source');
  const document = evidence.document;
  if (document.id !== expected.documentId || document.companyId !== expected.companyId || document.dealId !== expected.dealId || document.documentKind !== expected.documentKind || document.documentVersion !== expected.documentVersion || document.sourceObjectPath !== expected.sourceObjectPath || evidence.storageVisibility !== 'private' || evidence.objectPath !== expected.sourceObjectPath || evidence.templateId !== expected.templateId || evidence.templateVersion !== expected.templateVersion || evidence.templateSha256 !== expected.templateSha256) return fail('unverified_source');
  sourcePath(evidence.objectPath, expected.companyId);
  if (!(evidence.bytes instanceof Uint8Array) || evidence.bytes.byteLength < 5 || evidence.bytes.byteLength > MAX_FILE_BYTES) return fail('unverified_source');
  const bytes = Buffer.from(evidence.bytes);
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return fail('unverified_source');
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  if (checksum(evidence.sourceSha256, 'unverified_source') !== sourceSha256) return fail('unverified_source');
  try {
    validateApprovedSigners(evidence.approvedSigners);
    validateDocuSealCreateInput({ templateId: expected.templateId, sendEmail: false, signers: evidence.approvedSigners, order: 'preserved' });
  } catch { return fail('unverified_source'); }
  return { sourceSha256, signers: freeze(clone(evidence.approvedSigners)) };
}

export function createSigningUserBoundary(config: SigningUserConfig) {
  if (!record(config)) return fail('invalid_configuration');
  let base: URL;
  try { base = new URL(config.supabaseUrl); } catch { return fail('invalid_configuration'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/' || typeof config.publishableKey !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey) || typeof config.serviceStore?.registerDocumentVersion !== 'function' || typeof config.approvedRenderReader?.load !== 'function') return fail('invalid_configuration');
  const timeoutMs = config.timeoutMs ?? 8000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) return fail('invalid_configuration');
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return fail('invalid_configuration');
  const publishableKey = config.publishableKey;
  async function trustedCall<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new SigningUserError('unavailable')); }, timeoutMs); });
      return await Promise.race([operation(controller.signal), timeout]);
    } finally { if (timer) clearTimeout(timer); }
  }

  async function request(path: string, bearer: string, body?: Record<string, unknown>): Promise<unknown> {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    if (encoded && Buffer.byteLength(encoded) > 128 * 1024) return fail('unverified_source');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = (async () => {
        const response = await fetchImpl(`${base.origin}${path}`, { method: body === undefined ? 'GET' : 'POST', body: encoded, signal: controller.signal, redirect: 'error', cache: 'no-store', headers: { apikey: publishableKey, Authorization: bearer, Accept: 'application/json', 'Content-Type': 'application/json' } });
        if (response.status === 401) { void response.body?.cancel().catch(() => {}); return fail('unauthenticated'); }
        const result = await boundedJSON(response);
        if (!response.ok) {
          const code = record(result) ? result.code : undefined;
          if (response.status === 403 || code === '42501') return fail('forbidden');
          if (code === '40001' || code === '23505') return fail('conflict');
          return fail('unavailable');
        }
        return result;
      })();
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new SigningUserError('unavailable')); }, timeoutMs); });
      return await Promise.race([operation, timeout]);
    } catch (error) { if (error instanceof SigningUserError) throw error; return fail('unavailable'); }
    finally { if (timer) clearTimeout(timer); }
  }
  async function one(table: string, select: string, filters: Record<string, string>, bearer: string): Promise<Record<string, unknown> | null> {
    const params = new URLSearchParams({ select, ...filters, limit: '2' });
    const rows = await request(`/rest/v1/${table}?${params}`, bearer);
    if (!Array.isArray(rows) || rows.length > 1 || (rows.length && !record(rows[0]))) return fail('unavailable');
    return rows.length ? rows[0] : null;
  }
  async function prepare(bearer: string, value: SigningUserInput): Promise<{ snapshot: SigningJob }> {
    const input = validateInput(value);
    if (typeof bearer !== 'string' || bearer.length > 8192 || !/^Bearer [A-Za-z0-9._~-]+$/i.test(bearer)) return fail('unauthenticated');
    const auth = await request('/auth/v1/user', bearer);
    if (!record(auth) || typeof auth.id !== 'string' || !UUID.test(auth.id) || auth.is_anonymous === true) return fail('unauthenticated');
    const userId = auth.id;
    const membership = await one('memberships', 'company_id,user_id,role,status', { company_id: `eq.${input.companyId}`, user_id: `eq.${userId}`, status: 'eq.active' }, bearer);
    if (!membership || membership.company_id !== input.companyId || membership.user_id !== userId || membership.status !== 'active' || !['owner', 'admin', 'finance'].includes(membership.role as string)) return fail('forbidden');
    const [company, document] = await Promise.all([
      one('companies', 'id,status', { id: `eq.${input.companyId}` }, bearer),
      one('documents', 'id,company_id,deal_id,kind,object_path', { company_id: `eq.${input.companyId}`, id: `eq.${input.documentId}` }, bearer),
    ]);
    if (!company || company.id !== input.companyId || company.status !== 'active') return fail('forbidden');
    if (!document || document.id !== input.documentId || document.company_id !== input.companyId) return fail('not_found');
    if (!['purchase', 'contract'].includes(document.kind as string)) return fail('forbidden');
    const dealId = document.deal_id === null ? null : uuid(document.deal_id, 'forbidden');
    if (document.kind === 'contract' && dealId === null) return fail('forbidden');
    const objectPath = sourcePath(document.object_path, input.companyId);
    const deal = dealId === null ? null : await one('deals', 'id,company_id', { company_id: `eq.${input.companyId}`, id: `eq.${dealId}` }, bearer);
    if (dealId !== null && (!deal || deal.id !== dealId || deal.company_id !== input.companyId)) return fail('forbidden');
    // A historical same-key replay returns the original immutable job, even if the
    // active template has advanced. It does not register or dispatch anything again.
    const existing = await one('signing_jobs', JOB_COLUMNS, { company_id: `eq.${input.companyId}`, created_by: `eq.${userId}`, idempotency_key: `eq.${input.idempotencyKey}` }, bearer);
    if (existing) {
      const stored = parseStoredSigningJob(existing);
      const job = stored.snapshot;
      if (stored.createdBy !== userId || job.companyId !== input.companyId || existing.idempotency_key !== input.idempotencyKey) return fail('unavailable');
      if (job.documentId !== input.documentId || job.documentVersion !== input.documentVersion || job.templateId !== input.templateId || job.dealId !== dealId || stored.documentKind !== document.kind || stored.sourceObjectPath !== objectPath) return fail('conflict');
      return freeze({ snapshot: clone(job) });
    }
    const template = await one('signing_templates', 'company_id,provider_instance,template_id,template_version,template_sha256,document_kind,active', { company_id: `eq.${input.companyId}`, provider_instance: 'eq.docuseal-main', template_id: `eq.${input.templateId}`, document_kind: `eq.${document.kind}`, active: 'eq.true' }, bearer);
    if (!template || template.company_id !== input.companyId || template.provider_instance !== 'docuseal-main' || template.template_id !== input.templateId || template.document_kind !== document.kind || template.active !== true) return fail('forbidden');
    const readContext = freeze({ userId, companyId: input.companyId, documentId: input.documentId, dealId, documentKind: document.kind as 'purchase' | 'contract', documentVersion: input.documentVersion, sourceObjectPath: objectPath, templateId: input.templateId, templateVersion: positive(template.template_version, 'unavailable'), templateSha256: checksum(template.template_sha256, 'unavailable') });
    const render = validateRender(await trustedCall(signal => config.approvedRenderReader.load(readContext, { signal })), readContext);
    const registered = await trustedCall(signal => config.serviceStore.registerDocumentVersion({ companyId: input.companyId, documentId: input.documentId, documentVersion: input.documentVersion, sourceSha256: render.sourceSha256, sourceObjectPath: objectPath, actorUserId: userId, approvedSigners: render.signers, templateId: input.templateId, templateVersion: readContext.templateVersion, templateSha256: readContext.templateSha256 }, { signal }));
    if (!record(registered) || registered.companyId !== input.companyId || registered.documentId !== input.documentId || registered.documentVersion !== input.documentVersion || registered.sourceSha256 !== render.sourceSha256 || registered.sourceObjectPath !== objectPath || registered.templateId !== input.templateId || registered.templateVersion !== readContext.templateVersion || registered.templateSha256 !== readContext.templateSha256 || canonical(registered.approvedSigners) !== canonical(render.signers)) return fail('unavailable');
    uuid(registered.registeredBy, 'unavailable');
    const result = await request('/rest/v1/rpc/prepare_signing_job', bearer, { p_company_id: input.companyId, p_document_id: input.documentId, p_deal_id: dealId, p_document_version: input.documentVersion, p_source_sha256: render.sourceSha256, p_template_id: input.templateId, p_signers: render.signers, p_idempotency_key: input.idempotencyKey, p_expected_template_version: readContext.templateVersion, p_expected_template_sha256: readContext.templateSha256 });
    if (!record(result) || result.idempotency_key !== input.idempotencyKey) return fail('unavailable');
    const stored = parseStoredSigningJob(result);
    const job = stored.snapshot;
    if (job.companyId !== input.companyId || job.documentId !== input.documentId || job.dealId !== dealId || job.documentVersion !== input.documentVersion || job.sourceSha256 !== render.sourceSha256 || job.templateId !== input.templateId || job.templateVersion !== readContext.templateVersion || job.templateSha256 !== readContext.templateSha256 || stored.sourceObjectPath !== objectPath || stored.createdBy !== userId || stored.documentKind !== document.kind || canonical(stored.signers) !== canonical(render.signers)) return fail('unavailable');
    return freeze({ snapshot: clone(job) });
  }
  return {
    async prepare(bearer: string, input: SigningUserInput): Promise<{ snapshot: SigningJob }> {
      try { return await prepare(bearer, input); }
      catch (error) {
        if (error instanceof SigningUserError) throw error;
        if (error instanceof SigningStoreError) {
          if (error.code === 'conflict') return fail('conflict');
          if (error.code === 'forbidden') return fail('forbidden');
        }
        return fail('unavailable');
      }
    },
  };
}
