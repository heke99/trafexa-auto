import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ArchivedOfferDownloadError, createArchivedOfferDownloader } from '../src/lib/documents/archived-offer-download.ts';
import { createSourceLoader } from './helpers/source-loader.mjs';

const company = '10000000-0000-4000-8000-000000000001';
const document = '20000000-0000-4000-8000-000000000002';
const offer = '30000000-0000-4000-8000-000000000003';
const bytes = Buffer.from('%PDF-1.7\nimmutable archived offer');
const hash = createHash('sha256').update(bytes).digest('hex');
const proof = () => ({ company_id: company, document_id: document, offer_id: offer, offer_version: 4,
  pdf_sha256: hash, document_kind: 'other', storage_bucket: 'dealer-documents', storage_visibility: 'private',
  object_path: `${company}/offers/${offer}/v4/${hash}.pdf` });
const error = code => value => value instanceof ArchivedOfferDownloadError && value.code === code;

test('download uses the exact company binding, actual bytes and fresh privacy receipt after IO', async () => {
  let reads = 0;
  const downloader = createArchivedOfferDownloader({
    async readRecord(c, d) { assert.equal(c, company); assert.equal(d, document); reads++; return proof(); },
    async download(path) { assert.equal(path, proof().object_path); return new Blob([bytes]); },
  });
  const result = await downloader.read(company, document);
  assert.equal(reads, 2); assert.deepEqual(Buffer.from(result.bytes), bytes);
  assert.equal(result.filename, `offert-${offer}-v4.pdf`);
});
test('another company, unsafe path, public bucket and contract kind are refused before file download', async () => {
  for (const changes of [{ company_id: document }, { document_id: company }, { object_path: `${company}/../file.pdf` }, { storage_visibility: 'public' }, { document_kind: 'contract' }, { storage_bucket: 'public-files' }, { offer_version: 0 }]) {
    let downloads = 0;
    const downloader = createArchivedOfferDownloader({ async readRecord() { return { ...proof(), ...changes }; }, async download() { downloads++; return new Blob([bytes]); } });
    await assert.rejects(downloader.read(company, document), error('invalid_archive'));
    assert.equal(downloads, 0);
  }
});
test('changed file bytes and non-PDF files cannot be returned as archived offers', async () => {
  for (const file of [Buffer.from('%PDF-changed'), Buffer.from('<html>')]) {
    const downloader = createArchivedOfferDownloader({ async readRecord() { return proof(); }, async download() { return new Blob([file]); } });
    await assert.rejects(downloader.read(company, document), error('invalid_archive'));
  }
});
test('public bucket or changed binding observed after download never returns the bytes', async () => {
  for (const changes of [{ storage_visibility: 'public' }, { offer_version: 5 }, { pdf_sha256: '0'.repeat(64) }]) {
    let reads = 0;
    const downloader = createArchivedOfferDownloader({ async readRecord() { return ++reads === 1 ? proof() : { ...proof(), ...changes }; }, async download() { return new Blob([bytes]); } });
    await assert.rejects(downloader.read(company, document), error('invalid_archive'));
  }
});
test('missing archive, invalid identity, failed IO and stalled reader remain controlled failures', async () => {
  const missing = createArchivedOfferDownloader({ async readRecord() { return null; }, async download() { throw Error('must not download'); } });
  await assert.rejects(missing.read(company, document), error('not_found'));
  await assert.rejects(missing.read('invalid', document), error('invalid_input'));
  const failed = createArchivedOfferDownloader({ async readRecord() { throw Error('sensitive provider response'); }, async download() { throw Error(); } });
  await assert.rejects(failed.read(company, document), error('unavailable'));
  const stalled = createArchivedOfferDownloader({ timeoutMs: 10, async readRecord() { return new Promise(() => {}); }, async download() { throw Error(); } });
  await assert.rejects(stalled.read(company, document), error('unavailable'));
});

async function route(role = 'finance', config = {}) {
  let reads = 0, downloads = 0;
  const loader = await createSourceLoader({ '@/lib/data/company-context': {
    async getActiveCompanyContext() {
      if (config.unauthenticated) throw Error('not logged in');
      return { company, role, db: {
        async rpc(name, args) { reads++; assert.equal(name, 'get_offer_archive_by_document'); assert.deepEqual(args, { p_company_id: company, p_document_id: document }); return { data: config.missing ? null : proof(), error: null }; },
        storage: { from(bucket) { assert.equal(bucket, 'dealer-documents'); return { async download(path) { downloads++; assert.equal(path, proof().object_path); return { data: new Blob([config.corrupt ? '%PDF-wrong' : bytes]), error: null }; } }; } },
      } };
    },
  } });
  const handler = loader.load('src/app/api/documents/[documentId]/pdf/route.ts');
  return { get: () => handler.GET(new Request(`https://app.example.com/api/documents/${document}/pdf?company_id=${offer}`), { params: Promise.resolve({ documentId: document }) }), counts: () => ({ reads, downloads }) };
}
test('actual route returns authenticated private PDF without accepting query-selected companies or signing URLs', async () => {
  const r = await route(); const response = await r.get();
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('cache-control'), /private, no-store/); assert.equal(response.headers.get('vary'), 'Cookie');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes); assert.deepEqual(r.counts(), { reads: 2, downloads: 1 });
});
test('actual route denies unauthenticated, sales and viewer callers before archive lookup', async () => {
  for (const [role, config, status] of [['owner', { unauthenticated: true }, 401], ['sales', {}, 403], ['viewer', {}, 403]]) {
    const r = await route(role, config); assert.equal((await r.get()).status, status);
    assert.deepEqual(r.counts(), { reads: 0, downloads: 0 });
  }
});
test('actual route does not release absent archive or corrupt file contents', async () => {
  for (const [config, status] of [[{ missing: true }, 404], [{ corrupt: true }, 503]]) {
    const r = await route('owner', config); const response = await r.get();
    assert.equal(response.status, status); assert.ok(!(await response.text()).startsWith('%PDF-'));
  }
});
