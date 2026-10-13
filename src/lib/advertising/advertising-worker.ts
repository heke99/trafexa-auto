import 'server-only';
import { randomUUID } from 'node:crypto';
import { isAdvertisingProviderUrl, type AdvertisingPhoto, type AdvertisingProvider,
  type AdvertisingProviderOutcome, type AdvertisingPublicPayload, type AdvertisingWorkerJob } from './provider-contract';

export interface AdvertisingWorkerStore {
  getJob(id: string): Promise<AdvertisingWorkerJob | null>;
  claimJob(id: string, expectedVersion: number, claimToken: string): Promise<AdvertisingWorkerJob>;
  saveJob(id: string, expectedVersion: number, claimToken: string | null, outcome: AdvertisingProviderOutcome): Promise<AdvertisingWorkerJob>;
  expireDispatch(id: string, expectedVersion: number): Promise<AdvertisingWorkerJob>;
}
export interface AdvertisingMediaResolver {
  /** Verify private object identity/version/content before issuing access. URLs are not persisted. */
  resolve(photo: AdvertisingPhoto): Promise<{ url: string; expiresAt: string; objectPath: string; sha256: string; normalizationVersion: 'vehicle-photo-v1' }>;
  /** Exact trusted storage origin, provisioned server-side; never a dealer supplied host. */
  readonly origin: string;
}
type Options = {
  enabled?: boolean; store: AdvertisingWorkerStore; providers: readonly AdvertisingProvider[];
  media: AdvertisingMediaResolver; now?: () => Date;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function providerFor(job: AdvertisingWorkerJob, options: Options, now: Date) {
  const provider = options.providers.find((item) => item.channel === job.channel && item.dispatcherId === job.dispatcherId);
  const binding = provider?.verifiedBinding;
  if (!provider || !binding || binding.companyId !== job.companyId || binding.connectionId !== job.connectionId
    || binding.connectionVersion !== job.connectionVersion || binding.accountReference !== job.accountReference
    || !Number.isFinite(Date.parse(binding.validUntil)) || Date.parse(binding.validUntil) <= now.getTime()) {
    throw new Error('advertising_connection_unavailable');
  }
  return provider;
}

function validateSnapshot(job: AdvertisingWorkerJob) {
  const snapshot = job.snapshot;
  if (!UUID.test(job.id) || !UUID.test(job.companyId) || !UUID.test(job.stockId)
    || !UUID.test(job.connectionId) || !UUID.test(job.listingId) || !UUID.test(job.createdBy)
    || !Number.isSafeInteger(job.version) || job.version < 1 || !Number.isSafeInteger(job.listingVersion) || job.listingVersion < 1
    || !Number.isSafeInteger(job.connectionVersion) || job.connectionVersion < 1 || !job.accountReference || !job.dispatcherId
    || !snapshot || typeof snapshot.title !== 'string' || !snapshot.title.trim() || snapshot.title.length > 200
    || typeof snapshot.description !== 'string' || snapshot.description.length > 10000
    || typeof snapshot.make !== 'string' || !snapshot.make.trim() || snapshot.make.length > 200
    || typeof snapshot.model !== 'string' || !snapshot.model.trim() || snapshot.model.length > 200
    || typeof snapshot.fuel !== 'string' || snapshot.fuel.length > 100
    || typeof snapshot.transmission !== 'string' || snapshot.transmission.length > 100
    || typeof snapshot.priceGrossOre !== 'string' || !/^[1-9]\d{0,14}$/.test(snapshot.priceGrossOre)
    || !Number.isInteger(snapshot.year) || snapshot.year < 1900 || snapshot.year > 2100
    || !Number.isSafeInteger(snapshot.mileageKm) || snapshot.mileageKm < 0
    || typeof snapshot.includeRegistrationNumber !== 'boolean'
    || (snapshot.includeRegistrationNumber && (typeof snapshot.registrationNumber !== 'string' || !/^[A-Z0-9]{6}$/.test(snapshot.registrationNumber)))
    || (!snapshot.includeRegistrationNumber && snapshot.registrationNumber !== null)
    || !Array.isArray(snapshot.photos) || snapshot.photos.length < 1 || snapshot.photos.length > 20) {
    throw new Error('invalid_advertising_snapshot');
  }
  const ids = new Set<string>();
  for (const photo of snapshot.photos) {
    if (!UUID.test(photo.id) || ids.has(photo.id) || photo.companyId !== job.companyId || photo.stockId !== job.stockId
      || photo.status !== 'active' || photo.storageBucket !== 'ads-vehicle-photos' || photo.storageVisibility !== 'private'
      || !Number.isSafeInteger(photo.version) || photo.version < 1 || !Number.isSafeInteger(photo.sizeBytes)
      || photo.sizeBytes < 1 || photo.sizeBytes > 10485760
      || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.contentType)
      || typeof photo.objectPath !== 'string' || !photo.objectPath.startsWith(`${job.companyId}/${job.stockId}/`)
      || photo.objectPath.includes('..') || photo.objectPath.includes('//') || photo.objectPath.includes('%')) {
      throw new Error('invalid_advertising_photo');
    }
    ids.add(photo.id);
  }
}

async function payloadFor(job: AdvertisingWorkerJob, options: Options): Promise<AdvertisingPublicPayload> {
  validateSnapshot(job);
  const origin = new URL(options.media.origin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.port || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('invalid_advertising_media_origin');
  }
  const photos: AdvertisingPublicPayload['photos'] = [];
  for (const photo of job.snapshot.photos) {
    const signed = await options.media.resolve(photo);
    const url = new URL(signed.url);
    const extension = photo.contentType === 'image/jpeg' ? 'jpg' : photo.contentType === 'image/png' ? 'png' : 'webp';
    const normalizedPath = `${job.companyId}/${job.stockId}/${photo.id}/${signed.sha256}.${extension}`;
    // Partners process images asynchronously; short-lived links must never be submitted.
    const expires = Date.parse(signed.expiresAt);
    if (url.origin !== origin.origin || url.protocol !== 'https:' || url.username || url.password || url.hash
      || signed.normalizationVersion !== 'vehicle-photo-v1' || !/^[a-f0-9]{64}$/.test(signed.sha256)
      || signed.objectPath !== normalizedPath || url.pathname !== `/storage/v1/object/sign/ads-export-media/${normalizedPath}`
      || !url.searchParams.get('token')
      || !Number.isFinite(expires)
      || expires < (options.now?.() ?? new Date()).getTime() + 86400000) {
      throw new Error('advertising_media_unavailable');
    }
    photos.push({ url: url.href, contentType: photo.contentType, expiresAt: signed.expiresAt });
  }
  // Explicit projection prevents leaking purchase costs, customer data or internal notes.
  return { sourceId: job.listingId, listingVersion: job.listingVersion, accountReference: job.accountReference, title: job.snapshot.title,
    description: job.snapshot.description, make: job.snapshot.make, model: job.snapshot.model,
    fuel: job.snapshot.fuel, transmission: job.snapshot.transmission, priceGrossOre: job.snapshot.priceGrossOre,
    year: job.snapshot.year, mileageKm: job.snapshot.mileageKm,
    ...(job.snapshot.includeRegistrationNumber && job.snapshot.registrationNumber ? { registrationNumber: job.snapshot.registrationNumber } : {}), photos };
}

function safeOutcome(channel: AdvertisingWorkerJob['channel'], outcome: AdvertisingProviderOutcome): AdvertisingProviderOutcome {
  if (outcome.status === 'published') {
    if (!outcome.providerAdId || outcome.providerAdId.length > 200
      || (outcome.providerUrl !== null && !isAdvertisingProviderUrl(channel, outcome.providerUrl))) {
      return { status: 'outcome_unknown', errorCode: 'invalid_provider_evidence' };
    }
    return { status: 'published', providerAdId: outcome.providerAdId, providerUrl: outcome.providerUrl };
  }
  if (!['submitted', 'outcome_unknown', 'rejected', 'retryable'].includes(outcome.status)) {
    return { status: 'outcome_unknown', errorCode: 'invalid_provider_evidence' };
  }
  // Raw partner errors can contain credentials, signed image URLs or customer data.
  const errorCode = 'errorCode' in outcome && typeof outcome.errorCode === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(outcome.errorCode)
    ? outcome.errorCode : 'provider_status_pending';
  return { status: outcome.status, errorCode };
}

export function createAdvertisingWorker(options: Options) {
  return {
    async run(jobId: string): Promise<AdvertisingWorkerJob | null> {
      if (options.enabled !== true) throw new Error('advertising_dispatch_disabled');
      if (!UUID.test(jobId)) throw new Error('invalid_advertising_job_id');
      const now = options.now?.() ?? new Date();
      let job = await options.store.getJob(jobId);
      if (!job) return null;
      if (['published', 'rejected'].includes(job.status)) return job;
      if (job.status === 'dispatching') {
        if (!job.claimExpiresAt || Date.parse(job.claimExpiresAt) > now.getTime()) return job;
        job = await options.store.expireDispatch(job.id, job.version);
      }
      const provider = providerFor(job, options, now);
      if (job.status === 'submitted' || job.status === 'outcome_unknown') {
        let outcome: AdvertisingProviderOutcome;
        try { outcome = await provider.reconcile({ sourceId: job.listingId, listingVersion: job.listingVersion, accountReference: job.accountReference }); }
        catch { outcome = { status: 'outcome_unknown', errorCode: 'provider_reconciliation_unavailable' }; }
        const sanitized = safeOutcome(job.channel, outcome);
        // Reconciliation never grants permission to issue a fresh POST, even after a 404.
        if (sanitized.status === 'retryable' || sanitized.status === 'outcome_unknown'
          || (job.status === 'submitted' && sanitized.status === 'submitted')) return job;
        return options.store.saveJob(job.id, job.version, null, sanitized);
      }
      if (job.status !== 'queued' && job.status !== 'retryable') throw new Error('invalid_advertising_job_status');
      const payload = await payloadFor(job, options);
      // SQL claim rechecks live company, member, stock, photos and connection readiness.
      const original = job;
      const claimToken = randomUUID();
      job = await options.store.claimJob(job.id, job.version, claimToken);
      if (job.status !== 'dispatching' || job.claimToken !== claimToken || !UUID.test(job.claimToken)
        || job.version !== original.version + 1 || job.createdBy !== original.createdBy
        || !job.claimExpiresAt || !Number.isFinite(Date.parse(job.claimExpiresAt)) || Date.parse(job.claimExpiresAt) <= (options.now?.() ?? new Date()).getTime()
        || job.id !== original.id || job.companyId !== original.companyId || job.stockId !== original.stockId
        || job.connectionId !== original.connectionId || job.connectionVersion !== original.connectionVersion
        || job.accountReference !== original.accountReference || job.listingId !== original.listingId
        || job.listingVersion !== original.listingVersion || job.dispatcherId !== original.dispatcherId
        || job.channel !== original.channel || JSON.stringify(job.snapshot) !== JSON.stringify(original.snapshot)) {
        throw new Error('invalid_advertising_claim');
      }
      providerFor(job, options, options.now?.() ?? new Date());
      let outcome: AdvertisingProviderOutcome;
      try { outcome = await provider.submit(payload); }
      catch { outcome = { status: 'outcome_unknown', errorCode: 'provider_outcome_unknown' }; }
      // If recording fails, the lease expires into unknown. No network resend on the next run.
      return options.store.saveJob(job.id, job.version, job.claimToken, safeOutcome(job.channel, outcome));
    },
  };
}
