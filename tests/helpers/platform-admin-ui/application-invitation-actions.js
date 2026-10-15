export async function getPlatformApplicationInvitationAction(input) {
  window.fixture.invitationReadCalls.push(input);
  const response = window.fixture.invitationReadResponses.shift();
  if (response?.throw) throw new Error('Fixture unavailable read');
  return response ?? { ok: true, invitation: null };
}
