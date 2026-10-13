// Isolated browser fixture: no production action, Supabase or external write is invoked.
export async function listPlatformCompaniesAction(input) {
  window.fixture.listCalls.push({ ...input });
  return window.fixture.listResponses.shift() ?? { ok: true, companies: window.fixture.companies, nextPageKey: null };
}
export async function listPlatformContactRequestsAction(input) {
  window.fixture.contactCalls.push({ ...input });
  return { ok: false, code: 'access_denied', message: 'Ingen administratörsåtkomst.' };
}
export async function activatePlatformAdminAction(input) {
  window.fixture.activationCalls.push({ ...input });
  return { ok: false, code: 'access_denied', message: 'Ingen administratörsåtkomst.' };
}
export async function setPlatformCompanyStatusAction(input) {
  window.fixture.statusCalls.push({ ...input });
  const response = window.fixture.statusResponses.shift();
  if (response?.throw) throw new Error('Fixture unknown network outcome');
  window.fixture.companies = window.fixture.companies.map(company => company.id === input.companyId ? { ...company, status: input.status } : company);
  return response ?? { ok: true, receipt: { ...input, previousStatus: input.expectedStatus, changed: input.status !== input.expectedStatus, createdAt: '2026-10-13T18:00:00Z' } };
}
