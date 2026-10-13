import 'server-only';
import { createHash } from 'node:crypto';
import { normalizeVehicleImage } from './images';
import { deadline, getStoredPhoto, parseStoredPhoto, photoObject, photoRpcError, PhotoError, publicPhoto, requirePhotoContext } from './server';
import { PHOTO_BUCKET, type PhotoContentType } from './types';

type Upload = { companyId: string; stockId: string; photoId: string; requestId: string; contentType: string; bytes: Uint8Array };
function sameBytes(left: Uint8Array, right: Uint8Array) { return createHash('sha256').update(left).digest('hex') === createHash('sha256').update(right).digest('hex'); }
export async function uploadVehiclePhoto(input: Upload) {
  const context = await requirePhotoContext(input.companyId, true);
  const clean = await normalizeVehicleImage(input.bytes, input.contentType);
  const extension = clean.contentType === 'image/jpeg' ? 'jpg' : clean.contentType === 'image/png' ? 'png' : 'webp';
  const path = `${context.company}/${input.stockId}/${input.photoId}.${extension}`;
  // Unknown previous writes are retried with the same file/path/nonce; no overwrite is allowed.
  const existing = await getStoredPhoto(context, input.photoId);
  if (existing && (existing.stockId !== input.stockId || existing.status !== 'active' || existing.objectPath !== path || existing.contentType !== clean.contentType || existing.sizeBytes !== clean.bytes.byteLength)) throw new PhotoError('conflict');
  if (existing) {
    const downloaded = await deadline(context.db.storage.from(PHOTO_BUCKET).download(path));
    if (downloaded.error || !downloaded.data || !sameBytes(new Uint8Array(await downloaded.data.arrayBuffer()), clean.bytes)) throw new PhotoError('conflict');
  } else {
    const uploaded = await deadline(context.db.storage.from(PHOTO_BUCKET).upload(path, clean.bytes, { contentType: clean.contentType, cacheControl: '0', upsert: false }));
    if (uploaded.error) {
      // Storage may have persisted a previous timed-out upload before metadata registration.
      const downloaded = await deadline(context.db.storage.from(PHOTO_BUCKET).download(path));
      if (downloaded.error || !downloaded.data || !sameBytes(new Uint8Array(await downloaded.data.arrayBuffer()), clean.bytes)) throw new PhotoError('unavailable');
    }
  }
  // Verify the actual persisted object even when Storage reports upload success.
  const persisted = await deadline(context.db.storage.from(PHOTO_BUCKET).download(path));
  if (persisted.error || !persisted.data || persisted.data.size !== clean.bytes.byteLength || !sameBytes(new Uint8Array(await persisted.data.arrayBuffer()), clean.bytes)) throw new PhotoError('unavailable');
  const registration = await deadline(context.db.rpc('register_vehicle_photo', { p_company_id: context.company, p_stock_id: input.stockId, p_photo_id: input.photoId, p_object_path: path, p_content_type: clean.contentType, p_size_bytes: clean.bytes.byteLength, p_request_id: input.requestId }));
  photoRpcError(registration.error);
  const receipt = photoObject(registration.data);
  const registered = parseStoredPhoto(receipt.photo, context.company, input.photoId, input.stockId);
  if (receipt.actorUserId !== context.userId || receipt.requestId !== input.requestId || registered.status !== 'active' || registered.contentType !== clean.contentType || registered.sizeBytes !== clean.bytes.byteLength) throw new PhotoError('unavailable');
  // Recheck current Auth and private metadata after IO; a historical receipt is not current access.
  const fresh = await requirePhotoContext(input.companyId, true);
  const current = await getStoredPhoto(fresh, input.photoId);
  if (!current || current.status !== 'active' || current.objectPath !== path || current.contentType !== clean.contentType || current.sizeBytes !== clean.bytes.byteLength) throw new PhotoError('conflict');
  return publicPhoto(current);
}
export function supportedPhotoType(type: string): type is PhotoContentType { return ['image/jpeg', 'image/png', 'image/webp'].includes(type); }
