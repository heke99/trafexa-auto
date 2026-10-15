import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';

const id = n => `bca10000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const companyId = id(1), userId = id(2), branchId = id(3), requestId = id(4);
const fields = () => ({ code: 'stockholm', name: 'Stockholmsbutiken', addressLine1: 'Bilvägen 12', postalCode: '12345', city: 'Stockholm', publicEmail: 'butik@bilfirman.se', publicPhone: '+46 8 123 4567' });
const createdAt = '2026-10-15T15:00:00Z';
const branch = (patch = {}) => ({ id: branchId, companyId, version: 1, status: 'active', fields: fields(), createdAt, updatedAt: createdAt, ...patch });
const listInput = (patch = {}) => ({ companyId, status: 'active', ...patch });
const saveInput = (patch = {}) => ({ companyId, branchId, expectedVersion: 0, fields: fields(), acknowledged: true, requestId, ...patch });
const statusInput = (patch = {}) => ({ companyId, branchId, expectedVersion: 1, status: 'archived', reason: 'Butiken är stängd', acknowledged: true, requestId, ...patch });
const page = (patch = {}) => ({ companyId, actorUserId: userId, actorRole: 'owner', branches: [branch()], nextPageKey: null, status: 'active', legalName: 'Bilfirman AB', organisationNumber: '5568554884', ...patch });
const receipt = (action = 'save', patch = {}) => ({ companyId, actorUserId: userId, requestId, action, branch: action === 'save' ? branch() : branch({ version: 2, status: 'archived' }), ...patch });

async function fixture(options = {}) {
  const state = { calls: [], contexts: [], invalidated: [], options };
  const db = { rpc(name, args) {
    state.calls.push({ name, args: structuredClone(args) });
    const query = { abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return query; }, then(resolve, reject) {
      if (state.options.throwOnce) { state.options.throwOnce = false; return Promise.reject(Error('SECRET private diagnostic')).then(resolve, reject); }
      const data = state.options.data ?? (name === 'list_company_branches' ? page({ actorRole: state.options.role ?? 'owner' }) : receipt(name === 'save_company_branch' ? 'save' : 'status'));
      return Promise.resolve({ data, error: state.options.error ?? null }).then(resolve, reject);
    } }; return query;
  } };
  const graph = await createSourceLoader({
    './context': { requireCompanyBranchesContext: async selected => {
      state.contexts.push(selected); assert.equal(selected, companyId);
      if (options.deny || options.revoke && state.contexts.length > 1) throw Object.assign(Error('SECRET diagnostics'), { code: options.noAuth ? 'unauthenticated' : 'access_denied' });
      const changed = state.contexts.length > 1;
      return { db, companyId: changed && options.switchCompany ? id(90) : companyId, userId: changed && options.switchActor ? id(91) : userId, role: changed && options.switchRole ? 'admin' : options.role ?? 'owner' };
    } },
    'next/cache': { revalidatePath(path) { state.invalidated.push(path); if (options.revalidationFails) throw Error('No render context'); } },
  });
  return { state, actions: graph.load('src/lib/company-branches/actions.ts') };
}
const graph = await createSourceLoader(), v = graph.load('src/lib/company-branches/validation.ts');

test('branch parsers accept exact complete public fields and reject data leaks, invalid codes, versions and acknowledgements', () => {
  assert.deepEqual(v.parseSaveBranchInput(saveInput()), saveInput());
  assert.deepEqual(v.parseListBranchesInput(listInput()), { ...listInput(), pageKey: null, limit: 50 });
  assert.deepEqual(v.parseSetBranchStatusInput(statusInput()), statusInput());
  assert.equal(v.parseSaveBranchInput(saveInput({ fields: { ...fields(), publicEmail: null, publicPhone: null } })).fields.publicEmail, null);
  for (const patch of [{ code: 'UPPER' }, { code: 'two words' }, { code: '-leading' }, { code: 'a'.repeat(25) }, { publicEmail: 'UPPER@EXAMPLE.SE' }, { publicPhone: '123' }, { postalCode: '123 45' }, { name: ' Leading' }, { city: 'City\u0085' }, { apiKey: 'secret' }, { organisationNumber: '5568554884' }]) assert.throws(() => v.parseSaveBranchInput(saveInput({ fields: { ...fields(), ...patch } })));
  for (const patch of [{ acknowledged: false }, { expectedVersion: -1 }, { expectedVersion: Number.MAX_SAFE_INTEGER }, { requestId: 'bad' }, { role: 'owner' }, { actorUserId: userId }]) assert.throws(() => v.parseSaveBranchInput(saveInput(patch)));
  for (const patch of [{ expectedVersion: 0 }, { reason: '' }, { reason: ' trailing ' }, { reason: 'x'.repeat(501) }, { status: 'deleted' }]) assert.throws(() => v.parseSetBranchStatusInput(statusInput(patch)));
});

test('invalid action inputs stop before Auth and RPC including unsupported tenant and provider fields', async () => {
  const f = await fixture();
  for (const [method, input] of [
    ['listCompanyBranchesAction', listInput({ limit: 51 })],
    ['listCompanyBranchesAction', listInput({ pageKey: 'bad' })],
    ['listCompanyBranchesAction', listInput({ status: 'deleted' })],
    ['listCompanyBranchesAction', listInput({ actorUserId: userId })],
    ['saveCompanyBranchAction', saveInput({ acknowledged: false })],
    ['saveCompanyBranchAction', saveInput({ fields: { ...fields(), providerAccount: 'external' } })],
    ['saveCompanyBranchAction', saveInput({ expectedVersion: '0' })],
    ['setCompanyBranchStatusAction', statusInput({ expectedVersion: 0 })],
    ['setCompanyBranchStatusAction', statusInput({ reason: '' })],
  ]) assert.equal((await f.actions[method](input)).code, 'invalid_input');
  assert.equal(f.state.contexts.length, 0); assert.equal(f.state.calls.length, 0);
});

test('actual list/create/status actions send exact tenant-bound RPC arguments and recheck Auth after I/O', async () => {
  const f = await fixture();
  assert.equal((await f.actions.listCompanyBranchesAction(listInput())).ok, true);
  assert.equal((await f.actions.saveCompanyBranchAction(saveInput())).receipt.branch.version, 1);
  assert.equal((await f.actions.setCompanyBranchStatusAction(statusInput())).receipt.branch.status, 'archived');
  assert.deepEqual(f.state.calls, [
    { name: 'list_company_branches', args: { p_company_id: companyId, p_status: 'active', p_page_key: null, p_limit: 50 } },
    { name: 'save_company_branch', args: { p_company_id: companyId, p_branch_id: branchId, p_expected_version: 0, p_fields: fields(), p_acknowledged: true, p_request_id: requestId } },
    { name: 'set_company_branch_status', args: { p_company_id: companyId, p_branch_id: branchId, p_expected_version: 1, p_status: 'archived', p_reason: 'Butiken är stängd', p_acknowledged: true, p_request_id: requestId } },
  ]);
  assert.equal(f.state.contexts.length, 6); assert.deepEqual(f.state.invalidated, ['/settings', '/settings']);
});

test('active edit accepts version-bound immutable receipt and rejects wrong action, fields, status, scope or CAS', async () => {
  const input = saveInput({ expectedVersion: 4 });
  const correct = receipt('save', { branch: branch({ version: 5 }) });
  assert.equal((await (await fixture({ data: correct })).actions.saveCompanyBranchAction(input)).ok, true);
  for (const patch of [{ companyId: id(80) }, { actorUserId: id(81) }, { requestId: id(82) }, { action: 'status' }, { actorRole: 'owner' }, { branch: branch({ version: 4 }) }, { branch: branch({ version: 6 }) }, { branch: branch({ id: id(83), version: 5 }) }, { branch: branch({ companyId: id(84), version: 5 }) }, { branch: branch({ status: 'archived', version: 5 }) }, { branch: branch({ version: 5, fields: { ...fields(), name: 'Other shop' } }) }]) {
    const f = await fixture({ data: { ...correct, ...patch } }), result = await f.actions.saveCompanyBranchAction(input);
    assert.equal(result.code, 'unavailable'); assert.equal(f.state.invalidated.length, 0); assert.equal('branch' in result, false);
  }
});

test('status receipt binds requested status, branch, action and expected next version without mutable preflight', async () => {
  for (const patch of [{ action: 'save' }, { branch: branch({ version: 2, status: 'active' }) }, { branch: branch({ version: 3, status: 'archived' }) }, { requestId: id(99) }]) {
    const f = await fixture({ data: receipt('status', patch) }); assert.equal((await f.actions.setCompanyBranchStatusAction(statusInput())).code, 'unavailable'); assert.equal(f.state.invalidated.length, 0);
  }
  const f = await fixture();
  for (let i = 0; i < 2; i++) assert.equal((await f.actions.setCompanyBranchStatusAction(statusInput())).ok, true);
  assert.deepEqual(f.state.calls[0], f.state.calls[1]); assert.ok(f.state.calls.every(call => call.name === 'set_company_branch_status'));
});

test('historical save replay by a now-admin actor needs no old role, mutable branch read or regenerated nonce', async () => {
  const f = await fixture({ role: 'admin' });
  for (let i = 0; i < 2; i++) assert.equal((await f.actions.saveCompanyBranchAction(saveInput())).ok, true);
  assert.deepEqual(f.state.calls[0], f.state.calls[1]); assert.equal(f.state.calls[0].args.p_request_id, requestId);
  assert.ok(f.state.calls.every(call => call.name === 'save_company_branch')); assert.equal(f.state.contexts.length, 4);
});

test('unknown RPC outcome preserves original caller request and exact payload for a safe retry', async () => {
  const f = await fixture({ throwOnce: true });
  const first = await f.actions.saveCompanyBranchAction(saveInput());
  assert.equal(first.code, 'unavailable'); assert.equal(JSON.stringify(first).includes('SECRET'), false);
  assert.equal((await f.actions.saveCompanyBranchAction(saveInput())).ok, true);
  assert.deepEqual(f.state.calls[0], f.state.calls[1]); assert.equal(f.state.invalidated.length, 1);
});

test('revocation or actor, role and company changes after read/write I/O return no private data or invalidation', async () => {
  for (const options of [{ revoke: true }, { switchActor: true }, { switchRole: true }, { switchCompany: true }]) {
    for (const [method, input] of [['listCompanyBranchesAction', listInput()], ['saveCompanyBranchAction', saveInput()], ['setCompanyBranchStatusAction', statusInput()]]) {
      const f = await fixture(options), result = await f.actions[method](input);
      assert.equal(result.code, 'access_denied'); assert.deepEqual(Object.keys(result).sort(), ['code', 'message', 'ok']); assert.equal(f.state.invalidated.length, 0);
    }
  }
});

test('list output enforces tenant/actor/role/status and strictly ordered bounded cursor pages', async () => {
  const rows = [branch(), branch({ id: id(5) })];
  const input = listInput({ limit: 2 });
  const valid = page({ branches: rows, nextPageKey: id(5) });
  assert.equal((await (await fixture({ data: valid })).actions.listCompanyBranchesAction(input)).nextPageKey, id(5));
  for (const patch of [{ companyId: id(90) }, { actorUserId: id(91) }, { actorRole: 'admin' }, { status: 'archived' }, { branches: [...rows].reverse() }, { branches: [rows[0], rows[0]] }, { branches: [...rows, branch({ id: id(6) })] }, { nextPageKey: branchId }, { branches: [rows[0]], nextPageKey: branchId }, { apiKey: 'secret' }, { branches: [branch({ status: 'archived' })] }]) {
    const f = await fixture({ data: { ...valid, ...patch } }); assert.equal((await f.actions.listCompanyBranchesAction(input)).code, 'unavailable');
  }
  const stale = await fixture({ data: valid }); assert.equal((await stale.actions.listCompanyBranchesAction(listInput({ pageKey: branchId, limit: 2 }))).code, 'unavailable');
});

test('SQL failures have stable sanitized categories and revalidation failure never loses a verified receipt', async () => {
  for (const [raw, expected] of [['40001', 'conflict'], ['23505', 'conflict'], ['42501', 'access_denied'], ['22023', 'invalid_input'], ['XX000', 'unavailable']]) {
    const f = await fixture({ error: { code: raw, message: 'SECRET diagnostics' } });
    const result = await f.actions.saveCompanyBranchAction(saveInput()); assert.equal(result.code, expected); assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
  const noAuth = await fixture({ deny: true, noAuth: true }); assert.equal((await noAuth.actions.listCompanyBranchesAction(listInput())).code, 'unauthenticated'); assert.equal(noAuth.state.calls.length, 0);
  assert.equal((await (await fixture({ revalidationFails: true })).actions.saveCompanyBranchAction(saveInput())).ok, true);
});

test('branch context composes live team access and approval from the same verified actor; no CRM or profile coupling', async () => {
  for (const role of ['owner', 'admin']) {
    const calls = [], db = {};
    const loader = await createSourceLoader({
      '../company-team/context': { requireCompanyTeamContext: async company => { calls.push(company); return { companyId, userId, role, db }; }, CompanyTeamError: class extends Error { constructor(code) { super('Denied'); this.code = code; } } },
      '../account-access/context': { requireApprovedAccountAccess: async () => { calls.push('approval'); return { userId }; } },
    });
    const context = await loader.load('src/lib/company-branches/context.ts').requireCompanyBranchesContext(companyId);
    assert.deepEqual(context, { companyId, userId, role, db }); assert.deepEqual(calls, [companyId, 'approval']);
  }
  for (const patch of [{ role: 'sales' }, { role: 'finance' }, { role: 'viewer' }, { role: 'customer' }, { companyId: id(90) }, { approvalUser: id(91) }]) {
    const loader = await createSourceLoader({
      '../company-team/context': { requireCompanyTeamContext: async () => ({ companyId, userId, role: 'owner', ...patch }), CompanyTeamError: class extends Error { constructor(code) { super('Denied'); this.code = code; } } },
      '../account-access/context': { requireApprovedAccountAccess: async () => ({ userId: patch.approvalUser ?? userId }) },
    });
    await assert.rejects(() => loader.load('src/lib/company-branches/context.ts').requireCompanyBranchesContext(companyId), error => error.code === 'access_denied');
  }
});

