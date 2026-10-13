// Explicit browser fixtures. No production Server Action, database or provider is invoked.
export async function listDealOffersAction(dealId, companyId) {
  window.fixture.listCalls.push({ dealId, companyId });
  return { ok: true, companyId, offers: window.fixture.offers };
}
export async function createOfferVersionAction() { throw new Error('Unexpected create action in archive test'); }
export async function archiveOfferAction(input) {
  window.fixture.archiveCalls.push({ ...input });
  const response = window.fixture.responses.shift();
  if (response?.throw) throw new Error('Fixture transport failure');
  if (response?.defer) return new Promise((resolve, reject) => window.fixture.deferred.push({ resolve, reject }));
  return response ?? window.fixture.proof(input);
}
const unexpected = async () => { throw new Error('Unexpected unrelated Server Action'); };
export const createVehicleAction = unexpected, createCustomerAction = unexpected, createDealAction = unexpected,
  reserveVehicleAction = unexpected, createFinanceRequestAction = unexpected, releaseReservationAction = unexpected,
  updateVehiclePriceAction = unexpected, createVehicleCostAction = unexpected, signOutAction = unexpected, selectCompanyAction = unexpected;
