import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { test } from 'node:test';
import { createRequestReact, createSourceLoader } from './helpers/source-loader.mjs';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FOREIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const actions = [
  { name: 'createVehicleAction', path: '/inventory', target: 'create_stock', fields: { registration_number: 'ABC 123', make: 'Volvo', model: 'V60', model_year: '2025', mileage_km: '48000', fuel: 'hybrid', gearbox: 'automatic', purchase_price: '240000', asking_price: '289000', vat_scheme: 'unknown' } },
  { name: 'createCustomerAction', path: '/customers', target: 'create_customer_request', fields: { request_id: FOREIGN, name: 'Kund A', kind: 'person', email: 'buyer@example.invalid', phone: '+46 70 123 45 67', address: 'Gatan 1', notes: 'Kontakt om bilen' } },
  { name: 'createFinanceRequestAction', path: '/finance', target: 'create_finance_intake_request', fields: { request_id: FOREIGN, product: 'stock', requested_amount: '150000', deposit: '0', note: 'Lagerfinansiering' } },
];

function form(fields) {
  const result = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) result.set(key, value);
  return result;
}
function membership(company, role = 'owner') {
  return { company_id: company, user_id: USER, role, status: 'active', companies: { id: company, name: `Företag ${company[0]}`, organisation_number: '5566778899', status: 'active' } };
}
function redirect(url) {
  const error = new Error('Framework redirect');
  error.url = url; error.digest = `NEXT_REDIRECT;${url}`;
  throw error;
}
async function destination(work) {
  try { await work(); assert.fail('Expected the actual action to redirect.'); }
  catch (error) {
    assert.match(error.digest ?? '', /^NEXT_REDIRECT;/);
    return new URL(error.url, 'https://app.example.invalid');
  }
}

/** Actual action, company selector, account-access parser and request-local React
 * cache. Only Supabase I/O and Next request primitives are adapted; no live calls.
 * Provider-denial cases exercise error propagation, not a local SQL/RLS proof. */
async function harness() {
  const requests = new AsyncLocalStorage();
  const browser = { cookie: A };
  const state = () => { const value = requests.getStore(); assert.ok(value, 'A request is required'); return value; };
  const database = () => ({
    auth: {
      async getUser() { const request = state(); request.authCalls++; return { data: { user: request.user }, error: request.authError ?? null }; },
      getClaims() { assert.fail('Unverified claims must not authorize business writes'); },
    },
    rpc(name, args) {
      const request = state();
      if (name === 'get_account_access') return { data: { userId: request.user.id, email: request.user.email, emailVerified: Boolean(request.user.email_confirmed_at), status: request.approval, version: 1, isPlatformAdmin: false }, error: null };
      const create=async()=>{
        request.business.push({ target: name, value: args });
        if (!request.providerError) request.saved.push({ target: name, value: args });
        return { data: name==='create_stock'?null:{companyId:args.p_company_id,actorId:request.user.id,requestId:args.p_request_id,kind:name==='create_customer_request'?'customer':'finance_intake',recordId:FOREIGN,createdAt:'2026-10-15T10:00:00Z'}, error: request.providerError ?? null };
      };
      return name==='create_stock'?create():{abortSignal:create};
    },
    from(table) {
      const filters = {};
      const query = {
        select() { return query; },
        eq(key, value) { filters[key] = value; return query; },
        order() { return query; },
        async maybeSingle() {
          const rows=state().memberships.filter(row=>Object.entries(filters).every(([key,value])=>(key==='companies.status'?row.companies.status:row[key])===value));
          return{data:structuredClone(rows[0]??null),error:null};
        },
        async insert(value) {
          const request = state(); request.business.push({ target: table, value });
          if (!request.providerError) request.saved.push({ target: table, value });
          return { data: null, error: request.providerError ?? null };
        },
        then(resolve, reject) {
          assert.equal(table, 'memberships', 'Only authorization reads are expected');
          const rows = state().memberships.filter(row => Object.entries(filters).every(([key, value]) => (key === 'companies.status' ? row.companies.status : row[key]) === value));
          return Promise.resolve({ data: structuredClone(rows), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  });
  const loader = await createSourceLoader({
    react: createRequestReact(requests),
    'next/headers': { cookies: async () => ({ get: key => key === 'trafexa-company' ? { value: browser.cookie } : undefined, set: (key, value) => { assert.equal(key, 'trafexa-company'); browser.cookie = value; } }) },
    'next/navigation': { redirect },
    'next/cache': { revalidatePath: path => state().revalidated.push(path) },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => database() },
  });
  return {
    actions: loader.load('src/lib/data/actions.ts'),
    context: loader.load('src/lib/data/company-context.ts'),
    browser,
    async request(overrides, work) {
      const request = { user: { id: USER, email: 'dealer@example.invalid', email_confirmed_at: '2026-10-15T10:00:00Z', user_metadata: { role: 'owner', company_id: FOREIGN } }, memberships: [membership(A), membership(B)], approval: 'approved', business: [], saved: [], revalidated: [], authCalls: 0, reactCache: new Map(), ...overrides };
      const result = await requests.run(request, () => work(request));
      return { request, result };
    },
  };
}

for (const action of actions) {
  test(`${action.name}: stale form A is rejected after an actual cookie selection of B in another request`, async () => {
    const h = await harness();
    const displayed = await h.request({}, async () => (await h.context.getCompanySession()).membership.company_id);
    const input = form({ ...action.fields, expected_company_id: displayed.result });
    const switched = await h.request({}, () => destination(() => h.actions.selectCompanyAction(form({ company_id: B }))));
    assert.equal(switched.result.pathname, '/dashboard'); assert.equal(h.browser.cookie, B);
    const { request, result } = await h.request({}, () => destination(() => h.actions[action.name](input)));
    assert.equal(result.pathname, action.path); assert.match(result.searchParams.get('error'), /Det aktiva företaget har ändrats/);
    assert.equal(result.searchParams.has('success'), false);
    assert.deepEqual(request.business, []); assert.deepEqual(request.saved, []); assert.deepEqual(request.revalidated, []);
    assert.equal(request.authCalls, 1, 'A separate submission uses freshly verified Auth');
  });

  test(`${action.name}: missing, malformed and forged expected company never start business I/O`, async () => {
    const h = await harness();
    for (const expected of [undefined, '', 'invalid', `${A}x`, new File(['uuid'], 'company.txt'), B, FOREIGN]) {
      const { request, result } = await h.request({}, () => destination(() => h.actions[action.name](form({ ...action.fields, expected_company_id: expected, company_id: A }))));
      assert.equal(result.pathname, action.path); assert.equal(result.searchParams.has('success'), false); assert.ok(result.searchParams.get('error'));
      assert.deepEqual(request.business, []); assert.deepEqual(request.revalidated, []);
    }
  });

  test(`${action.name}: matching company creates only in the selected tenant and preserves the original payload`, async () => {
    const h = await harness();
    const { request, result } = await h.request({}, () => destination(() => h.actions[action.name](form({ ...action.fields, expected_company_id: A.toUpperCase(), company_id: FOREIGN }))));
    assert.equal(result.pathname, action.path); assert.ok(result.searchParams.get('success')); assert.equal(result.searchParams.has('error'), false);
    assert.equal(request.saved.length, 1); assert.equal(request.business[0].target, action.target);
    const value = request.saved[0].value;
    assert.equal(value.company ?? value.company_id ?? value.p_company_id, A); assert.equal(Object.hasOwn(value, 'expected_company_id'), false);
    if (action.target === 'create_stock') { assert.equal(value.registration, 'ABC123'); assert.equal(value.purchase_ore, 24000000); assert.equal(value.asking_ore, 28900000); }
    if (action.target === 'create_customer_request') { assert.equal(value.p_email, action.fields.email); assert.equal(value.p_name, action.fields.name); assert.equal(value.p_request_id, FOREIGN); }
    if (action.target === 'create_finance_intake_request') { assert.equal('created_by'in value,false); assert.equal('status'in value,false); assert.equal(value.p_deal_id, null); assert.equal(value.p_requested_amount_ore, 15000000); assert.equal(value.p_request_id, FOREIGN); }
    assert.deepEqual(request.revalidated, ['/dashboard', action.path]);
  });

  test(`${action.name}: logged-out, revoked and unapproved actors cannot use a matching company field`, async () => {
    const h = await harness();
    for (const [overrides, path] of [
      [{ user: null }, '/login'],
      [{ authError: { code: 'session_not_found' } }, '/login'],
      [{ memberships: [membership(B)] }, '/settings'],
      [{ approval: 'suspended' }, '/onboarding'],
    ]) {
      const { request, result } = await h.request(overrides, () => destination(() => h.actions[action.name](form({ ...action.fields, expected_company_id: A }))));
      assert.equal(result.pathname, path); assert.deepEqual(request.business, []); assert.deepEqual(request.revalidated, []);
    }
  });

  test(`${action.name}: a downgraded B role cannot reroute form A and provider authorization errors remain failures`, async () => {
    const h = await harness(); h.browser.cookie = B;
    const downgraded = { memberships: [membership(A), membership(B, 'viewer')], providerError: { code: '42501', message: 'Private policy diagnostic' } };
    const stale = await h.request(downgraded, () => destination(() => h.actions[action.name](form({ ...action.fields, expected_company_id: A }))));
    assert.match(stale.result.searchParams.get('error'), /Det aktiva företaget har ändrats/); assert.deepEqual(stale.request.business, []);
    const current = await h.request(downgraded, () => destination(() => h.actions[action.name](form({ ...action.fields, expected_company_id: B }))));
    if (action.name === 'createVehicleAction') {
      assert.match(current.result.searchParams.get('error'), /Endast företagets ägare och administratörer/);
      assert.equal(current.request.business.length, 0);
    } else {
      assert.match(current.result.searchParams.get('error'), /företagsbehörighet kunde inte verifieras/);
      assert.equal(current.request.business.length, 0);
    }
    assert.equal(current.result.searchParams.has('success'), false); assert.deepEqual(current.request.saved, []); assert.deepEqual(current.request.revalidated, []);
  });
}
