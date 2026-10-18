import test from 'node:test';
import assert from 'node:assert/strict';
import { createSourceLoader } from './helpers/source-loader.mjs';

const id = n => `99500000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), app = id(2), invitationId = id(3), oldDeliveryId = id(4), newDeliveryId = id(5), user = id(6);
const input = { applicationId: app, invitationId, expectedDeliveryId: oldDeliveryId, expectedVersion: 4, reason: 'Kunden behöver en ny personlig länk', requestId: id(7), acknowledged: true, invalidatesPreviousLink: true };
const invitation = { id: invitationId, applicationId: app, applicationVersion: 1, actorUserId: actor, requestId: id(8), email: 'synthetic@example.invalid', name: 'Synthetic applicant', reason: 'Original approval', status: 'created', userId: user, createdAt: '2026-10-15T10:00:00Z', expiresAt: '2026-10-15T10:15:00Z', consumedAt: '2026-10-15T10:01:00Z' };
async function harness({ configured = true, wrongScope = false, status = 'sent', errorCode = null, alteredReceipt = {}, revokedAfterRenewal = false } = {}) {
  const calls = []; let checks = 0;
  class PlatformAdminError extends Error { constructor(code) { super(code); this.code = code; } }
  const db = { rpc: async (name, args) => {
    calls.push(['rpc', name, args]);
    return { error: errorCode ? { code: errorCode } : null, data: { invitation, deliveryId: newDeliveryId, previousDeliveryId: oldDeliveryId, requestId: input.requestId, reason: input.reason, applicationVersion: input.expectedVersion, ...alteredReceipt } };
  } };
  const loader = await createSourceLoader({
    'next/cache': { revalidatePath: () => {} },
    './context': { PlatformAdminError, requirePlatformAdminContext: async () => { checks++; calls.push('auth'); if (revokedAfterRenewal && checks > 1) throw new PlatformAdminError('forbidden'); return { db, userId: actor }; } },
    './application-invitation-actions': { getPlatformApplicationInvitationAction: async value => { calls.push(['read', value]); return { ok: true, invitation: wrongScope ? { ...invitation, id: id(99) } : invitation }; } },
    '@/lib/email/account-invitation-server': { accountInvitationConfigured: () => configured, dispatchAccountInvitation: async (value, options) => { calls.push(['send', value, options]); return status; } },
  });
  return { action: loader.load('@/lib/platform-admin/application-invitation-renew-actions').renewPlatformApplicationInvitationAction, calls };
}

test('Renewal requires separate invalidation acknowledgement and strict reviewed inputs before any mutation', async () => {
  for (const invalid of [{ acknowledged: false }, { invalidatesPreviousLink: false }, { email: 'forged@example.invalid' }, { expectedVersion: 0 }, { expectedDeliveryId: null }]) {
    const { action, calls } = await harness(); assert.deepEqual(await action({ ...input, ...invalid }), { ok: false, code: 'invalid_input' }); assert.deepEqual(calls, ['auth']);
  }
});

test('Application identity is verified before renewal and missing transport never rotates the personal link', async () => {
  const scope = await harness({ wrongScope: true }); assert.deepEqual(await scope.action(input), { ok: false, code: 'conflict' });
  assert.equal(scope.calls.some(call => Array.isArray(call) && call[0] === 'rpc'), false);
  const config = await harness({ configured: false }); assert.equal((await config.action(input)).status, 'not_configured'); assert.deepEqual(config.calls, ['auth']);
});

test('Renewal uses the immutable generation receipt, stable request and same server-bound user after status-only case changes', async () => {
  const { action, calls } = await harness();
  assert.equal((await action(input)).status, 'sent'); assert.equal((await action(input)).status, 'sent');
  const requests = calls.filter(call => Array.isArray(call) && call[0] === 'rpc');
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0][1], 'renew_platform_application_invitation'); assert.equal(requests[0][2].p_expected_delivery_id, oldDeliveryId);
  const sent = calls.find(call => Array.isArray(call) && call[0] === 'send');
  assert.equal(sent[1].userId, user); assert.equal(sent[1].applicationVersion, 1); assert.deepEqual(sent[2], { expectedDeliveryId: newDeliveryId });
});

test('A mismatched renewal receipt never dispatches another applicant or an unreviewed delivery generation', async () => {
  for (const alteredReceipt of [{ deliveryId: oldDeliveryId }, { previousDeliveryId: id(99) }, { requestId: id(99) }, { reason: 'Other reason' }, { applicationVersion: 5 }, { invitation: { ...invitation, actorUserId: id(99) } }, { invitation: { ...invitation, applicationId: id(99) } }]) {
    const { action, calls } = await harness({ alteredReceipt }); assert.deepEqual(await action(input), { ok: false, code: 'unavailable' });
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'send'), false);
  }
});

test('Post-renewal revocation blocks delivery and conflicts preserve a bounded, secret-free result', async () => {
  const revoked = await harness({ revokedAfterRenewal: true }); assert.deepEqual(await revoked.action(input), { ok: false, code: 'forbidden' });
  assert.equal(revoked.calls.some(call => Array.isArray(call) && call[0] === 'send'), false);
  for (const [errorCode, code] of [['42501', 'forbidden'], ['40001', 'conflict'], ['22023', 'invalid_input'], ['XX000', 'unavailable']]) {
    const { action } = await harness({ errorCode }); assert.deepEqual(await action(input), { ok: false, code });
  }
  const unknown = await harness({ status: 'unknown' }); const result = await unknown.action(input);
  assert.equal(result.status, 'unknown'); assert.deepEqual(Object.keys(result).sort(), ['email', 'invitationId', 'ok', 'status']);
});
