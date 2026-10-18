export async function getPlatformApplicationInvitationAction(input) {
  window.fixture.invitationReadCalls.push(input);
  const response = window.fixture.invitationReadResponses.shift();
  if (response?.throw) throw new Error('Fixture unavailable read');
  const result = response ?? { ok: true, invitation: null };
  if (!result.ok || result.lifecycle) return result;
  return { ...result, lifecycle: { applicationVersion: window.fixture.application?.version ?? 1, delivery: { id: result.invitation ? '70000000-0000-4000-8000-000000000001' : null, state: 'not_started', attemptCount: 0, firstAttemptAt: null, updatedAt: null, canRetry: !!result.invitation }, account: { emailVerified: null, approvalStatus: null }, canRenew: false } };
}
