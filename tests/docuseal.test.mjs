import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createDocuSealClient, DocuSealError, verifyDocuSealWebhook, parseVerifiedDocuSealWebhook } from '../src/lib/signing/docuseal.ts';

const KEY = 'private-docuseal-key';
const SECRET = `whsec_${Buffer.alloc(24, 7).toString('base64')}`;
const NOW = 1791907200;
const signer = (changes = {}) => ({ id: 101, submission_id: 9001, role: 'Buyer', email: 'buyer@example.com', status: 'awaiting', external_id: 'dispatch-1:buyer', completed_at: null, declined_at: null, embed_src: 'https://sign.example.com/s/opaque', secret: KEY, ...changes });
const submission = (changes = {}) => ({ id: 9001, status: 'pending', completed_at: null, archived_at: null, submitters: [signer()], documents: [], audit_log_url: null, combined_document_url: null, private_provider_error: KEY, ...changes });
const input = () => ({ templateId: 44, signers: [{ role: 'Buyer', email: 'buyer@example.com', name: 'Buyer', externalId: 'dispatch-1:buyer', values: { Brand: 'Volvo', Price: 1000, Confirmed: false } }] });
const encode = (event) => Buffer.from(JSON.stringify(event));
const signature = (body, signedAt = NOW, secret = SECRET) => `${signedAt}.${createHmac('sha256', secret).update(`${signedAt}.`).update(body).digest('hex')}`;
const event = (changes = {}) => ({ event_type: 'submission.completed', timestamp: '2026-10-13T00:00:00Z', data: { id: 9001, status: 'completed', metadata: { company_id: 'untrusted', deal_id: 'untrusted' } }, ...changes });

function client(result, config = {}) {
  const calls = [];
  const adapter = createDocuSealClient({ baseUrl: 'https://api.docuseal.com', apiKey: KEY, enabled: true, timeoutMs: 50, fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    if (result instanceof Error) throw result;
    if (typeof result === 'function') return result(url, options);
    return Response.json(result);
  }, ...config });
  return { adapter, calls };
}
function isError(code) {
  return error => error instanceof DocuSealError && error.code === code && !error.message.includes(KEY);
}

test('existing-template creation uses official auth/fields and never sends email or SMS', async () => {
  const { adapter, calls } = client([signer()]);
  const result = await adapter.createSubmission(input());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.docuseal.com/submissions');
  assert.equal(calls[0].headers['X-Auth-Token'], KEY);
  assert.equal(calls[0].redirect, 'error');
  assert.equal(calls[0].cache, 'no-store');
  assert.equal(calls[0].headers['Idempotency-Key'], undefined);
  const body = JSON.parse(calls[0].body);
  assert.equal(body.template_id, 44);
  assert.equal(body.send_email, false);
  assert.equal(body.send_sms, false);
  assert.equal(body.submitters[0].send_email, false);
  assert.equal(body.submitters[0].send_sms, false);
  assert.equal(body.submitters[0].completed, undefined);
  assert.equal(body.submitters[0].external_id, 'dispatch-1:buyer');
  assert.deepEqual(body.submitters[0].values, input().signers[0].values);
  assert.equal(result.submissionId, 9001);
  assert.equal(result.submitters[0].id, 101);
  assert.equal(result.submitters[0].submissionId, 9001);
  assert.equal(result.submitters[0].secret, undefined);
});

test('self-hosted API base preserves /api path; GET response is sanitized', async () => {
  const { adapter, calls } = client(submission(), { baseUrl: 'https://docuseal.example.com/api/' });
  const result = await adapter.getSubmission(9001);
  assert.equal(calls[0].url, 'https://docuseal.example.com/api/submissions/9001');
  assert.equal(calls[0].method, 'GET');
  assert.equal(result.id, 9001);
  assert.equal(result.private_provider_error, undefined);
  assert.equal(result.submitters[0].secret, undefined);
});

test('creation is disabled by default and requires explicit activation; reads remain available', async () => {
  for (const enabled of [undefined, false]) {
    const { adapter, calls } = client(submission(), { enabled });
    await assert.rejects(adapter.createSubmission(input()), isError('disabled'));
    assert.equal(calls.length, 0);
    assert.equal((await adapter.getSubmission(9001)).id, 9001);
    assert.equal(calls.length, 1);
  }
});

test('GET completion/download information remains provider data without local status effects', async () => {
  const { adapter } = client(submission({ status: 'completed', completed_at: '2026-10-13T12:00:00Z', documents: [{ name: 'contract.pdf', url: 'https://docuseal.com/file/temporary-token' }], audit_log_url: 'https://docuseal.com/file/audit', combined_document_url: 'https://docuseal.com/file/combined', submitters: [signer({ status: 'completed', completed_at: '2026-10-13T12:00:00Z' })] }));
  const result = await adapter.getSubmission(9001);
  assert.equal(result.status, 'completed');
  assert.equal(result.documents[0].name, 'contract.pdf');
  assert.equal(result.auditLogUrl, 'https://docuseal.com/file/audit');
  assert.equal(result.companyId, undefined);
  assert.equal(result.dealId, undefined);
});

test('input rejects invalid ids, outbound flags, automatic completion and unknown fields before dispatch', async () => {
  const invalid = [null, {}, { ...input(), templateId: '44' }, { ...input(), templateId: 0 }, { ...input(), sendEmail: true }, { ...input(), send_sms: true }, { ...input(), signers: [] }, { ...input(), order: 'bad' }, { ...input(), signers: [{ ...input().signers[0], completed: true }] }, { ...input(), signers: [{ ...input().signers[0], email: 'bad' }] }, { ...input(), signers: [{ ...input().signers[0], values: { x: {} } }] }, { ...input(), signers: [input().signers[0], input().signers[0]] }];
  for (const value of invalid) {
    const { adapter, calls } = client([]);
    await assert.rejects(adapter.createSubmission(value), isError('invalid_input'));
    assert.equal(calls.length, 0);
  }
});

test('input enforces finite numbers, strings, signer count and UTF8 body bytes', async () => {
  const invalid = [
    { ...input(), signers: Array.from({ length: 21 }, (_, i) => ({ role: `Role${i}`, email: 'x@example.com' })) },
    { ...input(), signers: [{ ...input().signers[0], values: { amount: Infinity } }] },
    { ...input(), signers: [{ ...input().signers[0], values: { x: ['a'.repeat(10001)] } }] },
    { ...input(), signers: [{ ...input().signers[0], values: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`Field${i}`, 'x'.repeat(10000)])) }] },
  ];
  for (const value of invalid) {
    const { adapter, calls } = client([]);
    await assert.rejects(adapter.createSubmission(value), isError('invalid_input'));
    assert.equal(calls.length, 0);
  }
});

test('POST network errors, 5xx, timeouts and malformed confirmations produce outcome_unknown without retry', async () => {
  const failures = [new Error(KEY), () => new Response(KEY, { status: 503 }), () => new Response(KEY, { status: 408 }), () => new Response(KEY, { status: 302 }), () => new Response('{bad'), [], {}, [signer({ submission_id: 0 })], [signer({ external_id: 'other' })], [signer({ status: 'bad' })], () => new Promise(() => {})];
  for (const failure of failures) {
    const { adapter, calls } = client(failure, { timeoutMs: 5 });
    await assert.rejects(adapter.createSubmission(input()), isError('outcome_unknown'));
    assert.equal(calls.length, 1);
  }
});

test('POST multiple signers must share one submission ID and confirm each signer', async () => {
  const value = { ...input(), signers: [input().signers[0], { role: 'Dealer', email: 'dealer@example.com', externalId: 'dispatch-1:dealer' }] };
  const dealer = signer({ id: 102, role: 'Dealer', email: 'dealer@example.com', external_id: 'dispatch-1:dealer' });
  const valid = client([dealer, signer()]);
  assert.equal((await valid.adapter.createSubmission({ ...value, order: 'random' })).submissionId, 9001);
  for (const response of [[signer()], [signer(), { ...dealer, submission_id: 9002 }], [signer(), { ...dealer, id: 101 }], [signer(), { ...dealer, email: 'other@example.com' }]]) {
    const { adapter } = client(response);
    await assert.rejects(adapter.createSubmission(value), isError('outcome_unknown'));
  }
});

test('duplicate external ids are rejected before dispatch and GET server errors are unavailable', async () => {
  const { adapter, calls } = client([]);
  await assert.rejects(adapter.createSubmission({ ...input(), signers: [input().signers[0], { role: 'Dealer', email: 'dealer@example.com', externalId: 'dispatch-1:buyer' }] }), isError('invalid_input'));
  assert.equal(calls.length, 0);
  const unavailable = client(() => new Response(KEY, { status: 503 }));
  await assert.rejects(unavailable.adapter.getSubmission(9001), isError('provider_unavailable'));
});

test('document provider 4xx errors are sanitized without exposing response bodies', async () => {
  for (const status of [400, 401, 403, 404, 422, 429]) {
    const { adapter, calls } = client(() => new Response(KEY, { status }));
    await assert.rejects(adapter.createSubmission(input()), isError('provider_rejected'));
    assert.equal(calls.length, 1);
  }
});

test('GET invalid id rejected before fetch and invalid provider shapes never accepted', async () => {
  for (const value of [0, '9001', NaN, Infinity, 1.1, -1]) {
    const { adapter, calls } = client(submission());
    await assert.rejects(adapter.getSubmission(value), isError('invalid_input'));
    assert.equal(calls.length, 0);
  }
  for (const response of [{}, submission({ id: 9002 }), submission({ status: 'signed' }), submission({ documents: [{ name: 'bad', url: 'http://unsafe' }] }), submission({ submitters: [signer({ submission_id: 9002 })] })]) {
    const { adapter } = client(response);
    await assert.rejects(adapter.getSubmission(9001), isError('invalid_response'));
  }
  const { adapter } = client(new Error(KEY));
  await assert.rejects(adapter.getSubmission(9001), isError('provider_unavailable'));
});

test('response bytes and stalled bodies are bounded through the entire request', async () => {
  for (const response of [() => new Response('x'.repeat(1024 * 1024 + 1)), () => new Response('{}', { headers: { 'content-length': '1048577' } }), () => new Response(new ReadableStream({ start() {} }))]) {
    const { adapter, calls } = client(response, { timeoutMs: 5 });
    await assert.rejects(adapter.createSubmission(input()), isError('outcome_unknown'));
    assert.equal(calls.length, 1);
  }
});

test('configuration requires HTTPS and a server key with no credentials, query, fragment or control chars', () => {
  for (const config of [null, { baseUrl: 'http://api.docuseal.com', apiKey: KEY }, { baseUrl: 'https://user:pass@host.example', apiKey: KEY }, { baseUrl: 'https://host.example?x=y', apiKey: KEY }, { baseUrl: 'https://host.example#x', apiKey: KEY }, { baseUrl: 'https://host.example', apiKey: '' }, { baseUrl: 'https://host.example', apiKey: 'token\nheader' }, { baseUrl: 'https://host.example', apiKey: KEY, timeoutMs: 30001 }]) {
    assert.throws(() => createDocuSealClient(config), isError('invalid_configuration'));
  }
});

test('HMAC uses entire whsec string and exact raw bytes including whitespace/unicode', () => {
  const body = Buffer.from('{ "text": "Å😀", "data": 1 }\n');
  assert.equal(verifyDocuSealWebhook(body, signature(body), SECRET, NOW), true);
  const compact = encode(JSON.parse(body.toString()));
  assert.equal(verifyDocuSealWebhook(compact, signature(body), SECRET, NOW), false);
  const decodedKey = Buffer.from(SECRET.slice(6), 'base64');
  const incorrect = `${NOW}.${createHmac('sha256', decodedKey).update(`${NOW}.`).update(body).digest('hex')}`;
  assert.equal(verifyDocuSealWebhook(body, incorrect, SECRET, NOW), false);
});

test('HMAC rejects missing/malformed/different signatures, secrets and unsafe timestamps', () => {
  const body = encode(event());
  for (const header of [null, '', 'bad', `NaN.${'a'.repeat(64)}`, `Infinity.${'a'.repeat(64)}`, `-1.${'a'.repeat(64)}`, `1e3.${'a'.repeat(64)}`, `${NOW}.${'a'.repeat(63)}`, `${NOW}.${'g'.repeat(64)}`, `${NOW}.`, `${NOW}.ab.extra`, `9007199254740992.${'a'.repeat(64)}`]) {
    assert.equal(verifyDocuSealWebhook(body, header, SECRET, NOW), false);
  }
  assert.equal(verifyDocuSealWebhook(body, signature(body), `${SECRET.slice(0, -1)}A`, NOW), false);
  assert.equal(verifyDocuSealWebhook(body, signature(body), SECRET, NaN), false);
  assert.equal(verifyDocuSealWebhook('string', signature(body), SECRET, NOW), false);
  assert.equal(verifyDocuSealWebhook(Buffer.alloc(1024 * 1024 + 1), signature(body), SECRET, NOW), false);
});

test('HMAC checks both future and past timestamps with inclusive five-minute tolerance', () => {
  const body = encode(event());
  for (const delta of [-300, 300]) assert.equal(verifyDocuSealWebhook(body, signature(body, NOW + delta), SECRET, NOW), true);
  for (const delta of [-301, 301]) assert.equal(verifyDocuSealWebhook(body, signature(body, NOW + delta), SECRET, NOW), false);
});

test('verified event parser distinguishes single-signer completion from all-party completion', () => {
  const whole = encode(event());
  const signed = parseVerifiedDocuSealWebhook(whole, signature(whole), SECRET, NOW);
  assert.deepEqual(signed, { eventType: 'submission.completed', occurredAt: '2026-10-13T00:00:00Z', entity: 'submission', submissionId: 9001, submitterId: null });
  const form = encode(event({ event_type: 'form.completed', data: { id: 101, submission_id: 9001, submission: { id: 9001 }, metadata: { companyId: 'untrusted' } } }));
  assert.deepEqual(parseVerifiedDocuSealWebhook(form, signature(form), SECRET, NOW), { eventType: 'form.completed', occurredAt: '2026-10-13T00:00:00Z', entity: 'submitter', submissionId: 9001, submitterId: 101 });
  const nested = encode(event({ event_type: 'form.declined', data: { id: 101, submission: { id: 9001 } } }));
  assert.equal(parseVerifiedDocuSealWebhook(nested, signature(nested), SECRET, NOW).submissionId, 9001);
});

test('parser rejects unverified events, malformed payloads and contradictory signer/submission ids', () => {
  const body = encode(event());
  assert.throws(() => parseVerifiedDocuSealWebhook(body, `${NOW}.${'0'.repeat(64)}`, SECRET, NOW), isError('invalid_webhook'));
  for (const payload of [null, {}, event({ timestamp: 'bad' }), event({ event_type: 'unknown' }), event({ data: { id: '9001' } }), event({ event_type: 'form.completed', data: { id: 101 } }), event({ event_type: 'form.completed', data: { id: 101, submission_id: 9001, submission: { id: 9002 } } })]) {
    const invalid = encode(payload);
    assert.throws(() => parseVerifiedDocuSealWebhook(invalid, signature(invalid), SECRET, NOW), isError('invalid_webhook'));
  }
  const broken = Buffer.from('{broken');
  assert.throws(() => parseVerifiedDocuSealWebhook(broken, signature(broken), SECRET, NOW), isError('invalid_webhook'));
});


test('the application server wrapper stays disabled even when an untyped caller supplies enabled:true', async () => {
  const { registerHooks } = await import('node:module');
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.endsWith('/src/lib/signing/server.ts')) {
        if (specifier === 'server-only') return nextResolve('next/dist/compiled/server-only/empty.js', context);
        if (specifier === './docuseal' || specifier === './signing-state') return nextResolve(`${specifier}.ts`, context);
      }
      return nextResolve(specifier, context);
    }
  });
  let createTrafexaDocuSealClient;
  try { ({ createTrafexaDocuSealClient } = await import('../src/lib/signing/server.ts')); }
  finally { hook.deregister(); }
  let calls = 0;
  const adapter = createTrafexaDocuSealClient({
    baseUrl: 'https://api.docuseal.com', apiKey: KEY, enabled: true,
    fetchImpl: async () => { calls++; throw new Error('Application wrapper must not dispatch'); }
  });
  await assert.rejects(adapter.createSubmission(input()), isError('disabled'));
  assert.equal(calls, 0);
});
