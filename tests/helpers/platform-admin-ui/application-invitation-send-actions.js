// Isolated browser fixture; no production Auth, mail provider or database writes.
export async function inviteApprovedApplicationAction(input) {
  window.fixture.invitationCalls.push(input);
  const response = window.fixture.invitationResponses.shift();
  if (response?.throw) throw new Error('Fixture unknown result');
  if (response?.hold) return await new Promise(resolve => { window.releaseInvitation = resolve; });
  return response ?? { ok: true, invitationId: '50000000-0000-4000-8000-000000000001', status: 'sent', email: window.fixture.application.email };
}
