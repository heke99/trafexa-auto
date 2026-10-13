'use server';

import { revalidatePath } from 'next/cache';
import { deadline, parseStoredPhoto, photoFailure, photoInput, photoObject, photoRpcError, photoUuid, PhotoError, publicPhoto, requirePhotoContext } from './server';
import type { PhotoResult, VehiclePhoto } from './types';

export async function listVehiclePhotosAction(value: unknown): Promise<PhotoResult<{ photos: VehiclePhoto[]; nextPageKey: string | null }>> {
  try {
    const row = photoInput(value, ['companyId', 'stockId', 'pageKey']);
    const companyId = photoUuid(row.companyId), stockId = photoUuid(row.stockId), pageKey = row.pageKey == null ? null : photoUuid(row.pageKey);
    const context = await requirePhotoContext(companyId);
    const result = await deadline(context.db.rpc('list_vehicle_photos', { p_company_id: companyId, p_stock_id: stockId, p_page_key: pageKey, p_limit: 50 }));
    photoRpcError(result.error);
    const page = photoObject(result.data);
    if (!Array.isArray(page.photos) || page.photos.length > 20) throw new PhotoError('unavailable');
    const photos = page.photos.map(value => publicPhoto(parseStoredPhoto(value, companyId, undefined, stockId)));
    if (photos.some((photo, index) => photo.status !== 'active' || photo.id <= (index ? photos[index - 1].id : pageKey ?? '')) || page.nextPageKey !== null) throw new PhotoError('unavailable');
    return { ok: true, photos, nextPageKey: null };
  } catch (error) { return photoFailure(error); }
}
export async function archiveVehiclePhotoAction(value: unknown): Promise<PhotoResult<{ photo: VehiclePhoto }>> {
  try {
    const row = photoInput(value, ['companyId', 'photoId', 'expectedVersion', 'requestId']);
    const companyId = photoUuid(row.companyId), photoId = photoUuid(row.photoId), requestId = photoUuid(row.requestId);
    if (typeof row.expectedVersion !== 'number' || !Number.isSafeInteger(row.expectedVersion) || row.expectedVersion < 1) throw new PhotoError('invalid_input');
    const context = await requirePhotoContext(companyId, true);
    const result = await deadline(context.db.rpc('archive_vehicle_photo', { p_company_id: companyId, p_photo_id: photoId, p_expected_version: row.expectedVersion, p_request_id: requestId }));
    photoRpcError(result.error);
    const receipt = photoObject(result.data);
    const photo = parseStoredPhoto(receipt.photo, companyId, photoId);
    if (receipt.actorUserId !== context.userId || receipt.requestId !== requestId || photo.status !== 'archived' || photo.version !== row.expectedVersion + 1) throw new PhotoError('unavailable');
    try { revalidatePath('/advertising'); revalidatePath('/inventory'); } catch { /* Immutable receipt remains valid. */ }
    return { ok: true, photo: publicPhoto(photo) };
  } catch (error) { return photoFailure(error); }
}
