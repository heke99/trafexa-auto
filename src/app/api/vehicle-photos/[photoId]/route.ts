import { normalizeVehicleImage } from '@/lib/vehicle-photos/images';
import { deadline, getStoredPhoto, PhotoError, photoUuid, requirePhotoContext } from '@/lib/vehicle-photos/server';
import { MAX_PHOTO_BYTES, PHOTO_BUCKET } from '@/lib/vehicle-photos/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" };
export async function GET(_request: Request, { params }: { params: Promise<{ photoId: string }> }) {
  try {
    const id = photoUuid((await params).photoId);
    const context = await requirePhotoContext();
    const photo = await getStoredPhoto(context, id);
    if (!photo) throw new PhotoError('access_denied');
    const file = await deadline(context.db.storage.from(PHOTO_BUCKET).download(photo.objectPath));
    if (file.error || !file.data || file.data.size !== photo.sizeBytes || file.data.size > MAX_PHOTO_BYTES) throw new PhotoError('unavailable');
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    const clean = await normalizeVehicleImage(bytes, photo.contentType);
    const fresh = await requirePhotoContext(context.company);
    const current = await getStoredPhoto(fresh, id);
    if (!current || current.stockId !== photo.stockId || current.objectPath !== photo.objectPath || current.contentType !== photo.contentType || current.sizeBytes !== photo.sizeBytes) throw new PhotoError('access_denied');
    return new Response(clean.bytes, { headers: { ...headers, 'Content-Type': clean.contentType, 'Content-Disposition': `inline; filename="${id}.${photo.contentType === 'image/jpeg' ? 'jpg' : photo.contentType === 'image/png' ? 'png' : 'webp'}"` } });
  } catch { return new Response('Bilden är inte tillgänglig.', { status: 404, headers }); }
}
