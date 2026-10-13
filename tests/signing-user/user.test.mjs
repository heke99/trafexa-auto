import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSigningJob, startDispatch, dispatchUnknown, bindSubmission, applyVerifiedEvent, completeArchive } from '../../src/lib/signing/signing-state.ts';
import { SigningStoreError } from '../../src/lib/signing/signing-store.ts';
import { createSigningUserBoundary, SigningUserError } from '../../src/lib/signing/signing-user.ts';

const COMPANY = '10000000-0000-4000-8000-000000000001';
const DOC = '20000000-0000-4000-8000-000000000002';
const USER = '30000000-0000-4000-8000-000000000003';
const DEAL = '40000000-0000-4000-8000-000000000004';
const KEY = '50000000-0000-4000-8000-000000000005';
const JOB = '60000000-0000-4000-8000-000000000006';
const APPROVAL = '70000000-0000-4000-8000-000000000007';
const TOKEN = 'Bearer verified.user.token';
const PUB = 'sb_publishable_public_key';
const PDF = Buffer.from('%PDF-1.7\napproved original offer Price=1000');
const HASH = createHash('sha256').update(PDF).digest('hex');
const TEMPLATE_HASH = 'b'.repeat(64);
const SIGNERS = [{ role: 'Buyer', email: 'buyer@example.com', externalId: 'buyer-1', values: { Price: 1000, Notes: 'multiple\nlines' } }];
const INPUT = { companyId: COMPANY, documentId: DOC, documentVersion: 1, templateId: 44, idempotencyKey: KEY };
const copy = value => structuredClone(value);
const error = code => value => value instanceof SigningUserError && value.code === code && !value.message.includes(TOKEN) && !value.message.includes('private-key');
function harness(options = {}) {
  const calls = [];
  const registrations = [];
  const readerContexts = [];
  const body = createSigningJob({ id: JOB, companyId: COMPANY, documentId: DOC, dealId: options.purchase ? null : DEAL, documentVersion: 1, sourceSha256: HASH, templateId: 44, templateVersion: 1, templateSha256: TEMPLATE_HASH, expectedSignerExternalIds: ['buyer-1'] });
  const row = { id: JOB, company_id: COMPANY, document_id: DOC, deal_id: body.dealId, document_version: 1, source_sha256: HASH, source_object_path: `${COMPANY}/${DOC}.pdf`, template_id: 44, template_version: 1, template_sha256: TEMPLATE_HASH, document_kind: options.purchase ? 'purchase' : 'contract', created_by: USER, idempotency_key: KEY, provider_instance: 'docuseal-main', provider_submission_id: null, state: 'prepared', version: 1, snapshot: body, signers: SIGNERS, claim_token: null, claim_expires_at: null, error_code: null };
  const config = {
    supabaseUrl: 'https://project.supabase.co', publishableKey: PUB, timeoutMs: 50,
    fetchImpl: async (url, request) => {
      const parsed = new URL(url); calls.push({ url: parsed, ...request });
      if (options.fetchError) throw new Error('private-key-secret');
      if (options.timeout) return new Promise(() => {});
      if (parsed.pathname === '/auth/v1/user') {
        if (options.authStatus) return Response.json({ error: 'private-key-secret' }, { status: options.authStatus });
        return Response.json(options.auth ?? { id: USER, user_metadata: { role: 'owner', id: COMPANY } });
      }
      if (parsed.pathname === '/rest/v1/memberships') return Response.json(options.memberships ?? [{ company_id: COMPANY, user_id: USER, role: options.role ?? 'owner', status: 'active' }]);
      if (parsed.pathname === '/rest/v1/companies') return Response.json(options.companies ?? [{ id: COMPANY, status: 'active' }]);
      if (parsed.pathname === '/rest/v1/documents') return Response.json(options.documents ?? [{ id: DOC, company_id: COMPANY, deal_id: body.dealId, kind: row.document_kind, object_path: row.source_object_path }]);
      if (parsed.pathname === '/rest/v1/deals') return Response.json(options.deals ?? [{ id: DEAL, company_id: COMPANY }]);
      if (parsed.pathname === '/rest/v1/signing_templates') return Response.json(options.templates ?? [{ company_id: COMPANY, provider_instance: 'docuseal-main', template_id: 44, template_version: 1, template_sha256: TEMPLATE_HASH, document_kind: row.document_kind, active: true }]);
      if (parsed.pathname === '/rest/v1/signing_jobs') return Response.json(options.existing ? [options.existing(copy(row))] : []);
      if (parsed.pathname === '/rest/v1/rpc/prepare_signing_job') {
        if (options.prepareConflict) return Response.json({ code: '40001', message: 'private-key-detail' }, { status: 409 });
        if (options.prepareForbidden) return Response.json({ code: '42501', message: 'private-key-detail' }, { status: 403 });
        return Response.json(options.preparedRow ? options.preparedRow(copy(row)) : row);
      }
      throw new Error(`Unexpected route ${parsed.pathname}`);
    },
    approvedRenderReader: { async load(context) {
      readerContexts.push(context);
      assert.equal(Object.isFrozen(context), true);
      const value = { approvalId: APPROVAL, document: { id: DOC, companyId: COMPANY, dealId: body.dealId, documentKind: row.document_kind, documentVersion: 1, sourceObjectPath: row.source_object_path }, storageVisibility: 'private', objectPath: row.source_object_path, bytes: PDF, sourceSha256: HASH, approvedSigners: copy(SIGNERS), templateId: 44, templateVersion: 1, templateSha256: TEMPLATE_HASH };
      if (options.readerThrows) throw new Error('private-key-secret');
      if (options.readerStalls) return new Promise(() => {});
      return options.render ? options.render(value) : value;
    } },
    serviceStore: { async registerDocumentVersion(input) {
      registrations.push(input);
      if (options.registerError) throw new SigningStoreError(options.registerError);
      if (options.registerStalls) return new Promise(() => {});
      const { actorUserId, ...data } = input;
      const result = { ...data, registeredBy: USER, createdAt: '2026-10-13T12:00:00Z' };
      return options.registered ? options.registered(result) : result;
    } },
  };
  const boundary = createSigningUserBoundary({ ...config, ...options.config });
  return { boundary, calls, registrations, readerContexts };
}

test('authenticated owner prepares under user RLS using only approved immutable render values', async () => {
  const h = harness();
  const result = await h.boundary.prepare(TOKEN, INPUT);
  assert.equal(h.calls[0].url.pathname, '/auth/v1/user');
  for (const call of h.calls) { assert.equal(call.headers.apikey, PUB); assert.equal(call.headers.Authorization, TOKEN); assert.equal(call.redirect, 'error'); assert.equal(call.cache, 'no-store'); }
  const membership = h.calls.find(call => call.url.pathname.endsWith('/memberships'));
  assert.equal(membership.url.searchParams.get('user_id'), `eq.${USER}`);
  assert.equal(h.registrations[0].actorUserId, USER);
  assert.equal(h.registrations[0].sourceSha256, HASH);
  assert.deepEqual(h.registrations[0].approvedSigners, SIGNERS);
  const rpc = h.calls.find(call => call.url.pathname.endsWith('/prepare_signing_job'));
  assert.deepEqual(JSON.parse(rpc.body), { p_company_id: COMPANY, p_document_id: DOC, p_deal_id: DEAL, p_document_version: 1, p_source_sha256: HASH, p_template_id: 44, p_signers: SIGNERS, p_idempotency_key: KEY, p_expected_template_version: 1, p_expected_template_sha256: TEMPLATE_HASH });
  assert.equal(result.snapshot.id, JOB);
  assert.equal(result.signers, undefined); assert.equal(result.token, undefined);
  assert.equal(Object.isFrozen(result.snapshot), true);
  assert.equal(h.registrations.length, 1);
});

test('admin/finance and deal-free purchase contracts are supported', async () => {
  for (const role of ['admin', 'finance']) { const h = harness({ role, purchase: true }); const result = await h.boundary.prepare(TOKEN, INPUT); assert.equal(result.snapshot.dealId, null); assert.equal(h.calls.some(call => call.url.pathname.endsWith('/deals')), false); }
});

test('request cannot override signer values, hash, actor or approved template version', async () => {
  for (const field of ['signers', 'approvedSigners', 'sourceSha256', 'actorUserId', 'price', 'templateSha256', 'templateVersion', 'dealId']) {
    const h = harness(); await assert.rejects(h.boundary.prepare(TOKEN, { ...INPUT, [field]: 'override' }), error('invalid_input')); assert.equal(h.calls.length, 0); assert.equal(h.registrations.length, 0);
  }
  for (const value of [null, [], { ...INPUT, documentVersion: '1' }, { ...INPUT, documentVersion: 2147483648 }, { ...INPUT, companyId: `${COMPANY},or=(true)` }, { ...INPUT, templateId: 1.2 }]) { const h = harness(); await assert.rejects(h.boundary.prepare(TOKEN, value), error('invalid_input')); assert.equal(h.calls.length, 0); }
});

test('invalid/expired/anonymous/unverified identity cannot reach any database lookup or storage', async () => {
  for (const bearer of ['', 'Basic x', 'Bearer bad\nheader']) { const h = harness(); await assert.rejects(h.boundary.prepare(bearer, INPUT), error('unauthenticated')); assert.equal(h.calls.length, 0); }
  for (const options of [{ authStatus: 401 }, { auth: { id: USER, is_anonymous: true } }, { auth: { user_metadata: { id: USER, role: 'owner' } } }]) {
    const h = harness(options); await assert.rejects(h.boundary.prepare(TOKEN, INPUT), error('unauthenticated')); assert.equal(h.calls.length, 1); assert.equal(h.readerContexts.length, 0);
  }
});

test('membership must be active, privileged and match both verified user and requested company', async () => {
  for (const options of [{ role: 'viewer' }, { role: 'sales' }, { memberships: [] }, { memberships: [{ company_id: COMPANY, user_id: DEAL, role: 'owner', status: 'active' }] }, { memberships: [{ company_id: DEAL, user_id: USER, role: 'owner', status: 'active' }] }, { memberships: [{ company_id: COMPANY, user_id: USER, role: 'owner', status: 'inactive' }] }]) {
    const h = harness(options); await assert.rejects(h.boundary.prepare(TOKEN, INPUT), error('forbidden')); assert.equal(h.calls.length, 2); assert.equal(h.readerContexts.length, 0); assert.equal(h.registrations.length, 0);
  }
});

test('company/document/deal tenant checks prevent cross-company storage reads and preparation', async () => {
  const variants = [
    [{ companies: [{ id: COMPANY, status: 'inactive' }] }, 'forbidden'],
    [{ documents: [] }, 'not_found'],
    [{ documents: [{ id: DOC, company_id: DEAL, deal_id: DEAL, kind: 'contract', object_path: `${DEAL}/file.pdf` }] }, 'not_found'],
    [{ documents: [{ id: DOC, company_id: COMPANY, deal_id: null, kind: 'contract', object_path: `${COMPANY}/file.pdf` }] }, 'forbidden'],
    [{ deals: [{ id: DEAL, company_id: USER }] }, 'forbidden'],
    [{ deals: [] }, 'forbidden'],
  ];
  for (const [options, code] of variants) { const h = harness(options); await assert.rejects(h.boundary.prepare(TOKEN, INPUT), error(code)); assert.equal(h.readerContexts.length, 0); assert.equal(h.registrations.length, 0); }
});

test('only active same-company same-kind provider registry templates are read', async () => {
  const base = { company_id: COMPANY, provider_instance: 'docuseal-main', template_id: 44, template_version: 1, template_sha256: TEMPLATE_HASH, document_kind: 'contract', active: true };
  for (const templates of [[], [{ ...base, company_id: DEAL }], [{ ...base, template_id: 45 }], [{ ...base, document_kind: 'purchase' }], [{ ...base, active: false }]]) {
    const h = harness({ templates }); await assert.rejects(h.boundary.prepare(TOKEN, INPUT), error('forbidden')); assert.equal(h.readerContexts.length, 0); assert.equal(h.registrations.length, 0);
  }
});

test('trusted source still must provide exact private PDF bytes/hash and approved render context', async () => {
  for (const render of [
    value => ({ ...value, storageVisibility: 'public' }),
    value => ({ ...value, bytes: Buffer.from('%PDF-1.7\nchanged Price=1') }),
    value => ({ ...value, bytes: Buffer.from('not a PDF'), sourceSha256: createHash('sha256').update('not a PDF').digest('hex') }),
    value => ({ ...value, objectPath: `${USER}/file.pdf` }),
    value => ({ ...value, document: { ...value.document, documentVersion: 2 } }),
    value => ({ ...value, templateVersion: 2 }),
    value => ({ ...value, approvedSigners: [{ ...SIGNERS[0], email: 'invalid' }] }),
    value => ({ ...value, approvedSigners: [{ ...SIGNERS[0], values: { Price: Infinity } }] }),
    value => ({ ...value, approvalId: 'asserted approval' }),
  ]) { const h = harness({ render }); await assert.rejects(h.boundary.prepare(TOKEN, INPUT), error('unverified_source')); assert.equal(h.registrations.length, 0); assert.equal(h.calls.some(call => call.url.pathname.endsWith('/prepare_signing_job')), false); }
});

test('template revision race and post-approval permission revocation remain controlled failures', async () => {
  const race = harness({ prepareConflict: true }); await assert.rejects(race.boundary.prepare(TOKEN, INPUT), error('conflict')); assert.equal(race.registrations.length, 1);
  const revoked = harness({ prepareForbidden: true }); await assert.rejects(revoked.boundary.prepare(TOKEN, INPUT), error('forbidden'));
  const serviceRace = harness({ registerError: 'conflict' }); await assert.rejects(serviceRace.boundary.prepare(TOKEN, INPUT), error('conflict')); assert.equal(serviceRace.calls.some(call => call.url.pathname.endsWith('/prepare_signing_job')), false);
});

test('same-key historical replay returns the original snapshot after active template upgrade without new writes', async () => {
  const upgraded = [{ company_id: COMPANY, provider_instance: 'docuseal-main', template_id: 44, template_version: 2, template_sha256: 'c'.repeat(64), document_kind: 'contract', active: true }];
  const h = harness({ templates: upgraded, existing: row => row });
  const result = await h.boundary.prepare(TOKEN, INPUT);
  assert.equal(result.snapshot.templateVersion, 1);
  assert.equal(result.snapshot.templateSha256, TEMPLATE_HASH);
  assert.equal(h.readerContexts.length, 0); assert.equal(h.registrations.length, 0);
  assert.equal(h.calls.some(call => call.url.pathname.endsWith('/prepare_signing_job')), false);
  assert.equal(h.calls.some(call => call.url.pathname.endsWith('/signing_templates')), false);
  const lookup = h.calls.find(call => call.url.pathname.endsWith('/signing_jobs'));
  assert.equal(lookup.url.searchParams.get('created_by'), `eq.${USER}`);
  assert.equal(lookup.url.searchParams.get('idempotency_key'), `eq.${KEY}`);
  const newKey = harness({ templates: upgraded });
  await assert.rejects(newKey.boundary.prepare(TOKEN, { ...INPUT, idempotencyKey: APPROVAL }), error('unverified_source'));
  assert.equal(newKey.registrations.length, 0);
});

test('historical replay preserves dispatching, unknown and completed state; changed input conflicts', async () => {
  for (const transform of [
    job => startDispatch(job),
    job => dispatchUnknown(startDispatch(job)),
    job => {
      const bound = bindSubmission(startDispatch(job), { context: Object.fromEntries(['id', 'companyId', 'documentId', 'dealId', 'documentVersion', 'sourceSha256', 'templateId', 'templateVersion', 'templateSha256'].map(key => [key, job[key]])), provider: { submissionId: 9001, submitters: [{ id: 101, submissionId: 9001, externalId: 'buyer-1' }] } });
      const archive = applyVerifiedEvent(bound, { eventType: 'submission.completed', entity: 'submission', submissionId: 9001, submitterId: null });
      const context = Object.fromEntries(['id', 'companyId', 'documentId', 'dealId', 'documentVersion', 'sourceSha256', 'templateId', 'templateVersion', 'templateSha256'].map(key => [key, job[key]]));
      return completeArchive(archive, { context, submissionId: 9001, storageVisibility: 'private', signedPdf: { path: `${COMPANY}/signed.pdf`, sha256: HASH }, audit: { path: `${COMPANY}/audit.pdf`, sha256: TEMPLATE_HASH } });
    },
  ]) {
    let state;
    const h = harness({ existing: row => { const snapshot = transform(row.snapshot); state = snapshot.state; return { ...row, snapshot, state: snapshot.state, version: snapshot.version, provider_submission_id: snapshot.submissionId, error_code: snapshot.state === 'outcome_unknown' ? 'outcome_unknown' : null }; } });
    assert.equal((await h.boundary.prepare(TOKEN, INPUT)).snapshot.state, state);
    assert.equal(h.registrations.length, 0);
  }
  const changed = harness({ existing: row => row });
  await assert.rejects(changed.boundary.prepare(TOKEN, { ...INPUT, documentVersion: 2 }), error('conflict'));
  assert.equal(changed.readerContexts.length, 0); assert.equal(changed.registrations.length, 0);
});

test('trusted reader and service registry callbacks have bounded timeouts without advancing to prepare RPC', async () => {
  const stalledReader = harness({ readerStalls: true, config: { timeoutMs: 5 } });
  await assert.rejects(stalledReader.boundary.prepare(TOKEN, INPUT), error('unavailable'));
  assert.equal(stalledReader.registrations.length, 0);
  const stalledRegistry = harness({ registerStalls: true, config: { timeoutMs: 5 } });
  await assert.rejects(stalledRegistry.boundary.prepare(TOKEN, INPUT), error('unavailable'));
  assert.equal(stalledRegistry.registrations.length, 1);
  assert.equal(stalledRegistry.calls.some(call => call.url.pathname.endsWith('/prepare_signing_job')), false);
});

test('service registry confirmation and final row must match the immutable authorized context', async () => {
  const badRegister = harness({ registered: value => ({ ...value, sourceSha256: TEMPLATE_HASH }) });
  await assert.rejects(badRegister.boundary.prepare(TOKEN, INPUT), error('unavailable'));
  assert.equal(badRegister.calls.some(call => call.url.pathname.endsWith('/prepare_signing_job')), false);
  for (const preparedRow of [value => ({ ...value, created_by: DEAL }), value => ({ ...value, idempotency_key: APPROVAL }), value => ({ ...value, signers: [{ ...SIGNERS[0], values: { Price: 1 } }] })]) {
    const h = harness({ preparedRow }); await assert.rejects(h.boundary.prepare(TOKEN, INPUT), error('unavailable'));
  }
});

test('transport/reader errors are sanitized and no configured secret key is accepted as publishable', async () => {
  for (const options of [{ fetchError: true }, { timeout: true, config: { timeoutMs: 5 } }, { readerThrows: true }]) {
    const h = harness(options); await assert.rejects(h.boundary.prepare(TOKEN, INPUT), error('unavailable'));
  }
  for (const config of [{ publishableKey: 'sb_secret_private-key' }, { supabaseUrl: 'http://project.supabase.co' }, { supabaseUrl: 'https://user:pass@project.supabase.co' }, { approvedRenderReader: undefined }]) assert.throws(() => harness({ config }), error('invalid_configuration'));
});
