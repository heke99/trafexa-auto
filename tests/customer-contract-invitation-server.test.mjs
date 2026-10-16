import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';

const ids = ['01','02','03','04','05'].map(suffix => `bb270000-0000-4000-8000-0000000000${suffix}`);
const [emailId, leaseId, referenceId, invitationId, userId] = ids;
const recipient = 'synthetic@example.invalid';
const secret = 'synthetic-customer-invitation-encryption-secret';
const envelope = { id: emailId, leaseId, reference: referenceId, recipient, kind: 'contract_invitation', createdAt: new Date().toISOString() };
async function harness({ mode = 'guest', kind = 'contract_invitation', fail = null, altered = {}, provider = 'sent' } = {}) {
  const calls = [];
  const row = { emailId, leaseId, referenceId, recipient, kind, mode, invitationId, userId: null, expiresAt: new Date(Date.now()+7*86400_000).toISOString(), ciphertext: null, firstAttemptAt: null };
  const db = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (fail === name) throw Error('Synthetic unavailable RPC');
      if (name === 'bind_guest_document_invitation') row.ciphertext = args.p_ciphertext;
      if (name === 'begin_customer_contract_invitation_send') { row.firstAttemptAt ||= new Date().toISOString(); return { data: { ok: true, firstAttemptAt: row.firstAttemptAt }, error: null }; }
      return { data: { ...row, ...altered }, error: null };
    },
    get auth() { assert.fail('Guest document email must never create, invite or modify an Auth account'); },
  };
  const loader = await createSourceLoader({ './account-invitation-transport': { sendAccountInvitation: async input => { calls.push(['send', input]); return provider === 'sent' ? { status: 'sent', providerId: 'synthetic-provider-id' } : { status: provider }; } } });
  const send = loader.load('@/lib/email/customer-contract-invitation-server').sendClaimedCustomerContractInvitation;
  return { calls, row, run: () => send(db, { ...envelope, kind }, { secret, apiKey: 'synthetic' }) };
}

test('guest document mail atomically binds token hash and frozen encrypted body before first provider attempt without touching Auth', async () => {
  for (const kind of ['contract_invitation', 'offer_invitation', 'contract_completed']) {
    const h = await harness({ kind }); assert.deepEqual(await h.run(), { status: 'accepted', providerId: 'synthetic-provider-id' });
    const names = h.calls.map(call => call[0]);
    assert.ok(names.indexOf('bind_guest_document_invitation') < names.indexOf('begin_customer_contract_invitation_send'));
    assert.ok(names.indexOf('begin_customer_contract_invitation_send') < names.indexOf('send'));
    const sent = h.calls.find(call => call[0] === 'send')[1];
    assert.equal(sent.idempotencyKey, `trafexa/${emailId}`);
    assert.equal(sent.firstAttemptAt, h.row.firstAttemptAt);
    const body = JSON.parse(sent.body); assert.deepEqual(body.to, [recipient]);
    assert.match(body.text, /customer-document\/invitation/);
    const url=new URL(body.text.match(/https:\/\/\S+/)[0]); const raw=url.searchParams.get('token');
    assert.match(raw,/^[A-Za-z0-9_-]{43}$/);
    const bind=h.calls.find(call=>call[0]==='bind_guest_document_invitation')[1];
    assert.equal(bind.p_token_sha256,createHash('sha256').update(raw).digest('hex'));
    assert.equal(Object.values(bind).includes(raw),false);
    assert.ok(!h.row.ciphertext.includes(raw)); assert.ok(!h.row.ciphertext.includes(recipient));
    assert.match(body.text,/Du behöver inget konto eller lösenord/); assert.doesNotMatch(body.text,/ansökan|godkänd|Aktivera/);
  }
});

test('old Auth account invitation modes fail closed before any provider call', async () => {
  for(const mode of ['existing','invite']) {
    const h=await harness({mode}); assert.equal((await h.run()).status,'retryable');
    assert.equal(h.calls.some(call=>call[0]==='send'),false);
  }
});

test('known nonacceptance retry keeps exact frozen encrypted body and never rotates an already persisted document token', async () => {
  const h = await harness({ provider: 'retryable' });
  assert.equal((await h.run()).status, 'retryable'); const ciphertext = h.row.ciphertext;
  assert.equal((await h.run()).status, 'retryable'); assert.equal(h.row.ciphertext, ciphertext);
  assert.equal(h.calls.filter(call => call[0] === 'bind_guest_document_invitation').length, 1);
  const sends = h.calls.filter(call => call[0] === 'send').map(call => call[1]);
  assert.equal(sends[0].body, sends[1].body); assert.equal(sends[0].idempotencyKey, sends[1].idempotencyKey);
});

test('lease/source mismatch denies provider and an ambiguous first-attempt acknowledgement never becomes retryable', async () => {
  for (const altered of [{ recipient: 'other@example.invalid' }, { referenceId: emailId }, { emailId: userId }, { leaseId: emailId }]) {
    const h = await harness({ altered }); assert.equal((await h.run()).status, 'retryable');
    assert.equal(h.calls.some(call => call[0] === 'send' || call[0] === 'generate'), false);
  }
  const before = await harness({ fail: 'current_customer_contract_invitation' }); assert.equal((await before.run()).status, 'retryable'); assert.equal(before.calls.some(call => call[0] === 'send'), false);
  const after = await harness({ fail: 'begin_customer_contract_invitation_send' }); assert.equal((await after.run()).status, 'unknown'); assert.equal(after.calls.some(call => call[0] === 'send'), false);
  const unknown = await harness({ provider: 'unknown' }); assert.equal((await unknown.run()).status, 'unknown');
});
