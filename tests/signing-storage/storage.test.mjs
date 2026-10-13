import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPrivateSigningStorage, SigningStorageError } from '../../src/lib/documents/signing-storage.ts';

const companyId = '20000000-0000-4000-8000-000000000002';
const source = Buffer.from('%PDF-1.7\nsource');
const signed = Buffer.from('%PDF-1.7\nsigned');
const audit = Buffer.from('%PDF-1.7\naudit');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const context = { id: '10000000-0000-4000-8000-000000000001', companyId,
  documentId: '30000000-0000-4000-8000-000000000003', dealId: null,
  documentVersion: 1, sourceSha256: digest(source), templateId: 44,
  templateVersion: 1, templateSha256: 'a'.repeat(64) };
const input = { context, submissionId: 9001, signedPdfSourceUrl: 'https://files.example.com/signed?token=private', auditSourceUrl: 'https://files.example.com/audit?token=private' };
const error = code => value => value instanceof SigningStorageError && value.code === code;
function harness(options = {}) {
  const objects = new Map([[`${companyId}/source.pdf`, source]]);
  const counts = { bucket: 0, upload: 0, download: 0, fetch: 0 };
  const client = { storage: {
    async getBucket(name) { counts.bucket++; return { data: { id: name, public: options.public === true || Boolean(options.publicAfter && counts.bucket >= options.publicAfter) }, error: null }; },
    from(name) {
      assert.equal(name, 'dealer-documents');
      return {
        async download(path) { counts.download++; return { data: objects.has(path) ? new Blob([objects.get(path)]) : null, error: objects.has(path) ? null : {} }; },
        async upload(path, bytes, config) {
          counts.upload++; assert.equal(config.upsert, false); assert.equal(config.contentType, 'application/pdf');
          if (objects.has(path)) return { data: null, error: { status: 409 } };
          objects.set(path, options.corrupt ? Buffer.from('%PDF-corrupted') : new Uint8Array(bytes));
          return { data: { path }, error: null };
        },
      };
    },
  } };
  const fetchImpl = async (url, init) => {
    counts.fetch++;
    assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.equal(init.headers, undefined);
    return options.response ? options.response(url, init) : new Response(url.includes('/signed') ? signed : audit);
  };
  return { ...createPrivateSigningStorage({ client, allowedDownloadOrigins: options.origins ?? ['https://files.example.com'], fetchImpl, timeoutMs: options.timeoutMs ?? 1000 }), objects, counts };
}

test('source reads require actual private bucket metadata and return actual bytes', async () => {
  const h = harness();
  const result = await h.readPrivateObject({ context, objectPath: `${companyId}/source.pdf` });
  assert.deepEqual(Buffer.from(result.bytes), source); assert.equal(result.storageVisibility, 'private');
  assert.equal(h.counts.bucket, 2);
});
test('another tenant and traversal paths fail before storage access', async () => {
  for (const objectPath of ['other/source.pdf', `${companyId}/../source.pdf`, `${companyId}/%2e%2e/source.pdf`, `${companyId}//source.pdf`]) {
    const h = harness(); await assert.rejects(h.readPrivateObject({ context, objectPath }), error('invalid_context'));
    assert.equal(h.counts.bucket, 0); assert.equal(h.counts.download, 0);
  }
});
test('public buckets and a bucket becoming public while reading fail closed', async () => {
  for (const options of [{ public: true }, { publicAfter: 2 }]) {
    const h = harness(options); await assert.rejects(h.readPrivateObject({ context, objectPath: `${companyId}/source.pdf` }), error('private_storage_required'));
  }
});
test('archive downloads only configured HTTPS origins and sends no service credentials', async () => {
  const h = harness(); const result = await h.archive.store(input);
  assert.equal(h.counts.fetch, 2); assert.equal(h.counts.upload, 2);
  assert.equal(result.signedPdf.path, `${companyId}/signing/${context.id}/v1/signed-${digest(signed)}.pdf`);
  assert.deepEqual(Buffer.from((await h.archive.readStored({ context, path: result.audit.path })).bytes), audit);
});
test('missing allowlist, wrong origin, credentials, fragments and plain HTTP never fetch', async () => {
  for (const url of ['http://files.example.com/signed', 'https://attacker.example.com/signed', 'https://user:pass@files.example.com/signed', 'https://files.example.com/signed#secret']) {
    const h = harness(); await assert.rejects(h.archive.store({ ...input, signedPdfSourceUrl: url }), error('download_denied'));
    assert.equal(h.counts.fetch, 0); assert.equal(h.counts.upload, 0);
  }
  const h = harness({ origins: [] }); await assert.rejects(h.archive.store(input), error('download_denied'));
});
test('immutable upload conflicts are idempotent only after exact private readback', async () => {
  const h = harness(); const first = await h.archive.store(input); const second = await h.archive.store(input);
  assert.deepEqual(second, first); assert.equal(h.objects.size, 3); assert.equal(h.counts.upload, 4);
  h.objects.set(first.signedPdf.path, Buffer.from('%PDF-different'));
  await assert.rejects(h.archive.store(input), error('stored_file_mismatch'));
});
test('changed stored bytes never count as successful archival', async () => {
  const h = harness({ corrupt: true }); await assert.rejects(h.archive.store(input), error('stored_file_mismatch'));
});
test('non-PDF and oversized provider responses fail before any upload', async () => {
  for (const response of [() => new Response('HTML login page'), () => new Response(signed, { headers: { 'content-length': String(51 * 1024 * 1024) } }), () => new Response(null, { status: 302 })]) {
    const h = harness({ response }); await assert.rejects(h.archive.store(input), value => value instanceof SigningStorageError);
    assert.equal(h.counts.upload, 0);
  }
});
test('stalled download and streamed response bodies are bounded', async () => {
  for (const response of [() => new Promise(() => {}), () => new Response(new ReadableStream({ start() {} }))]) {
    const h = harness({ response, timeoutMs: 10 }); await assert.rejects(h.archive.store(input), error('unavailable'));
    assert.equal(h.counts.upload, 0);
  }
});
test('unsafe allowlist configuration and unbound contexts are rejected', async () => {
  for (const origin of ['http://files.example.com', 'https://files.example.com/path', 'https://user:pass@files.example.com']) assert.throws(() => harness({ origins: [origin] }), error('invalid_configuration'));
  const h = harness(); await assert.rejects(h.archive.store({ ...input, context: { ...context, documentVersion: 0 } }), error('invalid_context'));
});
