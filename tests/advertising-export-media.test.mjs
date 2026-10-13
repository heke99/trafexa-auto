import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createSourceLoader } from './helpers/source-loader.mjs';

class PhotoError extends Error {}
const loader = await createSourceLoader({ '@/lib/vehicle-photos/server': { PhotoError } });
const { createAdvertisingExportMediaResolver } = loader.load('@/lib/vehicle-photos/export-media');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-13T12:00:00Z');
const PROJECT = 'https://project.supabase.co';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const originals = new Map(await Promise.all(['jpeg', 'png', 'webp'].map(async (format) => [format, await sharp({ create: { width: 12, height: 8, channels: 3, background: '#4a7391' } })
  .withExif({ IFD0: { Artist: 'PRIVATE_OWNER', ImageDescription: 'PRIVATE_LOCATION' } }).toFormat(format).toBuffer()])));
function fixture(format = 'jpeg') {
  const source = originals.get(format);
  const contentType = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
  const extension = format === 'jpeg' ? 'jpg' : format;
  const photo = { id: id(1), companyId: id(2), stockId: id(3), objectPath: `${id(2)}/${id(3)}/${id(1)}.${extension}`,
    contentType, sizeBytes: source.length, version: 1, status: 'active', createdAt: NOW.toISOString(),
    storageBucket: 'ads-vehicle-photos', storageVisibility: 'private' };
  const calls = [];
  const buckets = new Map([['ads-vehicle-photos', { id: 'ads-vehicle-photos', public: false }], ['ads-export-media', { id: 'ads-export-media', public: false }]]);
  const exports = new Map();
  const behavior = { source, corruptReadback: false, uploadError: false, signedUrlOverride: null, sourceBlobOverride: null,
    async afterUpload() {}, async afterSign() {} };
  const client = { storage: {
    async getBucket(bucket) { calls.push(['bucket', bucket]); return { data: buckets.get(bucket), error: null }; },
    from(bucket) { return {
      async download(path) {
        calls.push(['download', bucket, path]);
        if (bucket === 'ads-vehicle-photos') {
          assert.equal(path, photo.objectPath);
          return { data: behavior.sourceBlobOverride ?? new Blob([behavior.source], { type: contentType }), error: null };
        }
        let bytes = exports.get(path);
        if (!bytes) return { data: null, error: { statusCode: '404' } };
        if (behavior.corruptReadback) { bytes = new Uint8Array(bytes); bytes[0] ^= 1; }
        return { data: new Blob([bytes], { type: contentType }), error: null };
      },
      async upload(path, bytes, options) {
        calls.push(['upload', bucket, path, options]);
        assert.equal(bucket, 'ads-export-media'); assert.equal(options.upsert, false);
        if (exports.has(path)) return { data: null, error: { statusCode: '409' } };
        if (behavior.uploadError) return { data: null, error: { statusCode: '403', message: 'secret-token' } };
        exports.set(path, new Uint8Array(bytes)); await behavior.afterUpload();
        return { data: { path }, error: null };
      },
      async createSignedUrl(path, expiresIn) {
        calls.push(['sign', bucket, path, expiresIn]); assert.equal(bucket, 'ads-export-media');
        await behavior.afterSign();
        return { data: { signedUrl: behavior.signedUrlOverride ?? `${PROJECT}/storage/v1/object/sign/ads-export-media/${path}?token=server-generated` }, error: null };
      },
    }; },
  } };
  return { photo, source, exports, calls, buckets, behavior, client, options: { enabled: true, client, projectOrigin: PROJECT, now: () => NOW } };
}

test('export resolver is disabled by default and never touches storage', async () => {
  const f = fixture(); delete f.options.enabled;
  await assert.rejects(createAdvertisingExportMediaResolver(f.options).resolve(f.photo), (e) => e.code === 'disabled');
  assert.deepEqual(f.calls, []);
});
test('real JPEG, PNG and WebP originals are decoded and stripped of EXIF before export and signed only after actual SHA readback', async () => {
  for (const format of ['jpeg', 'png', 'webp']) {
    const f = fixture(format); assert.ok((await sharp(f.source).metadata()).exif);
    const resolver = createAdvertisingExportMediaResolver(f.options);
    const proof = await resolver.resolve(f.photo);
    const exported = f.exports.get(proof.objectPath);
    assert.ok(exported); assert.notEqual(hash(exported), hash(f.source));
    assert.equal((await sharp(exported).metadata()).exif, undefined);
    assert.equal((await sharp(exported).metadata()).icc, undefined);
    assert.equal(proof.sha256, hash(exported)); assert.equal(proof.normalizationVersion, 'vehicle-photo-v1');
    const suffix = format === 'jpeg' ? 'jpg' : format;
    assert.equal(proof.objectPath, `${id(2)}/${id(3)}/${id(1)}/${proof.sha256}.${suffix}`);
    assert.ok(proof.url.startsWith(`${PROJECT}/storage/v1/object/sign/ads-export-media/`));
    assert.equal(proof.expiresAt, '2026-10-15T12:00:00.000Z');
    const upload = f.calls.findIndex(([kind]) => kind === 'upload');
    const readback = f.calls.findIndex(([kind, bucket]) => kind === 'download' && bucket === 'ads-export-media');
    const sign = f.calls.findIndex(([kind]) => kind === 'sign');
    assert.ok(upload < readback && readback < sign);
    assert.ok(!f.calls.some(([kind, bucket]) => kind === 'sign' && bucket === 'ads-vehicle-photos'));
    assert.equal(resolver.origin, PROJECT);
  }
});
test('an immutable existing normalized object can be reused only after real readback, without upsert', async () => {
  const f = fixture(); const resolver = createAdvertisingExportMediaResolver(f.options);
  const first = await resolver.resolve(f.photo); const second = await resolver.resolve(f.photo);
  assert.equal(first.sha256, second.sha256); assert.equal(first.objectPath, second.objectPath);
  assert.equal(f.exports.size, 1); assert.equal(f.calls.filter(([kind]) => kind === 'sign').length, 2);
  assert.ok(f.calls.filter(([kind]) => kind === 'upload').every(([, , , options]) => options.upsert === false));
});
test('untrusted photo scope, traversal, archived identity and false MIME never create exported bytes', async () => {
  for (const mutate of [p => { p.objectPath = `${id(9)}/${id(3)}/${id(1)}.jpg`; }, p => { p.objectPath += '/../evil'; },
    p => { p.status = 'archived'; }, p => { p.storageVisibility = 'public'; }, p => { p.contentType = 'text/html'; }]) {
    const f = fixture(); mutate(f.photo);
    await assert.rejects(createAdvertisingExportMediaResolver(f.options).resolve(f.photo), e => e.code === 'invalid_photo');
    assert.deepEqual(f.calls, []);
  }
  const f = fixture(); f.behavior.source = Buffer.from('<script>secret</script>'); f.photo.sizeBytes = f.behavior.source.length;
  await assert.rejects(createAdvertisingExportMediaResolver(f.options).resolve(f.photo), e => e.code === 'invalid_photo');
  assert.ok(!f.calls.some(([kind]) => kind === 'upload' || kind === 'sign'));
});
test('declared byte count is not trusted and actual source mismatch cannot be exported', async () => {
  const f = fixture(); f.photo.sizeBytes += 1;
  await assert.rejects(createAdvertisingExportMediaResolver(f.options).resolve(f.photo), e => e.code === 'unavailable');
  assert.ok(!f.calls.some(([kind]) => kind === 'upload' || kind === 'sign'));
});
test('upload receipt alone or corrupt actual readback can never grant an export URL', async () => {
  for (const behavior of ['corruptReadback', 'uploadError']) {
    const f = fixture(); f.behavior[behavior] = true;
    await assert.rejects(createAdvertisingExportMediaResolver(f.options).resolve(f.photo), e => ['stored_file_mismatch', 'unavailable'].includes(e.code) && !e.message.includes('secret-token'));
    assert.ok(!f.calls.some(([kind]) => kind === 'sign'));
  }
});
test('both buckets must remain private before uploads and before exposing the signed result', async () => {
  for (const bucket of ['ads-vehicle-photos', 'ads-export-media']) {
    const f = fixture(); f.buckets.get(bucket).public = true;
    await assert.rejects(createAdvertisingExportMediaResolver(f.options).resolve(f.photo), e => e.code === 'private_storage_required');
    assert.ok(!f.calls.some(([kind]) => kind === 'download' || kind === 'upload' || kind === 'sign'));
  }
  for (const moment of ['afterUpload', 'afterSign']) {
    const f = fixture(); f.behavior[moment] = async () => { f.buckets.get('ads-export-media').public = true; };
    await assert.rejects(createAdvertisingExportMediaResolver(f.options).resolve(f.photo), e => e.code === 'private_storage_required');
    if (moment === 'afterUpload') assert.ok(!f.calls.some(([kind]) => kind === 'sign'));
  }
});
test('signed URL must use the exact trusted project, normalized bucket/object and an access token', async () => {
  for (const override of ['https://evil.example/photo?token=secret', `${PROJECT}/storage/v1/object/sign/ads-vehicle-photos/evil.jpg?token=secret`,
    `${PROJECT}/storage/v1/object/sign/ads-export-media/another.jpg?token=secret`, 'javascript:alert(1)', 'not a url']) {
    const f = fixture(); f.behavior.signedUrlOverride = override;
    await assert.rejects(createAdvertisingExportMediaResolver(f.options).resolve(f.photo), e => e.code === 'unavailable');
  }
  const f = fixture(); f.behavior.afterUpload = async () => {
    f.behavior.signedUrlOverride = `${PROJECT}/storage/v1/object/sign/ads-export-media/${[...f.exports.keys()][0]}`;
  };
  await assert.rejects(createAdvertisingExportMediaResolver(f.options).resolve(f.photo), e => e.code === 'unavailable');
});
test('invalid trusted origin or short URL lifetime is rejected before storage operations', () => {
  for (const projectOrigin of ['http://project.supabase.co', 'https://project.supabase.co/untrusted', 'https://user:pass@project.supabase.co', 'https://project.supabase.co?redirect=evil']) {
    const f = fixture(); f.options.projectOrigin = projectOrigin;
    assert.throws(() => createAdvertisingExportMediaResolver(f.options), e => e.code === 'invalid_configuration');
    assert.deepEqual(f.calls, []);
  }
  const f = fixture(); f.options.expiresInSeconds = 86400;
  assert.throws(() => createAdvertisingExportMediaResolver(f.options), e => e.code === 'invalid_configuration');
});
