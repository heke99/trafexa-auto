import test from 'node:test';
import assert from 'node:assert/strict';
import { createSigningJob, startDispatch } from '../../src/lib/documents/signing-state.ts';
import { createSigningStore, parseStoredSigningJob, SigningStoreError } from '../../src/lib/documents/signing-store.ts';

const ID = '10000000-0000-4000-8000-000000000001';
const COMPANY = '20000000-0000-4000-8000-000000000002';
const DOC = '30000000-0000-4000-8000-000000000003';
const USER = '40000000-0000-4000-8000-000000000004';
const CLAIM = '50000000-0000-4000-8000-000000000005';
const INBOX = '60000000-0000-4000-8000-000000000006';
const SECRET = 'sb_secret_private_server_key';
const SIGNERS = [{ role: 'Buyer', email: 'buyer@example.com', externalId: 'buyer-1', values: { Price: 1000, Notes: 'multiline\ntext' } }];
const SOURCE = 'a'.repeat(64);
const TEMPLATE = 'b'.repeat(64);
function snapshot() { return createSigningJob({ id: ID, companyId: COMPANY, documentId: DOC, dealId: null, documentVersion: 1, sourceSha256: SOURCE, templateId: 44, templateVersion: 1, templateSha256: TEMPLATE, expectedSignerExternalIds: ['buyer-1'] }); }
function row(overrides = {}) { const value = overrides.snapshot ?? snapshot(); return { id: ID, company_id: COMPANY, document_id: DOC, deal_id: null, document_version: 1, source_sha256: SOURCE, source_object_path: `${COMPANY}/source.pdf`, template_id: 44, template_version: 1, template_sha256: TEMPLATE, document_kind: 'purchase', created_by: USER, provider_instance: 'docuseal-main', provider_submission_id: value.submissionId, state: value.state, version: value.version, snapshot: value, signers: SIGNERS, claim_token: null, claim_expires_at: null, error_code: null, sensitive_provider_detail: SECRET, ...overrides }; }
const EVENT = { eventType: 'submission.completed', occurredAt: '2026-10-13T12:00:00Z', entity: 'submission', submissionId: 9001, submitterId: null };
const inbox = (overrides = {}) => ({ id: INBOX, provider_instance: 'docuseal-main', body_sha256: SOURCE, event: EVENT, provider_submission_id: 9001, job_id: ID, status: 'pending', ...overrides });
function harness(sequence, overrides = {}) {
  const calls = [];
  const store = createSigningStore({ supabaseUrl: 'https://project.supabase.co', serviceKey: SECRET, timeoutMs: 50, fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), ...options });
    const result = sequence.shift();
    assert.notEqual(result, undefined, 'Unexpected fetch');
    if (result instanceof Error) throw result;
    if (typeof result === 'function') return result(url, options);
    return Response.json(result);
  }, ...overrides });
  return { store, calls };
}
const matches = code => value => value instanceof SigningStoreError && value.code === code && !value.message.includes(SECRET);
function legacy(role) { return `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.${Buffer.alloc(32, 3).toString('base64url')}`; }

test('service REST uses secret apikey only, bounded UUID query, no redirects and sanitized immutable snapshots', async () => {
  const { store, calls } = harness([[row()]]);
  const value = await store.getJob(ID);
  assert.equal(calls[0].url.pathname, '/rest/v1/signing_jobs');
  assert.equal(calls[0].url.searchParams.get('id'), `eq.${ID}`);
  assert.equal(calls[0].url.searchParams.get('limit'), '1');
  assert.equal(calls[0].headers.apikey, SECRET);
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].redirect, 'error'); assert.equal(calls[0].cache, 'no-store');
  assert.equal(value.sensitive_provider_detail, undefined);
  assert.equal(Object.isFrozen(value.snapshot), true);
  assert.equal(Object.isFrozen(value.signers[0]), true);
});

test('legacy service-role keys use both required headers; publishable and anon keys are rejected', async () => {
  const service = legacy('service_role');
  const h = harness([[]], { serviceKey: service }); await h.store.getJob(ID);
  assert.equal(h.calls[0].headers.apikey, service);
  assert.equal(h.calls[0].headers.Authorization, `Bearer ${service}`);
  for (const serviceKey of ['sb_publishable_public_key', legacy('anon'), 'private\nheader', 'invalid']) assert.throws(() => harness([], { serviceKey }), matches('invalid_configuration'));
});

test('ledger cross-checks all snapshot IDs, versions, source and approved template binding', () => {
  for (const override of [{ company_id: USER }, { document_id: USER }, { template_version: 2 }, { template_sha256: SOURCE }, { source_sha256: TEMPLATE }, { provider_submission_id: 9001 }, { signers: undefined }, { signers: [{ ...SIGNERS[0], externalId: 'unknown' }] }, { source_object_path: `${USER}/source.pdf` }, { state: 'completed' }, { version: 999 }]) assert.throws(() => parseStoredSigningJob(row(override)), matches('invalid_response'));
});

test('claim/save/expired RPCs send exactly SQL argument names and parse one returned object', async () => {
  const started = startDispatch(snapshot());
  const claimed = row({ snapshot: started, claim_token: CLAIM, claim_expires_at: '2026-10-13T12:05:00Z' });
  const { store, calls } = harness([claimed]);
  await store.claim(ID, 1, CLAIM);
  assert.equal(calls[0].url.pathname, '/rest/v1/rpc/claim_signing_job');
  assert.deepEqual(JSON.parse(calls[0].body), { p_job_id: ID, p_expected_version: 1, p_claim_token: CLAIM });
  const save = harness([row()]); await save.store.save({ jobId: ID, expectedVersion: 1, claimToken: null, snapshot: snapshot() });
  assert.deepEqual(JSON.parse(save.calls[0].body), { p_job_id: ID, p_expected_version: 1, p_claim_token: null, p_snapshot: snapshot(), p_error_code: null });
  const expired = harness([claimed]); await expired.store.markExpiredDispatch(ID, 2);
  assert.deepEqual(JSON.parse(expired.calls[0].body), { p_job_id: ID, p_expected_version: 2 });
});

test('service document registration binds approved values and template and preserves original registrant on retry', async () => {
  const input = { companyId: COMPANY, documentId: DOC, documentVersion: 1, sourceSha256: SOURCE, sourceObjectPath: `${COMPANY}/source.pdf`, actorUserId: USER, approvedSigners: SIGNERS, templateId: 44, templateVersion: 1, templateSha256: TEMPLATE };
  const registered = { company_id: COMPANY, document_id: DOC, document_version: 1, source_sha256: SOURCE, source_object_path: input.sourceObjectPath, registered_by: CLAIM, approved_signers: SIGNERS, approved_template_id: 44, approved_template_version: 1, approved_template_sha256: TEMPLATE, created_at: '2026-10-13T12:00:00Z' };
  const { store, calls } = harness([registered]);
  const result = await store.registerDocumentVersion(input);
  assert.equal(result.registeredBy, CLAIM);
  assert.deepEqual(JSON.parse(calls[0].body), { p_company_id: COMPANY, p_document_id: DOC, p_document_version: 1, p_source_sha256: SOURCE, p_source_object_path: input.sourceObjectPath, p_actor_user_id: USER, p_approved_signers: SIGNERS, p_approved_template_id: 44, p_approved_template_version: 1, p_approved_template_sha256: TEMPLATE });
  const altered = harness([{ ...registered, approved_signers: [{ ...SIGNERS[0], values: { Price: 1 } }] }]);
  await assert.rejects(altered.store.registerDocumentVersion(input), matches('invalid_response'));
});

test('webhook RPCs persist only normalized event and body hash and keep job/apply version atomic', async () => {
  const h = harness([inbox(), [inbox()], inbox({ status: 'processed' })]);
  await h.store.enqueue(SOURCE, EVENT);
  assert.deepEqual(JSON.parse(h.calls[0].body), { p_body_sha256: SOURCE, p_event: EVENT });
  await h.store.getInbox(INBOX);
  assert.equal(h.calls[1].url.pathname, '/rest/v1/signing_webhook_inbox');
  await h.store.applyWebhook({ inboxId: INBOX, expectedJobVersion: 1, snapshot: snapshot() });
  assert.deepEqual(JSON.parse(h.calls[2].body), { p_inbox_id: INBOX, p_expected_job_version: 1, p_snapshot: snapshot() });
  const quarantined = harness([inbox({ job_id: null, status: 'quarantined' })]);
  assert.equal((await quarantined.store.enqueue(SOURCE, EVENT)).status, 'quarantined');
});

test('malformed inputs do not reach REST/RPC and malformed rows cannot claim success', async () => {
  const h = harness([]);
  for (const value of ['bad', `${ID},or=(true)`]) await assert.rejects(h.store.getJob(value), matches('invalid_input'));
  await assert.rejects(h.store.claim(ID, 0, CLAIM), matches('invalid_input'));
  await assert.rejects(h.store.save(null), matches('invalid_input'));
  await assert.rejects(h.store.applyWebhook(null), matches('invalid_input'));
  await assert.rejects(h.store.registerDocumentVersion(null), matches('invalid_input'));
  await assert.rejects(h.store.enqueue(SOURCE, { ...EVENT, metadata: { companyId: COMPANY } }), matches('invalid_input'));
  assert.equal(h.calls.length, 0);
  for (const value of [null, {}, [row(), row()], [row({ id: USER })]]) {
    const invalid = harness([value]); await assert.rejects(invalid.store.getJob(ID), matches('invalid_response'));
  }
  for (const result of [inbox({ provider_submission_id: 1 }), inbox({ event: { ...EVENT, submitterId: 1 } }), inbox({ job_id: null, status: 'processed' })]) {
    const invalid = harness([result]); await assert.rejects(invalid.store.enqueue(SOURCE, EVENT), matches('invalid_response'));
  }
});

test('CAS, permission, provider, malformed response, oversized body and timeout failures are sanitized', async () => {
  for (const [result, code] of [
    [() => Response.json({ code: '40001', message: SECRET }, { status: 409 }), 'conflict'],
    [() => Response.json({ code: '42501', message: SECRET }, { status: 403 }), 'forbidden'],
    [() => Response.json({ message: SECRET }, { status: 503 }), 'unavailable'],
    [new Error(SECRET), 'unavailable'],
    [() => new Response('{invalid'), 'invalid_response'],
    [() => new Response('x'.repeat(1024 * 1024 + 1)), 'invalid_response'],
    [() => new Promise(() => {}), 'unavailable'],
  ]) {
    const h = harness([result], { timeoutMs: 5 }); await assert.rejects(h.store.getJob(ID), matches(code));
  }
});

test('configuration denies non-HTTPS, credentials, query/hash/path and invalid timeout', () => {
  for (const config of [{ supabaseUrl: 'http://project.supabase.co' }, { supabaseUrl: 'https://user:pass@host' }, { supabaseUrl: 'https://host?x=1' }, { supabaseUrl: 'https://host#fragment' }, { supabaseUrl: 'https://host/rest/v1' }, { timeoutMs: 30001 }]) assert.throws(() => harness([], config), matches('invalid_configuration'));
});
