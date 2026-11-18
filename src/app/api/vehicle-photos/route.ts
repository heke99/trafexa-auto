import { PhotoError, photoFailure, photoUuid, requirePhotoContext } from '@/lib/vehicle-photos/server';
import { MAX_PHOTO_UPLOAD_BYTES } from '@/lib/vehicle-photos/types';
import { supportedPhotoType, uploadVehiclePhoto } from '@/lib/vehicle-photos/upload';
import { readRequestBody, RequestBodyError } from '@/lib/http/request-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin || !request.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new PhotoError('access_denied');
    await requirePhotoContext(undefined, true);
    const body = await readRequestBody(request, MAX_PHOTO_UPLOAD_BYTES + 65536);
    const form = await new Response(body, { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData();
    const keys = ['companyId', 'stockId', 'photoId', 'requestId', 'file'];
    if ([...form.keys()].some(key => !keys.includes(key)) || keys.some(key => form.getAll(key).length !== 1)) throw new PhotoError('invalid_input');
    const file = form.get('file');
    if (file instanceof File && file.size > MAX_PHOTO_UPLOAD_BYTES) throw new RequestBodyError('too_large');
    if (!(file instanceof File) || !file.size || !supportedPhotoType(file.type)) throw new PhotoError('invalid_input');
    const photo = await uploadVehiclePhoto({ companyId: photoUuid(form.get('companyId')), stockId: photoUuid(form.get('stockId')), photoId: photoUuid(form.get('photoId')), requestId: photoUuid(form.get('requestId')), contentType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json({ ok: true, photo }, { headers });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      const status = error.reason === 'timeout' ? 408 : error.reason === 'too_large' ? 413 : 400;
      const message = error.reason === 'timeout' ? 'Det tog för lång tid att ta emot bilden. Försök igen.' : 'Välj en JPEG-, PNG- eller WebP-bild på högst 4 MiB.';
      return Response.json({ ok: false, code: 'invalid_input', message }, { status, headers });
    }
    const failure = photoFailure(error);
    return Response.json(failure, { status: failure.code === 'access_denied' ? 403 : failure.code === 'invalid_input' ? 400 : failure.code === 'conflict' ? 409 : 503, headers });
  }
}
