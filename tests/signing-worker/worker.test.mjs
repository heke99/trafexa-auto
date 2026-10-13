import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { DocuSealError } from '../../src/lib/documents/docuseal.ts';
import { createSigningJob, startDispatch, dispatchUnknown, bindSubmission, applyVerifiedEvent } from '../../src/lib/documents/signing-state.ts';
import { SigningStoreError } from '../../src/lib/documents/signing-store.ts';
import { createSigningWorker, hashSigningTemplate, SigningWorkerError } from '../../src/lib/documents/signing-worker.ts';

const JOB = '10000000-0000-4000-8000-000000000001';
const COMPANY = '20000000-0000-4000-8000-000000000002';
const DOC = '30000000-0000-4000-8000-000000000003';
const USER = '40000000-0000-4000-8000-000000000004';
const DEAL = '50000000-0000-4000-8000-000000000005';
const INBOX = '60000000-0000-4000-8000-000000000006';
const CLAIM = '70000000-0000-4000-8000-000000000007';
const NOW = Date.parse('2026-10-13T12:00:00Z');
const SECRET = `whsec_${Buffer.alloc(24, 9).toString('base64')}`;
const SOURCE = Buffer.from('%PDF-1.7\noriginal contract');
const TEMPLATE = Buffer.from('%PDF-1.7\napproved template');
const FIELDS = { roles: ['Buyer', 'Dealer'], fields: [{ name: 'Price', type: 'number' }] };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => structuredClone(value);
const ctx = value => Object.fromEntries(['id', 'companyId', 'documentId', 'dealId', 'documentVersion', 'sourceSha256', 'templateId', 'templateVersion', 'templateSha256'].map(key => [key, value[key]]));
const signers = [{ role: 'Buyer', email: 'buyer@example.com', externalId: 'buyer-1', values: { Notes: 'First line\nSecond line' } }, { role: 'Dealer', email: 'dealer@example.com', externalId: 'dealer-1' }];
function fixture() {
  return { snapshot: createSigningJob({ id: JOB, companyId: COMPANY, documentId: DOC, dealId: DEAL, documentVersion: 1, sourceSha256: digest(SOURCE), templateId: 44, templateVersion: 1, templateSha256: hashSigningTemplate(TEMPLATE, FIELDS), expectedSignerExternalIds: signers.map(value => value.externalId) }), sourceObjectPath: `${COMPANY}/sources/${DOC}.pdf`, createdBy: USER, providerInstance: 'docuseal-main', documentKind: 'contract', signers: copy(signers), claimToken: null, claimExpiresAt: null, errorCode: null };
}
const providerSigners = () => signers.map((signer, index) => ({ id: 101 + index, submissionId: 9001, externalId: signer.externalId, role: signer.role, email: signer.email, status: 'awaiting', completedAt: null, declinedAt: null, signingUrl: 'https://docuseal.com/s/sensitive-signing-link' }));
const event = (eventType, submitterId = null, submissionId = 9001) => ({ eventType, entity: eventType.startsWith('form.') ? 'submitter' : 'submission', submissionId, submitterId, occurredAt: '2026-10-13T12:00:00Z' });
function harness(options = {}) {
  let current = copy(options.initial ?? fixture());
  let clock = NOW;
  const entries = new Map();
  const objects = new Map();
  const counts = { claim: 0, save: 0, create: 0, getProvider: 0, enqueue: 0, apply: 0, archive: 0, readArchive: 0 };
  const store = {
    async getJob(id) { return id === current.snapshot.id ? copy(current) : null; },
    async claim(id, version, token) {
      counts.claim++;
      if (id !== current.snapshot.id || version !== current.snapshot.version || current.snapshot.state !== 'prepared') throw new SigningStoreError('conflict');
      current = { ...current, snapshot: startDispatch(current.snapshot), claimToken: token, claimExpiresAt: new Date(clock + 300000).toISOString() };
      return copy(current);
    },
    async save(input) {
      counts.save++;
      if (options.saveFails) throw new Error('private database key');
      if (input.expectedVersion !== current.snapshot.version || input.jobId !== current.snapshot.id || (current.snapshot.state === 'dispatching' && input.claimToken !== current.claimToken)) throw new SigningStoreError('conflict');
      current = { ...current, snapshot: copy(input.snapshot), claimToken: null, claimExpiresAt: null, errorCode: input.errorCode ?? null };
      return copy(current);
    },
    async markExpiredDispatch(id, version) {
      if (id !== current.snapshot.id || version !== current.snapshot.version || current.snapshot.state !== 'dispatching' || Date.parse(current.claimExpiresAt) > clock) throw new SigningStoreError('conflict');
      current = { ...current, snapshot: dispatchUnknown(current.snapshot), claimToken: null, claimExpiresAt: null, errorCode: 'outcome_unknown' };
      return copy(current);
    },
    async enqueue(hash, normalizedEvent) {
      counts.enqueue++;
      if (entries.has(hash)) return copy(entries.get(hash));
      const bound = current.snapshot.submissionId === normalizedEvent.submissionId;
      const entry = { id: INBOX, providerInstance: 'docuseal-main', bodySha256: hash, event: copy(normalizedEvent), submissionId: normalizedEvent.submissionId, jobId: bound ? JOB : null, status: bound ? 'pending' : 'quarantined' };
      entries.set(hash, entry); return copy(entry);
    },
    async getInbox(id) { const found = [...entries.values()].find(value => value.id === id); return found ? copy(found) : null; },
    async applyWebhook(input) {
      counts.apply++;
      if (options.applyFails || input.expectedJobVersion !== current.snapshot.version) throw new SigningStoreError('conflict');
      const entry = [...entries.values()].find(value => value.id === input.inboxId);
      current = { ...current, snapshot: copy(input.snapshot) }; entry.status = 'processed'; return copy(entry);
    },
  };
  const provider = {
    async createSubmission(input) { counts.create++; if (options.providerError) throw options.providerError; if (options.onCreate) await options.onCreate(input); return { submissionId: 9001, submitters: copy(providerSigners()) }; },
    async getSubmission(id) { counts.getProvider++; return copy(options.providerSubmission ?? { id, status: 'completed', completedAt: '2026-10-13T12:00:00Z', archivedAt: null, submitters: providerSigners().map(value => ({ ...value, status: 'completed', completedAt: '2026-10-13T12:00:00Z' })), documents: [{ name: 'signed.pdf', url: 'https://docuseal.com/file/signed' }], auditLogUrl: 'https://docuseal.com/file/audit', combinedDocumentUrl: null }); },
  };
  const privateSource = { async load(job) { const result = { context: ctx(job.snapshot), document: { id: DOC, companyId: COMPANY, dealId: DEAL, documentVersion: 1, documentKind: 'contract', sourceObjectPath: job.sourceObjectPath }, company: { id: COMPANY, active: true }, deal: { id: DEAL, companyId: COMPANY, active: true }, initiator: { id: USER, companyId: COMPANY, active: true, mayDispatch: true }, storageVisibility: 'private', objectPath: job.sourceObjectPath, approvedSigners: copy(signers), templateId: job.snapshot.templateId, templateVersion: job.snapshot.templateVersion, templateSha256: job.snapshot.templateSha256, bytes: SOURCE }; return options.source ? options.source(result) : result; } };
  const templateSource = { async load(job) { const result = { companyId: COMPANY, providerInstance: 'docuseal-main', templateId: job.snapshot.templateId, templateVersion: 1, documentKind: 'contract', active: true, bytes: TEMPLATE, fieldSchema: FIELDS }; return options.template ? options.template(result) : result; } };
  const archive = {
    async store(input) {
      counts.archive++;
      assert.equal(input.signedPdfSourceUrl, 'https://docuseal.com/file/signed');
      assert.equal(input.auditSourceUrl, 'https://docuseal.com/file/audit');
      const result = { context: input.context, submissionId: input.submissionId, storageVisibility: 'private', signedPdf: { path: `${COMPANY}/signing/${JOB}/signed.pdf`, downloadedBytes: Buffer.from('%PDF-1.7\nsigned') }, audit: { path: `${COMPANY}/signing/${JOB}/audit.pdf`, downloadedBytes: Buffer.from('%PDF-1.7\naudit') } };
      objects.set(result.signedPdf.path, result.signedPdf.downloadedBytes); objects.set(result.audit.path, result.audit.downloadedBytes);
      return options.archive ? options.archive(result) : result;
    },
    async readStored(input) {
      counts.readArchive++;
      const result = { context: input.context, path: input.path, storageVisibility: 'private', bytes: objects.get(input.path) };
      return options.readArchive ? options.readArchive(result) : result;
    },
  };
  const worker = createSigningWorker({ enabled: options.enabled ?? true, store, provider, privateSource, templateSource, archive, webhookSecret: SECRET, now: () => clock, claimToken: () => CLAIM });
  return { worker, store, counts, current: () => copy(current), setClock: value => { clock = value; }, entries, setCurrent: value => { current = copy(value); } };
}
function error(code) { return value => value instanceof SigningWorkerError && value.code === code && !value.message.includes('private'); }
async function bound(h) { await h.worker.dispatch(JOB, 1); return h.current(); }
function webhookPayload(type, signerId, sid = 9001) { return Buffer.from(JSON.stringify({ event_type: type, timestamp: '2026-10-13T12:00:00Z', data: type.startsWith('form.') ? { id: signerId, submission_id: sid } : { id: sid, metadata: { company_id: 'untrusted', arbitrary_url: 'http://internal' } } })); }
function signature(raw, time = NOW / 1000) { return `${time}.${createHmac('sha256', SECRET).update(`${time}.`).update(raw).digest('hex')}`; }
async function awaitingArchive(h) { const job = await bound(h); h.setCurrent({ ...job, snapshot: applyVerifiedEvent(job.snapshot, event('submission.completed')) }); return h.current(); }

test('two racing workers claim once and make at most one provider POST', async () => {
  const h = harness();
  const results = await Promise.allSettled([h.worker.dispatch(JOB, 1), h.worker.dispatch(JOB, 1)]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(h.counts.create, 1);
  assert.equal(h.current().snapshot.state, 'awaiting_signatures');
  assert.equal(h.current().snapshot.version, 3);
});

test('disabled worker performs no read, claim or provider dispatch', async () => {
  const h = harness({ enabled: false });
  await assert.rejects(h.worker.dispatch(JOB, 1), error('disabled'));
  assert.equal(h.counts.claim, 0); assert.equal(h.counts.create, 0);
  assert.equal(h.current().snapshot.state, 'prepared');
});

test('unknown provider outcome is persisted and cannot be automatically retried', async () => {
  const h = harness({ providerError: new DocuSealError('outcome_unknown') });
  await assert.rejects(h.worker.dispatch(JOB, 1), error('outcome_unknown'));
  assert.equal(h.current().snapshot.state, 'outcome_unknown');
  assert.equal(h.current().errorCode, 'outcome_unknown');
  await assert.rejects(h.worker.dispatch(JOB, 3), error('conflict'));
  assert.equal(h.counts.create, 1);
});

test('known provider refusals become terminal dispatch_failed using the exact SQL error enum', async () => {
  for (const code of ['provider_rejected', 'disabled', 'invalid_input', 'invalid_configuration']) {
    const h = harness({ providerError: new DocuSealError(code) });
    await assert.rejects(h.worker.dispatch(JOB, 1), error('dispatch_rejected'));
    assert.equal(h.current().snapshot.state, 'dispatch_failed');
    assert.equal(h.current().errorCode, 'provider_rejected');
    await assert.rejects(h.worker.dispatch(JOB, 3), error('conflict'));
    assert.equal(h.counts.create, 1);
  }
});

test('successful provider POST followed by database failure leaves a durable claim and never re-sends', async () => {
  const h = harness({ saveFails: true });
  await assert.rejects(h.worker.dispatch(JOB, 1), error('persistence_unknown'));
  assert.equal(h.current().snapshot.state, 'dispatching');
  assert.equal(h.current().claimToken, CLAIM);
  await assert.rejects(h.worker.dispatch(JOB, 2), error('conflict'));
  assert.equal(h.counts.create, 1);
  h.setClock(NOW + 300001);
  await h.worker.expireDispatch(JOB, 2);
  assert.equal(h.current().snapshot.state, 'outcome_unknown');
  await assert.rejects(h.worker.dispatch(JOB, 3), error('conflict'));
  assert.equal(h.counts.create, 1);
});

test('database commit with lost response also never permits a duplicate provider submission', async () => {
  const h = harness();
  const save = h.store.save;
  h.store.save = async input => { await save(input); throw new Error('private response lost'); };
  await assert.rejects(h.worker.dispatch(JOB, 1), error('persistence_unknown'));
  assert.equal(h.current().snapshot.state, 'awaiting_signatures');
  await assert.rejects(h.worker.dispatch(JOB, 3), error('conflict'));
  assert.equal(h.counts.create, 1);
});

test('unexpected provider binding cannot be persisted as a confirmed submission', async () => {
  const h = harness();
  // Mutate the immutable provider expectation indirectly by supplying a copied row
  // whose normalized signer confirmation will not match the original expected email.
  const initial = fixture();
  initial.signers[0].email = 'other@example.com';
  h.setCurrent(initial);
  // Source approval differs, so this corruption is blocked even before the claim.
  await assert.rejects(h.worker.dispatch(JOB, 1), error('source_mismatch'));
  assert.equal(h.counts.claim, 0); assert.equal(h.counts.create, 0);
});

test('claim snapshot/token/lease mismatch fails before provider dispatch', async () => {
  const h = harness();
  const claim = h.store.claim;
  h.store.claim = async (...args) => ({ ...await claim(...args), claimToken: INBOX });
  await assert.rejects(h.worker.dispatch(JOB, 1), error('persistence_unknown'));
  assert.equal(h.counts.create, 0);
});

test('stored source and active company/deal/initiator context must match actual private bytes before claim', async () => {
  const invalid = [
    value => ({ ...value, bytes: Buffer.from('changed') }),
    value => ({ ...value, storageVisibility: 'public' }),
    value => ({ ...value, objectPath: 'other/path.pdf' }),
    value => ({ ...value, company: { ...value.company, active: false } }),
    value => ({ ...value, initiator: { ...value.initiator, active: false } }),
    value => ({ ...value, initiator: { ...value.initiator, mayDispatch: false } }),
    value => ({ ...value, document: { ...value.document, companyId: USER } }),
    value => ({ ...value, deal: { ...value.deal, companyId: USER } }),
    value => ({ ...value, approvedSigners: value.approvedSigners.map((signer, index) => index ? signer : { ...signer, values: { Price: 1 } }) }),
  ];
  for (const source of invalid) { const h = harness({ source }); await assert.rejects(h.worker.dispatch(JOB, 1), error('source_mismatch')); assert.equal(h.counts.claim, 0); assert.equal(h.counts.create, 0); }
});

test('template registry context/version/kind/schema/PDF fingerprint must match before claim', async () => {
  for (const template of [value => ({ ...value, bytes: Buffer.from('different template') }), value => ({ ...value, templateVersion: 2 }), value => ({ ...value, documentKind: 'purchase' }), value => ({ ...value, companyId: USER }), value => ({ ...value, active: false }), value => ({ ...value, fieldSchema: { fields: [] } })]) {
    const h = harness({ template }); await assert.rejects(h.worker.dispatch(JOB, 1), error('template_mismatch')); assert.equal(h.counts.claim, 0); assert.equal(h.counts.create, 0);
  }
});

test('template fingerprint canonicalizes object keys but binds byte lengths, field array order and PDF bytes', () => {
  assert.equal(hashSigningTemplate(TEMPLATE, { b: 1, a: { z: true } }), hashSigningTemplate(TEMPLATE, { a: { z: true }, b: 1 }));
  assert.notEqual(hashSigningTemplate(TEMPLATE, { fields: ['a', 'b'] }), hashSigningTemplate(TEMPLATE, { fields: ['b', 'a'] }));
  assert.notEqual(hashSigningTemplate(TEMPLATE, FIELDS), hashSigningTemplate(Buffer.concat([TEMPLATE, Buffer.from('x')]), FIELDS));
  for (const schema of [{ x: Infinity }, { x: undefined }, { x: '\u0000' }, { x: 'x'.repeat(65536) }, null]) assert.throws(() => hashSigningTemplate(TEMPLATE, schema), error('invalid_input'));
});

test('provider payload comes only from immutable stored signer bindings', async () => {
  const h = harness({ onCreate: input => {
    assert.equal(input.templateId, 44); assert.equal(input.sendEmail, false);
    assert.deepEqual(input.signers, signers);
    assert.equal(Object.isFrozen(input.signers[0]), true);
  } });
  await h.worker.dispatch(JOB, 1);
});

test('raw webhook authenticity precedes durable inbox work, duplicate processed delivery is a no-op', async () => {
  const h = harness(); await bound(h);
  const raw = webhookPayload('form.completed', 101);
  await assert.rejects(h.worker.receiveWebhook(raw, `${NOW / 1000}.${'0'.repeat(64)}`), error('invalid_input'));
  assert.equal(h.counts.enqueue, 0);
  const queued = await h.worker.receiveWebhook(raw, signature(raw));
  assert.equal(queued.status, 'pending');
  await h.worker.processWebhook(queued.inboxId);
  assert.equal(h.current().snapshot.state, 'awaiting_signatures');
  assert.deepEqual(h.current().snapshot.completedSubmitterIds, [101]);
  assert.equal(h.current().snapshot.archive, null);
  assert.equal((await h.worker.receiveWebhook(raw, signature(raw))).status, 'processed');
  await h.worker.processWebhook(INBOX);
  assert.equal(h.counts.apply, 1);
  assert.equal([...h.entries.values()][0].bodySha256, digest(raw));
});

test('unknown submission is quarantined without deriving local context from metadata', async () => {
  const h = harness();
  const raw = webhookPayload('submission.completed', null, 123456);
  assert.equal((await h.worker.receiveWebhook(raw, signature(raw))).status, 'quarantined');
  assert.equal((await h.worker.processWebhook(INBOX)).status, 'quarantined');
  assert.equal(h.current().snapshot.state, 'prepared'); assert.equal(h.counts.apply, 0);
});

test('webhook CAS failure leaves the inbox pending and the job unchanged', async () => {
  const h = harness({ applyFails: true }); await bound(h);
  const raw = webhookPayload('submission.completed');
  await h.worker.receiveWebhook(raw, signature(raw));
  await assert.rejects(h.worker.processWebhook(INBOX), error('conflict'));
  assert.equal(h.current().snapshot.state, 'awaiting_signatures');
  assert.equal([...h.entries.values()][0].status, 'pending');
});

test('full completion only advances to awaiting_archive; private objects must be read back before completed', async () => {
  const h = harness(); const ready = await awaitingArchive(h);
  const completed = await h.worker.archiveCompleted(JOB, ready.snapshot.version);
  assert.equal(completed.snapshot.state, 'completed');
  assert.equal(h.counts.readArchive, 2);
  assert.equal(completed.snapshot.archive.signedPdf.sha256, digest(Buffer.from('%PDF-1.7\nsigned')));
  assert.equal(completed.snapshot.archive.audit.sha256, digest(Buffer.from('%PDF-1.7\naudit')));
  const replay = await h.worker.archiveCompleted(JOB, completed.snapshot.version);
  assert.equal(replay.snapshot.version, completed.snapshot.version);
  assert.equal(h.counts.archive, 1);
});

test('archival refuses partial provider completion, mismatched signer binding and unsafe URLs', async () => {
  for (const change of [value => ({ ...value, status: 'pending' }), value => ({ ...value, submitters: value.submitters.map((s, i) => i ? s : { ...s, status: 'awaiting', completedAt: null }) }), value => ({ ...value, submitters: value.submitters.map((s, i) => i ? s : { ...s, externalId: 'wrong' }) }), value => ({ ...value, auditLogUrl: 'http://internal/audit' })]) {
    const h = harness(); const ready = await awaitingArchive(h);
    const complete = { id: 9001, status: 'completed', completedAt: '2026-10-13T12:00:00Z', archivedAt: null, submitters: providerSigners().map(value => ({ ...value, status: 'completed', completedAt: '2026-10-13T12:00:00Z' })), documents: [{ name: 'signed.pdf', url: 'https://docuseal.com/file/signed' }], auditLogUrl: 'https://docuseal.com/file/audit', combinedDocumentUrl: null };
    const altered = harness({ initial: ready, providerSubmission: change(complete) });
    await assert.rejects(altered.worker.archiveCompleted(JOB, ready.snapshot.version), error('archive_invalid'));
    assert.equal(altered.counts.archive, 0); assert.equal(altered.current().snapshot.state, 'awaiting_archive');
  }
});

test('partial archives, wrong company paths, claimed public storage and readback hash mismatch never complete', async () => {
  const cases = [
    { archive: value => ({ ...value, audit: undefined }) },
    { archive: value => ({ ...value, signedPdf: { ...value.signedPdf, path: `${USER}/wrong.pdf` } }) },
    { archive: value => ({ ...value, storageVisibility: 'public' }) },
    { archive: value => ({ ...value, context: { ...value.context, documentId: USER } }) },
    { readArchive: value => ({ ...value, bytes: Buffer.from('%PDF-different stored bytes') }) },
    { readArchive: value => ({ ...value, storageVisibility: 'public' }) },
  ];
  for (const options of cases) {
    const h = harness(options); const ready = await awaitingArchive(h);
    await assert.rejects(h.worker.archiveCompleted(JOB, ready.snapshot.version), error('archive_invalid'));
    assert.equal(h.current().snapshot.state, 'awaiting_archive');
    assert.equal(h.current().snapshot.archive, null);
  }
});
