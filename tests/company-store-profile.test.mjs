import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';

const id = n => `c5f10000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const companyId = id(1), userId = id(2), requestId = id(3), profileId = id(4), exportId = id(5), sourceSha256 = 'a'.repeat(64);
const scope = { companyId, userId, role: 'owner' }, createdAt = '2026-10-15T10:00:00+00:00';
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const fields = () => ({ displayName: 'Åkes Bilbutik', addressLine1: 'Bilvägen 12', addressLine2: null, postalCode: '12345', city: 'Stockholm', countryCode: 'SE', publicEmail: 'butik@bilfirman.se', publicPhone: '+46 (8) 123-4567', websiteUrl: 'https://bilfirman.se/', logoUrl: 'https://cdn.bilfirman.se/logo.png', description: 'Bilar i två rader.\nVälkommen!', openingHoursText: 'Måndag–fredag 09–18' });
const profile = () => ({ id: profileId, companyId, version: 1, fields: fields(), createdAt, actorLabel: 'Du' });
const source = (org = '5568554884') => ({ schemaVersion: 1, companyId, profileId, profileVersion: 1, legalName: 'Bilfirman AB', organisationNumber: org, shop: fields() });
const page = patch => ({ actorId: userId, role: 'owner', companyId, legalName: 'Bilfirman AB', organisationNumber: '5568554884', identityValid: true, profile: profile(), source: source(), sourceSha256, canExport: true, reason: null, exports: [], ...patch });
const saveInput = () => ({ companyId, expectedVersion: 0, fields: fields(), reviewAcknowledged: true, requestId });
const createInput = () => ({ legalName: 'Bilfirman AB', organisationNumber: '5568554884', fields: fields(), representationAcknowledged: true, requestId });
const exportInput = () => ({ companyId, expectedVersion: 1, expectedSourceSha256: sourceSha256, channel: 'blocket', purpose: 'new_store', reviewAcknowledged: true, attestationVersion: '2026-10-15', requestId });
const profileReceipt = patch => ({ actorId: userId, role: 'owner', companyId, requestId, profile: profile(), source: source(), sourceSha256, ...patch });
function exported(patch = {}) {
  const snapshot = source(), canonicalContent = JSON.stringify({ schemaVersion: 1, kind: 'trafexa_store_profile', channel: 'blocket', purpose: 'new_store', profile: snapshot });
  return { id: exportId, companyId, channel: 'blocket', purpose: 'new_store', profileId, profileVersion: 1, sourceSha256, exportSha256: digest(canonicalContent), createdAt, actorLabel: 'Du', status: 'prepared', attestationVersion: '2026-10-15', snapshot, canonicalContent, ...patch };
}
const exportReceipt = patch => ({ actorId: userId, role: 'owner', companyId, requestId, export: exported(), ...patch });
const loader = await createSourceLoader(), v = loader.load('src/lib/company-store-profile/validation.ts');

test('exact public store fields normalize trim, nullable blank, email and ASCII-host URL while preserving Unicode profile text', () => {
  const parsed = v.parseCompanyStoreFields({ ...fields(), displayName: '  Åkes Bilbutik  ', publicEmail: '  BUTIK@BILFIRMAN.SE ', addressLine2: '  ', websiteUrl: ' HTTPS://BILFIRMAN.SE ', logoUrl: 'HTTPS://CDN.BILFIRMAN.SE/bild.png' }, true);
  assert.equal(parsed.displayName, fields().displayName); assert.equal(parsed.publicEmail, fields().publicEmail); assert.equal(parsed.addressLine2, null);
  assert.equal(parsed.websiteUrl, fields().websiteUrl); assert.equal(parsed.logoUrl, 'https://cdn.bilfirman.se/bild.png');
  assert.deepEqual(v.parseCompanyStoreFields(fields()), fields());
  assert.equal(v.parseCompanyStoreFields({ ...fields(), description: '😀'.repeat(5000) }).description.length, 10000);
  assert.throws(() => v.parseCompanyStoreFields({ ...fields(), description: '😀'.repeat(5001) }));
  for (const patch of [{ invoiceEmail: 'private@bilfirman.se' }, { accountReference: 'dealer-code' }, { apiKey: 'secret' }, { actorId: userId }, { customer: {} }, { publicEmail: 'BUTIK@BILFIRMAN.SE' }, { addressLine1: '\nBilvägen' }, { city: 'x'.repeat(101) }, { displayName: '\ud800x' }, { description: 'bad\u0085text' }, { publicPhone: '123456' }, { postalCode: '123 45' }, { countryCode: 'NO' }]) assert.throws(() => v.parseCompanyStoreFields({ ...fields(), ...patch }));
});

test('syntactic public HTTPS URLs reject alternate schemes, SSRF-shaped hosts, credentials, explicit ports, controls and noncanonical receipts', () => {
  const bad = ['http://bilfirman.se/', '//bilfirman.se/', 'https://user@bilfirman.se/', 'https://user:password@bilfirman.se/', 'https://bilfirman.se:443/', 'https://bilfirman.se:8443/', 'https://bilfirman.se/?', 'https://bilfirman.se/#', 'https://bilfirman.se/?a=1', 'https://bilfirman.se/#logo', 'https://bilfirman.se\\@127.0.0.1/', 'https://127.0.0.1/', 'https://0177.1/', 'https://2130706433/', 'https://[::1]/', 'https://169.254.169.254/', 'https://localhost/', 'https://metadata.internal/', 'https://a.local/', 'https://a.home.arpa/', 'https://example.com/', 'https://www.example.org/', 'https://a.invalid/', 'https://a.test/', 'https://a.onion/', 'https://bilfirman.se./', 'https://a.123/', 'https://a..se/', 'https://-a.se/', 'https://bilfirman.se/with space', 'https://bilfirman.se/%0Aheader', 'https://bilfirman.se/%5Cpath', 'https://bilfirman.se/%xx'];
  for (const value of bad) assert.throws(() => v.normalizeCompanyStoreUrl(value), value);
  for (const value of ['https://räksmörgås.se/', 'https://xn--rksmrgs-5wao1o.se/', 'https://shop.xn--rksmrgs-5wao1o.se/', 'https://xn--a.se/', 'https://xn--bilar-pla.se/']) {
    assert.throws(() => v.normalizeCompanyStoreUrl(value), value);
    for (const key of ['websiteUrl', 'logoUrl']) assert.throws(() => v.parseCompanyStoreFields({ ...fields(), [key]: value }, true), `${key}: ${value}`);
  }
  for (const value of ['https://bilfirman.se/', 'https://www.bilfirman.se/butik/stockholm', 'https://cdn.bilfirman.se/logo%20one.png']) assert.equal(v.normalizeCompanyStoreUrl(value), value);
  assert.equal(v.normalizeCompanyStoreUrl('https://bilfirman.se/a/../butik'), 'https://bilfirman.se/butik');
  for (const websiteUrl of ['HTTPS://BILFIRMAN.SE', 'https://bilfirman.se', 'https://bilfirman.se/a/../butik']) assert.throws(() => v.parseCompanyStoreFields({ ...fields(), websiteUrl }));
});

test('new company requires Luhn and explicit representation while exact legacy invalid identity remains readable and saveable', () => {
  assert.equal(v.parseCreateCompanyWithProfileInput({ ...createInput(), organisationNumber: '16 556855-4884' }).organisationNumber, '5568554884');
  for (const organisationNumber of ['0000000000', '5568554885', '123', '5568554884x']) assert.throws(() => v.parseCreateCompanyWithProfileInput({ ...createInput(), organisationNumber }));
  assert.throws(() => v.parseCreateCompanyWithProfileInput({ ...createInput(), representationAcknowledged: false }));
  const legacy = page({ organisationNumber: '5568554885', identityValid: false, source: source('5568554885'), canExport: false, reason: 'invalid_organisation_number' });
  assert.equal(v.parseCompanyStoreProfilePage(legacy, scope).canExport, false);
  assert.equal(v.parseCompanyStoreProfileReceipt(profileReceipt({ source: source('5568554885') }), scope, saveInput()).source.organisationNumber, '5568554885');
  const missing = page({ organisationNumber: '5568554885', identityValid: false, profile: null, source: null, sourceSha256: null, canExport: false, reason: 'profile_missing' });
  assert.equal(v.parseCompanyStoreProfilePage(missing, scope).reason, 'profile_missing');
});

test('page algebra, tenant/actor/role binding, history limits and strict snapshot privacy reject forged output', () => {
  assert.equal(v.parseCompanyStoreProfilePage(page(), scope).profile.version, 1);
  for (const patch of [{ actorId: id(99) }, { companyId: id(99) }, { role: 'sales' }, { identityValid: false }, { canExport: false }, { reason: 'profile_missing' }, { source: null }, { sourceSha256: null }, { cursor: 'foreign' }, { exports: Array(21).fill(exported()) }, { exports: [exported(), exported()] }]) assert.throws(() => v.parseCompanyStoreProfilePage(page(patch), scope));
  for (const patch of [{ profileVersion: 2 }, { profileId: id(99) }, { companyId: id(99) }, { legalName: 'Another firm' }, { shop: { ...fields(), internalNotes: 'private' } }, { createdBy: userId }]) assert.throws(() => v.parseCompanyStoreProfilePage(page({ source: { ...source(), ...patch } }), scope));
  assert.throws(() => v.parseCompanyStoreProfilePage(page({ role: 'sales' }), { ...scope, role: 'sales' }));
});

test('export verifies exact UTF-8 canonical bytes, strict projected body, snapshot/version and immutable legacy identity validity', () => {
  const value = exported(); assert.equal(v.parseCompanyStoreExport(value, companyId).canonicalContent, value.canonicalContent);
  assert.equal(digest(Buffer.from(value.canonicalContent, 'utf8')), value.exportSha256);
  for (const patch of [{ canonicalContent: value.canonicalContent + '\n' }, { exportSha256: 'b'.repeat(64) }, { profileVersion: 2 }, { channel: 'wayke' }, { status: 'created' }, { attestationVersion: 'future' }, { apiKey: 'secret' }, { snapshot: source('5568554885') }]) assert.throws(() => v.parseCompanyStoreExport({ ...value, ...patch }, companyId));
  const leaked = JSON.stringify({ schemaVersion: 1, kind: 'trafexa_store_profile', channel: 'blocket', purpose: 'new_store', profile: { ...source(), invoiceEmail: 'private@bilfirman.se' } });
  assert.throws(() => v.parseCompanyStoreExport({ ...value, canonicalContent: leaked, exportSha256: digest(leaked) }, companyId));
  const malformed = '{'; assert.throws(() => v.parseCompanyStoreExport({ ...value, canonicalContent: malformed, exportSha256: digest(malformed) }, companyId));
});

test('strict save/export inputs preserve caller nonce, version and source hash without accepting forged metadata', () => {
  assert.deepEqual(v.parseSaveCompanyStoreProfileInput(saveInput()), saveInput()); assert.deepEqual(v.parsePrepareCompanyStoreExportInput(exportInput()), exportInput());
  for (const patch of [{ reviewAcknowledged: false }, { expectedVersion: -1 }, { expectedVersion: '0' }, { role: 'owner' }, { legalName: 'forged' }, { requestId: 'bad' }]) assert.throws(() => v.parseSaveCompanyStoreProfileInput({ ...saveInput(), ...patch }));
  for (const patch of [{ reviewAcknowledged: false }, { expectedVersion: 0 }, { expectedSourceSha256: 'BAD' }, { source: source() }, { channel: 'other' }, { purpose: 'publish' }, { attestationVersion: 'future' }]) assert.throws(() => v.parsePrepareCompanyStoreExportInput({ ...exportInput(), ...patch }));
});

async function actionFixture(options = {}) {
  const state = { calls: [], contexts: [], cookies: [], invalidated: [] };
  const db = { rpc(name, args) { state.calls.push({ name, args }); const query = { abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return query; }, then(resolve, reject) { let data = options.data; if (!data) data = name === 'get_company_store_profile' ? page() : name === 'get_company_store_export' ? { actorId: userId, role: 'owner', companyId, export: exported() } : name === 'prepare_company_store_export' ? exportReceipt() : profileReceipt(); return Promise.resolve({ data, error: options.error ?? null }).then(resolve, reject); } }; return query; } };
  async function context(kind) { state.contexts.push(kind); if (options.deny || options.revoke && state.contexts.length > 1) throw Object.assign(Error('private provider key'), { code: options.noAuth ? 'unauthenticated' : 'access_denied' }); return { db, companyId, userId: options.switchActor && state.contexts.length > 1 ? id(99) : userId, role: options.switchRole && state.contexts.length > 1 ? 'admin' : 'owner' }; }
  const graph = await createSourceLoader({
    '../company-store-profile/context': { requireCompanyStoreContext: async selected => { assert.equal(selected, companyId); return context('selected'); }, requireCompanyStoreCreationContext: () => context('new-auth'), requireCreatedCompanyStoreContext: async (selected, actor) => { assert.equal(selected, companyId); assert.equal(actor, userId); return context('new-owner'); } },
    'next/headers': { cookies: async () => ({ set(...args) { state.cookies.push(args); } }) }, 'next/cache': { revalidatePath(path) { state.invalidated.push(path); } },
  });
  return { state, actions: graph.load('src/lib/data/company-store-profile-actions.ts') };
}

test('actual actions call only authenticated scoped RPCs and return complete parsed receipts with post-I/O checks', async () => {
  const { actions, state } = await actionFixture();
  assert.equal((await actions.getCompanyStoreProfileAction({ companyId })).ok, true);
  assert.equal((await actions.saveCompanyStoreProfileAction(saveInput())).ok, true);
  assert.equal((await actions.prepareCompanyStoreExportAction(exportInput())).export.status, 'prepared');
  assert.equal((await actions.getCompanyStoreExportAction({ companyId, exportId })).export.id, exportId);
  assert.deepEqual(state.calls.map(call => call.name), ['get_company_store_profile', 'save_company_store_profile', 'prepare_company_store_export', 'get_company_store_export']);
  assert.equal(state.contexts.length, 8); assert.equal(state.cookies.length, 0);
  assert.deepEqual(state.calls[2].args, { p_company_id: companyId, p_expected_version: 1, p_expected_source_sha256: sourceSha256, p_channel: 'blocket', p_purpose: 'new_store', p_acknowledged: true, p_attestation_version: '2026-10-15', p_request_id: requestId });
});

test('new company action bypasses prior selection, verifies new owner before cookie and normalizes complete atomic creation payload', async () => {
  const { actions, state } = await actionFixture(); assert.equal((await actions.createCompanyWithProfileAction(createInput())).ok, true);
  assert.deepEqual(state.contexts, ['new-auth', 'new-owner']); assert.equal(state.calls.length, 1); assert.equal(state.calls[0].name, 'create_company_with_profile');
  assert.equal(state.calls[0].args.p_representation_acknowledged, true); assert.deepEqual(state.calls[0].args.p_fields, fields());
  assert.equal(state.cookies.length, 1); assert.equal(state.cookies[0][0], 'trafexa-company'); assert.equal(state.cookies[0][1], companyId);
  assert.deepEqual(state.cookies[0][2], { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
});

test('historical company-creation replay accepts a founder now authorized as admin and binds receipt to that fresh role', async () => {
  const f = await actionFixture({ data: profileReceipt({ role: 'admin' }), switchRole: true });
  const result = await f.actions.createCompanyWithProfileAction(createInput()); assert.equal(result.ok, true); assert.equal(result.role, 'admin'); assert.equal(f.state.cookies.length, 1);
});

test('historical retries use identical RPC payload without loading mutable current source or checking latest profile version', async () => {
  const { actions, state } = await actionFixture();
  for (let i = 0; i < 2; i++) assert.equal((await actions.saveCompanyStoreProfileAction(saveInput())).ok, true);
  assert.deepEqual(state.calls[0], state.calls[1]); assert.ok(state.calls.every(call => call.name === 'save_company_store_profile'));
  const exp = await actionFixture(); for (let i = 0; i < 2; i++) assert.equal((await exp.actions.prepareCompanyStoreExportAction(exportInput())).ok, true); assert.deepEqual(exp.state.calls[0], exp.state.calls[1]);
});

test('invalid input stops before Auth/RPC and forged receipts stop before cookies/invalidation', async () => {
  const bad = await actionFixture();
  for (const [action, input] of [['getCompanyStoreProfileAction', { companyId, actorId: userId }], ['saveCompanyStoreProfileAction', { ...saveInput(), reviewAcknowledged: false }], ['createCompanyWithProfileAction', { ...createInput(), organisationNumber: '5568554885' }], ['prepareCompanyStoreExportAction', { ...exportInput(), expectedVersion: 0 }]]) assert.equal((await bad.actions[action](input)).code, 'invalid_input');
  assert.equal(bad.state.calls.length, 0); assert.equal(bad.state.contexts.length, 0);
  for (const patch of [{ actorId: id(99) }, { role: 'admin' }, { requestId: id(99) }, { companyId: id(99) }, { source: { ...source(), profileVersion: 2 } }, { profile: { ...profile(), fields: { ...fields(), displayName: 'Wrong shop' } } }]) {
    const f = await actionFixture({ data: profileReceipt(patch) }); assert.equal((await f.actions.createCompanyWithProfileAction(createInput())).ok, false); assert.equal(f.state.cookies.length, 0); assert.equal(f.state.invalidated.length, 0);
  }
});

test('revoked permission, actor/role switches and unknown DB outcomes withhold data/cookie and sanitize diagnostics', async () => {
  for (const options of [{ deny: true }, { revoke: true }, { switchActor: true }, { switchRole: true }]) {
    for (const action of ['saveCompanyStoreProfileAction', 'createCompanyWithProfileAction', 'prepareCompanyStoreExportAction']) {
      const f = await actionFixture(options), input = action.startsWith('save') ? saveInput() : action.startsWith('create') ? createInput() : exportInput();
      const result = await f.actions[action](input); assert.equal(result.code, 'access_denied'); assert.equal(f.state.cookies.length, 0); assert.equal(f.state.invalidated.length, 0);
    }
  }
  for (const [code, expected] of [['42501', 'access_denied'], ['40001', 'conflict'], ['23505', 'conflict'], ['22023', 'invalid_input'], ['XX000', 'unavailable']]) {
    const f = await actionFixture({ error: { code, message: 'private token details' } }), result = await f.actions.saveCompanyStoreProfileAction(saveInput()); assert.equal(result.code, expected); assert.equal(result.error.includes('token'), false); assert.equal(f.state.calls[0].args.p_request_id, requestId);
  }
});

test('actual new-company contexts require fresh Auth/approval and direct active owner membership independent of selected tenant', async () => {
  for (const patch of [{}, { role: 'admin' }, { role: 'sales' }, { approval: 'suspended' }, { actor: id(99) }, { company: id(99) }]) {
    const calls = [], member = { company_id: patch.company ?? companyId, user_id: userId, role: patch.role ?? 'owner', status: 'active', companies: { id: companyId, status: 'active' } };
    const query = { select() { return query; }, eq() { return query; }, async maybeSingle() { calls.push('membership'); return { data: member, error: null }; } };
    const db = { auth: { async getUser() { calls.push('auth'); return { data: { user: { id: patch.actor ?? userId, email: 'owner@private.se', email_confirmed_at: createdAt } }, error: null }; } }, from() { return query; } };
    const graph = await createSourceLoader({ '../supabase/server': { createServerSupabaseClient: async () => db }, '../account-access/context': { async readAccountAccess(_db, user) { calls.push('approval'); return { userId: user.id, emailVerified: true, status: patch.approval ?? 'approved' }; } }, '../crm/context': { CrmError: class extends Error { constructor(code) { super('safe'); this.code = code; } }, requireCrmContext() { throw Error('selected tenant must never run'); } } });
    const c = graph.load('src/lib/company-store-profile/context.ts');
    if (Object.keys(patch).length && patch.role !== 'admin') await assert.rejects(c.requireCreatedCompanyStoreContext(companyId, userId));
    else { const result = await c.requireCreatedCompanyStoreContext(companyId, userId); assert.equal(result.companyId, companyId); assert.deepEqual(calls, ['auth', 'approval', 'membership']); }
  }
});

test('actual regular context refuses sales/finance/viewer and reads approval freshly on every call', async () => {
  for (const role of ['owner', 'admin', 'sales', 'finance', 'viewer']) {
    let approvals = 0;
    const graph = await createSourceLoader({ '../crm/context': { async requireCrmContext(selected) { assert.equal(selected, companyId); return { db: {}, companyId, userId, role }; }, CrmError: class extends Error { constructor(code) { super('safe'); this.code = code; } } }, '../account-access/context': { async requireApprovedAccountAccess() { approvals++; return { userId }; } } });
    const c = graph.load('src/lib/company-store-profile/context.ts');
    if (role === 'owner' || role === 'admin') { await c.requireCompanyStoreContext(companyId); await c.requireCompanyStoreContext(companyId); assert.equal(approvals, 2); }
    else await assert.rejects(c.requireCompanyStoreContext(companyId));
  }
});
