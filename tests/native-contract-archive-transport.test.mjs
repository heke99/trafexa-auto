import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNativeContractArchiveRegistrationClient, createNativeContractArchiveUploader, contractArchivePaths, nativeArchiveOperation } from '../src/lib/documents/native-contract-archive.ts';
import { digest, ARCHIVE_COMPANY as companyId, ARCHIVE_SIGNING as signingId, ARCHIVE_DEALER as actorUserId, ARCHIVE_REQUEST as requestId } from './helpers/native-archive-fixture.mjs';

const token = role => `header.${Buffer.from(JSON.stringify({ role, sub: actorUserId })).toString('base64url')}.signature`;
const key = 'sb_secret_fixture_private_capability_12345';
const publishableKey = 'sb_publishable_fixture_public_capability_12345';
const supabaseUrl = 'https://project.supabase.co';
const payload = { companyId, signingId, actorUserId, requestId, documentContentSha256: 'a'.repeat(64), revision: 3, pdfSha256: 'b'.repeat(64), pdfBytes: 1234, evidenceSha256: 'c'.repeat(64), evidenceBytes: 1000, rendererVersion: 'trafexa-native-v1' };
const content = new TextEncoder().encode('%PDF-transport-fixture');
const path = contractArchivePaths(companyId, signingId, digest(content), 'c'.repeat(64)).pdf;
const control = () => ({ signal: new AbortController().signal });

test('service capability sends only frozen registration fields to the exact RPC with no storage capability', async () => {
  for (const serviceKey of [key, token('service_role')]) {
    const calls = [];
    const client = createNativeContractArchiveRegistrationClient({ supabaseUrl, serviceKey, fetchImpl: async (url, options) => {
      const request = new Request(url, options); calls.push(request);
      assert.equal(request.url, `${supabaseUrl}/rest/v1/rpc/register_contract_signing_archive`);
      assert.equal(request.method, 'POST'); assert.equal(request.redirect, 'error'); assert.equal(request.cache, 'no-store');
      assert.equal(request.headers.get('apikey'), serviceKey);
      assert.equal(request.headers.get('authorization'), serviceKey.startsWith('sb_secret_') ? null : `Bearer ${serviceKey}`);
      assert.deepEqual(await request.json(), { p_company_id: companyId, p_signing_id: signingId, p_actor_user_id: actorUserId, p_request_id: requestId, p_document_content_sha256: payload.documentContentSha256, p_revision: 3, p_pdf_sha256: payload.pdfSha256, p_pdf_bytes: 1234, p_evidence_sha256: payload.evidenceSha256, p_evidence_bytes: 1000, p_renderer_version: 'trafexa-native-v1' });
      return Response.json({ fixture: 'registration-receipt' });
    } });
    assert.deepEqual(await client.register(payload, control()), { fixture: 'registration-receipt' });
    assert.equal(calls.length, 1);
  }
});

test('registration I/O budget starts at invocation after the prepared client has been idle', async () => {
  let called = 0;
  const client = createNativeContractArchiveRegistrationClient({ supabaseUrl, serviceKey: key, timeoutMs: 25, fetchImpl: async () => { called++; return Response.json({ ok: true }); } });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.deepEqual(await client.register(payload, control()), { ok: true }); assert.equal(called, 1);
});

test('raw storage POST enforces user JWT plus publishable key, exact bytes/path and immutable upload headers', async () => {
  let calls = 0; const signal = new AbortController().signal;
  const uploader = createNativeContractArchiveUploader({ supabaseUrl, publishableKey, fetchImpl: async (url, options) => {
    calls++; assert.equal(options.signal, signal);
    const request = new Request(url, options);
    assert.equal(request.url, `${supabaseUrl}/storage/v1/object/native-contract-originals/${path}`);
    assert.equal(request.headers.get('apikey'), publishableKey);
    assert.equal(request.headers.get('authorization'), `Bearer ${token('authenticated')}`);
    assert.equal(request.headers.get('x-upsert'), 'false'); assert.equal(request.headers.get('content-type'), 'application/pdf');
    assert.equal(request.headers.get('cache-control'), 'max-age=0'); assert.equal(request.redirect, 'error'); assert.equal(request.cache, 'no-store');
    assert.deepEqual(new Uint8Array(await request.arrayBuffer()), content);
    return Response.json({ Key: `native-contract-originals/${path}`, Id: actorUserId });
  } });
  await uploader.upload(path, content, 'application/pdf', token('authenticated'), { signal }); assert.equal(calls, 1);
});

test('service keys, anonymous tokens, foreign path syntax, mismatched content and MIME never reach Storage', async () => {
  let calls = 0;
  const uploader = createNativeContractArchiveUploader({ supabaseUrl, publishableKey, fetchImpl: async () => { calls++; throw Error('must not send'); } });
  for (const [objectPath, bytes, mime, userToken] of [
    [path, content, 'application/pdf', token('service_role')], [path, content, 'application/pdf', token('anon')],
    [`${path}/../foreign`, content, 'application/pdf', token('authenticated')],
    [path, new TextEncoder().encode('%PDF-substituted'), 'application/pdf', token('authenticated')],
    [path, content, 'application/json', token('authenticated')],
  ]) await assert.rejects(uploader.upload(objectPath, bytes, mime, userToken, control()));
  assert.equal(calls, 0);
});

test('configuration rejects missing/service-role-public credentials and credentials cannot alter endpoint URLs', () => {
  for (const config of [{ serviceKey: '' }, { serviceKey: token('anon') }, { serviceKey: publishableKey }, { supabaseUrl: 'http://project.supabase.co' }, { supabaseUrl: 'https://u:p@project.supabase.co' }, { supabaseUrl: 'https://project.supabase.co/path' }]) assert.throws(() => createNativeContractArchiveRegistrationClient({ supabaseUrl, serviceKey: key, ...config }), { code: 'configuration_missing' });
  for (const publicKey of ['', key, token('service_role')]) assert.throws(() => createNativeContractArchiveUploader({ supabaseUrl, publishableKey: publicKey }), { code: 'configuration_missing' });
});

test('response streams are bounded and cancelled instead of exposing oversized RPC or Storage bodies', async () => {
  for (const kind of ['register', 'upload']) {
    let cancelled = false;
    const fetchImpl = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(32769)); }, cancel() { cancelled = true; } }));
    const operation = kind === 'register'
      ? createNativeContractArchiveRegistrationClient({ supabaseUrl, serviceKey: key, fetchImpl }).register(payload, control())
      : createNativeContractArchiveUploader({ supabaseUrl, publishableKey, fetchImpl }).upload(path, content, 'application/pdf', token('authenticated'), control());
    await assert.rejects(operation); assert.equal(cancelled, true);
  }
});

test('bounded network operations deliver AbortSignal cancellation to pending raw uploads and registration', async () => {
  for (const kind of ['register', 'upload']) {
    let aborted = false;
    const fetchImpl = async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
    const bounded = nativeArchiveOperation(15);
    const operation = kind === 'register'
      ? bounded(control => createNativeContractArchiveRegistrationClient({ supabaseUrl, serviceKey: key, fetchImpl }).register(payload, control))
      : bounded(control => createNativeContractArchiveUploader({ supabaseUrl, publishableKey, fetchImpl }).upload(path, content, 'application/pdf', token('authenticated'), control));
    await assert.rejects(operation); assert.equal(aborted, true);
  }
});
