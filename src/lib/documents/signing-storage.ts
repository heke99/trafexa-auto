/** Server-only bridge for private Supabase objects and verified provider downloads. */
import { createHash } from 'node:crypto';
import { createSigningJob } from './signing-state.ts';
import type { SigningContext } from './signing-state.ts';
import type { TrustedPrivateArchive } from './signing-worker.ts';

export class SigningStorageError extends Error {
  readonly code: 'invalid_configuration' | 'invalid_context' | 'private_storage_required' | 'invalid_file' | 'download_denied' | 'unavailable' | 'stored_file_mismatch';
  constructor(code: SigningStorageError['code']) {
    super('Private signing document operation could not be completed.');
    this.name = 'SigningStorageError'; this.code = code;
  }
}
if (typeof window !== 'undefined') throw new SigningStorageError('invalid_configuration');

type StorageResult<T> = { data: T | null; error: unknown | null };
export interface SigningStorageClient {
  storage: {
    getBucket(name: string): Promise<StorageResult<{ id: string; public: boolean }>>;
    from(name: string): {
      download(path: string): Promise<StorageResult<Blob>>;
      upload(path: string, bytes: Uint8Array, options: { contentType: string; upsert: false; cacheControl: string }): Promise<StorageResult<{ path: string }>>;
    };
  };
}
export type PrivateSigningStorageConfig = {
  client: SigningStorageClient;
  allowedDownloadOrigins?: string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};
const BUCKET = 'dealer-documents';
const MAX_BYTES = 50 * 1024 * 1024;
const CONTEXT_KEYS = ['id', 'companyId', 'documentId', 'dealId', 'documentVersion', 'sourceSha256', 'templateId', 'templateVersion', 'templateSha256'] as const;
function fail(code: SigningStorageError['code']): never { throw new SigningStorageError(code); }
function context(value: SigningContext): SigningContext {
  try { createSigningJob({ ...value, expectedSignerExternalIds: ['storage-verification'] }); }
  catch { return fail('invalid_context'); }
  return Object.fromEntries(CONTEXT_KEYS.map(key => [key, value[key]])) as SigningContext;
}
function path(value: string, companyId: string): string {
  if (typeof value !== 'string' || value.length > 1024 || !value.startsWith(`${companyId}/`) || value.split('/').some(part => !/^[a-zA-Z0-9._-]+$/.test(part) || part === '.' || part === '..')) return fail('invalid_context');
  return value;
}
function pdf(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength < 5 || value.byteLength > MAX_BYTES || Buffer.from(value.subarray(0, 5)).toString('ascii') !== '%PDF-') return fail('invalid_file');
  return new Uint8Array(value);
}
function hash(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }

export function createPrivateSigningStorage(config: PrivateSigningStorageConfig) {
  if (!config || typeof config !== 'object' || typeof config.client?.storage?.getBucket !== 'function' || typeof config.client?.storage?.from !== 'function') return fail('invalid_configuration');
  const client = config.client;
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? 15000;
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) return fail('invalid_configuration');
  const allowedOrigins = new Set<string>();
  for (const address of config.allowedDownloadOrigins ?? []) {
    let origin: URL;
    try { origin = new URL(address); } catch { return fail('invalid_configuration'); }
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') return fail('invalid_configuration');
    allowedOrigins.add(origin.origin);
  }
  async function bounded<T>(work: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SigningStorageError('unavailable')), timeoutMs);
      })]);
    } catch (error) { if (error instanceof SigningStorageError) throw error; return fail('unavailable'); }
    finally { if (timer) clearTimeout(timer); }
  }
  async function privateBucket(): Promise<void> {
    const result = await bounded(() => client.storage.getBucket(BUCKET));
    if (result.error || !result.data || result.data.id !== BUCKET) return fail('unavailable');
    if (result.data.public !== false) return fail('private_storage_required');
  }
  async function read(ctx: SigningContext, objectPath: string): Promise<Uint8Array> {
    path(objectPath, ctx.companyId);
    await privateBucket();
    const result = await bounded(() => client.storage.from(BUCKET).download(objectPath));
    if (result.error || !(result.data instanceof Blob)) return fail('unavailable');
    if (result.data.size < 5 || result.data.size > MAX_BYTES) return fail('invalid_file');
    const bytes = pdf(new Uint8Array(await bounded(() => result.data!.arrayBuffer())));
    // Do not claim private archival success if the bucket changed during the operation.
    await privateBucket();
    return bytes;
  }
  async function download(address: string): Promise<Uint8Array> {
    let url: URL;
    try { url = new URL(address); } catch { return fail('download_denied'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !allowedOrigins.has(url.origin)) return fail('download_denied');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = (async () => {
        // Signed artifact URLs carry their own authorization. Never send API keys here.
        const response = await fetchImpl(url.toString(), { redirect: 'error', cache: 'no-store', signal: controller.signal });
        if (!response.ok || !response.body) return fail('unavailable');
        const length = response.headers.get('content-length');
        if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) return fail('invalid_file');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > MAX_BYTES) { void reader.cancel().catch(() => {}); return fail('invalid_file'); }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
        return pdf(Buffer.concat(chunks));
      })();
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new SigningStorageError('unavailable')); }, timeoutMs);
      })]);
    } catch (error) { if (error instanceof SigningStorageError) throw error; return fail('unavailable'); }
    finally { if (timer) clearTimeout(timer); }
  }
  async function persist(ctx: SigningContext, bytes: Uint8Array, kind: 'signed' | 'audit') {
    const checksum = hash(bytes);
    const objectPath = `${ctx.companyId}/signing/${ctx.id}/v${ctx.documentVersion}/${kind}-${checksum}.pdf`;
    await privateBucket();
    const result = await bounded(() => client.storage.from(BUCKET).upload(objectPath, bytes, { contentType: 'application/pdf', upsert: false, cacheControl: '0' }));
    if (!result.error && result.data?.path !== objectPath) return fail('stored_file_mismatch');
    // A duplicate immutable-object upload can be a safe retry only after read-back.
    // Even when upload reports an error, success requires the exact intended bytes.
    const stored = await read(ctx, objectPath);
    if (hash(stored) !== checksum) return fail('stored_file_mismatch');
    return { path: objectPath, downloadedBytes: new Uint8Array(bytes) };
  }
  const archive: TrustedPrivateArchive = {
    async store(input) {
      const ctx = context(input.context);
      if (!Number.isSafeInteger(input.submissionId) || input.submissionId < 1) return fail('invalid_context');
      await privateBucket();
      const signed = await download(input.signedPdfSourceUrl);
      const audit = await download(input.auditSourceUrl);
      return {
        context: ctx, submissionId: input.submissionId, storageVisibility: 'private',
        signedPdf: await persist(ctx, signed, 'signed'), audit: await persist(ctx, audit, 'audit'),
      };
    },
    async readStored(input) {
      const ctx = context(input.context);
      return { context: ctx, path: path(input.path, ctx.companyId), storageVisibility: 'private', bytes: await read(ctx, input.path) };
    },
  };
  return {
    archive,
    async readPrivateObject(input: { context: SigningContext; objectPath: string }) {
      const ctx = context(input.context);
      return { context: ctx, objectPath: path(input.objectPath, ctx.companyId), storageVisibility: 'private' as const, bytes: await read(ctx, input.objectPath) };
    },
  };
}
