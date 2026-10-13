function take(queue) { const item = queue.shift(); if (item?.throw) throw new Error('Unknown transport outcome'); return item; }
const scope = () => ({ companyId: window.fixture.companyId, actorUserId: window.fixture.userId, actorRole: window.fixture.role });
export async function listAdvertisingWorkspaceAction(input) {
  window.fixture.listCalls.push({ ...input });
  return take(window.fixture.listResponses) ?? { ok: true, ...scope(), listings: window.fixture.listings, jobs: window.fixture.jobs, channels: window.fixture.channels, nextPageKey: null, nextJobsPageKey: null };
}
export async function listAdvertisingStockAction(input) {
  window.fixture.stockCalls.push({ ...input });
  return { ok: true, ...scope(), stock: window.fixture.stock, nextPageKey: null };
}
export async function getStockAdvertisingAction(input) {
  window.fixture.detailCalls.push({ ...input });
  return take(window.fixture.detailResponses) ?? { ok: true, ...scope(), listing: window.fixture.listings.find(item => item.stockId === input.stockItemId) ?? null, jobs: window.fixture.jobs, channels: window.fixture.channels };
}
function draft(input, existing = null) {
  const stock = window.fixture.stock.find(item => item.id === input.stockItemId);
  const listing = { id: existing?.id ?? input.requestId, companyId: input.companyId, stockId: input.stockItemId, version: (existing?.version ?? 0) + 1, status: 'draft', createdAt: '2026-10-13T18:00:00Z', updatedAt: '2026-10-13T18:00:00Z',
    snapshot: { title: input.title, description: input.description, priceGrossOre: stock.priceGrossOre, make: stock.make, model: stock.model, year: stock.year, mileageKm: 48200, fuel: 'petrol', transmission: 'automatic', photos: input.photoIds.map(id => window.fixture.photos.find(photo => photo.id === id)), includeRegistrationNumber: input.includeRegistrationNumber ?? false, registrationNumber: input.includeRegistrationNumber ? 'ABC123' : null } };
  window.fixture.listings = [...window.fixture.listings.filter(item => item.stockId !== input.stockItemId), listing];
  return { ok: true, receipt: { listing } };
}
export async function createAdvertisingListingAction(input) {
  window.fixture.createCalls.push({ ...input });
  return take(window.fixture.createResponses) ?? draft(input);
}
export async function saveAdvertisingListingAction(input) {
  window.fixture.saveCalls.push({ ...input });
  return take(window.fixture.saveResponses) ?? draft(input, window.fixture.listings.find(item => item.id === input.listingId));
}
export async function markAdvertisingListingReadyAction(input) {
  window.fixture.readyCalls.push({ ...input });
  const response = take(window.fixture.readyResponses); if (response) return response;
  const listing = window.fixture.listings.find(item => item.id === input.listingId); listing.status = 'ready'; listing.version++;
  return { ok: true, receipt: { listing } };
}
export async function sendAdvertisingListingAction(input) {
  window.fixture.sendCalls.push({ ...input });
  const response = take(window.fixture.sendResponses); if (response) return response;
  const listing = window.fixture.listings.find(item => item.id === input.listingId);
  window.fixture.jobs = input.channels.map(channel => ({ id: `job-${channel}`, companyId: input.companyId, stockId: listing.stockId, listingId: listing.id, listingVersion: listing.version, channel, status: 'queued', version: 1, providerAdId: null, providerUrl: null, snapshot: listing.snapshot, createdAt: '2026-10-13T18:00:00Z', updatedAt: '2026-10-13T18:00:00Z' }));
  return { ok: true, receipt: { status: 'queued', jobs: window.fixture.jobs, listing } };
}
export async function requestAdvertisingConnectionAction(input) {
  window.fixture.connectionCalls.push({ ...input });
  const response = take(window.fixture.connectionResponses); if (response) return response;
  const connection = { channel: input.channel, accountReference: input.accountReference, status: 'requested', dispatcherAvailable: false };
  window.fixture.channels = [...window.fixture.channels.filter(item => item.channel !== input.channel), connection];
  return { ok: true, connection };
}
