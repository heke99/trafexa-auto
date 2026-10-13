// Substitute private photo action transport, while the actual root-owned gallery renders unchanged.
export async function listVehiclePhotosAction({ companyId, stockId }) {
  window.fixture.photoCalls.push(stockId);
  return { ok: true, photos: window.fixture.photos.map(photo => ({ ...photo, companyId, stockId })), nextPageKey: null };
}
export async function archiveVehiclePhotoAction() {
  throw new Error('Read-only advertising previews must not archive photos');
}
