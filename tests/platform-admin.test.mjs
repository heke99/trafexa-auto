import test from 'node:test';
import assert from 'node:assert/strict';
import { createSourceLoader } from './helpers/source-loader.mjs';

const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const NEXT = '33333333-3333-4333-8333-333333333333';
const REQUEST = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-10-13T18:00:00Z';
const verifiedUser = { id: USER, email: 'owner@example.com', email_confirmed_at: NOW, is_anonymous: false, user_metadata: { role: 'owner' } };
const company = { id: COMPANY, name: 'Företag AB', organisation_number: '5561234567', status: 'active', created_at: NOW, membership_count: 2, stock_count: 9, service_key: 'not-for-client', customer_price: 999 };
const mutation = { companyId: COMPANY, expectedStatus: 'active', status: 'suspended', reason: 'Konto granskas', requestId: REQUEST };
const receipt = { company_id: COMPANY, previous_status: 'active', status: 'suspended', changed: true, request_id: REQUEST, actor_user_id: USER, reason: mutation.reason, created_at: NOW };

async function fixture(options = {}) {
  const calls = [], invalidations = [];
  let admin = options.admin ?? true;
  const db = {
    auth: { async getUser() { calls.push(['auth']); return { data: { user: options.user === undefined ? verifiedUser : options.user }, error: options.authError ?? null }; } },
    async rpc(name, args) {
      calls.push([name, args]);
      if (options.rpc) { const result = await options.rpc(name, args); if (result !== undefined) return result; }
      if (name === 'get_platform_admin_session') return { data: { is_platform_admin: admin, user_id: options.sessionUserId ?? USER }, error: options.sessionError ?? null };
      if (name === 'list_platform_companies') return { data: options.companyPage ?? { companies: [company], next_page_key: null }, error: options.listError ?? null };
      if (name === 'list_platform_contact_requests') return { data: options.contactPage ?? { requests: [], next_page_key: null }, error: null };
      if (name === 'set_platform_company_status') return { data: options.receipt ?? receipt, error: options.mutationError ?? null };
      if (name === 'claim_platform_admin_access') { admin = true; return { data: { is_platform_admin: true, user_id: USER, claimed: true }, error: null }; }
      throw new Error('Unexpected RPC');
    },
  };
  const loader = await createSourceLoader({ '@/lib/supabase/server': { createServerSupabaseClient: async () => db }, 'next/cache': { revalidatePath: path => invalidations.push(path) },
    'next/navigation': { redirect: path => { throw new Error(`REDIRECT:${path}`); }, notFound: () => { throw new Error('NOT_FOUND'); } },
    '@/components/platform-admin-workspace': { PlatformAdminWorkspace: () => null, PlatformAdminActivation: () => null }, '@/components/brand': { Brand: () => null },
    '@/lib/data/actions': { signOutAction: async () => {} },
  });
  return { calls, invalidations, db, loader, context: loader.load('./src/lib/platform-admin/context.ts'), actions: loader.load('./src/lib/platform-admin/actions.ts') };
}

test('fresh verified Auth and matching private allowlist identity precede every privileged RPC', async () => {
  const { actions, calls } = await fixture();
  const result = await actions.listPlatformCompaniesAction({ search: ' AB ', limit: 3 });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['auth'], ['get_platform_admin_session', {}], ['list_platform_companies', { p_search: 'AB', p_page_key: null, p_limit: 3 }]]);
  assert.deepEqual(Object.keys(result.companies[0]).sort(), ['createdAt', 'id', 'membershipCount', 'name', 'organisationNumber', 'status', 'stockCount']);
  assert.equal(JSON.stringify(result).includes('not-for-client'), false);
});

test('ordinary company owners and info contact email receive no global data', async () => {
  const { actions, context, calls } = await fixture({ admin: false, user: { ...verifiedUser, email: 'info@trafexa.com', app_metadata: { role: 'superadmin' } } });
  assert.equal(await context.getPlatformAdminContext(), null);
  assert.equal((await actions.listPlatformCompaniesAction()).code, 'access_denied');
  assert.equal((await actions.setPlatformCompanyStatusAction(mutation)).code, 'access_denied');
  assert.equal(calls.some(call => ['list_platform_companies', 'set_platform_company_status', 'claim_platform_admin_access'].includes(call[0])), false);
});

test('missing, anonymous and unverified users never reach private session RPC', async () => {
  for (const user of [null, { ...verifiedUser, is_anonymous: true }, { ...verifiedUser, email_confirmed_at: null }, { ...verifiedUser, email_confirmed_at: 'invalid' }]) {
    const { actions, calls } = await fixture({ user });
    const result = await actions.listPlatformCompaniesAction({});
    assert.equal(result.ok, false); assert.equal(result.code, 'access_denied');
    assert.deepEqual(calls, [['auth']]);
  }
});

test('mismatched allowlist UID, revoked admin and missing RPC fail closed', async () => {
  for (const options of [{ sessionUserId: NEXT }, { admin: false }, { sessionError: { code: 'PGRST202', message: 'secret backend error' } }]) {
    const { context, actions, calls } = await fixture(options);
    assert.equal(await context.getPlatformAdminContext(), null);
    const result = await actions.listPlatformCompaniesAction({});
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes('secret'), false);
    assert.equal(calls.some(call => call[0] === 'list_platform_companies'), false);
  }
});

test('Auth is refreshed for mutation after a successful read', async () => {
  let revoked = false;
  const { actions, calls } = await fixture({ rpc(name) { if (name === 'get_platform_admin_session') return { data: { is_platform_admin: !revoked, user_id: USER }, error: null }; } });
  assert.equal((await actions.listPlatformCompaniesAction()).ok, true);
  revoked = true;
  assert.equal((await actions.setPlatformCompanyStatusAction(mutation)).code, 'access_denied');
  assert.equal(calls.filter(call => call[0] === 'auth').length, 2);
  assert.equal(calls.some(call => call[0] === 'set_platform_company_status'), false);
});

test('list inputs are bounded and strictly whitelisted; identity headers have no authority', async () => {
  for (const value of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { pageKey: 'not-uuid' }, { search: 'x'.repeat(161) }, { search: 'name\n' }, { headers: { 'x-role': 'superadmin' } }, { role: 'owner' }, null, []]) {
    const { actions, calls } = await fixture();
    assert.equal((await actions.listPlatformCompaniesAction(value)).code, 'invalid_input');
    assert.equal(calls.some(call => call[0] === 'list_platform_companies'), false);
  }
});

test('keyset cursor and maximum limit are forwarded as typed RPC arguments', async () => {
  const { actions, calls } = await fixture({ companyPage: { companies: [{ ...company, id: NEXT }], next_page_key: NEXT } });
  const result = await actions.listPlatformCompaniesAction({ pageKey: COMPANY, limit: 50 });
  assert.equal(result.ok, true); assert.equal(result.nextPageKey, NEXT);
  assert.deepEqual(calls.at(-1), ['list_platform_companies', { p_search: '', p_page_key: COMPANY, p_limit: 50 }]);
});

test('malformed, duplicate, oversized and backwards provider lists never leak rows', async () => {
  for (const companyPage of [{ companies: [company, company], next_page_key: null }, { companies: [company], next_page_key: NEXT }, { companies: [{ ...company, stock_count: -1 }], next_page_key: null }, { companies: [{ ...company, status: 'deleted' }], next_page_key: null }, { companies: [{ ...company, created_at: 'oops' }], next_page_key: null }, { companies: [company, { ...company, id: NEXT }], next_page_key: null }]) {
    const { actions } = await fixture({ companyPage });
    const result = await actions.listPlatformCompaniesAction({ limit: 1 });
    assert.deepEqual(Object.keys(result).sort(), ['code', 'message', 'ok']);
    assert.equal(result.code, 'unavailable');
  }
});

test('status mutations use only verified identity, expected status, normalized reason and stable request ID', async () => {
  const { actions, calls, invalidations } = await fixture();
  const result = await actions.setPlatformCompanyStatusAction({ ...mutation, reason: '  Konto granskas  ' });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.at(-1), ['set_platform_company_status', { p_company_id: COMPANY, p_expected_status: 'active', p_status: 'suspended', p_reason: 'Konto granskas', p_request_id: REQUEST }]);
  assert.deepEqual(invalidations, ['/admin']);
  assert.equal('actorUserId' in result.receipt, false);
});

test('mutation input cannot inject actor/admin/company data or bypass status/reason bounds', async () => {
  for (const value of [{ ...mutation, actorUserId: NEXT }, { ...mutation, isAdmin: true }, { ...mutation, status: 'deleted' }, { ...mutation, expectedStatus: '' }, { ...mutation, reason: ' ' }, { ...mutation, reason: 'x'.repeat(501) }, { ...mutation, reason: 'a\nb' }, { ...mutation, requestId: '' }]) {
    const { actions, calls } = await fixture();
    assert.equal((await actions.setPlatformCompanyStatusAction(value)).code, 'invalid_input');
    assert.equal(calls.some(call => call[0] === 'set_platform_company_status'), false);
  }
});

test('historical exact request retries return original receipt without pretending it is current company state', async () => {
  const { actions, calls } = await fixture();
  const first = await actions.setPlatformCompanyStatusAction(mutation);
  const retry = await actions.setPlatformCompanyStatusAction(mutation);
  assert.deepEqual(retry, first); assert.equal(retry.ok, true);
  assert.deepEqual(calls.filter(call => call[0] === 'set_platform_company_status').map(call => call[1].p_request_id), [REQUEST, REQUEST]);
});

test('CAS conflicts, missing companies and authorization errors are sanitized failures', async () => {
  for (const [code, expected] of [['40001', 'conflict'], ['42501', 'access_denied'], ['P0002', 'not_found'], ['XX000', 'unavailable']]) {
    const { actions } = await fixture({ mutationError: { code, message: 'raw token secret provider message' } });
    const result = await actions.setPlatformCompanyStatusAction(mutation);
    assert.equal(result.ok, false); assert.equal(result.code, expected);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  }
});

test('a successful RPC with wrong receipt identity or changed payload never reports success', async () => {
  for (const patch of [{ actor_user_id: NEXT }, { company_id: NEXT }, { request_id: NEXT }, { status: 'active' }, { previous_status: 'suspended' }, { reason: 'different' }, { changed: false }, { created_at: 'invalid' }]) {
    const { actions, invalidations } = await fixture({ receipt: { ...receipt, ...patch } });
    assert.equal((await actions.setPlatformCompanyStatusAction(mutation)).code, 'unavailable');
    assert.deepEqual(invalidations, []);
  }
});

test('unknown network outcomes are sanitized and can retry the exact original request ID', async () => {
  let attempt = 0;
  const { actions, calls } = await fixture({ rpc(name) { if (name === 'set_platform_company_status' && !attempt++) throw new Error('Authorization secret provider body'); } });
  assert.equal((await actions.setPlatformCompanyStatusAction(mutation)).code, 'unavailable');
  assert.equal((await actions.setPlatformCompanyStatusAction(mutation)).ok, true);
  assert.deepEqual(calls.filter(call => call[0] === 'set_platform_company_status').map(call => call[1].p_request_id), [REQUEST, REQUEST]);
});

test('read-only contact requests preserve multiline messages and expose only the authorized DTO', async () => {
  const contact = { id: COMPANY, name: 'Kontakt', email: 'contact@example.com', company: 'Dealer AB', phone: null, message: 'Rad ett\nRad två', created_at: NOW, hidden_auth_token: 'secret',organisation_number:null,seeking:[],privacy_version:null,privacy_acknowledged_at:null,legacy:true,status:'new',version:1 };
  const { actions, calls } = await fixture({ contactPage: { requests: [contact], next_page_key: COMPANY } });
  const result = await actions.listPlatformContactRequestsAction({ limit: 1 });
  assert.equal(result.ok, true); assert.equal(result.requests[0].message, contact.message);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.deepEqual(calls.at(-1), ['list_platform_contact_requests', { p_page_key: null, p_limit: 1 }]);
  const denied = await fixture({ admin: false });
  assert.equal((await denied.actions.listPlatformContactRequestsAction()).code, 'access_denied');
  assert.equal(denied.calls.some(call => call[0] === 'list_platform_contact_requests'), false);
});

test('contact duplicate or backwards-order results fail closed', async () => {
  const contact = { id: COMPANY, name: 'A', email: 'a@example.com', company: 'A', phone: null, message: null, created_at: NOW,organisation_number:null,seeking:[],privacy_version:null,privacy_acknowledged_at:null,legacy:true,status:'new',version:1 };
  for (const requests of [[contact, contact], [contact, { ...contact, id: NEXT }], [contact, { ...contact, id: NEXT, created_at: '2026-10-14T18:00:00Z' }]]) {
    const { actions } = await fixture({ contactPage: { requests, next_page_key: null } });
    assert.equal((await actions.listPlatformContactRequestsAction()).code, 'unavailable');
  }
});

test('activation is a separate explicit POST with no email or UID input and verified post-claim session', async () => {
  const { actions, context, calls } = await fixture({ admin: false });
  assert.equal(await context.getPlatformAdminContext(), null);
  assert.equal(calls.some(call => call[0] === 'claim_platform_admin_access'), false);
  const result = await actions.activatePlatformAdminAction({});
  assert.deepEqual(result, { ok: true, activated: true });
  assert.deepEqual(calls.filter(call => call[0] === 'claim_platform_admin_access'), [['claim_platform_admin_access', {}]]);
  assert.equal(calls.at(-1)[0], 'get_platform_admin_session');
});

test('activation denies forged email/UID, unverified users, forbidden reservation and mismatched claim identity', async () => {
  for (const value of [{ email: 'hekmat.h@trafexa.com' }, { userId: USER }]) {
    const { actions, calls } = await fixture();
    assert.equal((await actions.activatePlatformAdminAction(value)).code, 'invalid_input');
    assert.equal(calls.some(call => call[0] === 'claim_platform_admin_access'), false);
  }
  for (const options of [{ user: { ...verifiedUser, email_confirmed_at: null } }, { rpc(name) { if (name === 'claim_platform_admin_access') return { data: null, error: { code: '42501', message: 'reserved email secret' } }; } }, { rpc(name) { if (name === 'claim_platform_admin_access') return { data: { is_platform_admin: true, user_id: NEXT, claimed: true }, error: null }; } }]) {
    const { actions } = await fixture(options);
    const result = await actions.activatePlatformAdminAction({});
    assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes('reserved'), false);
  }
});

test('admin layout and page redirect missing users to the dedicated admin login without any privileged reads', async () => {
  for (const path of ['./src/app/admin/layout.tsx', './src/app/admin/page.tsx']) {
    const { loader, calls } = await fixture({ user: null });
    await assert.rejects(() => loader.load(path).default({ children: 'PRIVATE CHILD' }), /REDIRECT:\/login\?next=\/admin/);
    assert.equal(calls.some(call => call[0] !== 'auth'), false);
  }
});

test('verified ordinary users see only the neutral activation view; no GET claims or global reads', async () => {
  for (const path of ['./src/app/admin/layout.tsx', './src/app/admin/page.tsx']) {
    const { loader, calls } = await fixture({ admin: false });
    const element = await loader.load(path).default({ children: 'PRIVATE CHILD' });
    assert.ok(element);
    assert.equal(JSON.stringify(element).includes('PRIVATE CHILD'), false);
    assert.equal(calls.some(call => ['claim_platform_admin_access', 'list_platform_companies', 'list_platform_contact_requests'].includes(call[0])), false);
  }
});

test('unverified users cannot render the activation view or admin children', async () => {
  for (const path of ['./src/app/admin/layout.tsx', './src/app/admin/page.tsx']) {
    const { loader, calls } = await fixture({ user: { ...verifiedUser, email_confirmed_at: null } });
    await assert.rejects(() => loader.load(path).default({ children: 'PRIVATE CHILD' }), /NOT_FOUND/);
    assert.equal(calls.some(call => call[0] !== 'auth'), false);
  }
});
