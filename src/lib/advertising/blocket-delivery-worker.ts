import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { AdvertisingProvider, AdvertisingProviderOutcome, AdvertisingPublicPayload, AdvertisingWorkerJob, BlocketDelivery, BlocketProviderOutcome } from './provider-contract';
import type { AdvertisingWorkerStore } from './advertising-worker';
import type { BlocketDeliveryStore } from './blocket-delivery-store';
import { parseBlocketDelivery } from './blocket-delivery-store';

type Options = { job: AdvertisingWorkerJob; provider: AdvertisingProvider; ledger: BlocketDeliveryStore; store: AdvertisingWorkerStore;
  payload(): Promise<AdvertisingPublicPayload>; now(): Date; verifyProvider(job: AdvertisingWorkerJob): void;
  safeOutcome(job: AdvertisingWorkerJob, outcome: unknown): AdvertisingProviderOutcome };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function bound(raw: BlocketDelivery, job: AdvertisingWorkerJob) {
  const delivery = parseBlocketDelivery(raw);
  if (delivery.companyId !== job.companyId || delivery.listingId !== job.listingId || delivery.sourceId !== job.listingId || delivery.listingVersion !== job.listingVersion
    || delivery.connectionId !== job.connectionId || delivery.connectionVersion !== job.connectionVersion || delivery.dealerCode !== job.accountReference
    || job.providerAdId !== null && delivery.providerAdId !== job.providerAdId) throw Error('invalid_blocket_delivery_binding');
  return delivery;
}
function evidence(job: AdvertisingWorkerJob, raw: BlocketProviderOutcome, options: Options): BlocketProviderOutcome {
  const safe = options.safeOutcome(job, raw);
  if (raw.providerRequestId !== undefined && (typeof raw.providerRequestId !== 'string' || !UUID.test(raw.providerRequestId))) return { status: 'outcome_unknown', errorCode: 'invalid_provider_evidence' };
  if (raw.evidenceSha256 !== undefined && (typeof raw.evidenceSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.evidenceSha256))) return { status: 'outcome_unknown', errorCode: 'invalid_provider_evidence' };
  if (safe.status === 'published' && (!raw.providerRequestId || !raw.evidenceSha256)) return { status: 'outcome_unknown', errorCode: 'invalid_provider_evidence' };
  if (safe.status === 'submitted' && !raw.providerRequestId) return { status: 'outcome_unknown', errorCode: 'invalid_provider_evidence' };
  return { ...safe, ...(raw.providerRequestId ? { providerRequestId: raw.providerRequestId } : {}), ...(raw.evidenceSha256 ? { evidenceSha256: raw.evidenceSha256 } : {}) };
}

export async function runBlocketDelivery(options: Options): Promise<AdvertisingWorkerJob> {
  let job = options.job;
  let delivery = await options.ledger.get(job.id);
  const identity = () => ({ sourceId: job.listingId, listingVersion: job.listingVersion, accountReference: job.accountReference });
  async function save(raw: BlocketProviderOutcome, token: string | null, reconciling: boolean) {
    let outcome = evidence(job, raw, options);
    if (delivery!.providerRequestId && outcome.providerRequestId && delivery!.providerRequestId !== outcome.providerRequestId
      || delivery!.providerAdId && outcome.providerAdId && delivery!.providerAdId !== outcome.providerAdId) outcome = { status: 'outcome_unknown', errorCode: 'invalid_provider_evidence' };
    if (reconciling && (outcome.status === 'outcome_unknown' || outcome.status === 'retryable')) return job;
    // A recovered first acknowledgement must become durable before publication is recorded.
    if (outcome.status === 'published' && !delivery!.providerRequestId) {
      delivery = bound(await options.ledger.record(job.id, delivery!, token, { status: 'submitted', providerRequestId: outcome.providerRequestId, providerAdId: outcome.providerAdId }), job);
    }
    delivery = bound(await options.ledger.record(job.id, delivery!, token, outcome), job);
    if (outcome.status === 'published' && delivery.status !== 'published' || outcome.status === 'submitted' && delivery.status !== 'submitted') throw Error('invalid_blocket_delivery_receipt');
    const publicOutcome = options.safeOutcome(job, outcome);
    return options.store.saveJob(job.id, job.version, token, publicOutcome);
  }
  if (delivery) {
    delivery = bound(delivery, job);
    if (delivery.status === 'published') {
      // Verified immutable proof is already durable. Remote state may since have changed;
      // finalizing a lost local save must not depend on another GET or a re-hashed log.
      return options.store.saveJob(job.id, job.version, job.claimToken,
        options.safeOutcome(job, { status: 'published', providerAdId: delivery.providerAdId, providerUrl: null }));
    }
    if (delivery.status === 'rejected') {
      return options.store.saveJob(job.id, job.version, job.claimToken,
        options.safeOutcome(job, { status: 'rejected', errorCode: 'blocket_delivery_rejected', ...(delivery.providerAdId ? { providerAdId: delivery.providerAdId } : {}) }));
    }
    // Existing durable intent, including a begin whose response was lost, only permits reads.
    let outcome: BlocketProviderOutcome;
    try { options.verifyProvider(job); outcome = await options.provider.reconcile(identity(), delivery); }
    catch { return job; }
    return save(outcome, job.claimToken, true);
  }
  if (job.status !== 'queued' && job.status !== 'retryable') return job;
  const payload = await options.payload(), payloadSha256 = createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
  const claimToken = randomUUID(), original = job;
  const begun = await options.ledger.begin(job, claimToken, payloadSha256);
  job = begun.job; delivery = bound(begun.delivery, job);
  const stable: (keyof AdvertisingWorkerJob)[] = ['id','companyId','stockId','listingId','listingVersion','channel','connectionId','connectionVersion','accountReference','dispatcherId','createdBy','providerAdId','providerUrl'];
  if (stable.some(key => job[key] !== original[key]) || JSON.stringify(job.snapshot) !== JSON.stringify(original.snapshot)
    || delivery.payloadSha256 !== payloadSha256 || job.status !== 'dispatching' || job.claimToken !== claimToken
    || job.version !== original.version + 1 || !job.claimExpiresAt || !Number.isFinite(Date.parse(job.claimExpiresAt)) || Date.parse(job.claimExpiresAt) <= options.now().getTime()) throw Error('invalid_advertising_claim');
  options.verifyProvider(job);
  if (begun.replayed) return job;
  if (delivery.status !== 'dispatching' || delivery.providerRequestId !== null) throw Error('invalid_blocket_delivery');
  let outcome: BlocketProviderOutcome;
  try { outcome = await options.provider.submit(payload, delivery); }
  catch { outcome = { status: 'outcome_unknown', errorCode: 'provider_outcome_unknown' }; }
  // Persist the revision result first; failure leaves a durable intent that can never POST again.
  return save(outcome, claimToken, false);
}
