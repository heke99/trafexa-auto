// Explicit browser fixtures. No production Server Action, database or provider is invoked.
export async function listDealOffersAction(dealId, companyId) {
  window.fixture.listCalls.push({ dealId, companyId });
  return { ok: true, companyId, offers: window.fixture.offers };
}
export async function createOfferVersionAction(form) { const f=window.fixture;if(!f.createEnabled)throw new Error('Unexpected create action in archive test');f.createCalls.push(Object.fromEntries(form));const response=f.createResponses.shift();if(response?.throw)throw Error('unknown');return response||{ok:true,message:'Offertversionen har sparats.',offerId:f.offers[0].id}; }
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

export async function loadDealerRegisterPage(input) {
  const snapshot = window.fixture.workspaceSnapshot;
  const rows = input.kind === 'inventory' ? snapshot.inventory : input.kind === 'customers' ? snapshot.customers
    : snapshot.deals.map(deal => ({ ...deal, customer: snapshot.customers.find(row => row.id === deal.customer_id), stockItem: snapshot.inventory.find(row => row.id === deal.stock_item_id) }));
  const counts = { all: rows.length };
  for (const row of rows) { const status = input.kind === 'customers' ? row.kind : row.status; counts[status] = (counts[status] ?? 0) + 1; }
  return { ok: true, page: { kind: input.kind, companyId: snapshot.organization.id, actorId: snapshot.user.id, role: snapshot.membership.role, rows: rows.slice(0, 50), totalCount: rows.length, filteredCount: rows.length, counts, nextCursor: null } };
}
export async function loadVehicleCosts(input) {
  const snapshot = window.fixture.workspaceSnapshot;
  return { ok: true, companyId: snapshot.organization.id, actorId: snapshot.user.id, role: snapshot.membership.role, stockItemId: input.stockItemId, costs: snapshot.vehicle_costs.filter(cost => cost.stock_item_id === input.stockItemId) };
}
export const searchDealOptions = unexpected;

export async function listDealTradeInsAction(input){const f=window.fixture;f.tradeReads??=[];f.tradeReads.push(input);const next=f.tradeResponses?.shift();if(next?.defer)return new Promise(resolve=>{f.resolveTrade=()=>resolve(next.result);});return next||{ok:true,companyId:input.companyId,dealId:input.dealId,salePriceOre:'25000000',customerName:'Fixturekund',latestVersion:2,canCreate:f.tradeCanCreate!==false,versions:f.tradeRows||[],nextBeforeVersion:f.tradeCursor||null};}
