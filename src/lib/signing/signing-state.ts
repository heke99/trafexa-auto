/**
 * Pure signing-job transitions. Persist a returned snapshot using CAS on the old
 * version. The caller must authorize the company/document, durably claim dispatch,
 * verify provider/webhook provenance, and verify private archive storage.
 * Runtime shape validation cannot prove a caller's identity or storage ACLs.
 */
import type { DocuSealWebhookEvent } from './docuseal.ts';

export type SigningState = 'prepared' | 'dispatching' | 'outcome_unknown' | 'dispatch_failed' | 'awaiting_signatures' | 'awaiting_archive' | 'completed' | 'expired' | 'declined';
export type SigningContext = {
  id: string;
  companyId: string;
  documentId: string;
  dealId: string | null;
  documentVersion: number;
  sourceSha256: string;
  templateId: number;
  templateVersion: number;
  templateSha256: string;
};
export type SubmitterBinding = { id: number; externalId: string };
export type ArchiveEvidence = {
  context: SigningContext;
  submissionId: number;
  storageVisibility: 'private';
  signedPdf: { path: string; sha256: string };
  audit: { path: string; sha256: string };
};
export type SigningJob = SigningContext & {
  expectedSignerExternalIds: string[];
  state: SigningState;
  version: number;
  submissionId: number | null;
  submitters: SubmitterBinding[];
  completedSubmitterIds: number[];
  archive: ArchiveEvidence | null;
};
export type ProviderConfirmation = {
  context: SigningContext;
  provider: {
    submissionId: number;
    submitters: { id: number; submissionId: number; externalId: string | null }[];
  };
};
export type VerifiedSigningEvent = Pick<DocuSealWebhookEvent, 'eventType' | 'entity' | 'submissionId' | 'submitterId'>;
export class SigningStateError extends Error {
  readonly code: 'invalid_input' | 'invalid_transition' | 'binding_mismatch';
  constructor(code: SigningStateError['code']) {
    super('Signing job validation or transition failed.');
    this.name = 'SigningStateError';
    this.code = code;
  }
}

const CONTEXT_KEYS = ['id', 'companyId', 'documentId', 'dealId', 'documentVersion', 'sourceSha256', 'templateId', 'templateVersion', 'templateSha256'];
const STATES = ['prepared', 'dispatching', 'outcome_unknown', 'dispatch_failed', 'awaiting_signatures', 'awaiting_archive', 'completed', 'expired', 'declined'];
const EVENTS = ['form.viewed', 'form.started', 'form.completed', 'form.declined', 'submission.created', 'submission.completed', 'submission.expired', 'submission.archived'];
function fail(code: SigningStateError['code'] = 'invalid_input'): never { throw new SigningStateError(code); }
function record(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail();
}
function fields(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) fail();
}
function positive(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail();
}
function uuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) fail();
}
function checksum(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail();
}
function externalId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value !== value.trim() || value.length < 1 || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) fail();
}
function context(value: unknown): void {
  record(value);
  for (const field of ['id', 'companyId', 'documentId']) uuid(value[field]);
  if (value.dealId !== null) uuid(value.dealId);
  positive(value.documentVersion);
  positive(value.templateId);
  positive(value.templateVersion);
  checksum(value.sourceSha256);
  checksum(value.templateSha256);
}
function matchContext(job: SigningContext, value: unknown): asserts value is SigningContext {
  record(value);
  context(value);
  fields(value, CONTEXT_KEYS);
  if (CONTEXT_KEYS.some(key => job[key as keyof SigningContext] !== value[key])) fail('binding_mismatch');
}
function signerIds(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) fail();
  value.forEach(externalId);
  if (new Set(value).size !== value.length) fail();
}
function privateObject(value: unknown, companyId: string): asserts value is {path: string; sha256: string} {
  record(value);
  fields(value, ['path', 'sha256']);
  checksum(value.sha256);
  if (typeof value.path !== 'string' || value.path.length > 1024 || !value.path.startsWith(`${companyId}/`)) fail('binding_mismatch');
  const parts = value.path.split('/');
  if (parts.length < 2 || parts.some(part => !/^[a-zA-Z0-9._-]+$/.test(part) || part === '.' || part === '..')) fail();
}
function archiveEvidence(job: SigningJob, evidence: unknown): asserts evidence is ArchiveEvidence {
  record(evidence);
  fields(evidence, ['context', 'submissionId', 'storageVisibility', 'signedPdf', 'audit']);
  matchContext(job, evidence.context);
  positive(evidence.submissionId);
  if (evidence.submissionId !== job.submissionId) fail('binding_mismatch');
  if (evidence.storageVisibility !== 'private') fail();
  privateObject(evidence.signedPdf, job.companyId);
  privateObject(evidence.audit, job.companyId);
  if (!evidence.signedPdf.path.endsWith('.pdf') || evidence.signedPdf.path === evidence.audit.path) fail();
}

/** Validate a persisted snapshot too, rather than trusting a TypeScript annotation. */
export function validateSigningJob(value: unknown): asserts value is SigningJob {
  record(value);
  fields(value, [...CONTEXT_KEYS, 'expectedSignerExternalIds', 'state', 'version', 'submissionId', 'submitters', 'completedSubmitterIds', 'archive']);
  context(value);
  signerIds(value.expectedSignerExternalIds);
  positive(value.version);
  if (!STATES.includes(value.state as string)) fail();
  if (!Array.isArray(value.submitters) || !Array.isArray(value.completedSubmitterIds)) fail();
  const unbound = ['prepared', 'dispatching', 'outcome_unknown', 'dispatch_failed'].includes(value.state as string);
  if (unbound) {
    if (value.submissionId !== null || value.submitters.length || value.completedSubmitterIds.length || value.archive !== null) fail();
  } else {
    positive(value.submissionId);
    const ids = new Set<number>();
    const external = new Set<string>();
    for (const submitter of value.submitters) {
      record(submitter);
      fields(submitter, ['id', 'externalId']);
      positive(submitter.id);
      externalId(submitter.externalId);
      if (ids.has(submitter.id) || external.has(submitter.externalId) || !value.expectedSignerExternalIds.includes(submitter.externalId)) fail();
      ids.add(submitter.id);
      external.add(submitter.externalId);
    }
    if (external.size !== value.expectedSignerExternalIds.length) fail();
    value.completedSubmitterIds.forEach(positive);
    if (new Set(value.completedSubmitterIds).size !== value.completedSubmitterIds.length || value.completedSubmitterIds.some(id => !ids.has(id))) fail();
    if (value.state === 'completed') archiveEvidence(value as unknown as SigningJob, value.archive);
    else if (value.archive !== null) fail();
  }
}

function next(job: SigningJob, changes: Partial<SigningJob>): SigningJob {
  const result = { ...job, ...changes, version: job.version + 1 };
  validateSigningJob(result);
  return result;
}
export function createSigningJob(input: unknown): SigningJob {
  record(input);
  fields(input, [...CONTEXT_KEYS, 'expectedSignerExternalIds']);
  context(input);
  signerIds(input.expectedSignerExternalIds);
  const result = {
    ...input, expectedSignerExternalIds: [...input.expectedSignerExternalIds],
    state: 'prepared', version: 1, submissionId: null, submitters: [], completedSubmitterIds: [], archive: null,
  };
  validateSigningJob(result);
  return result;
}
export function startDispatch(job: SigningJob): SigningJob {
  validateSigningJob(job);
  if (job.state !== 'prepared') fail('invalid_transition');
  return next(job, {state: 'dispatching'});
}
export function dispatchUnknown(job: SigningJob): SigningJob {
  validateSigningJob(job);
  if (job.state !== 'dispatching') fail('invalid_transition');
  return next(job, {state: 'outcome_unknown'});
}
/** Only use for a known pre-dispatch failure or a definitive provider rejection. */
export function dispatchRejected(job: SigningJob): SigningJob {
  validateSigningJob(job);
  if (job.state !== 'dispatching') fail('invalid_transition');
  return next(job, {state: 'dispatch_failed'});
}
/** Only pass a verified provider return plus the trusted immutable dispatch context. */
export function bindSubmission(job: SigningJob, confirmation: ProviderConfirmation): SigningJob {
  validateSigningJob(job);
  if (job.state !== 'dispatching' && job.state !== 'outcome_unknown') fail('invalid_transition');
  record(confirmation);
  fields(confirmation, ['context', 'provider']);
  matchContext(job, confirmation.context);
  record(confirmation.provider);
  positive(confirmation.provider.submissionId);
  if (!Array.isArray(confirmation.provider.submitters) || confirmation.provider.submitters.length !== job.expectedSignerExternalIds.length) fail('binding_mismatch');
  const submitters = confirmation.provider.submitters.map(submitter => {
    record(submitter);
    positive(submitter.id);
    positive(submitter.submissionId);
    externalId(submitter.externalId);
    if (submitter.submissionId !== confirmation.provider.submissionId || !job.expectedSignerExternalIds.includes(submitter.externalId)) fail('binding_mismatch');
    return { id: submitter.id, externalId: submitter.externalId };
  });
  if (new Set(submitters.map(signer => signer.id)).size !== submitters.length || new Set(submitters.map(signer => signer.externalId)).size !== submitters.length) fail('binding_mismatch');
  return next(job, {state: 'awaiting_signatures', submissionId: confirmation.provider.submissionId, submitters});
}
/** The transport must verify HMAC over raw bytes before supplying an event. */
export function applyVerifiedEvent(job: SigningJob, event: VerifiedSigningEvent): SigningJob {
  validateSigningJob(job);
  record(event);
  if (!EVENTS.includes(event.eventType as string)) fail();
  positive(event.submissionId);
  if ((event.eventType as string).startsWith('form.')) {
    if (event.entity !== 'submitter') fail();
    positive(event.submitterId);
  } else if (event.entity !== 'submission' || event.submitterId !== null) fail();
  if (event.submissionId !== job.submissionId || ['completed', 'expired', 'declined'].includes(job.state)) return job;
  if (event.entity === 'submitter' && !job.submitters.some(signer => signer.id === event.submitterId)) return job;
  if (event.eventType === 'form.completed' && ['awaiting_signatures', 'awaiting_archive'].includes(job.state)) {
    if (job.completedSubmitterIds.includes(event.submitterId as number)) return job;
    return next(job, {completedSubmitterIds: [...job.completedSubmitterIds, event.submitterId as number].sort((a,b) => a-b)});
  }
  if (job.state !== 'awaiting_signatures') return job;
  if (event.eventType === 'submission.completed') return next(job, {state: 'awaiting_archive'});
  if (event.eventType === 'form.declined') return next(job, {state: 'declined'});
  if (event.eventType === 'submission.expired') return next(job, {state: 'expired'});
  return job;
}
/** Provider completion alone is insufficient; archive source and local IDs must match. */
export function completeArchive(job: SigningJob, evidence: ArchiveEvidence): SigningJob {
  validateSigningJob(job);
  archiveEvidence(job, evidence);
  if (job.state === 'completed') {
    if (job.archive?.signedPdf.path === evidence.signedPdf.path && job.archive.signedPdf.sha256 === evidence.signedPdf.sha256
        && job.archive.audit.path === evidence.audit.path && job.archive.audit.sha256 === evidence.audit.sha256) return job;
    fail('binding_mismatch');
  }
  if (job.state !== 'awaiting_archive') fail('invalid_transition');
  return next(job, {state: 'completed', archive: {
    context: {...evidence.context}, submissionId: evidence.submissionId, storageVisibility: 'private',
    signedPdf: {...evidence.signedPdf}, audit: {...evidence.audit},
  }});
}
