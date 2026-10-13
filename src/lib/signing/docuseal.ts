/**
 * Server-only DocuSeal transport. Import only from server routes/jobs.
 * This module never writes application state, sends signature emails/SMS, or retries POSTs.
 * Reference: https://www.docuseal.com/docs/api
 * HMAC: https://www.docuseal.com/resources/use-webhooks
 * Secret semantics: https://github.com/docusealco/docuseal/blob/master/lib/webhook_urls/signatures.rb
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_SIGNERS = 20;
const SUBMISSION_STATUSES = ['pending', 'completed', 'declined', 'expired'] as const;
const SIGNER_STATUSES = ['awaiting', 'sent', 'opened', 'completed', 'declined'] as const;

export type DocuSealErrorCode = 'invalid_configuration' | 'disabled' | 'invalid_input' | 'provider_rejected' | 'provider_unavailable' | 'invalid_response' | 'outcome_unknown' | 'invalid_webhook';
export class DocuSealError extends Error {
  readonly code: DocuSealErrorCode;
  constructor(code: DocuSealErrorCode) {
    super(code === 'outcome_unknown' ? 'Signature request outcome is unknown. Reconcile before retrying.' : 'Document provider operation could not be completed.');
    this.name = 'DocuSealError';
    this.code = code;
  }
}

if (typeof window !== 'undefined') throw new DocuSealError('invalid_configuration');

type FieldValue = string | number | boolean | null | (string | number | boolean)[];
export type DocuSealSignerInput = {
  role: string;
  email: string;
  name?: string;
  externalId?: string;
  values?: Record<string, FieldValue>;
};
export type DocuSealCreateInput = {
  templateId: number;
  signers: DocuSealSignerInput[];
  sendEmail?: false;
  order?: 'preserved' | 'random';
};
export type DocuSealSubmitter = {
  id: number;
  submissionId: number;
  status: (typeof SIGNER_STATUSES)[number];
  role: string;
  email: string;
  externalId: string | null;
  completedAt: string | null;
  declinedAt: string | null;
  signingUrl: string | null;
};
export type DocuSealSubmission = {
  id: number;
  status: (typeof SUBMISSION_STATUSES)[number];
  completedAt: string | null;
  archivedAt: string | null;
  submitters: DocuSealSubmitter[];
  documents: { name: string; url: string }[];
  auditLogUrl: string | null;
  combinedDocumentUrl: string | null;
};
export type DocuSealConfig = { baseUrl: string; apiKey: string; enabled?: boolean; timeoutMs?: number; fetchImpl?: typeof fetch };

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function fail(code: DocuSealErrorCode): never { throw new DocuSealError(code); }
function id(value: unknown, code: DocuSealErrorCode): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) return fail(code);
  return value as number;
}
function text(value: unknown, max: number, code: DocuSealErrorCode): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return fail(code);
  return value;
}
function nullableText(value: unknown, max: number): string | null {
  return value === null || value === undefined ? null : text(value, max, 'invalid_response');
}
function email(value: unknown, code: DocuSealErrorCode): string {
  const address = text(value, 254, code);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return fail(code);
  return address;
}
function timestamp(value: unknown, code: DocuSealErrorCode): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) return fail(code);
  return value;
}
function httpsUrl(value: unknown, code: DocuSealErrorCode): string {
  if (typeof value !== 'string' || value.length > 8192) return fail(code);
  let url: URL;
  try { url = new URL(value); } catch { return fail(code); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return fail(code);
  return url.toString();
}
function nullableUrl(value: unknown): string | null { return value == null ? null : httpsUrl(value, 'invalid_response'); }
function knownFields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('invalid_input');
}

function createBody(input: DocuSealCreateInput): string {
  if (!object(input)) return fail('invalid_input');
  knownFields(input, ['templateId', 'signers', 'sendEmail', 'order']);
  id(input.templateId, 'invalid_input');
  if (input.sendEmail !== undefined && input.sendEmail !== false) return fail('invalid_input');
  if (input.order !== undefined && input.order !== 'preserved' && input.order !== 'random') return fail('invalid_input');
  if (!Array.isArray(input.signers) || input.signers.length < 1 || input.signers.length > MAX_SIGNERS) return fail('invalid_input');
  const roles = new Set<string>();
  const externalIds = new Set<string>();
  const submitters = input.signers.map(signer => {
    if (!object(signer)) return fail('invalid_input');
    knownFields(signer, ['role', 'email', 'name', 'externalId', 'values']);
    const role = text(signer.role, 200, 'invalid_input');
    const address = email(signer.email, 'invalid_input');
    if (roles.has(role)) return fail('invalid_input');
    roles.add(role);
    if (signer.externalId !== undefined) {
      const externalId = text(signer.externalId, 200, 'invalid_input');
      if (externalIds.has(externalId)) return fail('invalid_input');
      externalIds.add(externalId);
    }
    const values: Record<string, FieldValue> = Object.create(null);
    if (signer.values !== undefined) {
      if (!object(signer.values) || Object.keys(signer.values).length > 100) return fail('invalid_input');
      const validPrimitive = (value: unknown): boolean => typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 10000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
      for (const [name, value] of Object.entries(signer.values)) {
        text(name, 200, 'invalid_input');
        if (value !== null && !(Array.isArray(value) ? value.length <= 100 && value.every(validPrimitive) : validPrimitive(value))) return fail('invalid_input');
        values[name] = value as FieldValue;
      }
    }
    return {
      role, email: address, ...(signer.name === undefined ? {} : { name: text(signer.name, 200, 'invalid_input') }),
      ...(signer.externalId === undefined ? {} : { external_id: text(signer.externalId, 200, 'invalid_input') }),
      values, send_email: false, send_sms: false,
    };
  });
  const body = JSON.stringify({ template_id: input.templateId, order: input.order ?? 'preserved', send_email: false, send_sms: false, submitters });
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return fail('invalid_input');
  return body;
}

function submitter(value: unknown): DocuSealSubmitter {
  if (!object(value) || !SIGNER_STATUSES.includes(value.status as DocuSealSubmitter['status'])) return fail('invalid_response');
  return {
    id: id(value.id, 'invalid_response'), submissionId: id(value.submission_id, 'invalid_response'),
    status: value.status as DocuSealSubmitter['status'], externalId: nullableText(value.external_id, 200),
    role: text(value.role, 200, 'invalid_response'), email: email(value.email, 'invalid_response'),
    completedAt: timestamp(value.completed_at, 'invalid_response'), declinedAt: timestamp(value.declined_at, 'invalid_response'),
    signingUrl: nullableUrl(value.embed_src),
  };
}

function signerRows(value: unknown): DocuSealSubmitter[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SIGNERS) return fail('invalid_response');
  const parsed = value.map(submitter);
  if (new Set(parsed.map(signer => signer.id)).size !== parsed.length) return fail('invalid_response');
  return parsed;
}

function submission(value: unknown, expectedId: number): DocuSealSubmission {
  if (!object(value) || id(value.id, 'invalid_response') !== expectedId || !SUBMISSION_STATUSES.includes(value.status as DocuSealSubmission['status'])) return fail('invalid_response');
  const submitters = signerRows(value.submitters);
  if (submitters.some(signer => signer.submissionId !== expectedId)) return fail('invalid_response');
  if (!Array.isArray(value.documents) || value.documents.length > 100) return fail('invalid_response');
  const documents = value.documents.map(document => {
    if (!object(document)) return fail('invalid_response');
    return { name: text(document.name, 500, 'invalid_response'), url: httpsUrl(document.url, 'invalid_response') };
  });
  return {
    id: expectedId, status: value.status as DocuSealSubmission['status'],
    completedAt: timestamp(value.completed_at, 'invalid_response'), archivedAt: timestamp(value.archived_at, 'invalid_response'),
    submitters, documents, auditLogUrl: nullableUrl(value.audit_log_url), combinedDocumentUrl: nullableUrl(value.combined_document_url),
  };
}

async function boundedJSON(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) return fail('invalid_response');
  if (!response.body) return fail('invalid_response');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { void reader.cancel().catch(() => {}); return fail('invalid_response'); }
      parts.push(value);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch { return fail('invalid_response'); }
  finally { reader.releaseLock(); }
}

export function createDocuSealClient(config: DocuSealConfig) {
  if (typeof window !== 'undefined') return fail('invalid_configuration');
  if (!object(config)) return fail('invalid_configuration');
  const base = new URL(httpsUrl(config.baseUrl, 'invalid_configuration'));
  if (base.search) return fail('invalid_configuration');
  const baseUrl = base.toString().replace(/\/$/, '');
  const apiKey = text(config.apiKey, 4096, 'invalid_configuration');
  if (apiKey !== apiKey.trim()) return fail('invalid_configuration');
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') return fail('invalid_configuration');
  const enabled = config.enabled === true;
  const timeoutMs = config.timeoutMs ?? 8000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) return fail('invalid_configuration');
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return fail('invalid_configuration');

  async function request(method: 'GET' | 'POST', path: string, body?: string): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const pending = (async () => {
        const response = await fetchImpl(`${baseUrl}${path}`, {
          method, body, signal: controller.signal, redirect: 'error', cache: 'no-store',
          headers: { 'X-Auth-Token': apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          const ambiguous = response.status === 408 || response.status >= 500 || (response.status >= 300 && response.status < 400);
          return fail(ambiguous ? (method === 'POST' ? 'outcome_unknown' : 'provider_unavailable') : 'provider_rejected');
        }
        return boundedJSON(response);
      })();
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new DocuSealError(method === 'POST' ? 'outcome_unknown' : 'provider_unavailable')); }, timeoutMs);
      });
      return await Promise.race([pending, timeout]);
    } catch (error) {
      if (error instanceof DocuSealError && error.code === 'provider_rejected') throw error;
      if (method === 'POST') return fail('outcome_unknown');
      if (error instanceof DocuSealError) throw error;
      return fail('provider_unavailable');
    } finally { if (timer) clearTimeout(timer); }
  }

  return {
    async createSubmission(input: DocuSealCreateInput): Promise<{ submissionId: number; submitters: DocuSealSubmitter[] }> {
      if (!enabled) return fail('disabled');
      // Validate before starting the POST. No blind retries after dispatch.
      const body = createBody(input);
      const expectedSigners = (JSON.parse(body) as { submitters: { role: string; email: string; external_id?: string }[] }).submitters;
      const result = await request('POST', '/submissions', body);
      try {
        const submitters = signerRows(result);
        const submissionId = submitters[0].submissionId;
        if (submitters.length !== expectedSigners.length || submitters.some(signer => signer.submissionId !== submissionId)) return fail('invalid_response');
        const returnedRoles = new Set<string>();
        for (const signer of submitters) {
          const expected = expectedSigners.find(value => value.role === signer.role && value.email.toLowerCase() === signer.email.toLowerCase());
          if (!expected || returnedRoles.has(signer.role) || (expected.external_id !== undefined && signer.externalId !== expected.external_id)) return fail('invalid_response');
          returnedRoles.add(signer.role);
        }
        return { submissionId, submitters };
      } catch { return fail('outcome_unknown'); }
    },
    async getSubmission(submissionId: number): Promise<DocuSealSubmission> {
      id(submissionId, 'invalid_input');
      return submission(await request('GET', `/submissions/${submissionId}`), submissionId);
    },
  };
}

export type DocuSealWebhookEvent = {
  eventType: 'form.viewed' | 'form.started' | 'form.completed' | 'form.declined' | 'submission.created' | 'submission.completed' | 'submission.expired' | 'submission.archived';
  occurredAt: string;
  entity: 'submitter' | 'submission';
  submissionId: number;
  submitterId: number | null;
};
const WEBHOOK_EVENTS = ['form.viewed', 'form.started', 'form.completed', 'form.declined', 'submission.created', 'submission.completed', 'submission.expired', 'submission.archived'];

export function verifyDocuSealWebhook(rawBody: Uint8Array, signatureHeader: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!(rawBody instanceof Uint8Array) || rawBody.byteLength > MAX_RESPONSE_BYTES || typeof signatureHeader !== 'string' || signatureHeader.length > 100 || typeof secret !== 'string' || !/^whsec_[A-Za-z0-9+/=]{32}$/.test(secret) || !Number.isSafeInteger(nowSeconds) || nowSeconds < 0) return false;
  const match = /^(0|[1-9][0-9]*)\.([a-f0-9]{64})$/.exec(signatureHeader);
  if (!match) return false;
  const signedAt = Number(match[1]);
  if (!Number.isSafeInteger(signedAt) || Math.abs(nowSeconds - signedAt) > 300) return false;
  // Official Node/Ruby implementations use the ENTIRE whsec_... string as UTF-8 key.
  // Do not strip the prefix or base64-decode the secret.
  const expected = createHmac('sha256', secret).update(`${match[1]}.`).update(rawBody).digest();
  const received = Buffer.from(match[2], 'hex');
  return received.length === expected.length && timingSafeEqual(expected, received);
}

export function parseVerifiedDocuSealWebhook(rawBody: Uint8Array, signatureHeader: string | null, secret: string, nowSeconds?: number): DocuSealWebhookEvent {
  if (!verifyDocuSealWebhook(rawBody, signatureHeader, secret, nowSeconds)) return fail('invalid_webhook');
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(rawBody).toString('utf8')); } catch { return fail('invalid_webhook'); }
  if (!object(payload) || !WEBHOOK_EVENTS.includes(payload.event_type as string) || !object(payload.data)) return fail('invalid_webhook');
  const occurredAt = timestamp(payload.timestamp, 'invalid_webhook');
  if (!occurredAt) return fail('invalid_webhook');
  const eventType = payload.event_type as DocuSealWebhookEvent['eventType'];
  const isForm = eventType.startsWith('form.');
  const data = payload.data;
  // Form events identify a signer; submission events identify the whole submission.
  // Metadata is never used to infer local company, deal, or document ownership.
  const submissionId = isForm
    ? id(data.submission_id ?? (object(data.submission) ? data.submission.id : undefined), 'invalid_webhook')
    : id(data.id, 'invalid_webhook');
  if (isForm && object(data.submission) && id(data.submission.id, 'invalid_webhook') !== submissionId) return fail('invalid_webhook');
  return { eventType, occurredAt, entity: isForm ? 'submitter' : 'submission', submissionId, submitterId: isForm ? id(data.id, 'invalid_webhook') : null };
}
