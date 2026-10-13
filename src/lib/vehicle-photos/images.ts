import 'server-only';
import sharp from 'sharp';
import { MAX_PHOTO_BYTES, type PhotoContentType } from './types';
import { PhotoError } from './server';

const MAX_PIXELS = 16777216;
const types = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;
async function metadata(bytes: Uint8Array, expected: unknown) {
  if (!bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES || !Object.values(types).includes(expected as PhotoContentType)) throw new PhotoError('invalid_input');
  try {
    const image = sharp(bytes, { failOn: 'error', limitInputPixels: MAX_PIXELS, animated: true });
    const info = await image.metadata();
    if (!info.format || !(info.format in types) || types[info.format as keyof typeof types] !== expected || !info.width || !info.height || info.width > 8192 || info.height > 8192 || info.width * info.height > MAX_PIXELS || (info.pages ?? 1) > 1) throw new Error();
    return { image, format: info.format as keyof typeof types, contentType: expected as PhotoContentType };
  } catch { throw new PhotoError('invalid_input'); }
}
/** Decode and re-encode the original image format, removing metadata and embedded payloads. */
export async function normalizeVehicleImage(bytes: Uint8Array, expected: unknown) {
  const checked = await metadata(bytes, expected);
  try {
    const clean = await checked.image.rotate().toFormat(checked.format).toBuffer();
    if (!clean.byteLength || clean.byteLength > MAX_PHOTO_BYTES) throw new Error();
    return { bytes: clean, contentType: checked.contentType };
  } catch { throw new PhotoError('invalid_input'); }
}
/** Metadata alone is insufficient: decode every pixel before releasing stored bytes. */
export async function validateStoredVehicleImage(bytes: Uint8Array, expected: PhotoContentType) {
  const checked = await metadata(bytes, expected);
  try { await checked.image.raw().toBuffer(); } catch { throw new PhotoError('unavailable'); }
}
