import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archiveNativeContract, contractArchivePaths, parseContractArchive, parseContractArchiveEnvelope, verifyContractArchiveFiles, NativeContractArchiveError } from '../src/lib/documents/native-contract-archive.ts';
import { parseCompletedContract } from '../src/lib/documents/signed-contract-pdf.ts';
import { completedArchiveSource, digest, archiveId, ARCHIVE_COMPANY as COMPANY, ARCHIVE_SIGNING as SIGNING, ARCHIVE_DEALER as ACTOR, ARCHIVE_REQUEST as REQUEST } from './helpers/native-archive-fixture.mjs';

const input = { companyId: COMPANY, signingId: SIGNING, requestId: REQUEST };
function signing() { const value = completedArchiveSource(); value.draft.actorLabel = 'Du'; return parseCompletedContract(value); }
function pair(source, marker = 'first') {
  const pdf = new TextEncoder().encode(`%PDF-private-unit-${marker}`);
  const evidence = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, method: 'trafexa-simple-electronic-signature', signingId: source.id, draftId: source.draftId, draftVersion: source.draftVersion, documentContentSha256: source.documentHash, signedPdfSha256: digest(pdf), completedAt: source.completedAt, receipts: [source.customerSignature, source.companySignature].map(({ party, fullName, signedAt, documentHash, consentVersion }) => ({ party, fullName, signedAt, documentHash, consentVersion })), assurance: 'Synthetic fixture. No BankID.' }));
  return { pdf, evidence };
}
function proof(source, artifacts) {
  const paths = contractArchivePaths(COMPANY, SIGNING, digest(artifacts.pdf), digest(artifacts.evidence));
  return { id: archiveId(40), signingId: SIGNING, companyId: COMPANY, dealId: source.dealId, draftId: source.draftId, draftVersion: source.draftVersion, documentContentSha256: source.documentHash, signingRevision: 3, rendererVersion: 'trafexa-native-v1', evidenceSchemaVersion: 1, pdf: { objectPath: paths.pdf, sha256: digest(artifacts.pdf), bytes: artifacts.pdf.byteLength, mimeType: 'application/pdf' }, evidence: { objectPath: paths.evidence, sha256: digest(artifacts.evidence), bytes: artifacts.evidence.byteLength, mimeType: 'application/json' }, archivedAt: '2026-10-15T11:00:00Z' };
}
function fixture(options = {}) {
  const source = signing(), generated = pair(source);
  const state = { source, generated, archive: null, objects: new Map(), calls: [], role: 'owner', actorId: ACTOR, companyId: COMPANY, reads: 0, ...options };
  const envelope = () => ({ actorId: state.actorId, companyId: COMPANY, signingId: SIGNING, archive: state.archive });
  function save(artifacts) { const archive = proof(source, artifacts); state.objects.set(archive.pdf.objectPath, artifacts.pdf); state.objects.set(archive.evidence.objectPath, artifacts.evidence); state.archive = archive; return archive; }
  const deps = {
    timeoutMs: 1000,
    async authorize() { state.calls.push('authorize'); if (state.deny) throw Object.assign(new Error('private'), { code: 'access_denied' }); return { companyId: state.companyId, actorId: state.actorId, role: state.role }; },
    async getSigning() { state.calls.push('source'); return structuredClone(state.source); },
    async getArchive() { state.calls.push('archive'); state.reads++; if (state.public) throw new NativeContractArchiveError('access_denied'); state.onArchive?.(state, save); return structuredClone(envelope()); },
    async prepareRegistration() { state.calls.push('prepare'); if (state.noConfiguration) throw new NativeContractArchiveError('configuration_missing'); },
    async generateArtifacts() { state.calls.push('render'); state.onRender?.(state, save); return { pdf: new Uint8Array(state.generated.pdf), evidence: new Uint8Array(state.generated.evidence) }; },
    async upload(path, bytes) { state.calls.push(`upload:${path}`); state.objects.set(path, new Uint8Array(bytes)); state.onUpload?.(state, path); if (state.uploadUnknown) throw Error('response lost'); },
    async download(path) { state.calls.push(`read:${path}`); state.onDownload?.(state, path); const bytes = state.objects.get(path); if (!bytes) throw new NativeContractArchiveError('storage_unverified'); return new Uint8Array(bytes); },
    async register(payload) { state.calls.push('register'); const paths = contractArchivePaths(COMPANY, SIGNING, payload.pdfSha256, payload.evidenceSha256); assert.ok(state.calls.includes(`read:${paths.pdf}`)); assert.ok(state.calls.includes(`read:${paths.evidence}`)); assert.equal(digest(state.objects.get(paths.pdf)), payload.pdfSha256); assert.equal(digest(state.objects.get(paths.evidence)), payload.evidenceSha256); if (!state.archive) save({ pdf: state.objects.get(paths.pdf), evidence: state.objects.get(paths.evidence) }); state.onRegister?.(state, save); if (state.registerUnknown) throw Error('committed response lost'); return structuredClone(envelope()); },
  };
  return { state, deps, save };
}

test('native archive registers only after both exact readbacks and verifies original again after registration', async () => {
  const { state, deps } = fixture(); const result = await archiveNativeContract(input, deps);
  assert.equal(result.id, state.archive.id); assert.equal(result.pdf.sha256, digest(state.generated.pdf));
  assert.equal(state.calls.filter(value => value === 'render').length, 1);
  assert.equal(state.calls.filter(value => value.startsWith('upload:')).length, 2);
  assert.equal(state.calls.filter(value => value.startsWith('read:')).length, 4);
  assert.ok(state.calls.lastIndexOf('authorize') > state.calls.lastIndexOf('register'));
});

test('missing server capability rejects before rendering or uploading while an existing original remains reusable', async () => {
  const first = fixture({ noConfiguration: true });
  await assert.rejects(archiveNativeContract(input, first.deps), { code: 'configuration_missing' });
  assert.ok(!first.state.calls.some(value => value === 'render' || value.startsWith('upload:') || value === 'register'));
  const existing = fixture({ noConfiguration: true }); existing.save(existing.state.generated);
  assert.equal((await archiveNativeContract(input, existing.deps)).id, existing.state.archive.id);
  assert.ok(!existing.state.calls.includes('prepare')); assert.ok(!existing.state.calls.includes('render'));
});

test('upload/registration unknown outcomes recover only a complete verified original', async () => {
  for (const patch of [{ uploadUnknown: true }, { registerUnknown: true }]) {
    const { state, deps } = fixture(patch); const saved = await archiveNativeContract(input, deps);
    assert.equal(saved.pdf.sha256, digest(state.generated.pdf)); assert.equal(saved.id, state.archive.id);
  }
  const missing = fixture(); missing.deps.upload = async () => { throw Error('network'); };
  await assert.rejects(archiveNativeContract(input, missing.deps));
  assert.ok(!missing.state.calls.includes('register'));
  const partial = fixture(); const originalUpload = partial.deps.upload;
  partial.deps.upload = async (path, ...args) => { if (path.endsWith('.json')) throw Error('lost before write'); return originalUpload(path, ...args); };
  await assert.rejects(archiveNativeContract(input, partial.deps));
  assert.equal(partial.state.archive, null); assert.ok(!partial.state.calls.includes('register'));
});

test('racing renderers reuse the registered first winner instead of replacing it with local bytes', async () => {
  for (const stage of ['onRender', 'onRegister']) {
    const other = pair(signing(), 'different-renderer');
    const { state, deps } = fixture({ [stage]: (_state, save) => save(other) });
    const result = await archiveNativeContract(input, deps);
    assert.equal(result.pdf.sha256, digest(other.pdf)); assert.equal(result.evidence.sha256, digest(other.evidence));
    assert.notEqual(result.pdf.sha256, digest(state.generated.pdf));
    assert.equal(state.calls.filter(value => value === 'register').length, stage === 'onRender' ? 0 : 1);
  }
});

test('registered missing/corrupt evidence or PDF never invokes a renderer or registration fallback', async () => {
  for (const kind of ['pdf', 'evidence']) {
    const { state, deps, save } = fixture(); const archive = save(state.generated);
    state.objects.set(archive[kind].objectPath, new TextEncoder().encode('corrupt'));
    await assert.rejects(archiveNativeContract(input, deps), { code: 'storage_unverified' });
    assert.ok(!state.calls.includes('render')); assert.ok(!state.calls.includes('register'));
  }
});

test('revoked scope, public bucket, forged metadata and changed source withhold archived success', async () => {
  for (const onRegister of [state => { state.role = 'finance'; }, state => { state.actorId = archiveId(99); }, state => { state.public = true; }, state => { state.deny = true; }]) {
    const { deps } = fixture({ onRegister }); await assert.rejects(archiveNativeContract(input, deps), error => ['access_denied', 'conflict'].includes(error.code));
  }
  for (const patch of [{ companyId: archiveId(99) }, { role: 'finance' }, { role: 'sales' }]) {
    const { state, deps } = fixture(patch); await assert.rejects(archiveNativeContract(input, deps), { code: 'access_denied' }); assert.ok(!state.calls.includes('render'));
  }
  const malformed = fixture(); malformed.state.source.documentHash = '0'.repeat(64);
  await assert.rejects(archiveNativeContract(input, malformed.deps), { code: 'source_invalid' });
});

test('timeouts are bounded and cannot report success after an upload promise remains pending', async () => {
  const { state, deps } = fixture(); deps.timeoutMs = 15; deps.upload = async (_path, _bytes, _mime, { signal }) => { await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); throw Error('aborted'); };
  await assert.rejects(archiveNativeContract(input, deps)); assert.equal(state.archive, null); assert.ok(!state.calls.includes('register'));
});

test('strict metadata and evidence parsing binds scope, path, lengths and the exact PDF checksum', () => {
  const source = signing(), artifacts = pair(source), archive = proof(source, artifacts);
  assert.deepEqual(verifyContractArchiveFiles(parseContractArchive(archive), artifacts, source), artifacts);
  assert.throws(() => parseContractArchiveEnvelope({ actorId: archiveId(99), companyId: COMPANY, signingId: SIGNING, archive }, { companyId: COMPANY, signingId: SIGNING, actorId: ACTOR }), { code: 'access_denied' });
  for (const mutate of [value => { value.pdf.objectPath += '/foreign'; }, value => { value.pdf.bytes = 51 * 1024 * 1024; }, value => { value.rendererVersion = 'future'; }, value => { value.signingRevision = 2; }]) { const value = structuredClone(archive); mutate(value); assert.throws(() => parseContractArchive(value)); }
  const wrong = JSON.parse(new TextDecoder().decode(artifacts.evidence)); wrong.signedPdfSha256 = '0'.repeat(64);
  const substituted = { ...artifacts, evidence: new TextEncoder().encode(JSON.stringify(wrong)) };
  assert.throws(() => verifyContractArchiveFiles(proof(source, substituted), substituted, source), { code: 'storage_unverified' });
});
