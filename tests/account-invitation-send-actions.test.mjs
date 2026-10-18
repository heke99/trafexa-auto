import test from 'node:test';
import assert from 'node:assert/strict';
import { createSourceLoader } from './helpers/source-loader.mjs';

const actor = '99400000-0000-4000-8000-000000000001', app = '99400000-0000-4000-8000-000000000002', request = '99400000-0000-4000-8000-000000000003';
const input = { applicationId: app, expectedVersion: 2, reason: 'Reviewed application', requestId: request, acknowledged: true };
const saved = { id: app, applicationId: app, actorUserId: actor, applicationVersion: 2, reason: input.reason, requestId: actor, status: 'created', userId: request, email: 'synthetic@example.invalid' };
async function harness({ configured = true, existing = null, prepareError = null, dispatch = 'sent', denied = false, currentVersion = 2 } = {}) {
  const calls = [];
  class PlatformAdminError extends Error { constructor(code) { super(code); this.code = code; } }
  const source = await createSourceLoader({
    'next/cache': { revalidatePath: () => {} },
    './context': { PlatformAdminError, requirePlatformAdminContext: async () => { calls.push('auth'); if (denied) throw new PlatformAdminError('forbidden'); return { userId: actor }; } },
    './application-invitation-actions': {
      getPlatformApplicationInvitationAction: async value => { calls.push(['read', value]); return { ok: true, invitation: existing, lifecycle: { applicationVersion: currentVersion, delivery: { id: existing?.id ?? null } } }; },
      preparePlatformApplicationInvitationAction: async value => { calls.push(['prepare', value]); return prepareError ? { ok: false, code: prepareError } : { ok: true, invitation: { ...saved, status: 'prepared', userId: null } }; },
      repreparePlatformApplicationInvitationAction: async value => { calls.push(['reprepare', value]); return { ok: true, invitation: { ...saved, status: 'prepared', userId: null, applicationVersion: value.expectedVersion, reason: value.reason, requestId: value.requestId }, deliveryId: request }; },
    },
    '@/lib/email/account-invitation-server': { accountInvitationConfigured: () => configured, dispatchAccountInvitation: async (value, options) => { calls.push(['send', value, options]); return dispatch; } },
  });
  return { action: source.load('@/lib/platform-admin/application-invitation-send-actions').inviteApprovedApplicationAction, calls };
}

test('Reviewed invitation action authenticates before config and rejects browser recipient/token injection without IO', async () => {
  for (const extra of [{ email: 'forged@example.invalid' }, { token: 'forged' }, { acknowledged: false }, { expectedVersion: 0 }]) {
    const { action, calls } = await harness(); assert.deepEqual(await action({ ...input, ...extra }), { ok: false, code: 'invalid_input' }); assert.deepEqual(calls, ['auth']);
  }
  const denied = await harness({ denied: true }); assert.deepEqual(await denied.action(input), { ok: false, code: 'forbidden' }); assert.deepEqual(denied.calls, ['auth']);
  const missing = await harness({ configured: false }); assert.equal((await missing.action(input)).status, 'not_configured'); assert.deepEqual(missing.calls, ['auth']);
});

test('Existing persisted invitation survives browser reload without a second approval; changed review is refused', async () => {
  const same = await harness({ existing: saved, dispatch: 'already_sent' });
  assert.equal((await same.action(input)).status, 'already_sent');
  assert.equal(same.calls.some(call => Array.isArray(call) && call[0] === 'prepare'), false);
  for (const altered of [{ actorUserId: request }, { reason: 'Other review' }]) {
    const { action, calls } = await harness({ existing: { ...saved, ...altered } });
    assert.deepEqual(await action(input), { ok: false, code: 'conflict' }); assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'send'), false);
  }
});

test('An unconsumed approval from an older case version requires a new reviewed preparation and uses its new delivery identity', async () => {
  const { action, calls } = await harness({ existing: { ...saved, applicationVersion: 1, userId: null, status: 'prepared' } });
  assert.equal((await action({ ...input, reason: 'Fresh case review' })).status, 'sent');
  const reprepare = calls.find(call => Array.isArray(call) && call[0] === 'reprepare')[1];
  assert.equal(reprepare.expectedApplicationVersion, 1); assert.equal(reprepare.expectedVersion, 2);
  assert.equal(reprepare.reviewAcknowledged, true); assert.equal(reprepare.requestId, input.requestId); assert.equal(reprepare.reason, 'Fresh case review');
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'prepare'), false);
  const send = calls.find(call => Array.isArray(call) && call[0] === 'send');
  assert.deepEqual(send[2], { expectedDeliveryId: request });
});

test('Post-creation case handling changes retain original approval, while stale current case review is refused', async () => {
  const current = await harness({ existing: saved, currentVersion: 3, dispatch: 'already_sent' });
  assert.equal((await current.action({ ...input, expectedVersion: 3 })).status, 'already_sent');
  const sent = current.calls.find(call => Array.isArray(call) && call[0] === 'send');
  assert.equal(sent[1].applicationVersion, 2); assert.equal(sent[2].expectedDeliveryId, saved.id);
  const stale = await harness({ existing: saved, currentVersion: 3 });
  assert.deepEqual(await stale.action(input), { ok: false, code: 'conflict' });
  assert.equal(stale.calls.some(call => Array.isArray(call) && call[0] === 'send'), false);
});

test('Expired unsent intent refreshes its original reviewed identity and provider ambiguity is not success', async () => {
  const expired = await harness({ existing: { ...saved, status: 'expired' } }); assert.equal((await expired.action(input)).status, 'sent');
  const refreshed = expired.calls.find(call => Array.isArray(call) && call[0] === 'prepare')[1];
  assert.equal(refreshed.requestId, saved.requestId); assert.equal(refreshed.reviewAcknowledged, true);
  for (const dispatch of ['busy', 'retryable', 'unknown']) {
    const { action } = await harness({ dispatch }); const result = await action(input);
    if (dispatch === 'unknown') { assert.equal(result.ok, true); assert.equal(result.status, 'unknown'); } else { assert.deepEqual(result, { ok: false, code: 'unavailable' }); }
    assert.ok(!JSON.stringify(result).includes('token'));
  }
});
