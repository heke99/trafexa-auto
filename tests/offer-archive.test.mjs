import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { createSourceLoader } from './helpers/source-loader.mjs';

const COMPANY = '10000000-0000-4000-8000-000000000001';
const OFFER = '20000000-0000-4000-8000-000000000002';
const DEAL = '30000000-0000-4000-8000-000000000003';
const USER = '40000000-0000-4000-8000-000000000004';
const NONCE = '50000000-0000-4000-8000-000000000005';
const DOCUMENT = '60000000-0000-4000-8000-000000000006';
const HASH = 'a'.repeat(64);
const INPUT = { companyId: COMPANY, offerId: OFFER, submissionId: NONCE };
const PDF = Buffer.from('%PDF-1.7\nimmutable Price=1000');
const digest = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const loader = await createSourceLoader();
const { archiveStoredOffer, createOfferArchiveRegistrationClient, OfferArchiveError, parseOfferArchiveProof } = loader.load('./src/lib/documents/offer-archive');
function snapshot() { return { schema_version: 1, document_type: 'offer', version: 1, deal_id: DEAL, issued_at: '2026-10-13T12:00:00Z', valid_until: '2026-11-12', terms: 'Betalning före leverans.', currency: 'SEK', price_basis: 'gross', sale_price_ore: '100000', company: { id: COMPANY, name: 'Trafexa Test AB', organisation_number: '5560000001' }, customer: { id: USER, kind: 'person', name: 'Test Buyer', email: 'test@example.com', phone: null, address: null }, stock: { id: OFFER, vat_scheme: 'standard' }, vehicle: { id: DEAL, registration_number: 'ABC123', vin: null, make: 'Volvo', model: 'XC90', model_year: 2026, mileage_km: 100, fuel: 'hybrid', gearbox: 'automatic' }, vat: { rate_percent: 25, amount_ore: '20000', net_price_ore: '80000' } }; }
const source = () => ({ company_id: COMPANY, offer_id: OFFER, deal_id: DEAL, offer_version: 1, snapshot: snapshot(), snapshot_sha256: HASH, document_name: 'Offert v1 – ABC123', document_kind: 'other', storage_bucket: 'dealer-documents', storage_visibility: 'private' });
function proof(bytes = PDF) { const sha = digest(bytes); return { company_id: COMPANY, offer_id: OFFER, deal_id: DEAL, offer_version: 1, pdf_sha256: sha, snapshot_sha256: HASH, object_path: `${COMPANY}/offers/${OFFER}/v1/${sha}.pdf`, document_id: DOCUMENT, document_name: 'Offert v1 – ABC123', document_kind: 'other', storage_bucket: 'dealer-documents', storage_visibility: 'private', submission_id: NONCE, archived_by: USER, created_at: '2026-10-13T12:00:00Z' }; }
const matches = code => error => error instanceof OfferArchiveError && error.code === code && !error.message.includes('private provider');
function harness(options = {}) {
  let stored = options.existing ? proof(options.bytes ?? PDF) : null;
  const objects = new Map();
  if (stored) objects.set(stored.object_path, options.bytes ?? PDF);
  const counts = { authorize: 0, source: 0, lookup: 0, render: 0, upload: 0, download: 0, register: 0, created: 0 };
  const deps = {
    timeoutMs: options.timeoutMs ?? 50,
    async authorize() { counts.authorize++; return { companyId: COMPANY, userId: USER, role: options.role ?? 'owner', companyActive: options.companyActive ?? true, membershipActive: true, ...options.auth }; },
    async getSource() { counts.source++; return options.source ? options.source(source()) : source(); },
    async getArchive() { counts.lookup++; if (options.privateRace && counts.lookup > 1) throw new OfferArchiveError('forbidden'); return stored ? clone(stored) : null; },
    async generatePdf(value, offerId) { counts.render++; assert.equal(offerId, OFFER); assert.equal(value.sale_price_ore, '100000'); assert.equal(Object.isFrozen(value), true); if (options.renderStalls) return new Promise(() => {}); return options.bytes ?? PDF; },
    async upload(path, bytes) {
      counts.upload++;
      if (objects.has(path)) throw new Error('Duplicate');
      if (!options.uploadFails) objects.set(path, options.corruptUpload ? Buffer.from('%PDF-corrupt') : Buffer.from(bytes));
      if (options.uploadFails || options.uploadResponseLost) throw new Error('private provider details');
    },
    async download(path) { counts.download++; if (options.corruptRead) return Buffer.from('%PDF-corrupted after upload'); if (!objects.has(path)) throw new Error('private provider missing object'); return objects.get(path); },
    async register(input) {
      counts.register++;
      assert.equal(input.snapshotSha256, HASH); assert.equal(input.pdfSha256, digest(options.bytes ?? PDF));
      if (options.registerFails) throw new Error('private provider registration failed');
      if (!stored) { stored = proof(options.bytes ?? PDF); stored.submission_id = input.submissionId; counts.created++; }
      if (options.responseLost) throw new Error('private provider response lost');
      return clone(stored);
    },
  };
  return { deps, counts, objects, stored: () => clone(stored) };
}

test('only the stored immutable offer is rendered, uploaded, verified and registered as ordinary other document', async () => {
  const h = harness(); const result = await archiveStoredOffer(INPUT, h.deps);
  assert.equal(result.documentId, DOCUMENT); assert.equal(result.documentKind, 'other');
  assert.equal(result.pdfSha256, digest(PDF)); assert.equal(result.snapshotSha256, HASH);
  assert.equal(h.counts.created, 1); assert.equal(h.counts.render, 1); assert.equal(h.counts.register, 1);
  assert.ok(h.counts.download >= 2);
});

test('production renderer produces a real original offer PDF from the stored snapshot', async () => {
  const h = harness({ timeoutMs: 5000 }); delete h.deps.generatePdf;
  let registered;
  h.deps.register = async input => { registered = { ...proof(PDF), pdf_sha256: input.pdfSha256, object_path: input.objectPath }; return registered; };
  h.deps.getArchive = async () => registered ?? null;
  const result = await archiveStoredOffer(INPUT, h.deps);
  const pdf = await PDFDocument.load(h.objects.get(result.objectPath));
  assert.equal(pdf.getTitle(), 'Offert v1 – ABC123');
  assert.equal(pdf.getCreationDate().toISOString(), '2026-10-13T12:00:00.000Z');
});

test('existing original proof is verified without regeneration or current price lookup, even for a new nonce', async () => {
  const h = harness({ existing: true });
  h.deps.generatePdf = async () => { throw new Error('Must not regenerate or read current price'); };
  const result = await archiveStoredOffer({ ...INPUT, submissionId: DOCUMENT }, h.deps);
  assert.equal(result.submissionId, NONCE); assert.equal(result.documentId, DOCUMENT);
  assert.equal(h.counts.upload, 0); assert.equal(h.counts.register, 0);
});

test('bad role/company/active state and client hashes/signer fields fail before source reads or uploads', async () => {
  for (const options of [{ role: 'sales' }, { role: 'viewer' }, { companyActive: false }]) { const h = harness(options); await assert.rejects(archiveStoredOffer(INPUT, h.deps), matches('forbidden')); assert.equal(h.counts.source, 0); }
  const wrong = harness({ auth: { companyId: DEAL } }); await assert.rejects(archiveStoredOffer(INPUT, wrong.deps), matches('company_changed'));
  for (const extra of ['pdfSha256', 'snapshot', 'kind', 'signers', 'price', 'actor']) { const h = harness(); await assert.rejects(archiveStoredOffer({ ...INPUT, [extra]: 'forged' }, h.deps), matches('invalid_input')); assert.equal(h.counts.authorize, 0); }
});

test('foreign source, mismatched offer version, public bucket receipt and forged source identity fail closed', async () => {
  for (const alter of [value => ({ ...value, company_id: USER }), value => ({ ...value, storage_visibility: 'public' }), value => ({ ...value, document_kind: 'contract' }), value => ({ ...value, offer_version: 2 }), value => ({ ...value, snapshot: { ...value.snapshot, company: { ...value.snapshot.company, id: USER } } })]) {
    const h = harness({ source: alter }); await assert.rejects(archiveStoredOffer(INPUT, h.deps), matches('source_invalid')); assert.equal(h.counts.render, 0); assert.equal(h.counts.register, 0);
  }
});

test('corrupt upload or stored original bytes cannot produce an archive registration or success', async () => {
  const upload = harness({ corruptUpload: true }); await assert.rejects(archiveStoredOffer(INPUT, upload.deps), matches('storage_unverified')); assert.equal(upload.counts.register, 0);
  const original = harness({ existing: true, corruptRead: true }); await assert.rejects(archiveStoredOffer(INPUT, original.deps), matches('storage_unverified')); assert.equal(original.counts.register, 0);
});

test('two racing archive attempts preserve one canonical file and one original database artifact', async () => {
  const h = harness();
  const [first, second] = await Promise.all([archiveStoredOffer(INPUT, h.deps), archiveStoredOffer({ ...INPUT, submissionId: DOCUMENT }, h.deps)]);
  assert.equal(first.documentId, second.documentId); assert.equal(first.submissionId, second.submissionId);
  assert.equal(h.objects.size, 1); assert.equal(h.counts.created, 1);
});

test('lost upload and committed registration responses recover only after actual original bytes/proof checks', async () => {
  for (const options of [{ uploadResponseLost: true }, { responseLost: true }]) { const h = harness(options); const result = await archiveStoredOffer(INPUT, h.deps); assert.equal(result.documentId, DOCUMENT); assert.equal(h.counts.created, 1); }
  const unresolved = harness({ registerFails: true }); await assert.rejects(archiveStoredOffer(INPUT, unresolved.deps), matches('persistence_unknown')); assert.equal(unresolved.counts.created, 0);
  const upload = harness({ uploadFails: true }); await assert.rejects(archiveStoredOffer(INPUT, upload.deps), matches('persistence_unknown')); assert.equal(upload.counts.register, 0);
});

test('a bucket becoming public during verification cannot yield archived success', async () => {
  const h = harness({ existing: true, privateRace: true }); await assert.rejects(archiveStoredOffer(INPUT, h.deps), matches('forbidden')); assert.equal(h.counts.register, 0);
});

test('stalled generation is bounded and archive proof rejects foreign paths or contract promotion', async () => {
  const h = harness({ renderStalls: true, timeoutMs: 5 }); await assert.rejects(archiveStoredOffer(INPUT, h.deps), matches('source_invalid')); assert.equal(h.counts.upload, 0);
  for (const row of [{ ...proof(), object_path: `${USER}/file.pdf` }, { ...proof(), document_kind: 'contract' }, { ...proof(), storage_visibility: 'public' }]) assert.throws(() => parseOfferArchiveProof(row, COMPANY, OFFER), matches('source_invalid'));
});

async function actionHarness(options = {}) {
  const core = harness(options), calls = [], invalidations = [];
  const db = {
    auth: { async getUser() { calls.push(['auth']); return { data: { user: { id: USER } }, error: null }; } },
    from(table) {
      const steps = []; calls.push([table, steps]);
      const query = { select(...a) { steps.push(['select', ...a]); return query; }, eq(...a) { steps.push(['eq', ...a]); return query; }, abortSignal() { return query; }, async maybeSingle() { return { data: table === 'memberships' ? { company_id: COMPANY, user_id: USER, role: options.freshRole ?? 'owner', status: 'active' } : { id: COMPANY, status: 'active' }, error: null }; } };
      return query;
    },
    rpc(name, args) {
      calls.push(['rpc', name, args]);
      return { abortSignal(signal) { const control = { signal }; if (name === 'get_offer_archive_source') return core.deps.getSource(args.p_company_id, args.p_offer_id, control).then(data => ({ data, error: null })); if (name === 'get_offer_document_archive') return core.deps.getArchive(args.p_company_id, args.p_offer_id, control).then(data => ({ data, error: null })); if (name === 'register_offer_document_archive') return core.deps.register({ companyId: args.p_company_id, offerId: args.p_offer_id, version: args.p_offer_version, pdfSha256: args.p_pdf_sha256, snapshotSha256: args.p_snapshot_sha256, objectPath: args.p_object_path, submissionId: args.p_submission_id }, control).then(data => ({ data, error: null })); throw new Error('Unexpected RPC'); } };
    },
    storage: { from(bucket) { assert.equal(bucket, 'dealer-documents'); return { async upload(path, bytes, options) { calls.push(['upload', options]); try { await core.deps.upload(path, bytes); return { error: null }; } catch { return { error: { message: 'private provider detail' } }; } }, async download(path, _options, fetchOptions) { assert.equal(fetchOptions.cache, 'no-store'); return { data: new Blob([await core.deps.download(path)], { type: 'application/pdf' }), error: null }; } }; } },
  };
  const actionLoader = await createSourceLoader({ 'node:process': { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: options.missingConfig ? undefined : 'sb_secret_test_server_key' } }, 'next/cache': { revalidatePath: path => invalidations.push(path) }, './company-context': { getActiveCompanyContext: async () => ({ db, company: options.selectedCompany ?? COMPANY, user: USER, role: 'viewer' }) }, '../documents/offer-archive': { ...loader.load('./src/lib/documents/offer-archive'), createOfferArchiveRegistrationClient: config => { if (!config.serviceKey) throw new OfferArchiveError('configuration_missing'); return { register: async payload => { calls.push(['serviceRegister', payload]); return core.deps.register(payload); } }; }, archiveStoredOffer: (input, dependencies) => archiveStoredOffer(input, { ...dependencies, generatePdf: core.deps.generatePdf }) } });
  return { action: actionLoader.load('./src/lib/data/offer-archive-actions').archiveOfferAction, calls, invalidations, core };
}

test('real Server Action rechecks auth/membership instead of cached role, renders/uploads under user RLS and registers through server capability', async () => {
  const h = await actionHarness(); const result = await h.action(INPUT);
  assert.equal(result.ok, true); assert.equal(result.documentId, DOCUMENT); assert.equal(result.status, 'archived');
  assert.deepEqual(h.calls.find(call => call[0] === 'upload')[1], { upsert: false, contentType: 'application/pdf', cacheControl: '0' });
  assert.equal(result.pdfSha256, undefined); assert.equal(result.signingUrl, undefined);
  assert.deepEqual(h.invalidations, ['/documents', '/deals']);
  const registered = h.calls.find(call => call[0] === 'serviceRegister');
  assert.equal(registered[1].submissionId, NONCE); assert.equal(registered[1].snapshotSha256, HASH); assert.equal(registered[1].actorUserId, USER);
  assert.equal(h.calls.some(call => call[0] === 'rpc' && call[1] === 'register_offer_document_archive'), false);
});

test('missing server registration configuration stops before rendering/upload; existing original proof remains readable', async () => {
  const missing = await actionHarness({ missingConfig: true });
  const result = await missing.action(INPUT);
  assert.equal(result.ok, false); assert.match(result.message, /inte konfigurerad/);
  assert.equal(missing.core.counts.render, 0); assert.equal(missing.core.counts.upload, 0);
  const replay = await actionHarness({ missingConfig: true, existing: true });
  assert.equal((await replay.action(INPUT)).ok, true); assert.equal(replay.core.counts.upload, 0);
});

test('server registration sends modern apikey-only or legacy service-role headers and exact derived actor/schema arguments', async () => {
  const registration = { companyId: COMPANY, offerId: OFFER, version: 1, pdfSha256: digest(PDF), snapshotSha256: HASH, objectPath: proof().object_path, submissionId: NONCE, actorUserId: USER };
  const legacy = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"role":"service_role"}').toString('base64url')}.${Buffer.alloc(32).toString('base64url')}`;
  for (const serviceKey of ['sb_secret_test_server_key', legacy]) {
    const calls = [];
    const client = createOfferArchiveRegistrationClient({ supabaseUrl: 'https://project.supabase.co', serviceKey, fetchImpl: async (url, options) => { calls.push({ url, ...options }); return Response.json(proof()); } });
    await client.register(registration);
    assert.equal(calls[0].url, 'https://project.supabase.co/rest/v1/rpc/register_offer_document_archive');
    assert.equal(calls[0].headers.apikey, serviceKey);
    assert.equal(calls[0].headers.Authorization, serviceKey.startsWith('sb_secret_') ? undefined : `Bearer ${legacy}`);
    assert.equal(calls[0].redirect, 'error'); assert.equal(calls[0].cache, 'no-store');
    assert.deepEqual(JSON.parse(calls[0].body), { p_company_id: COMPANY, p_offer_id: OFFER, p_offer_version: 1, p_pdf_sha256: digest(PDF), p_snapshot_sha256: HASH, p_object_path: proof().object_path, p_submission_id: NONCE, p_actor_user_id: USER });
  }
  for (const serviceKey of ['', 'sb_publishable_client_key', 'invalid']) assert.throws(() => createOfferArchiveRegistrationClient({ supabaseUrl: 'https://project.supabase.co', serviceKey }), matches('configuration_missing'));
});

test('service timeout, invalid responses and raw errors are unknown outcomes without secrets or automatic retries', async () => {
  const registration = { companyId: COMPANY, offerId: OFFER, version: 1, pdfSha256: digest(PDF), snapshotSha256: HASH, objectPath: proof().object_path, submissionId: NONCE, actorUserId: USER };
  for (const result of [() => new Promise(() => {}), () => new Response('{broken'), () => { throw new Error('private provider key'); }]) {
    let calls = 0;
    const client = createOfferArchiveRegistrationClient({ supabaseUrl: 'https://project.supabase.co', serviceKey: 'sb_secret_test_only', timeoutMs: 5, fetchImpl: async () => { calls++; return result(); } });
    await assert.rejects(client.register(registration), matches('persistence_unknown')); assert.equal(calls, 1);
  }
});

test('real Server Action rejects stale company or newly revoked role and never leaks underlying errors', async () => {
  const stale = await actionHarness({ selectedCompany: DEAL }); assert.equal((await stale.action(INPUT)).ok, false); assert.equal(stale.core.counts.register, 0);
  const revoked = await actionHarness({ freshRole: 'viewer' }); assert.equal((await revoked.action(INPUT)).ok, false); assert.equal(revoked.core.counts.source, 0);
  const broken = await actionHarness({ registerFails: true }); const result = await broken.action(INPUT); assert.equal(result.ok, false); assert.doesNotMatch(result.message, /private provider/); assert.equal(result.documentId, undefined);
});
