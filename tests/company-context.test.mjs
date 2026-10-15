import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequestReact, createSourceLoader } from './helpers/source-loader.mjs';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PAUSED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REVOKED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const FOREIGN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const STOCK = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const USER = '11111111-1111-4111-8111-111111111111';

function membership(id, { role = 'owner', status = 'active', companyStatus = 'active', user = USER } = {}) {
  return { company_id: id, role, status, user_id: user, companies: { id, name: `Company ${id[0]}`, organisation_number: '1111111111', status: companyStatus } };
}
function fixture(overrides = {}) {
  return {
    user: { id: USER, email: 'verified@example.invalid', email_confirmed_at:'2026-10-14T00:00Z', user_metadata: { company_id: FOREIGN, role: 'owner' } },
    cookie: undefined, authError: null, membershipError: null, authCalls: 0, clients: 0, queries: [], inserts: [], cookieWrites: [], revalidated: [], reactCache: new Map(),
    memberships: [membership(B), membership(A), membership(PAUSED, { companyStatus: 'inactive' }), membership(REVOKED, { status: 'revoked' }), membership(FOREIGN, { user: 'other-user' })],
    stock: [{ id: STOCK, company_id: A, status: 'available', created_at: '2026-10-15T10:00:00Z', acquired_on: '2026-10-15', purchase_price_ore: 10000, asking_price_ore: 20000, vat_scheme: 'unknown', vehicles: { id: REVOKED, company_id: A, registration_number: 'FIX123', make: 'Volvo', model: 'V60', model_year: 2022, mileage_km: 10000, fuel: 'petrol', gearbox: 'automatic' } }],
    customers: [{ id: 'own-customer', company_id: A, name: 'Own customer' }, { id: 'foreign-customer', company_id: B, name: 'Foreign customer' }],
    ...overrides,
  };
}
function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
function redirect(url) {
  const error = new Error(url);
  error.url = url; error.digest = `NEXT_REDIRECT;${url}`;
  throw error;
}
async function redirected(work) {
  try { await work(); assert.fail('The operation should redirect.'); }
  catch (error) { assert.match(error.digest ?? '', /^NEXT_REDIRECT;/); return decodeURIComponent(error.url); }
}

async function harness() {
  const storage = new AsyncLocalStorage();
  const state = () => {
    const request = storage.getStore();
    if (!request) throw new Error('A request is required for auth, cookies and database operations.');
    return request;
  };
  function database(request) {
    return {
      auth: {
        async getUser() { request.authCalls++; return { data: { user: request.user }, error: request.authError }; },
        getClaims() { throw new Error('Authorization must use verified getUser(), not JWT/user metadata.'); },
      },
      rpc(name, args) {
        if (name === 'create_customer_request') return {async abortSignal() {
          request.inserts.push({table:'customers',value:{company_id:args.p_company_id,name:args.p_name,kind:args.p_kind,email:args.p_email||null,phone:args.p_phone||null,address:args.p_address||null,notes:args.p_notes||null}});
          return {data:{companyId:args.p_company_id,actorId:request.user.id,requestId:args.p_request_id,kind:'customer',recordId:STOCK,createdAt:'2026-10-15T10:00:00Z'},error:null};
        }};
        if (name === 'get_workspace_inventory') {
          const role = request.memberships.find(m => m.company_id === args.p_company_id && m.user_id === request.user.id).role;
          return {data:{companyId:args.p_company_id,actorId:request.user.id,role,rows:request.stock.filter(s=>s.company_id===args.p_company_id).map(s=>({...s,purchase_price_ore:['owner','admin','finance'].includes(role)?s.purchase_price_ore:null}))},error:null};
        }
        if (name === 'inventory_dashboard_totals') return {data:null,error:{code:'test_no_totals'}};
        assert.equal(name,'get_account_access'); return {data:{userId:request.user.id,email:request.user.email,emailVerified:Boolean(request.user.email_confirmed_at),status:request.approvalStatus??'approved',version:request.approvalStatus?0:1,isPlatformAdmin:false},error:request.approvalError??null};
      },
      from(table) {
        const entry = { table, filters: {}, columns: '', order: null, start: 0, end: Infinity, cap: Infinity };
        request.queries.push(entry);
        let inserted;
        function response() {
          if (inserted) return { data: [{ id: 'saved-row' }], error: null };
          if (table === 'memberships' && request.membershipError) return { data: null, error: request.membershipError };
          let rows = table === 'memberships' ? request.memberships : table === 'stock_items' ? request.stock : table === 'customers' ? request.customers : [];
          rows = rows.filter((row) => Object.entries(entry.filters).every(([key, value]) => key === 'companies.status' ? row.companies.status === value : row[key] === value));
          if (entry.order) rows = rows.slice().sort((left, right) => String(left[entry.order]).localeCompare(String(right[entry.order])));
          return { data: structuredClone(rows.slice(entry.start, Math.min(entry.end + 1, entry.cap))), error: null };
        }
        const query = {
          select(columns) { entry.columns = columns; return query; },
          eq(key, value) { entry.filters[key] = value; return query; },
          order(key) { entry.order = key; return query; },
          limit(value) { entry.cap = value; return query; },
          range(start, end) { entry.start = start; entry.end = end; return query; },
          insert(value) { inserted = value; request.inserts.push({ table, value }); return query; },
          async maybeSingle() { const result = response(); return { ...result, data: result.data?.[0] ?? null }; },
          async single() { const result = response(); return { ...result, data: result.data?.[0] ?? null }; },
          then(resolve, reject) { return Promise.resolve(response()).then(resolve, reject); },
        };
        return query;
      },
    };
  }
  const loader = await createSourceLoader({
    react: createRequestReact(storage),
    'next/headers': { cookies: async () => ({
      get: (key) => key === 'trafexa-company' && state().cookie !== undefined ? { value: state().cookie } : undefined,
      set: (...args) => { state().cookieWrites.push(args); state().cookie = args[1]; },
    }) },
    'next/navigation': { redirect, notFound: () => { throw new Error('NOT_FOUND'); } },
    'next/cache': { revalidatePath: (path) => state().revalidated.push(path) },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => { state().clients++; return database(state()); } },
    './stock-import': { StockImport: () => null },
    './deal-offers': { DealOffers: () => null },
  });
  return {
    loader,
    context: loader.load('src/lib/data/company-context.ts'),
    workspace: loader.load('src/lib/data/workspace.ts'),
    actions: loader.load('src/lib/data/actions.ts'),
    request: (request, work) => storage.run(request, work),
  };
}

test('company session verifies identity and deterministically lists only own active memberships and companies', async () => {
  const h = await harness(), request = fixture();
  await h.request(request, async () => {
    const session = await h.context.getCompanySession();
    assert.deepEqual(session.user, { id: USER, email: 'verified@example.invalid' });
    assert.deepEqual(session.memberships.map((item) => item.company_id), [A, B]);
    assert.equal(session.membership.company_id, A);
    assert.equal(session.selectionRequired, false);
    const strict = await h.context.getActiveCompanyContext();
    assert.equal(strict.company, A); assert.equal(strict.user, USER);
    assert.deepEqual(session.memberships.map((item) => item.companies.id), [A, B]);
  });
});

test('real React server cache shares a verified session across context and snapshot within one request', async () => {
  const h = await harness(), request = fixture();
  await h.request(request, async () => {
    const [one, two, snapshot, strict] = await Promise.all([h.context.getCompanySession(), h.context.getCompanySession(), h.workspace.getWorkspaceSnapshot(), h.context.getActiveCompanyContext()]);
    assert.equal(one, two);
    assert.equal(snapshot.organization.id, strict.company);
    assert.equal(request.authCalls, 3); assert.equal(request.clients, 3);
    assert.equal(request.queries.filter((query) => query.table === 'memberships').length, 2);
  });
});

test('auth and membership revocation are fresh across requests without leaking a cached actor', async () => {
  const h = await harness();
  await h.request(fixture(), async () => assert.equal((await h.context.getCompanySession()).membership.company_id, A));
  const next = fixture({ cookie: A, memberships: [membership(A, { status: 'revoked' }), membership(B)], user: { id: USER, email: 'fresh@example.invalid',email_confirmed_at:'2026-10-14T00:00Z' } });
  await h.request(next, async () => {
    const session = await h.context.getCompanySession();
    assert.equal(session.user.email, 'fresh@example.invalid'); assert.equal(session.membership, null);
    await assert.rejects(h.context.getActiveCompanyContext(), /Välj ett företag/);
    assert.equal(next.authCalls, 1);
  });
  const otherActor = fixture({ user: { id: 'other-user', email: 'other@example.invalid',email_confirmed_at:'2026-10-14T00:00Z' } });
  await h.request(otherActor, async () => {
    const session = await h.context.getCompanySession();
    assert.equal(session.user.id, 'other-user'); assert.equal(session.membership.company_id, FOREIGN);
    assert.deepEqual(session.memberships.map((item) => item.company_id), [FOREIGN]);
    assert.equal(otherActor.authCalls, 1);
  });
  const unauthenticated = fixture({ user: null });
  await h.request(unauthenticated, async () => assert.equal(await h.workspace.getWorkspaceSnapshot(), null));
  assert.equal(unauthenticated.authCalls, 1);
});

test('snapshot reuses verified company metadata and scopes customer, stock and cost reads to the selected company', async () => {
  const h = await harness(), request = fixture({ cookie: A.toUpperCase() });
  await h.request(request, async () => {
    const snapshot = await h.workspace.getWorkspaceSnapshot();
    assert.equal(snapshot.organization.id, A); assert.equal(snapshot.organization.name, 'Company a');
    assert.equal(snapshot.user.email, 'verified@example.invalid');
    assert.deepEqual(snapshot.customers.map((customer) => customer.name), ['Own customer']);
    assert.ok(request.queries.filter((query) => !['memberships', 'finance_partners'].includes(query.table)).every((query) => query.filters.company_id === A));
    assert.equal(request.authCalls, 3);
  });
});

test('stale, blank, paused-company and revoked-member cookies permit only a readonly company chooser', async () => {
  const h = await harness();
  for (const cookie of ['stale-company', '', PAUSED, REVOKED]) {
    const request = fixture({ cookie });
    await h.request(request, async () => {
      const session = await h.context.getCompanySession();
      assert.equal(session.membership, null); assert.equal(session.selectionRequired, true);
      assert.deepEqual(session.memberships.map((item) => item.company_id), [A, B]);
      await assert.rejects(h.context.getActiveCompanyContext(), /Välj ett företag/);
      const snapshot = await h.workspace.getWorkspaceSnapshot();
      assert.equal(snapshot.organization, null); assert.equal(snapshot.membership, null);
      for (const field of ['customers', 'inventory', 'vehicle_costs', 'deals', 'documents']) assert.deepEqual(snapshot[field], []);
      assert.ok(request.queries.every((query) => query.table === 'memberships'));
      assert.deepEqual(request.inserts, []);
    });
  }
});

test('unauthenticated and failed-auth sessions read no memberships, while no active memberships yield onboarding state', async () => {
  const h = await harness();
  for (const overrides of [{ user: null }, { authError: { message: 'Token revoked' } }]) {
    const request = fixture(overrides);
    await h.request(request, async () => {
      assert.equal(await h.context.getCompanySession(), null);
      assert.equal(await h.workspace.getWorkspaceSnapshot(), null);
      await assert.rejects(h.context.getActiveCompanyContext(), /Logga in/);
      assert.deepEqual(request.queries, []);
    });
  }
  const request = fixture({ memberships: [] });
  await h.request(request, async () => {
    const snapshot = await h.workspace.getWorkspaceSnapshot();
    assert.equal(snapshot.organization, null); assert.deepEqual(snapshot.memberships, []);
    assert.ok(request.queries.every((query) => query.table === 'memberships'));
  });
});

test('membership-query errors fail closed and do not read business data or offer a fallback company', async () => {
  const h = await harness(), request = fixture({ membershipError: { code: '42501' } });
  await h.request(request, async () => {
    await assert.rejects(h.workspace.getWorkspaceSnapshot(), /Företagsbehörigheten kunde inte kontrolleras/);
    await assert.rejects(h.context.getActiveCompanyContext(), /Företagsbehörigheten kunde inte kontrolleras/);
    assert.equal(request.authCalls, 1);
    assert.ok(request.queries.every((query) => query.table === 'memberships'));
  });
});

test('legacy mutations require the displayed company and derive the tenant instead of trusting posted company_id', async () => {
  const h = await harness(), input = form({ name: 'Test Customer', kind: 'business', expected_company_id: A, request_id: FOREIGN, company_id: B });
  const stale = fixture({ cookie: 'stale-company' });
  await h.request(stale, async () => {
    assert.equal(await redirected(() => h.actions.createCustomerAction(input)), '/settings');
    assert.deepEqual(stale.inserts, []);
  });
  const selected = fixture({ cookie: A });
  await h.request(selected, async () => {
    assert.match(await redirected(() => h.actions.createCustomerAction(input)), /^\/customers\?success=/);
    assert.equal(selected.inserts.length, 1); assert.equal(selected.inserts[0].value.company_id, A);
  });
});

test('explicit company selection repairs a stale cookie but rejects foreign, inactive and malformed choices', async () => {
  const h = await harness(), selected = fixture({ cookie: 'stale-company' });
  await h.request(selected, async () => {
    assert.equal(await redirected(() => h.actions.selectCompanyAction(form({ company_id: B.toUpperCase() }))), '/dashboard');
    const [name, value, options] = selected.cookieWrites[0];
    assert.equal(name, 'trafexa-company'); assert.equal(value, B);
    assert.equal(options.httpOnly, true); assert.equal(options.sameSite, 'lax'); assert.equal(options.path, '/');
  });
  for (const company of [FOREIGN, PAUSED, REVOKED, 'bad', new File(['not a company'], 'company.txt')]) {
    const request = fixture({ cookie: 'stale-company' });
    await h.request(request, async () => {
      assert.match(await redirected(() => h.actions.selectCompanyAction(form({ company_id: company }))), /^\/settings\?error=/);
      assert.deepEqual(request.cookieWrites, []);
    });
  }
  const unauthenticated = fixture({ user: null });
  await h.request(unauthenticated, async () => assert.equal(await redirected(() => h.actions.selectCompanyAction(form({ company_id: A }))), '/login'));
});

test('cost writes authorize actual membership roles rather than editable user metadata', async () => {
  const h = await harness(), input = form({ stock_item_id: STOCK, category: 'repair', description: 'Service', amount: '1250,50', incurred_on: '2026-10-13', company_id: B });
  for (const role of ['owner', 'admin', 'sales', 'viewer', 'finance']) {
    const request = fixture({ cookie: A, memberships: [membership(A, { role })] });
    await h.request(request, async () => {
      const outcome = await redirected(() => h.actions.createVehicleCostAction(input));
      if (['owner', 'admin'].includes(role)) {
        assert.match(outcome, /^\/inventory\?success=/);
        assert.equal(request.inserts[0].value.company_id, A); assert.equal(request.inserts[0].value.amount_ore, 125050);
        assert.ok(request.queries.some((query) => query.table === 'stock_items' && query.filters.company_id === A && query.filters.id === STOCK));
      } else { assert.match(outcome, /Du har inte behörighet/); assert.deepEqual(request.inserts, []); }
    });
  }
});

test('dealer route renders the stale-company chooser and redirects other, no-active and unauthenticated views', async () => {
  const h = await harness(), page = h.loader.load('src/app/(dealer)/[section]/page.tsx').default;
  const render = (section) => page({ params: Promise.resolve({ section }), searchParams: Promise.resolve({}) });
  await h.request(fixture({ cookie: 'stale-company' }), async () => {
    const settings = await render('settings');
    assert.equal(settings.props.snapshot.organization, null); assert.equal(settings.props.snapshot.memberships.length, 2);
    assert.match(settings.props.notice.message, /Välj ett aktivt företag/);
    for (const section of ['inventory', 'deals', 'customers']) assert.equal(await redirected(() => render(section)), '/settings');
    await assert.rejects(render('not-a-section'), /NOT_FOUND/);
  });
  await h.request(fixture({ memberships: [] }), async () => assert.equal(await redirected(() => render('settings')), '/onboarding'));
  await h.request(fixture({ user: null }), async () => assert.equal(await redirected(() => render('inventory')), '/login?next=/inventory'));
});

test('actual settings markup with null membership offers every active company for explicit selection and no active/edit badge', async () => {
  const h = await harness(), { DealerWorkspace } = h.loader.load('src/components/dealer-workspace.tsx');
  await h.request(fixture({ cookie: 'stale-company' }), async () => {
    const snapshot = await h.workspace.getWorkspaceSnapshot();
    const html = renderToStaticMarkup(createElement(DealerWorkspace, { snapshot, section: 'settings', notice: { type: 'error', message: 'Välj ett aktivt företag.' } }));
    assert.equal((html.match(/Byt företag/g) ?? []).length, 2);
    assert.equal(html.includes('Aktivt företag'), false); assert.equal(html.includes('Lägg till bil'), false);
    assert.ok(html.includes('Välj företag')); assert.ok(html.includes('verified@example.invalid'));
    for (const forbidden of ['Company c', 'Company d', 'Company e', 'foreign-customer']) assert.ok(!html.includes(forbidden), forbidden);
  });
});

test('pending rejected and suspended accounts expose no companies even with active owner fixtures',async()=>{
 const h=await harness();for(const approvalStatus of ['pending','rejected','suspended']){const request=fixture({approvalStatus});await h.request(request,async()=>{const session=await h.context.getCompanySession();assert.equal(session.accountAccess.status,approvalStatus);assert.deepEqual(session.memberships,[]);assert.equal(session.membership,null);assert.equal(request.queries.length,0);await assert.rejects(h.context.getActiveCompanyContext());});}
 const unavailable=fixture({approvalError:{code:'XX000'}});await h.request(unavailable,async()=>{await assert.rejects(h.context.getCompanySession(),/godkännande/);assert.equal(unavailable.queries.length,0);});
});
