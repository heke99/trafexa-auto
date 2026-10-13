import test from 'node:test';
import assert from 'node:assert/strict';
import { createSourceLoader } from './helpers/source-loader.mjs';

const COMPANY = '10000000-0000-4000-8000-000000000001';
const FOREIGN = '10000000-0000-4000-8000-000000000002';
const STOCK = '20000000-0000-4000-8000-000000000001';
const LISTING = '30000000-0000-4000-8000-000000000001';
const PHOTO = '40000000-0000-4000-8000-000000000001';
const JOB = '50000000-0000-4000-8000-000000000001';
const JOB2 = '50000000-0000-4000-8000-000000000002';
const USER = '60000000-0000-4000-8000-000000000001';
const REQUEST = '70000000-0000-4000-8000-000000000001';
const NOW = '2026-10-13T21:00:00Z';
const user = { id: USER, email: 'owner@example.com', email_confirmed_at: NOW, is_anonymous: false, user_metadata: { role: 'owner' } };
const photo = { id: PHOTO, companyId: COMPANY, stockId: STOCK, objectPath: `${COMPANY}/${STOCK}/${PHOTO}.jpg`, contentType: 'image/jpeg', sizeBytes: 2000, version: 1, status: 'active', createdAt: NOW, storageBucket: 'ads-vehicle-photos', storageVisibility: 'private' };
const snapshot = { title: 'Volvo V60', description: 'En rad\nOch nästa rad', priceGrossOre: '25000000', make: 'Volvo', model: 'V60', year: 2025, mileageKm: 10000, fuel: 'hybrid', transmission: 'automatic', photos: [photo], includeRegistrationNumber: false, registrationNumber: null, purchasePriceOre: '19000000', vin: 'SECRET_VIN', customer: 'SECRET_CUSTOMER', internalNotes: 'SECRET_NOTES' };
const listing = { id: LISTING, companyId: COMPANY, stockId: STOCK, version: 2, status: 'ready', snapshot, createdAt: NOW, updatedAt: NOW };
const job = { id: JOB, companyId: COMPANY, stockId: STOCK, listingId: LISTING, listingVersion: 2, channel: 'blocket', status: 'queued', version: 1, providerAdId: null, providerUrl: null, snapshot, createdAt: NOW, updatedAt: NOW, claimToken: REQUEST, dispatcherId: 'SECRET_DISPATCHER', accountReference: 'INTERNAL_ACCOUNT', connectionId: REQUEST, createdBy: USER, errorCode: 'SECRET_PROVIDER_ERROR' };
const connections = [{ channel: 'blocket', status: 'disconnected', accountReference: null, dispatcherAvailable: false }, { channel: 'wayke', status: 'disconnected', accountReference: null, dispatcherAvailable: false }];
const createInput = { companyId: COMPANY, stockItemId: STOCK, title: snapshot.title, description: snapshot.description, photoIds: [PHOTO], requestId: REQUEST };
const saveInput = { ...createInput, listingId: LISTING, expectedVersion: 2 };
const readyInput = { companyId: COMPANY, listingId: LISTING, expectedVersion: 1, requestId: REQUEST };
const sendInput = { companyId: COMPANY, listingId: LISTING, expectedVersion: 2, channels: ['blocket'], requestId: REQUEST };
const connectionInput = { companyId: COMPANY, channel: 'blocket', accountReference: 'dealer-account-123', requestId: REQUEST };

async function fixture(options = {}) {
  const calls = [], queries = [], invalidations = [];
  const role = options.role ?? 'owner';
  const membership = options.membership === undefined ? { company_id: COMPANY, user_id: USER, role, status: 'active', companies: { id: COMPANY, status: 'active' } } : options.membership;
  const db = {
    auth: { async getUser() { calls.push(['auth']); return { data: { user: options.user === undefined ? user : options.user }, error: options.authError ?? null }; } },
    from(table) {
      const query = { table, fields: null, filters: [] }; queries.push(query); calls.push(['membership']);
      const builder = { select(fields) { query.fields = fields; return builder; }, eq(field, value) { query.filters.push([field, value]); return builder; }, async maybeSingle() { return { data: membership, error: options.membershipError ?? null }; } };
      return builder;
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (options.rpc) { const result = await options.rpc(name, args); if (result !== undefined) return result; }
      if (name === 'list_company_advertising') return { data: options.workspace ?? { listings: [listing], jobs: [job], channels: connections, nextPageKey: null, nextJobsPageKey: null }, error: options.rpcError ?? null };
      if (name === 'list_advertising_stock') return { data: options.stockPage ?? { stock: [{ id: STOCK, make: 'Volvo', model: 'V60', year: 2025, priceGrossOre: '25000000', status: 'available', purchasePriceOre: 'PRIVATE_COST', vin: 'SECRET_VIN' }], nextPageKey: null }, error: options.rpcError ?? null };
      if (name === 'get_stock_advertising') return { data: options.details ?? { listing, jobs: [job], channels: connections }, error: options.rpcError ?? null };
      if (name === 'save_vehicle_advertisement') return { data: options.saveReceipt ?? { actorUserId: USER, requestId: args.p_request_id, listing: { ...listing, id: args.p_listing_id, version: args.p_expected_version + 1, status: 'draft', snapshot: { ...snapshot, title: args.p_title, description: args.p_description, photos: args.p_photo_ids.length ? [photo] : [], includeRegistrationNumber: args.p_include_registration_number, registrationNumber: args.p_include_registration_number ? 'ABC123' : null } } }, error: options.rpcError ?? null };
      if (name === 'mark_vehicle_advertisement_ready') return { data: options.readyReceipt ?? { actorUserId: USER, requestId: REQUEST, listing }, error: options.rpcError ?? null };
      if (name === 'send_vehicle_advertisement') return { data: options.sendReceipt ?? { actorUserId: USER, requestId: REQUEST, status: 'connection_required', jobs: [], listing }, error: options.rpcError ?? null };
      if (name === 'request_advertising_connection') return { data: options.connectionReceipt ?? { actorUserId: USER, requestId: REQUEST, connection: { channel: 'blocket', status: 'requested', accountReference: 'dealer-account-123', dispatcherAvailable: false } }, error: options.rpcError ?? null };
      throw new Error('Unexpected RPC');
    },
  };
  const loader = await createSourceLoader({
    '@/lib/supabase/server': { async createServerSupabaseClient() { return db; } },
    '@/lib/data/company-context': { async getActiveCompanyContext() { calls.push(['company']); if (options.noCompany) throw new Error('private diagnostic'); return { db, company: options.selectedCompany ?? COMPANY, user: options.contextUser ?? USER, role: options.cachedRole ?? role }; } },
    'next/cache': { revalidatePath(path) { invalidations.push(path); } },
  });
  return { actions: loader.load('./src/lib/advertising/actions.ts'), calls, queries, invalidations };
}

test('advertising reads verify actual Auth, selected tenant and current active membership before user RPC', async () => {
  const { actions, calls, queries } = await fixture();
  const result = await actions.listAdvertisingWorkspaceAction({ companyId: COMPANY });
  assert.equal(result.ok, true); assert.equal(result.actorUserId, USER); assert.equal(result.actorRole, 'owner');
  assert.deepEqual(calls.map(call => call[0]), ['auth', 'company', 'membership', 'list_company_advertising']);
  assert.deepEqual(queries[0].filters, [['company_id', COMPANY], ['user_id', USER], ['status', 'active'], ['companies.status', 'active']]);
  assert.deepEqual(calls.at(-1)[1], { p_company_id: COMPANY, p_page_key: null, p_jobs_page_key: null, p_limit: 50 });
});

test('all active team roles read public ad DTO; only owner/admin/sales may write and only owner/admin request connections', async () => {
  for (const role of ['owner', 'admin', 'sales', 'finance', 'viewer']) {
    const { actions } = await fixture({ role });
    assert.equal((await actions.listAdvertisingWorkspaceAction({ companyId: COMPANY })).ok, true);
    assert.equal((await actions.createAdvertisingListingAction(createInput)).ok, ['owner', 'admin', 'sales'].includes(role));
    assert.equal((await actions.requestAdvertisingConnectionAction(connectionInput)).ok, ['owner', 'admin'].includes(role));
  }
});

test('tenant mismatch, fake cached owner, revoked memberships and suspended companies never permit mutations', async () => {
  for (const options of [{ selectedCompany: FOREIGN }, { contextUser: FOREIGN }, { role: 'viewer', cachedRole: 'owner' }, { membership: null }, { membership: { company_id: COMPANY, user_id: USER, role: 'owner', status: 'suspended', companies: { id: COMPANY, status: 'active' } } }, { membership: { company_id: COMPANY, user_id: USER, role: 'owner', status: 'active', companies: { id: COMPANY, status: 'suspended' } } }, { noCompany: true }]) {
    const { actions, calls } = await fixture(options);
    assert.equal((await actions.createAdvertisingListingAction(createInput)).code, 'access_denied');
    assert.equal(calls.some(call => call[0] === 'save_vehicle_advertisement'), false);
  }
});

test('anonymous/unverified/missing sessions fail before company or advertisement lookup', async () => {
  for (const userValue of [null, { ...user, is_anonymous: true }, { ...user, email_confirmed_at: null }]) {
    const { actions, calls } = await fixture({ user: userValue });
    assert.equal((await actions.listAdvertisingWorkspaceAction({ companyId: COMPANY })).ok, false);
    assert.deepEqual(calls, [['auth']]);
  }
});

test('DTO allowlists remove VIN, costs, customers, internal notes, paths and worker claim/provider secrets', async () => {
  const { actions } = await fixture();
  const result = await actions.listAdvertisingWorkspaceAction({ companyId: COMPANY });
  assert.equal(result.ok, true);
  const json = JSON.stringify(result);
  for (const secret of ['SECRET_VIN', 'SECRET_CUSTOMER', 'SECRET_NOTES', 'SECRET_DISPATCHER', 'SECRET_PROVIDER_ERROR', 'INTERNAL_ACCOUNT', 'objectPath', 'purchasePriceOre', 'claimToken']) assert.equal(json.includes(secret), false);
  assert.deepEqual(Object.keys(result.listings[0].snapshot).sort(), ['description', 'fuel', 'includeRegistrationNumber', 'make', 'mileageKm', 'model', 'photos', 'priceGrossOre', 'registrationNumber', 'title', 'transmission', 'year']);
  assert.equal(result.listings[0].snapshot.registrationNumber, null);
});

test('decimal-string stock prices preserve bigint precision and reject JSON numbers or invalid amounts', async () => {
  const base = { id: STOCK, make: 'Volvo', model: 'V60', year: 2025, status: 'available' };
  const exact = await fixture({ stockPage: { stock: [{ ...base, priceGrossOre: '9223372036854775807' }], nextPageKey: null } });
  assert.equal((await exact.actions.listAdvertisingStockAction({ companyId: COMPANY })).stock[0].priceGrossOre, '9223372036854775807');
  for (const priceGrossOre of [25000000, '01', '-1', '1.5', '9223372036854775808']) {
    const { actions } = await fixture({ stockPage: { stock: [{ ...base, priceGrossOre }], nextPageKey: null } });
    assert.equal((await actions.listAdvertisingStockAction({ companyId: COMPANY })).code, 'unavailable');
  }
});

test('strict input whitelists reject client prices, credentials, provider flags and malformed ids/types before DB', async () => {
  for (const [method, value] of [
    ['createAdvertisingListingAction', { ...createInput, priceGrossOre: '1' }], ['createAdvertisingListingAction', { ...createInput, purchasePriceOre: '1' }], ['createAdvertisingListingAction', { ...createInput, vin: 'fake' }],
    ['createAdvertisingListingAction', { ...createInput, title: 'x'.repeat(161) }], ['createAdvertisingListingAction', { ...createInput, title: 'title\n' }], ['createAdvertisingListingAction', { ...createInput, description: 'x'.repeat(5001) }], ['createAdvertisingListingAction', { ...createInput, photoIds: [PHOTO, PHOTO] }], ['createAdvertisingListingAction', { ...createInput, includeRegistrationNumber: 'true' }],
    ['saveAdvertisingListingAction', { ...saveInput, expectedVersion: 0 }], ['saveAdvertisingListingAction', { ...saveInput, expectedVersion: 2147483648 }],
    ['sendAdvertisingListingAction', { ...sendInput, providerConfigured: true }], ['sendAdvertisingListingAction', { ...sendInput, actorUserId: USER }], ['sendAdvertisingListingAction', { ...sendInput, channels: ['blocket', 'blocket'] }], ['sendAdvertisingListingAction', { ...sendInput, channels: [] }], ['sendAdvertisingListingAction', { ...sendInput, channels: ['unknown'] }],
    ['requestAdvertisingConnectionAction', { ...connectionInput, apiKey: 'secret' }], ['requestAdvertisingConnectionAction', { ...connectionInput, status: 'verified' }], ['requestAdvertisingConnectionAction', { ...connectionInput, accountReference: 'x'.repeat(161) }],
    ['listAdvertisingWorkspaceAction', { companyId: COMPANY, limit: 51 }], ['listAdvertisingWorkspaceAction', { companyId: COMPANY, pageKey: 'id.eq.other' }],
  ]) {
    const { actions, calls } = await fixture();
    assert.equal((await actions[method](value)).code, 'invalid_input'); assert.deepEqual(calls, []);
  }
});

test('create/save derive all prices from stock RPC, preserve description and photo order and default registration opt-out', async () => {
  const { actions, calls } = await fixture();
  const created = await actions.createAdvertisingListingAction(createInput);
  assert.equal(created.ok, true); assert.equal(created.receipt.listing.id, REQUEST); assert.equal(created.receipt.listing.version, 1);
  const parameters = calls.at(-1)[1];
  assert.deepEqual(parameters, { p_company_id: COMPANY, p_stock_id: STOCK, p_listing_id: REQUEST, p_expected_version: 0, p_title: snapshot.title, p_description: snapshot.description, p_photo_ids: [PHOTO], p_include_registration_number: false, p_request_id: REQUEST });
  assert.equal('priceGrossOre' in parameters, false);
  const saved = await actions.saveAdvertisingListingAction({ ...saveInput, includeRegistrationNumber: true });
  assert.equal(saved.ok, true); assert.equal(saved.receipt.listing.version, 3); assert.equal(saved.receipt.listing.snapshot.registrationNumber, 'ABC123');
});

test('ready is an explicit authenticated write with a new immutable version and requires verified photos', async () => {
  const { actions, calls } = await fixture();
  const result = await actions.markAdvertisingListingReadyAction(readyInput);
  assert.equal(result.ok, true); assert.equal(result.receipt.listing.version, 2);
  assert.deepEqual(calls.at(-1)[1], { p_company_id: COMPANY, p_listing_id: LISTING, p_expected_version: 1, p_request_id: REQUEST });
  const missing = await fixture({ readyReceipt: { actorUserId: USER, requestId: REQUEST, listing: { ...listing, snapshot: { ...snapshot, photos: [] } } } });
  assert.equal((await missing.actions.markAdvertisingListingReadyAction(readyInput)).code, 'unavailable');
});

test('receipt actor/nonce/company/stock/version/content/privacy mismatch never reports save success', async () => {
  const base = { actorUserId: USER, requestId: REQUEST, listing: { ...listing, id: REQUEST, version: 1, status: 'draft' } };
  for (const patch of [{ actorUserId: FOREIGN }, { requestId: FOREIGN }, { listing: { ...base.listing, companyId: FOREIGN } }, { listing: { ...base.listing, stockId: FOREIGN } }, { listing: { ...base.listing, version: 2 } }, { listing: { ...base.listing, snapshot: { ...snapshot, title: 'different' } } }, { listing: { ...base.listing, snapshot: { ...snapshot, registrationNumber: 'LEAK' } } }, { listing: { ...base.listing, snapshot: { ...snapshot, photos: [{ ...photo, stockId: FOREIGN }] } } }]) {
    const { actions, invalidations } = await fixture({ saveReceipt: { ...base, ...patch } });
    assert.equal((await actions.createAdvertisingListingAction(createInput)).code, 'unavailable'); assert.deepEqual(invalidations, []);
  }
});

test('unknown save outcome retries the same stable creation id and immutable exact nonce payload', async () => {
  let attempt = 0;
  const { actions, calls } = await fixture({ rpc(name) { if (name === 'save_vehicle_advertisement' && !attempt++) throw new Error('secret provider diagnostic'); } });
  assert.equal((await actions.createAdvertisingListingAction(createInput)).code, 'unavailable');
  assert.equal((await actions.createAdvertisingListingAction(createInput)).ok, true);
  const sends = calls.filter(call => call[0] === 'save_vehicle_advertisement');
  assert.deepEqual(sends[0], sends[1]);
});

test('missing/expired/unverified trusted connections produce connection_required with no fake queued/published receipt', async () => {
  const { actions, invalidations, calls } = await fixture();
  const result = await actions.sendAdvertisingListingAction({ ...sendInput, channels: ['wayke', 'blocket'] });
  assert.equal(result.ok, false); assert.equal(result.code, 'connection_required'); assert.equal('receipt' in result, false); assert.deepEqual(invalidations, []);
  assert.deepEqual(calls.at(-1)[1], { p_company_id: COMPANY, p_listing_id: LISTING, p_expected_version: 2, p_channels: ['blocket', 'wayke'], p_request_id: REQUEST });
  assert.equal(calls.filter(call => call[0] === 'send_vehicle_advertisement').length, 1);
});

test('atomic configured send accepts only one correctly-bound durable queued job for every selected channel', async () => {
  const jobs = [job, { ...job, id: JOB2, channel: 'wayke' }];
  const receipt = { actorUserId: USER, requestId: REQUEST, status: 'queued', jobs, listing };
  const { actions } = await fixture({ sendReceipt: receipt });
  const result = await actions.sendAdvertisingListingAction({ ...sendInput, channels: ['wayke', 'blocket'] });
  assert.equal(result.ok, true); assert.equal(result.receipt.status, 'queued'); assert.equal(result.receipt.jobs.length, 2);
  for (const patch of [{ jobs: [job] }, { jobs: [job, job] }, { jobs: [job, { ...job, id: JOB2, channel: 'wayke', listingVersion: 1 }] }, { jobs: [job, { ...job, id: JOB2, channel: 'wayke', snapshot: { ...snapshot, priceGrossOre: '1' } }] }, { status: 'connection_required', jobs: [job] }, { actorUserId: FOREIGN }]) {
    const invalid = await fixture({ sendReceipt: { ...receipt, ...patch } });
    assert.equal((await invalid.actions.sendAdvertisingListingAction({ ...sendInput, channels: ['blocket', 'wayke'] })).code, 'unavailable');
  }
});

test('published state requires evidence id and validates an optional HTTPS URL on the exact provider allowlist', async () => {
  const base = { ...job, status: 'published', providerAdId: 'provider-123', providerUrl: 'https://www.blocket.se/annons/stockholm/123' };
  const valid = await fixture({ workspace: { listings: [listing], jobs: [base], channels: connections, nextPageKey: null, nextJobsPageKey: null } });
  assert.equal((await valid.actions.listAdvertisingWorkspaceAction({ companyId: COMPANY })).jobs[0].providerUrl, base.providerUrl);
  const withoutUrl = await fixture({ workspace: { listings: [listing], jobs: [{ ...base, providerUrl: null }], channels: connections, nextPageKey: null, nextJobsPageKey: null } });
  const published = await withoutUrl.actions.listAdvertisingWorkspaceAction({ companyId: COMPANY });
  assert.equal(published.ok, true); assert.equal(published.jobs[0].status, 'published'); assert.equal(published.jobs[0].providerUrl, null);
  for (const providerUrl of ['http://www.blocket.se/annons/1', 'https://www.blocket.se.evil.test/1', 'https://www.wayke.se/1', 'https://user:password@www.blocket.se/1', 'https://www.blocket.se/1?token=secret', 'javascript:alert(1)']) {
    const { actions } = await fixture({ workspace: { listings: [listing], jobs: [{ ...base, providerUrl }], channels: connections, nextPageKey: null, nextJobsPageKey: null } });
    assert.equal((await actions.listAdvertisingWorkspaceAction({ companyId: COMPANY })).code, 'unavailable');
  }
  const noEvidence = await fixture({ workspace: { listings: [listing], jobs: [{ ...base, providerAdId: null }], channels: connections, nextPageKey: null, nextJobsPageKey: null } });
  assert.equal((await noEvidence.actions.listAdvertisingWorkspaceAction({ companyId: COMPANY })).code, 'unavailable');
});

test('reader bounds preserve existing valid 160-character vehicle make/model fields', async () => {
  const fields = { make: 'M'.repeat(160), model: 'X'.repeat(160) };
  const { actions } = await fixture({ stockPage: { stock: [{ id: STOCK, ...fields, year: 2025, priceGrossOre: '25000000', status: 'available' }], nextPageKey: null }, workspace: { listings: [{ ...listing, snapshot: { ...snapshot, ...fields } }], jobs: [], channels: connections, nextPageKey: null, nextJobsPageKey: null } });
  const stock = await actions.listAdvertisingStockAction({ companyId: COMPANY });
  const ads = await actions.listAdvertisingWorkspaceAction({ companyId: COMPANY });
  assert.equal(stock.ok, true); assert.equal(stock.stock[0].model, fields.model);
  assert.equal(ads.ok, true); assert.equal(ads.listings[0].snapshot.make, fields.make);
});

test('positive provider submission is displayed separately and never creates a published link', async () => {
  const { actions } = await fixture({ workspace: { listings: [listing], jobs: [{ ...job, status: 'submitted', providerAdId: 'accepted-1', providerUrl: 'https://www.blocket.se/annons/1' }], channels: connections, nextPageKey: null, nextJobsPageKey: null } });
  const result = await actions.listAdvertisingWorkspaceAction({ companyId: COMPANY });
  assert.equal(result.ok, true); assert.equal(result.jobs[0].status, 'submitted'); assert.equal(result.jobs[0].providerUrl, null);
});

test('connection request is owner/admin-only nonsecret account reference and never user-verifies an account', async () => {
  const { actions, calls } = await fixture();
  const result = await actions.requestAdvertisingConnectionAction(connectionInput);
  assert.equal(result.ok, true); assert.equal(result.connection.status, 'requested'); assert.equal(result.connection.dispatcherAvailable, false);
  assert.deepEqual(calls.at(-1)[1], { p_company_id: COMPANY, p_channel: 'blocket', p_account_reference: 'dealer-account-123', p_request_id: REQUEST });
  const forged = await fixture({ connectionReceipt: { actorUserId: USER, requestId: REQUEST, connection: { channel: 'blocket', status: 'requested', accountReference: connectionInput.accountReference, dispatcherAvailable: true } } });
  assert.equal((await forged.actions.requestAdvertisingConnectionAction(connectionInput)).code, 'unavailable');
  const existing = await fixture({ connectionReceipt: { actorUserId: USER, requestId: REQUEST, connection: { channel: 'blocket', status: 'verified', accountReference: connectionInput.accountReference, dispatcherAvailable: true } } });
  assert.equal((await existing.actions.requestAdvertisingConnectionAction(connectionInput)).connection.status, 'verified');
});

test('workspace/stock/details use bounded independent UUID cursors and reject cross-tenant/stock provider rows', async () => {
  const { actions, calls } = await fixture({ workspace: { listings: [listing], jobs: [job], channels: connections, nextPageKey: LISTING, nextJobsPageKey: JOB } });
  const result = await actions.listAdvertisingWorkspaceAction({ companyId: COMPANY, pageKey: STOCK, jobsPageKey: PHOTO, limit: 1 });
  assert.equal(result.ok, true); assert.equal(result.nextJobsPageKey, JOB);
  assert.deepEqual(calls.at(-1)[1], { p_company_id: COMPANY, p_page_key: STOCK, p_jobs_page_key: PHOTO, p_limit: 1 });
  for (const details of [{ listing: { ...listing, stockId: FOREIGN }, jobs: [], channels: connections }, { listing: null, jobs: [{ ...job, stockId: FOREIGN }], channels: connections }]) {
    const invalid = await fixture({ details });
    assert.equal((await invalid.actions.getStockAdvertisingAction({ companyId: COMPANY, stockItemId: STOCK })).code, 'unavailable');
  }
});

test('CAS/access/provider failures remain generic and successful historical receipts trigger real refresh paths', async () => {
  for (const [code, expected] of [['40001', 'conflict'], ['42501', 'access_denied'], ['P0002', 'not_found'], ['22023', 'invalid_input'], ['XX000', 'unavailable']]) {
    const { actions } = await fixture({ rpcError: { code, message: 'SECRET_PROVIDER_ERROR' } });
    const result = await actions.saveAdvertisingListingAction(saveInput);
    assert.equal(result.code, expected); assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
  const { actions, invalidations } = await fixture();
  assert.deepEqual(await actions.createAdvertisingListingAction(createInput), await actions.createAdvertisingListingAction(createInput));
  assert.deepEqual(invalidations, ['/advertising', '/advertising']);
});
