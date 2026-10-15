import test from 'node:test';
import assert from 'node:assert/strict';
import { createSourceLoader } from './helpers/source-loader.mjs';

const { createAdvertisingWorker } = (await createSourceLoader()).load('@/lib/advertising/advertising-worker');
const { createBlocketProvider } = (await createSourceLoader()).load('@/lib/advertising/blocket-provider');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-13T12:00:00Z');
const SHA = 'a'.repeat(64);
const EXPORT_PATH = `${id(2)}/${id(3)}/${id(7)}/${SHA}.jpg`;
function normalizedReceipt(overrides = {}) { return { url: `https://project.supabase.co/storage/v1/object/sign/ads-export-media/${EXPORT_PATH}?token=private`, expiresAt: '2026-10-15T12:00:00Z', objectPath: EXPORT_PATH, sha256: SHA, normalizationVersion: 'vehicle-photo-v1', ...overrides }; }
function fixture() {
  let job = { id: id(1), companyId: id(2), stockId: id(3), listingId: id(4), listingVersion: 2,
    channel: 'blocket', connectionId: id(5), connectionVersion: 1, accountReference: 'DEALER-A',
    dispatcherId: 'blocket-v4', createdBy: id(6), status: 'queued', version: 1, claimToken: null,
    claimExpiresAt: null, providerAdId: null, providerUrl: null, errorCode: null,
    snapshot: { title: 'Volvo XC60', description: 'Välskött bil', priceGrossOre: '35000025', make: 'Volvo',
      model: 'XC60', year: 2022, mileageKm: 35000, fuel: 'Bensin', transmission: 'Automat',
      includeRegistrationNumber: true, registrationNumber: 'ABC123', photos: [{ id: id(7), companyId: id(2), stockId: id(3),
        objectPath: `${id(2)}/${id(3)}/${id(7)}.jpg`, contentType: 'image/jpeg', sizeBytes: 500,
        version: 1, status: 'active', createdAt: NOW.toISOString(), storageBucket: 'ads-vehicle-photos', storageVisibility: 'private' }] },
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
  const calls = [];
  const store = {
    async getJob() { return structuredClone(job); },
    async claimJob(jobId, expectedVersion, token) {
      calls.push(['claim', jobId, expectedVersion]);
      assert.equal(expectedVersion, job.version);
      job = { ...job, status: 'dispatching', version: job.version + 1, claimToken: token, claimExpiresAt: '2026-10-13T12:02:00Z' };
      return structuredClone(job);
    },
    async saveJob(jobId, expectedVersion, token, outcome) {
      calls.push(['save', jobId, expectedVersion, token, outcome]);
      assert.equal(expectedVersion, job.version);
      if (job.providerAdId !== null) assert.equal(outcome.providerAdId, job.providerAdId, 'persisted provider identity is immutable');
      job = { ...job, ...outcome, version: job.version + 1 }; return structuredClone(job);
    },
    async expireDispatch() { calls.push(['expire']); job = { ...job, status: 'outcome_unknown', version: job.version + 1 }; return structuredClone(job); },
  };
  const provider = { channel: 'blocket', dispatcherId: 'blocket-v4',
    verifiedBinding: { companyId: id(2), connectionId: id(5), connectionVersion: 1, accountReference: 'DEALER-A', validUntil: '2026-10-13T12:05:00Z' },
    async submit(payload) { calls.push(['submit', payload]); return { status: 'submitted' }; },
    async reconcile(payload) { calls.push(['reconcile', payload]); return { status: 'published', providerAdId: '123456', providerUrl: null }; } };
  const media = { origin: 'https://project.supabase.co', async resolve(photo) {
    calls.push(['media', photo.id]);
    return normalizedReceipt();
  } };
  return { calls, store, provider, media, get job() { return job; }, set job(value) { job = value; },
    options: { enabled: true, store, providers: [provider], media, now: () => NOW } };
}

test('dispatch is disabled by default without any storage, media or network activity', async () => {
  const f = fixture(); delete f.options.enabled;
  await assert.rejects(createAdvertisingWorker(f.options).run(id(1)), /disabled/);
  assert.deepEqual(f.calls, []);
});
test('an accepted POST stays submitted; the payload excludes private fields and uses immutable source identity', async () => {
  const f = fixture(); f.job.snapshot.purchaseCost = '123'; f.job.snapshot.customerEmail = 'secret@example.com';
  const result = await createAdvertisingWorker(f.options).run(id(1));
  assert.equal(result.status, 'submitted');
  const payload = f.calls.find(([kind]) => kind === 'submit')[1];
  assert.equal(payload.sourceId, id(4)); assert.equal(payload.listingVersion, 2); assert.equal(payload.accountReference, 'DEALER-A');
  assert.equal(payload.make, 'Volvo'); assert.equal(payload.model, 'XC60'); assert.equal(payload.fuel, 'Bensin'); assert.equal(payload.transmission, 'Automat');
  assert.equal(payload.priceGrossOre, '35000025'); assert.equal(payload.mileageKm, 35000);
  assert.ok(!JSON.stringify(payload).includes('purchaseCost')); assert.ok(!JSON.stringify(payload).includes('customerEmail'));
  assert.equal(f.calls.filter(([kind]) => kind === 'claim').length, 1);
});
test('registration number is omitted without explicit consent, and inconsistent snapshots are denied', async () => {
  const f = fixture(); f.job.snapshot.includeRegistrationNumber = false; f.job.snapshot.registrationNumber = null;
  await createAdvertisingWorker(f.options).run(id(1));
  assert.ok(!Object.hasOwn(f.calls.find(([kind]) => kind === 'submit')[1], 'registrationNumber'));
  const denied = fixture(); denied.job.snapshot.includeRegistrationNumber = false;
  await assert.rejects(createAdvertisingWorker(denied.options).run(id(1)), /snapshot/);
  assert.ok(!denied.calls.some(([kind]) => kind === 'submit' || kind === 'claim'));
});
test('tenant, connection revision, channel and verified account scope are checked before sending', async () => {
  for (const [field, value] of [['companyId', id(9)], ['connectionId', id(9)], ['connectionVersion', 2], ['accountReference', 'DEALER-B'], ['validUntil', NOW.toISOString()]]) {
    const f = fixture(); f.provider.verifiedBinding[field] = value;
    await assert.rejects(createAdvertisingWorker(f.options).run(id(1)), /connection_unavailable/);
    assert.deepEqual(f.calls, []);
  }
});
test('dealers sharing a dispatcher use their own exact binding regardless of provider order', async () => {
  for (const reverse of [false, true]) {
    const f = fixture(); let otherCalls = 0;
    const other = { ...f.provider, verifiedBinding: { ...f.provider.verifiedBinding, companyId: id(20), connectionId: id(21), accountReference: 'DEALER-B' },
      async submit() { otherCalls++; throw Error('wrong dealer'); } };
    f.options.providers = reverse ? [f.provider, other] : [other, f.provider];
    assert.equal((await createAdvertisingWorker(f.options).run(id(1))).status, 'submitted');
    assert.equal(otherCalls, 0); assert.equal(f.calls.filter(([kind]) => kind === 'submit').length, 1);
  }
});
test('ambiguous exact provider bindings fail before media, claiming or external requests', async () => {
  const f = fixture();
  f.options.providers.push({ ...f.provider, verifiedBinding: { ...f.provider.verifiedBinding } });
  await assert.rejects(createAdvertisingWorker(f.options).run(id(1)), /connection_unavailable/);
  assert.deepEqual(f.calls, []);
});
test('submitted provider identity is retained without claiming publication', async () => {
  const f = fixture(); f.provider.submit = async () => ({ status: 'submitted', providerAdId: 'accepted-123', errorCode: 'awaiting_publication' });
  const result = await createAdvertisingWorker(f.options).run(id(1));
  assert.equal(result.status, 'submitted'); assert.equal(result.providerAdId, 'accepted-123'); assert.equal(result.providerUrl, null);
  assert.deepEqual(f.calls.find(([kind]) => kind === 'save')[4], { status: 'submitted', providerAdId: 'accepted-123', errorCode: 'awaiting_publication' });
});
test('invalid submitted provider identities become unknown without persisting unsafe evidence', async () => {
  for (const providerAdId of ['', 'x'.repeat(201), 'unsafe\nidentity', 'unsafe\u0085identity', 123]) {
    const f = fixture(); f.provider.submit = async () => ({ status: 'submitted', providerAdId });
    const result = await createAdvertisingWorker(f.options).run(id(1));
    assert.equal(result.status, 'outcome_unknown'); assert.equal(result.providerAdId, null);
    assert.deepEqual(f.calls.find(([kind]) => kind === 'save')[4], { status: 'outcome_unknown', errorCode: 'invalid_provider_evidence' });
  }
});
test('reconciliation can add the first submitted identity and keeps it on later receipts', async () => {
  const f = fixture(); f.job.status = 'submitted';
  f.provider.reconcile = async () => ({ status: 'submitted', providerAdId: 'accepted-123' });
  const worker = createAdvertisingWorker(f.options);
  assert.equal((await worker.run(id(1))).providerAdId, 'accepted-123');
  assert.equal(f.calls.filter(([kind]) => kind === 'save').length, 1);
  f.provider.reconcile = async () => ({ status: 'submitted' });
  assert.equal((await worker.run(id(1))).providerAdId, 'accepted-123');
  assert.equal(f.calls.filter(([kind]) => kind === 'save').length, 1);
  f.provider.reconcile = async () => ({ status: 'published', providerAdId: 'accepted-123', providerUrl: null });
  assert.equal((await worker.run(id(1))).status, 'published');
  assert.ok(!f.calls.some(([kind]) => kind === 'submit' || kind === 'claim' || kind === 'media'));
});
test('unknown reconciliation retains an established identity when submitted or rejected omits it', async () => {
  for (const status of ['submitted', 'rejected']) {
    const f = fixture(); f.job.status = 'outcome_unknown'; f.job.providerAdId = 'accepted-123';
    f.provider.reconcile = async () => ({ status, errorCode: 'provider_status_pending' });
    const result = await createAdvertisingWorker(f.options).run(id(1));
    assert.equal(result.status, status); assert.equal(result.providerAdId, 'accepted-123');
    assert.equal(f.calls.find(([kind]) => kind === 'save')[4].providerAdId, 'accepted-123');
    assert.ok(!f.calls.some(([kind]) => kind === 'submit' || kind === 'claim'));
  }
});
test('reconciliation never changes an established provider identity or verifies mismatched evidence', async () => {
  for (const status of ['submitted', 'published', 'rejected']) {
    const f = fixture(); f.job.status = 'outcome_unknown'; f.job.providerAdId = 'accepted-123';
    f.provider.reconcile = async () => ({ status, providerAdId: 'other-456', providerUrl: null });
    const result = await createAdvertisingWorker(f.options).run(id(1));
    assert.equal(result.status, 'outcome_unknown'); assert.equal(result.providerAdId, 'accepted-123');
    assert.deepEqual(f.calls, []);
  }
});
test('submission with changed provider identity records unknown while keeping the known identity', async () => {
  const f = fixture(); f.job.providerAdId = 'accepted-123';
  f.provider.submit = async () => ({ status: 'published', providerAdId: 'other-456', providerUrl: null });
  const result = await createAdvertisingWorker(f.options).run(id(1));
  assert.equal(result.status, 'outcome_unknown'); assert.equal(result.providerAdId, 'accepted-123');
  assert.deepEqual(f.calls.find(([kind]) => kind === 'save')[4], { status: 'outcome_unknown', providerAdId: 'accepted-123', errorCode: 'invalid_provider_evidence' });
});
test('cross-tenant, archived and duplicate photos are rejected before signing or claiming', async () => {
  for (const mutate of [p => { p.companyId = id(9); }, p => { p.status = 'archived'; }, p => { p.objectPath = 'somewhere/evil.jpg'; }]) {
    const f = fixture(); mutate(f.job.snapshot.photos[0]);
    await assert.rejects(createAdvertisingWorker(f.options).run(id(1)), /photo/); assert.deepEqual(f.calls, []);
  }
  const f = fixture(); f.job.snapshot.photos.push(f.job.snapshot.photos[0]);
  await assert.rejects(createAdvertisingWorker(f.options).run(id(1)), /photo/);
});
test('expired media, arbitrary origins, redirected paths and wrong private objects fail closed', async () => {
  for (const signed of [
    normalizedReceipt({ url: 'https://evil.example/photo.jpg' }),
    normalizedReceipt({ url: `https://project.supabase.co/storage/v1/object/sign/ads-vehicle-photos/${id(2)}/${id(3)}/${id(7)}.jpg?token=private` }),
    normalizedReceipt({ url: `https://project.supabase.co/storage/v1/object/sign/ads-export-media/${id(9)}/evil.jpg?token=private` }),
    normalizedReceipt({ expiresAt: '2026-10-13T12:00:01Z' }),
    normalizedReceipt({ normalizationVersion: 'unverified' }),
    normalizedReceipt({ url: `https://project.supabase.co/storage/v1/object/sign/ads-export-media/${EXPORT_PATH}` }),
    normalizedReceipt({ sha256: 'not-a-hash' }),
    normalizedReceipt({ objectPath: `${id(9)}/${id(3)}/${id(7)}/${SHA}.jpg` }),
  ]) {
    const f = fixture(); f.media.resolve = async () => signed;
    await assert.rejects(createAdvertisingWorker(f.options).run(id(1)), /media_unavailable/);
    assert.ok(!f.calls.some(([kind]) => kind === 'claim' || kind === 'submit'));
  }
});
test('changed claim snapshots or context never reach the provider', async () => {
  for (const mutate of [job => { job.snapshot.description = 'different'; }, job => { job.claimToken = id(99); },
    job => { job.claimExpiresAt = 'not-a-date'; }, job => { job.version += 1; }, job => { job.createdBy = id(99); },
    job => { job.providerAdId = 'changed-identity'; }, job => { job.providerUrl = 'https://www.blocket.se/ad/changed'; }]) {
    const f = fixture(); const claim = f.store.claimJob;
    f.store.claimJob = async (...args) => { const job = await claim(...args); mutate(job); return job; };
    await assert.rejects(createAdvertisingWorker(f.options).run(id(1)), /claim/);
    assert.ok(!f.calls.some(([kind]) => kind === 'submit'));
  }
});
test('transport ambiguity is persisted as unknown, and subsequent work only reconciles', async () => {
  const f = fixture(); f.provider.submit = async () => { f.calls.push(['submit']); throw new Error('token=SECRET'); };
  const worker = createAdvertisingWorker(f.options);
  assert.equal((await worker.run(id(1))).status, 'outcome_unknown');
  assert.equal((await worker.run(id(1))).status, 'published');
  assert.equal(f.calls.filter(([kind]) => kind === 'submit').length, 1);
  assert.ok(!JSON.stringify(f.calls).includes('SECRET'));
});
test('save failure after remote acceptance cannot result in a second POST after lease expiry', async () => {
  const f = fixture(); const save = f.store.saveJob; f.store.saveJob = async () => { throw new Error('database unavailable'); };
  await assert.rejects(createAdvertisingWorker(f.options).run(id(1)), /database/);
  f.store.saveJob = save; f.job.claimExpiresAt = '2026-10-13T11:59:00Z';
  const result = await createAdvertisingWorker(f.options).run(id(1));
  assert.equal(result.status, 'published'); assert.equal(f.calls.filter(([kind]) => kind === 'submit').length, 1);
  assert.ok(f.calls.some(([kind]) => kind === 'expire'));
});
test('unknown reconciliation does not authorize retry, and invalid publication evidence stays unknown', async () => {
  const f = fixture(); f.job.status = 'outcome_unknown';
  f.provider.reconcile = async () => ({ status: 'retryable', errorCode: 'remote_not_found' });
  assert.equal((await createAdvertisingWorker(f.options).run(id(1))).status, 'outcome_unknown');
  assert.ok(!f.calls.some(([kind]) => kind === 'claim' || kind === 'submit' || kind === 'save'));
  f.provider.reconcile = async () => ({ status: 'published', providerAdId: '123', providerUrl: 'https://evil.example/ad/123' });
  assert.equal((await createAdvertisingWorker(f.options).run(id(1))).status, 'outcome_unknown');
});

function blocketFixture() {
  const f = fixture(); const requests = [];
  const options = { enabled: true, token: 'server-only-token', dispatcherId: 'blocket-v4', verifiedBinding: f.provider.verifiedBinding,
    fetch: async (url, init) => { requests.push({ url, init }); return new Response('{}', { status: 201 }); } };
  const payload = { sourceId: id(4), listingVersion: 1, accountReference: 'DEALER-A', title: 'Never send to car endpoint', description: 'Fin bil',
    priceGrossOre: '35000000', year: 2022, mileageKm: 35000, registrationNumber: 'ABC123',
    photos: [{ url: 'https://project.supabase.co/private.jpg', contentType: 'image/jpeg', expiresAt: '2026-10-15T12:00:00Z' }] };
  return { options, payload, requests };
}
test('Blocket mock adapter uses official fixed endpoint, SEK conversion, tenant code and excludes forbidden car fields', async () => {
  const f = blocketFixture();
  assert.equal((await createBlocketProvider(f.options).submit(f.payload)).status, 'submitted');
  const { url, init } = f.requests[0]; assert.equal(url, 'https://api.blocket.se/pro-import-api/v4/car');
  assert.equal(init.redirect, 'error'); assert.equal(init.headers['X-Auth-Token'], 'server-only-token');
  const body = JSON.parse(init.body); assert.equal(body.price[0].amount, 350000); assert.equal(body.dealer_code, 'DEALER-A');
  assert.equal(body.category_fields.condition.mileage.unit, 'km'); assert.equal(body.dont_publish_on_failed_images, true);
  assert.ok(!Object.hasOwn(body, 'title')); assert.ok(!Object.hasOwn(body, 'contact')); assert.ok(!Object.hasOwn(body.category_fields, 'vin'));
});
test('Blocket missing consent identifier, WebP or wrong account never issues a request', async () => {
  for (const mutate of [p => { delete p.registrationNumber; }, p => { p.photos[0].contentType = 'image/webp'; }, p => { p.accountReference = 'DEALER-B'; }]) {
    const f = blocketFixture(); mutate(f.payload);
    assert.equal((await createBlocketProvider(f.options).submit(f.payload)).status, 'rejected'); assert.deepEqual(f.requests, []);
  }
  const f = blocketFixture(); delete f.options.enabled;
  assert.throws(() => createBlocketProvider(f.options), /unavailable/);
});
test('Blocket unverified decimal price capability rejects öre rather than silently rounding', async () => {
  const f = blocketFixture(); f.payload.priceGrossOre = '35000025';
  assert.deepEqual(await createBlocketProvider(f.options).submit(f.payload), { status: 'rejected', errorCode: 'blocket_decimal_price_unverified' });
  assert.deepEqual(f.requests, []);
});
test('stable listing identity never creates a second ad or reuses earlier publication evidence for later versions', async () => {
  const f = blocketFixture(); f.payload.listingVersion = 2;
  const provider = createBlocketProvider(f.options);
  assert.deepEqual(await provider.submit(f.payload), { status: 'rejected', errorCode: 'blocket_update_contract_required' });
  assert.deepEqual(await provider.reconcile(f.payload), { status: 'outcome_unknown', errorCode: 'blocket_update_contract_required' });
  assert.deepEqual(f.requests, []);
  const workerFixture = fixture(); workerFixture.job.listingVersion = 2;
  await createAdvertisingWorker(workerFixture.options).run(id(1));
  const payload = workerFixture.calls.find(([kind]) => kind === 'submit')[1];
  assert.equal(payload.sourceId, workerFixture.job.listingId); assert.equal(payload.listingVersion, 2);
});
test('Blocket 5xx/rate limiting/network timeout never authorizes blind resubmission', async () => {
  for (const status of [429, 500, 502, 409]) {
    const f = blocketFixture(); f.options.fetch = async () => new Response('{}', { status });
    assert.equal((await createBlocketProvider(f.options).submit(f.payload)).status, 'outcome_unknown');
  }
  const f = blocketFixture(); f.options.fetch = async () => { throw new Error('connection reset'); };
  assert.equal((await createBlocketProvider(f.options).submit(f.payload)).status, 'outcome_unknown');
});
test('Blocket publication requires remote source/account match, visible state, publish done and actual marketplace ID', async () => {
  const base = { source_id: id(4), dealer_code: 'DEALER-A', category_id: 1020, state: 'created', visible: true,
    blocket_ad_id: '123456', log: [{ action: 'publish', state: 'done' }] };
  for (const [change, expected] of [[{}, 'published'], [{ blocket_ad_id: null }, 'submitted'], [{ log: [{ action: 'publish', state: 'processing' }] }, 'submitted'],
    [{ source_id: id(9) }, 'outcome_unknown'], [{ dealer_code: 'DEALER-B' }, 'outcome_unknown'], [{ visible: false }, 'outcome_unknown'],
    [{ log: [...base.log, { action: 'handle_media', state: 'error' }] }, 'outcome_unknown']]) {
    const f = blocketFixture(); f.options.fetch = async (url, init) => { assert.equal(init.method, 'GET'); assert.ok(url.includes(`/ad/${id(4)}`)); return Response.json({ ...base, ...change }); };
    const result = await createBlocketProvider(f.options).reconcile(f.payload); assert.equal(result.status, expected);
    if (expected === 'published') assert.equal(result.providerUrl, null);
  }
});
