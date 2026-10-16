import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSourceLoader } from './helpers/source-loader.mjs';

const id = '99300000-0000-4000-8000-000000000001', actorId = '99300000-0000-4000-8000-000000000002', userId = '99300000-0000-4000-8000-000000000003', leaseId = '99300000-0000-4000-8000-000000000004';
const secret = 'synthetic-secret-for-encryption-only-not-a-credential';
// Supabase Auth uses hex SHA-224, not the 64-character SHA-256 mocked previously.
const token = createHash('sha224').update('synthetic@example.invalid' + '12345678').digest('hex');
const invitation = { id, actorUserId: actorId, email: 'synthetic@example.invalid', name: '<Synthetic>', applicationId: id, applicationVersion: 1, reason: 'Reviewed', requestId: id };
const loader = await createSourceLoader();
const content = loader.load('@/lib/email/account-invitation-content');
const transport = loader.load('@/lib/email/account-invitation-transport');

test('Invitation payload uses one canonical activation URL and encrypted authenticated service-only persistence', () => {
  const body = content.renderAccountInvitationBody({ invitationId: id, email: invitation.email, name: invitation.name, tokenHash: token });
  const rendered = JSON.parse(body);
  assert.equal(rendered.from, 'Trafexa <kundtjanst@trafexa.com>'); assert.equal(rendered.reply_to, 'info@trafexa.com');
  assert.deepEqual(rendered.to, [invitation.email]); assert.match(rendered.html, /&lt;Synthetic&gt;/);
  assert.equal(rendered.subject, 'Välkommen till Trafexa – din ansökan är godkänd');
  for (const format of [rendered.text, rendered.html]) {
    assert.match(format, /Välkommen till Trafexa!/);
    assert.match(format, /ansökan till Trafexa har granskats och godkänts/);
    assert.match(format, /bekräfta din e-postadress och välja ett lösenord/);
    assert.match(format, /Finansiering kräver ett separat godkännande/);
    assert.match(format, /Länken är personlig och kan användas en gång/);
    assert.match(format, /info@trafexa\.com/);
  }
  assert.match(rendered.html, /<html lang="sv">/);
  assert.match(rendered.html, /<h1[^>]*>Välkommen till Trafexa!<\/h1>/);
  assert.match(rendered.html, /Om knappen inte fungerar/);
  const activationLinks = [...rendered.html.matchAll(/href="(https:[^"]+)"/g)].map(match => match[1]);
  assert.equal(activationLinks.length, 2);
  assert.equal(new Set(activationLinks).size, 1, 'CTA and fallback must use the same one-time link');
  assert.deepEqual(rendered.tags, [{ name: 'kind', value: 'account_invitation' }, { name: 'invitation_id', value: id }]);
  assert.match(rendered.text, new RegExp(`https://app.trafexa.com/auth/invitation\\?token_hash=${token}`));
  const encrypted = content.encryptInvitationBody(body, id, secret);
  assert.ok(!encrypted.includes(token)); assert.ok(!encrypted.includes(invitation.email));
  assert.equal(content.decryptInvitationBody(encrypted, id, secret), body);
  assert.throws(() => content.decryptInvitationBody(encrypted, actorId, secret));
  assert.throws(() => content.decryptInvitationBody(encrypted, id, secret + '-rotated'));
  assert.throws(() => content.decryptInvitationBody(encrypted.slice(0, -8) + 'AAAAAAAA', id, secret));
});

test('Invitation provider failures retain ambiguity and exact idempotency/body on a known retry', async () => {
  const input = { invitationId: id, firstAttemptAt: new Date().toISOString(), body: '{"synthetic":true}', apiKey: 'synthetic' };
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, options }); return new Response('', { status: 429 }); };
  assert.equal((await transport.sendAccountInvitation(input, fetcher)).status, 'retryable');
  assert.equal((await transport.sendAccountInvitation(input, fetcher)).status, 'retryable');
  assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']); assert.equal(calls[0].options.body, calls[1].options.body);
  assert.equal((await transport.sendAccountInvitation(input, async () => new Response('', { status: 503 }))).status, 'unknown');
  assert.equal((await transport.sendAccountInvitation(input, async () => { throw Error('timeout'); })).status, 'unknown');
  assert.equal((await transport.sendAccountInvitation(input, async () => new Response('{}'))).status, 'unknown');
  assert.equal((await transport.sendAccountInvitation(input, async () => new Response('', { status: 422 }))).status, 'rejected');
  assert.deepEqual(await transport.sendAccountInvitation(input, async () => Response.json({ id: 'synthetic-provider-id' })), { status: 'sent', providerId: 'synthetic-provider-id' });
  let network = false;
  assert.equal((await transport.sendAccountInvitation({ ...input, firstAttemptAt: new Date(Date.now() - 24 * 3600_000).toISOString() }, async () => { network = true; return Response.json({ id: 'bad' }); })).status, 'unknown');
  assert.equal(network, false);
});

async function withConfig(run) {
  const keys = ['TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED', 'NEXT_PUBLIC_SUPABASE_URL', 'RESEND_API_KEY', 'SUPABASE_SECRET_KEY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED: 'true', NEXT_PUBLIC_SUPABASE_URL: 'https://buqdtssxrotkzndublrt.supabase.co', RESEND_API_KEY: 'synthetic', SUPABASE_SECRET_KEY: secret });
  try { await run(); } finally { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
}

async function dispatchHarness({ mode = 'generate', revoked = false, linkUser = userId, linkToken = token, sendStatus = 'sent', prebound = false } = {}) {
  const calls = [], job = { invitationId: id, actorUserId: actorId, leaseId, status: mode, email: invitation.email, userId: mode === 'generate' && !prebound ? null : userId, firstAttemptAt: mode === 'send' ? new Date().toISOString() : null, ciphertext: null };
  if (mode === 'send') job.ciphertext = content.encryptInvitationBody(content.renderAccountInvitationBody({ invitationId: id, email: invitation.email, name: invitation.name, tokenHash: token }), id, secret);
  const db = { rpc: async (name) => { calls.push(name); return { data: { ...job }, error: null }; } };
  let checks = 0;
  const service = { auth: { admin: { generateLink: async input => {
    calls.push(['generate', input]); job.userId = userId;
    return { data: { properties: { hashed_token: linkToken, verification_type: 'invite' }, user: { id: linkUser, email: invitation.email } }, error: null };
  } } }, rpc: async (name, input) => {
    calls.push([name, input]);
    if (name.startsWith('get_')) { checks++; if (revoked && checks >= 3) return { data: null, error: { code: '42501' } }; return { data: { ...job }, error: null }; }
    if (name.startsWith('bind_')) { job.status = 'send'; job.ciphertext = input.p_ciphertext; job.firstAttemptAt = new Date().toISOString(); return { data: { ...job }, error: null }; }
    if (name.startsWith('finish_')) return { data: { invitationId: id, actorUserId: actorId, leaseId, outcome: input.p_outcome, providerId: input.p_provider_id }, error: null };
    throw Error('Unexpected RPC');
  } };
  const privateLoader = await createSourceLoader({ '@supabase/supabase-js': { createClient: () => service }, '@/lib/platform-admin/context': { requirePlatformAdminContext: async () => ({ db, userId: actorId }) }, './account-invitation-transport': { sendAccountInvitation: async input => { calls.push(['send', input]); return sendStatus === 'sent' ? { status: 'sent', providerId: 'synthetic-id' } : { status: sendStatus }; } } });
  return { server: privateLoader.load('@/lib/email/account-invitation-server'), calls };
}

test('Reviewed invite creates link without Auth SMTP, encrypts before network, rechecks authority, and exposes only outcome', async () => withConfig(async () => {
  const { server, calls } = await dispatchHarness();
  assert.equal(await server.dispatchAccountInvitation(invitation), 'sent');
  const sequence = calls.filter(Array.isArray).map(call => call[0]);
  assert.ok(sequence.indexOf('bind_platform_application_invitation_delivery') < sequence.indexOf('send'));
  assert.ok(sequence.lastIndexOf('get_platform_application_invitation_delivery') < sequence.indexOf('send'));
  const generated = calls.find(call => Array.isArray(call) && call[0] === 'generate')[1];
  assert.deepEqual(Object.keys(generated).sort(), ['email', 'options', 'type']); assert.equal(generated.email, invitation.email); assert.equal(generated.type, 'invite');
}));

test('Retry reuses encrypted payload without rotating Auth token; terminal outcomes do not touch provider', async () => withConfig(async () => {
  const retry = await dispatchHarness({ mode: 'send' }); assert.equal(await retry.server.dispatchAccountInvitation(invitation), 'sent');
  assert.equal(retry.calls.some(call => Array.isArray(call) && call[0] === 'generate'), false);
  for (const mode of ['sent', 'unknown', 'busy']) {
    const { server, calls } = await dispatchHarness({ mode });
    assert.equal(await server.dispatchAccountInvitation(invitation), mode === 'sent' ? 'already_sent' : mode);
    assert.equal(calls.some(Array.isArray), false);
  }
}));

test('Mismatched Auth user or revoked fresh delivery denies external sending', async () => withConfig(async () => {
  for (const options of [{ linkUser: actorId }, { revoked: true }]) {
    const { server, calls } = await dispatchHarness(options);
    await assert.rejects(server.dispatchAccountInvitation(invitation));
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'send'), false);
  }
}));

test('GoTrue SHA-224 hashes pass generation, encrypted persistence and provider dispatch, including an unsent prebound account', async () => withConfig(async () => {
  assert.equal(token.length, 56);
  for (const prebound of [false, true]) {
    const { server, calls } = await dispatchHarness({ prebound });
    assert.equal(await server.dispatchAccountInvitation(invitation), 'sent');
    const send = calls.find(call => Array.isArray(call) && call[0] === 'send')[1];
    const payload = JSON.parse(send.body);
    assert.match(payload.text, new RegExp(`token_hash=${token}`));
    const bound = calls.find(call => Array.isArray(call) && call[0] === 'bind_platform_application_invitation_delivery')[1];
    assert.equal(bound.p_invitation_id, id);
    assert.equal(content.decryptInvitationBody(bound.p_ciphertext, id, secret), send.body);
  }
}));

test('Malformed provider invitation hashes fail before persistence or provider delivery', async () => withConfig(async () => {
  for (const linkToken of ['a'.repeat(55), 'a'.repeat(57), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(56), '']) {
    const { server, calls } = await dispatchHarness({ linkToken });
    await assert.rejects(server.dispatchAccountInvitation(invitation));
    assert.equal(calls.some(call => Array.isArray(call) && ['bind_platform_application_invitation_delivery', 'send'].includes(call[0])), false);
  }
}));
