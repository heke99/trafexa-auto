// Browser fixtures substitute transport only; actual production components and React run unchanged.
function response(queue) {
  const next = queue.shift();
  if (next?.throw) throw new Error('Unknown transport outcome');
  return next;
}
export async function listCompanyTeamAction(input) {
  window.fixture.teamCalls.push({ ...input });
  return response(window.fixture.teamResponses) ?? { ok: true, ...window.fixture.team };
}
export async function getMyInvitationsAction(input) {
  window.fixture.myCalls.push({ ...input });
  return response(window.fixture.myResponses) ?? { ok: true, invitations: window.fixture.myInvitations, nextPageKey: window.fixture.nextPageKey ?? null };
}
export async function updateCompanyMemberAction(input) {
  window.fixture.updateCalls.push({ ...input });
  const next = response(window.fixture.updateResponses);
  if (next) return next;
  window.fixture.team.members = window.fixture.team.members.map(member => member.id === input.membershipId ? { ...member, role: input.role, status: input.status, version: member.version + 1 } : member);
  return { ok: true, receipt: { historical: true } };
}
export async function inviteCompanyMemberAction(input) {
  window.fixture.inviteCalls.push({ ...input });
  return response(window.fixture.inviteResponses) ?? { ok: true, receipt: { historical: true } };
}
export async function cancelCompanyInvitationAction(input) {
  window.fixture.cancelCalls.push({ ...input });
  return response(window.fixture.cancelResponses) ?? { ok: true, receipt: { historical: true } };
}
export async function acceptCompanyInvitationAction(input) {
  window.fixture.acceptCalls.push({ ...input });
  const next = response(window.fixture.acceptResponses);
  if (next) return next;
  window.fixture.myInvitations = window.fixture.myInvitations.filter(item => item.id !== input.invitationId);
  return { ok: true, companyId: window.fixture.team.companyId, role: 'sales' };
}
