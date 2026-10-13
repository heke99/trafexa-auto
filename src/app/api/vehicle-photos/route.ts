import { PhotoError, photoFailure, photoUuid, requirePhotoContext } from '@/lib/vehicle-photos/server';
import { MAX_PHOTO_BYTES } from '@/lib/vehicle-photos/types';
import { supportedPhotoType, uploadVehiclePhoto } from '@/lib/vehicle-photos/upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

async function boundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new PhotoError('invalid_input');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_PHOTO_BYTES + 65536) { await reader.cancel(); throw new PhotoError('invalid_input'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin || !request.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new PhotoError('access_denied');
    await requirePhotoContext(undefined, true);
    const body = await boundedBody(request);
    const form = await new Response(body, { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData();
    const keys = ['companyId', 'stockId', 'photoId', 'requestId', 'file'];
    if ([...form.keys()].some(key => !keys.includes(key)) || keys.some(key => form.getAll(key).length !== 1)) throw new PhotoError('invalid_input');
    const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > MAX_PHOTO_BYTES || !supportedPhotoType(file.type)) throw new PhotoError('invalid_input');
    const photo = await uploadVehiclePhoto({ companyId: photoUuid(form.get('companyId')), stockId: photoUuid(form.get('stockId')), photoId: photoUuid(form.get('photoId')), requestId: photoUuid(form.get('requestId')), contentType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json({ ok: true, photo }, { headers });
  } catch (error) { const failure = photoFailure(error); return Response.json(failure, { status: failure.code === 'access_denied' ? 403 : failure.code === 'invalid_input' ? 400 : failure.code === 'conflict' ? 409 : 503, headers }); }
}
