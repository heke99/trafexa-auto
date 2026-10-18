import assert from 'node:assert/strict';
import {test} from 'node:test';
import {archiveId, ARCHIVE_COMPANY, ARCHIVE_DEALER, ARCHIVE_CUSTOMER, ARCHIVE_REQUEST, ARCHIVE_SIGNING, completedArchiveSource, digest} from './helpers/native-archive-fixture.mjs';

import {integration} from './helpers/native-archive-integration.mjs';

function privateHeaders(response) {
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal(response.headers.get('vary'), 'Cookie');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
}
async function originalResponse(harness, format, customer = false) {
  const response = await harness.get(format, customer);
  assert.equal(response.status, 200); privateHeaders(response);
  assert.match(response.headers.get('content-disposition'), /-original(?:\.pdf|-signeringsbevis\.json)/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const file = harness.state.archive[format];
  assert.deepEqual(bytes, harness.state.objects.get(file.objectPath).bytes);
  assert.equal(digest(bytes), file.sha256); assert.equal(bytes.length, file.bytes);
  return bytes;
}

test('native original integration: actual action, core readback, service registration and both GET exports preserve stored bytes when the renderer disappears', async () => {
  const h = await integration(), result = await h.archive();
  assert.equal(result.ok, true, JSON.stringify({result, calls: h.state.sdkCalls.map(call => call.slice(0, 2)), renders: h.state.renders.length, registrations: h.state.serviceCalls.length})); assert.equal(result.archive.id, h.state.archive.id);
  assert.equal(h.state.objects.size, 2); assert.equal(h.state.serviceCalls.length, 1); assert.equal(h.state.renders.length, 1);
  assert.deepEqual(h.state.invalidations, ['/deals', '/documents', '/my-contracts']);
  const read = await h.actions.getContractArchiveAction({companyId: ARCHIVE_COMPANY, signingId: ARCHIVE_SIGNING});
  assert.equal(read.ok, true); assert.deepEqual(read.archive, result.archive);
  h.state.rendererUnavailable = true;
  for (const customer of [false, true]) {
    const pdf = await originalResponse(h, 'pdf', customer), evidence = await originalResponse(h, 'evidence', customer);
    assert.equal(JSON.parse(new TextDecoder().decode(evidence)).signedPdfSha256, digest(pdf));
  }
  assert.equal(h.state.renders.length, 1); assert.equal(h.state.serviceCalls.length, 1);
});

test('native original integration: verified null allows generated downloads without a server key while archive creation stops before upload', async () => {
  const h = await integration({missingKey: true}), result = await h.archive();
  assert.equal(result.ok, false); assert.equal(result.code, 'configuration_missing');
  assert.equal(h.state.objects.size, 0); assert.equal(h.state.renders.length, 0); assert.equal(h.state.serviceCalls.length, 0);
  const pdf = await h.get('pdf'), evidence = await h.get('evidence');
  assert.equal(pdf.status, 200); assert.equal(evidence.status, 200); privateHeaders(pdf); privateHeaders(evidence);
  assert.match(pdf.headers.get('content-disposition'), /-genererad-kopia\.pdf/);
  assert.match(evidence.headers.get('content-disposition'), /-genererad-kopia-signeringsbevis\.json/);
  const bytes = new Uint8Array(await pdf.arrayBuffer()), proof = await evidence.json();
  assert.equal(new TextDecoder('ascii').decode(bytes.subarray(0, 5)), '%PDF-'); assert.equal(proof.signedPdfSha256, digest(bytes));
  assert.ok(h.state.renders.length >= 2); assert.equal(h.state.archive, null); assert.equal(h.state.objects.size, 0); assert.equal(h.state.serviceCalls.length, 0);
});

test('native original integration: corrupt registered PDF or evidence withholds either GET and never falls through to regenerated copies', async () => {
  const h = await integration(); assert.equal((await h.archive()).ok, true); h.state.rendererUnavailable = true;
  for (const damaged of ['pdf', 'evidence']) {
    const path = h.state.archive[damaged].objectPath, object = h.state.objects.get(path), saved = object.bytes;
    object.bytes = new Uint8Array(saved); object.bytes[object.bytes.length - 1] ^= 1;
    for (const format of ['pdf', 'evidence']) {
      const response = await h.get(format); assert.equal(response.status, 503); privateHeaders(response);
      assert.doesNotMatch(await response.text(), /%PDF-|PRIVATE|Originalvillkor/);
    }
    object.bytes = saved;
  }
  assert.equal(h.state.renders.length, 1); assert.equal(h.state.serviceCalls.length, 1);
});

test('native original integration: racing different valid rendered pairs converge on the first registered original through the losing action and actual GETs', async () => {
  const h = await integration({racingRenderers: true});
  const [first, second] = await Promise.all([h.archive(), h.archive(archiveId(30))]);
  assert.equal(first.ok, true, JSON.stringify({first, second, renders: h.state.renders.length, registrations: h.state.serviceCalls.length})); assert.equal(second.ok, true); assert.deepEqual(first.archive, second.archive);
  assert.equal(h.state.renders.length, 2); assert.notEqual(digest(h.state.renders[0]), digest(h.state.renders[1]));
  assert.equal(h.state.serviceCalls.length, 2); assert.notEqual(h.state.serviceCalls[0].p_pdf_sha256, h.state.serviceCalls[1].p_pdf_sha256);
  assert.equal(first.archive.pdf.sha256, h.state.serviceCalls[0].p_pdf_sha256);
  assert.equal(h.state.objects.size, 4);
  h.state.rendererUnavailable = true;
  const pdf = await originalResponse(h, 'pdf'), evidence = await originalResponse(h, 'evidence');
  assert.equal(JSON.parse(new TextDecoder().decode(evidence)).signedPdfSha256, digest(pdf));
});

test('native original integration: a partial two-file upload is not registered and exact same-request retry completes the stored original', async () => {
  const h = await integration(); h.state.failEvidenceUpload = true;
  const first = await h.archive(); assert.equal(first.ok, false); assert.equal(h.state.archive, null);
  assert.equal(h.state.serviceCalls.length, 0); assert.equal(h.state.objects.size, 1);
  const partial = await h.actions.getContractArchiveAction({companyId: ARCHIVE_COMPANY, signingId: ARCHIVE_SIGNING});
  assert.equal(partial.ok, true); assert.equal(partial.archive, null);
  h.state.failEvidenceUpload = false;
  const second = await h.archive(); assert.equal(second.ok, true); assert.equal(h.state.objects.size, 2);
  assert.equal(h.state.serviceCalls.length, 1); assert.equal(h.state.serviceCalls[0].p_request_id, ARCHIVE_REQUEST);
  h.state.rendererUnavailable = true; await originalResponse(h, 'pdf'); await originalResponse(h, 'evidence');
});

test('native original integration: account or membership revocation after Storage readback withholds private GET bytes', async () => {
  for (const revoke of [state => {state.accountStatus = 'suspended';}, state => {state.role = 'viewer';}]) {
    const h = await integration(); assert.equal((await h.archive()).ok, true); h.state.rendererUnavailable = true;
    let delivered = 0;
    h.state.onDownload = () => {if (++delivered === 2) {h.state.onDownload = null; revoke(h.state);}};
    const response = await h.get('pdf'); assert.equal(response.status, 403); privateHeaders(response);
    assert.doesNotMatch(await response.text(), /%PDF-|PRIVATE|Originalvillkor/); assert.equal(h.state.renders.length, 1);
  }
});

test('native original integration: a public bucket blocks verified-null fallback and a mid-download privacy change blocks registered originals', async () => {
  const missing = await integration({missingKey: true}); missing.state.bucketPrivate = false;
  const denied = await missing.get('pdf'); assert.equal(denied.status, 403); privateHeaders(denied);
  assert.equal(missing.state.renders.length, 0); assert.equal(missing.state.serviceCalls.length, 0);
  const h = await integration(); assert.equal((await h.archive()).ok, true); h.state.rendererUnavailable = true;
  let delivered = 0;
  h.state.onDownload = () => {if (++delivered === 2) {h.state.onDownload = null; h.state.bucketPrivate = false;}};
  const response = await h.get('evidence'); assert.equal(response.status, 403); privateHeaders(response);
  assert.doesNotMatch(await response.text(), /PRIVATE|documentContentSha256/); assert.equal(h.state.renders.length, 1);
});
