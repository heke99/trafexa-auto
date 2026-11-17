import 'server-only';
import { createHash } from 'node:crypto';
import type { AdvertisingMediaResolver, ResolvedAdvertisingPhoto } from '@/lib/advertising/advertising-worker';
import type { AdvertisingPhoto } from '@/lib/advertising/provider-contract';
import { normalizeVehicleImage } from './images';
import { MAX_PHOTO_BYTES, PHOTO_BUCKET } from './types';

const EXPORT_BUCKET = 'ads-export-media';
const BATCH_SIZE = 3;
const MAX_BATCH_MS = 30000;
const BUCKETS = [PHOTO_BUCKET, EXPORT_BUCKET] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type StorageResult<T> = { data: T | null; error: unknown | null };
/** Inject a trusted server-side service client. No credentials are read or created here. */
export interface AdvertisingExportStorageClient {
  storage: {
    getBucket(name: string): Promise<StorageResult<{ id: string; public: boolean }>>;
    from(name: string): {
      download(path: string): Promise<StorageResult<Blob>>;
      upload(path: string, bytes: Uint8Array, options: { contentType: string; upsert: false; cacheControl: string }): Promise<StorageResult<{ path: string }>>;
      createSignedUrl(path: string, expiresIn: number): Promise<StorageResult<{ signedUrl: string }>>;
    };
  };
}
type Options = {
  client: AdvertisingExportStorageClient;
  /** Trusted project origin from server provisioning, never dealer input. */
  projectOrigin: string;
  enabled?: boolean;
  expiresInSeconds?: number;
  timeoutMs?: number;
  now?: () => Date;
};
export class AdvertisingExportMediaError extends Error {
  constructor(readonly code: 'disabled' | 'invalid_configuration' | 'invalid_photo' | 'private_storage_required' | 'unavailable' | 'stored_file_mismatch') {
    super('Annonsbilden kunde inte verifieras för export.');
    this.name = 'AdvertisingExportMediaError';
  }
}
function fail(code: AdvertisingExportMediaError['code']): never { throw new AdvertisingExportMediaError(code); }
function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function extension(contentType: AdvertisingPhoto['contentType']) {
  return contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : 'webp';
}
function photoIdentity(photo: AdvertisingPhoto) {
  if (!photo || !UUID.test(photo.id) || !UUID.test(photo.companyId) || !UUID.test(photo.stockId)
    || photo.status !== 'active' || photo.storageBucket !== PHOTO_BUCKET || photo.storageVisibility !== 'private'
    || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.contentType)
    || !Number.isSafeInteger(photo.version) || photo.version < 1
    || !Number.isSafeInteger(photo.sizeBytes) || photo.sizeBytes < 1 || photo.sizeBytes > MAX_PHOTO_BYTES
    || !Number.isFinite(Date.parse(photo.createdAt))
    || photo.objectPath !== `${photo.companyId}/${photo.stockId}/${photo.id}.${extension(photo.contentType)}`) {
    fail('invalid_photo');
  }
  // Copy the trusted immutable job snapshot so caller mutation cannot redirect reads mid-flight.
  return { ...photo };
}

export function createAdvertisingExportMediaResolver(options: Options): AdvertisingMediaResolver {
  let origin: URL;
  try { origin = new URL(options.projectOrigin); } catch { return fail('invalid_configuration'); }
  const expiresIn = options.expiresInSeconds ?? 172800;
  const timeout = options.timeoutMs ?? 20000;
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.port || origin.pathname !== '/'
    || origin.search || origin.hash || typeof options.client?.storage?.getBucket !== 'function'
    || typeof options.client?.storage?.from !== 'function'
    || !Number.isSafeInteger(expiresIn) || expiresIn < 172800 || expiresIn > 604800
    || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30000) fail('invalid_configuration');
  const client = options.client;
  const enabled = options.enabled === true;
  const now = options.now ?? (() => new Date());
  async function resolveBatch(inputs: readonly AdvertisingPhoto[]): Promise<ResolvedAdvertisingPhoto[]> {
    if (!enabled) fail('disabled');
    if (inputs.length < 1 || inputs.length > 20) fail('invalid_photo');
    const photos = inputs.map(photoIdentity);
    const deadline = performance.now() + MAX_BATCH_MS;
    let stopped = false;

    async function bounded<T>(operation: () => Promise<T>): Promise<T> {
      const remaining = deadline - performance.now();
      if (stopped || remaining <= 0) fail('unavailable');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([operation(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new AdvertisingExportMediaError('unavailable')), Math.min(timeout, remaining));
        })]);
      } catch (error) {
        if (error instanceof AdvertisingExportMediaError) throw error;
        return fail('unavailable');
      } finally { clearTimeout(timer); }
    }

    async function checkPrivateBuckets() {
      const results = await Promise.all(BUCKETS.map(bucket => bounded(() => client.storage.getBucket(bucket))));
      for (const [index, result] of results.entries()) {
        if (result.error || result.data?.id !== BUCKETS[index]) fail('unavailable');
        if (result.data.public !== false) fail('private_storage_required');
      }
    }

    async function read(bucket: string, path: string, expectedSize: number, allowMissing: boolean) {
      const result = await bounded(() => client.storage.from(bucket).download(path));
      if (allowMissing && result.data === null && result.error && typeof result.error === 'object') {
        const error = result.error as { status?: unknown; statusCode?: unknown };
        if (error.status === 404 || error.statusCode === '404' || error.statusCode === 'NoSuchKey') return null;
      }
      if (result.error || !(result.data instanceof Blob) || result.data.size < 1 || result.data.size > MAX_PHOTO_BYTES
        || result.data.size !== expectedSize) fail('unavailable');
      return new Uint8Array(await bounded(() => result.data!.arrayBuffer()));
    }

    async function normalize(photo: AdvertisingPhoto) {
      const source = await read(PHOTO_BUCKET, photo.objectPath, photo.sizeBytes, false);
      if (!source) fail('unavailable');
      const normalized = await bounded(() => normalizeVehicleImage(source, photo.contentType).catch(() => fail('invalid_photo')));
      if (normalized.contentType !== photo.contentType || normalized.bytes.byteLength < 1 || normalized.bytes.byteLength > MAX_PHOTO_BYTES) fail('invalid_photo');
      const digest = sha256(normalized.bytes);
      const objectPath = `${photo.companyId}/${photo.stockId}/${photo.id}/${digest}.${extension(normalized.contentType)}`;
      return { digest, objectPath, normalized };
    }

    async function verifyExport({ digest, objectPath, normalized }: Awaited<ReturnType<typeof normalize>>) {
      let stored = await read(EXPORT_BUCKET, objectPath, normalized.bytes.byteLength, true);
      if (!stored) {
        const uploaded = await bounded(() => client.storage.from(EXPORT_BUCKET).upload(objectPath, normalized.bytes, {
          contentType: normalized.contentType, upsert: false, cacheControl: '0',
        }));
        if (!uploaded.error && uploaded.data?.path !== objectPath) fail('stored_file_mismatch');
        // A lost or duplicate upload receipt is safe only after exact readback.
        stored = await read(EXPORT_BUCKET, objectPath, normalized.bytes.byteLength, false);
      }
      if (!stored || sha256(stored) !== digest) fail('stored_file_mismatch');
      return { digest, objectPath };
    }

    async function sign({ digest, objectPath }: Awaited<ReturnType<typeof verifyExport>>): Promise<ResolvedAdvertisingPhoto> {
      const issuedAt = now().getTime();
      if (!Number.isFinite(issuedAt)) fail('invalid_configuration');
      const signed = await bounded(() => client.storage.from(EXPORT_BUCKET).createSignedUrl(objectPath, expiresIn));
      if (signed.error || !signed.data?.signedUrl) fail('unavailable');
      let signedUrl: URL;
      try { signedUrl = new URL(signed.data.signedUrl); } catch { return fail('unavailable'); }
      if (signedUrl.origin !== origin.origin || signedUrl.username || signedUrl.password || signedUrl.hash
        || signedUrl.pathname !== `/storage/v1/object/sign/${EXPORT_BUCKET}/${objectPath}`
        || !signedUrl.searchParams.get('token')) fail('unavailable');
      const expiresAt = issuedAt + expiresIn * 1000;
      if (expiresAt < now().getTime() + 86400000) fail('unavailable');
      return { url: signedUrl.href, expiresAt: new Date(expiresAt).toISOString(), objectPath,
        sha256: digest, normalizationVersion: 'vehicle-photo-v1' };
    }

    const resolved: ResolvedAdvertisingPhoto[] = [];
    try {
      await checkPrivateBuckets();
      for (let offset = 0; offset < photos.length; offset += BATCH_SIZE) {
        const normalized = await Promise.all(photos.slice(offset, offset + BATCH_SIZE).map(normalize));
        await checkPrivateBuckets();
        const exports = await Promise.all(normalized.map(verifyExport));
        await checkPrivateBuckets();
        resolved.push(...await Promise.all(exports.map(sign)));
        await checkPrivateBuckets();
      }
    } catch (error) {
      stopped = true;
      throw error;
    }
    return resolved;
  }
  return {
    origin: origin.origin,
    async resolve(photo) { return (await resolveBatch([photo]))[0]; },
    resolveBatch,
  };
}
