import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createSourceLoader } from './helpers/source-loader.mjs';

const company = '10000000-0000-4000-8000-000000000001';
const stock = '20000000-0000-4000-8000-000000000002';
const photoId = '30000000-0000-4000-8000-000000000003';
const requestId = '40000000-0000-4000-8000-000000000004';
const userId = '50000000-0000-4000-8000-000000000005';
const foreign = '60000000-0000-4000-8000-000000000006';
const now = '2026-10-13T21:00:00Z';
const bucket = 'ads-vehicle-photos';
const makeImage = (format, color = '#ca4040') => sharp({ create: { width: 8, height: 6, channels: 3, background: color } }).toFormat(format).toBuffer();
const jpeg = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#ca4040' } })
  .withExif({ IFD0: { Artist: 'Private vehicle owner', Copyright: 'Internal metadata' } }).jpeg().toBuffer();
const png = await makeImage('png');
const webp = await makeImage('webp');
const cleanPng = await sharp(png).rotate().png().toBuffer();
const path = `${company}/${stock}/${photoId}.png`;
const record = (changes = {}) => ({ id: photoId, companyId: company, stockId: stock, objectPath: path,
  contentType: 'image/png', sizeBytes: cleanPng.length, version: 1, status: 'active', createdAt: now,
  storageBucket: bucket, storageVisibility: 'private', ...changes });
const actualMembership = (changes = {}) => ({ company_id: company, user_id: userId, role: 'sales', status: 'active', companies: { id: company, status: 'active' }, ...changes });
const input = (changes = {}) => ({ companyId: company, stockId: stock, photoId, requestId, contentType: 'image/png', bytes: png, ...changes });
const errorCode = code => error => error?.code === code;

/** The database and Storage are mocked; decoder, context, handlers and upload modules are real. */
async function fixture(options = {}) {
  let registered = options.initialPhoto ?? null;
  let stored = options.storedBytes === undefined ? options.initialPhoto ? Buffer.from(cleanPng) : null : Buffer.from(options.storedBytes);
  let registrations = 0, downloads = 0, reads = 0, membershipReads = 0;
  const uploads = [], calls = [];
  const db = {
    auth: { async getUser() { calls.push('auth'); return { data: { user: options.user === undefined ? { id: userId, email: 'sales@example.test', email_confirmed_at: now, is_anonymous: false } : options.user }, error: options.authError ?? null }; } },
    from(table) {
      assert.equal(table, 'memberships');
      const filters = [];
      const query = { select(fields) { assert.equal(fields, 'company_id,user_id,role,status,companies!inner(id,status)'); return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        async maybeSingle() {
          ++membershipReads;
          assert.deepEqual(filters, [['company_id', company], ['user_id', userId], ['status', 'active'], ['companies.status', 'active']]);
          const data = options.membership ? options.membership(membershipReads, registrations) : actualMembership();
          return { data, error: null };
        } }; return query;
    },
    async rpc(name, args) {
      calls.push(name);
      if (name === 'get_vehicle_photo') {
        assert.deepEqual(args, { p_company_id: company, p_photo_id: photoId });
        ++reads;
        return { data: options.catalog ? options.catalog(reads, registered) : registered, error: null };
      }
      assert.equal(name, 'register_vehicle_photo');
      ++registrations;
      assert.deepEqual(args, { p_company_id: company, p_stock_id: stock, p_photo_id: photoId, p_object_path: path, p_content_type: 'image/png', p_size_bytes: cleanPng.length, p_request_id: requestId });
      if (options.registerError) return { data: null, error: { code: options.registerError, message: 'private backend detail' } };
      registered = record();
      return { data: { actorUserId: userId, requestId, photo: record(options.receiptPatch) }, error: null };
    },
    storage: { from(requestedBucket) {
      assert.equal(requestedBucket, bucket);
      return {
        async upload(objectPath, bytes, config) {
          uploads.push({ path: objectPath, bytes: Buffer.from(bytes), config });
          assert.equal(objectPath, path);
          assert.deepEqual(config, { contentType: 'image/png', cacheControl: '0', upsert: false });
          stored = options.persistBytes ? Buffer.from(options.persistBytes(bytes)) : Buffer.from(bytes);
          return { data: { path: objectPath }, error: options.uploadError ? { message: 'previous object or uncertain upload' } : null };
        },
        async download(objectPath) {
          assert.equal(objectPath, options.initialPhoto?.objectPath ?? path);
          ++downloads;
          return { data: stored ? new Blob([stored]) : null, error: stored ? null : { message: 'missing object' } };
        },
      };
    } },
  };
  const loader = await createSourceLoader({ '@/lib/data/company-context': {
    async getActiveCompanyContext() { return { db, company, user: userId, role: 'owner' }; },
  } });
  return { loader, context: loader.load('src/lib/vehicle-photos/server.ts'), upload: loader.load('src/lib/vehicle-photos/upload.ts'),
    get: () => loader.load('src/app/api/vehicle-photos/[photoId]/route.ts').GET(new Request(`https://app.example.test/api/vehicle-photos/${photoId}`), { params: Promise.resolve({ photoId }) }),
    post: request => loader.load('src/app/api/vehicle-photos/route.ts').POST(request),
    counts: () => ({ registrations, downloads, reads, membershipReads }), uploads, calls };
}

test('actual Sharp normalizes JPEG/PNG/WebP while removing EXIF and preserving the image format', async () => {
  const loader = await createSourceLoader();
  const images = loader.load('src/lib/vehicle-photos/images.ts');
  assert.ok((await sharp(jpeg).metadata()).exif);
  for (const [bytes, contentType, format] of [[jpeg, 'image/jpeg', 'jpeg'], [png, 'image/png', 'png'], [webp, 'image/webp', 'webp']]) {
    const clean = await images.normalizeVehicleImage(bytes, contentType);
    const info = await sharp(clean.bytes).metadata();
    assert.equal(clean.contentType, contentType); assert.equal(info.format, format);
    assert.equal(info.width, 8); assert.equal(info.height, 6); assert.equal(info.exif, undefined);
    assert.equal(info.icc, undefined); assert.equal(info.xmp, undefined);
    await images.validateStoredVehicleImage(clean.bytes, contentType);
  }
});

test('real decoder rejects SVG, MIME disguises, corrupt images and size/dimension limits', async () => {
  const loader = await createSourceLoader();
  const images = loader.load('src/lib/vehicle-photos/images.ts');
  const wide = await sharp({ create: { width: 9000, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer();
  for (const [bytes, type] of [[Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"/>'), 'image/png'], [png, 'image/jpeg'], [jpeg.subarray(0, 80), 'image/jpeg'], [Buffer.from('not an image'), 'image/webp'], [wide, 'image/png'], [Buffer.alloc(10485761), 'image/png']]) {
    await assert.rejects(images.normalizeVehicleImage(bytes, type), errorCode('invalid_input'));
  }
});

test('photo identifiers accept standard UUIDs and reject missing groups and traversal values', async () => {
  const f = await fixture();
  assert.equal(f.context.photoUuid(photoId.toUpperCase()), photoId);
  for (const invalid of ['30000000-0000-4000-000000000003', `${photoId}/../other`, 'not-a-uuid', null]) {
    assert.throws(() => f.context.photoUuid(invalid), errorCode('invalid_input'));
  }
});

test('fresh membership is authoritative over a cached owner role for every photo write', async () => {
  for (const member of [null, actualMembership({ role: 'finance' }), actualMembership({ role: 'viewer' }), actualMembership({ status: 'suspended' }), actualMembership({ companies: { id: company, status: 'suspended' } }), actualMembership({ user_id: foreign })]) {
    const f = await fixture({ membership: () => member });
    await assert.rejects(f.upload.uploadVehiclePhoto(input()), errorCode('access_denied'));
    assert.equal(f.uploads.length, 0); assert.equal(f.counts().registrations, 0);
  }
  const reader = await fixture({ membership: () => actualMembership({ role: 'finance' }) });
  assert.equal((await reader.context.requirePhotoContext(company)).role, 'finance');
});

test('photo contexts reject unverified Auth identity and foreign selected companies before Storage IO', async () => {
  for (const user of [null, { id: foreign, email: 'other@example.test', email_confirmed_at: now }, { id: userId, email: 'sales@example.test', email_confirmed_at: null }, { id: userId, email: 'sales@example.test', email_confirmed_at: now, is_anonymous: true }]) {
    const f = await fixture({ user });
    await assert.rejects(f.upload.uploadVehiclePhoto(input()), errorCode('access_denied'));
    assert.equal(f.uploads.length, 0);
  }
  const f = await fixture();
  await assert.rejects(f.upload.uploadVehiclePhoto(input({ companyId: foreign })), errorCode('access_denied'));
  assert.equal(f.uploads.length, 0);
});

test('upload success requires actual persisted bytes before registration and fresh access after IO', async () => {
  const f = await fixture();
  const result = await f.upload.uploadVehiclePhoto(input());
  assert.equal(result.id, photoId); assert.equal(result.status, 'active');
  assert.equal('objectPath' in result, false); assert.equal('storageBucket' in result, false);
  assert.deepEqual(f.uploads[0].bytes, cleanPng);
  assert.deepEqual(f.counts(), { registrations: 1, downloads: 1, reads: 2, membershipReads: 2 });
});

test('a successful Storage response with altered same-size bytes or wrong size never registers a photo', async () => {
  for (const persistBytes of [bytes => { const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1; return changed; }, bytes => Buffer.from(bytes).subarray(0, bytes.length - 1)]) {
    const f = await fixture({ persistBytes });
    await assert.rejects(f.upload.uploadVehiclePhoto(input()), errorCode('unavailable'));
    assert.equal(f.counts().registrations, 0);
  }
});

test('uncertain persisted upload retries only matching bytes and never requests overwrite', async () => {
  const f = await fixture({ uploadError: true });
  assert.equal((await f.upload.uploadVehiclePhoto(input())).id, photoId);
  assert.equal(f.uploads[0].config.upsert, false); assert.equal(f.counts().registrations, 1);
  const changed = await fixture({ uploadError: true, persistBytes: () => Buffer.from('unrelated bytes') });
  await assert.rejects(changed.upload.uploadVehiclePhoto(input()), errorCode('unavailable'));
  assert.equal(changed.counts().registrations, 0);
});

test('same photo ID and same file retry reads existing bytes and forwards the original request nonce', async () => {
  const f = await fixture({ initialPhoto: record() });
  assert.equal((await f.upload.uploadVehiclePhoto(input())).id, photoId);
  assert.equal(f.uploads.length, 0); assert.equal(f.counts().registrations, 1);
  const changed = await fixture({ initialPhoto: record(), storedBytes: Buffer.from(cleanPng).fill(0) });
  await assert.rejects(changed.upload.uploadVehiclePhoto(input()), errorCode('conflict'));
  assert.equal(changed.uploads.length, 0); assert.equal(changed.counts().registrations, 0);
});

test('metadata conflicts, CAS rejection and mismatched receipts cannot report successful registration', async () => {
  const archived = await fixture({ initialPhoto: record({ status: 'archived', version: 2 }) });
  await assert.rejects(archived.upload.uploadVehiclePhoto(input()), errorCode('conflict'));
  assert.equal(archived.uploads.length, 0);
  const rejected = await fixture({ registerError: '40001' });
  await assert.rejects(rejected.upload.uploadVehiclePhoto(input()), errorCode('conflict'));
  for (const receiptPatch of [{ companyId: foreign }, { sizeBytes: cleanPng.length + 1 }, { status: 'archived', version: 2 }]) {
    const f = await fixture({ receiptPatch });
    await assert.rejects(f.upload.uploadVehiclePhoto(input()), error => ['unavailable', 'invalid_input'].includes(error?.code));
  }
});

test('revoked membership or sales-to-finance downgrade after upload does not return success', async () => {
  for (const next of [null, actualMembership({ role: 'finance' })]) {
    const f = await fixture({ membership: (_reads, registrations) => registrations ? next : actualMembership() });
    await assert.rejects(f.upload.uploadVehiclePhoto(input()), errorCode('access_denied'));
    assert.equal(f.counts().registrations, 1);
  }
});

test('actual GET strips EXIF from directly registered raw files and returns private normalized bytes', async () => {
  const jpgPath = `${company}/${stock}/${photoId}.jpg`;
  const f = await fixture({ initialPhoto: record({ objectPath: jpgPath, contentType: 'image/jpeg', sizeBytes: jpeg.length }), storedBytes: jpeg });
  const response = await f.get();
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /sandbox/);
  const released = Buffer.from(await response.arrayBuffer());
  assert.notDeepEqual(released, jpeg); assert.equal((await sharp(released).metadata()).exif, undefined);
  assert.equal(f.counts().membershipReads, 2); assert.equal(f.counts().reads, 2);
});

test('actual GET refuses corruption, MIME disagreement and wrong catalog byte counts', async () => {
  for (const changes of [{ storedBytes: Buffer.from('corrupt'), initialPhoto: record({ sizeBytes: 7 }) }, { storedBytes: jpeg, initialPhoto: record({ sizeBytes: jpeg.length }) }, { storedBytes: png, initialPhoto: record({ sizeBytes: png.length + 1 }) }]) {
    const f = await fixture(changes);
    const response = await f.get(); assert.equal(response.status, 404);
    assert.equal(await response.text(), 'Bilden är inte tillgänglig.');
  }
});

test('actual GET denies foreign metadata before download and revoked/current public storage after IO', async () => {
  const foreignPhoto = await fixture({ initialPhoto: record({ companyId: foreign }) });
  assert.equal((await foreignPhoto.get()).status, 404); assert.equal(foreignPhoto.counts().downloads, 0);
  const revoked = await fixture({ initialPhoto: record(), membership: reads => reads === 1 ? actualMembership() : null });
  assert.equal((await revoked.get()).status, 404); assert.equal(revoked.counts().downloads, 1);
  const publicBucket = await fixture({ initialPhoto: record(), catalog: reads => record(reads === 1 ? {} : { storageVisibility: 'public' }) });
  assert.equal((await publicBucket.get()).status, 404);
});

test('archived originals remain downloadable through a fresh authenticated read for historical versions', async () => {
  const f = await fixture({ initialPhoto: record({ status: 'archived', version: 2 }), membership: () => actualMembership({ role: 'viewer' }) });
  assert.equal((await f.get()).status, 200); assert.equal(f.uploads.length, 0);
});

test('actual POST rejects cross-origin and unsupported multipart fields before upload', async () => {
  for (const origin of ['https://evil.example.test', null]) {
    const f = await fixture();
    const response = await f.post(new Request('https://app.example.test/api/vehicle-photos', { method: 'POST', headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': 'multipart/form-data; boundary=test' }, body: 'untrusted body' }));
    assert.equal(response.status, 403); assert.equal(f.calls.length, 0);
  }
  for (const extra of ['actorUserId', 'providerConfigured']) {
    const form = new FormData(); form.set('companyId', company); form.set('stockId', stock); form.set('photoId', photoId); form.set('requestId', requestId); form.set('file', new File([png], 'car.png', { type: 'image/png' })); form.set(extra, userId);
    const f = await fixture();
    const response = await f.post(new Request('https://app.example.test/api/vehicle-photos', { method: 'POST', headers: { Origin: 'https://app.example.test' }, body: form }));
    assert.equal(response.status, 400); assert.equal(f.uploads.length, 0);
  }
});

test('actual POST bounds streaming request bytes and cancels oversized bodies', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10485760 + 65537)); }, cancel() { cancelled = true; } });
  const f = await fixture();
  const request = new Request('https://app.example.test/api/vehicle-photos', { method: 'POST', headers: { Origin: 'https://app.example.test', 'Content-Type': 'multipart/form-data; boundary=test' }, body, duplex: 'half' });
  assert.equal((await f.post(request)).status, 400); assert.equal(cancelled, true);
  assert.equal(f.uploads.length, 0); assert.equal(f.counts().registrations, 0);
});

test('actual POST uses the decoded upload pipeline and returns a sanitized photo DTO', async () => {
  const form = new FormData(); form.set('companyId', company); form.set('stockId', stock); form.set('photoId', photoId); form.set('requestId', requestId); form.set('file', new File([png], 'car.png', { type: 'image/png' }));
  const f = await fixture();
  const response = await f.post(new Request('https://app.example.test/api/vehicle-photos', { method: 'POST', headers: { Origin: 'https://app.example.test' }, body: form }));
  assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.ok, true); assert.equal(result.photo.id, photoId);
  assert.equal(JSON.stringify(result).includes(path), false); assert.equal(JSON.stringify(result).includes('storageBucket'), false);
  assert.equal(f.counts().registrations, 1); assert.equal(f.counts().downloads, 1);
});
