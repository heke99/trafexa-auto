export async function renewPlatformApplicationInvitationAction(input) {
  window.fixture.renewCalls ??= [];
  window.fixture.renewCalls.push(input);
  const response = window.fixture.renewResponses?.shift();
  if (response?.throw) throw new Error('Fixture unknown renewal');
  if (response?.hold) return await new Promise(resolve => { window.releaseRenewal = resolve; });
  return response ?? { ok: true, invitationId: input.invitationId, email: window.fixture.application.email, status: 'sent' };
}
