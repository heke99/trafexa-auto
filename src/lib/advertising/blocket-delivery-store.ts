import 'server-only';
import type { AdvertisingWorkerJob, BlocketDelivery, BlocketProviderOutcome } from './provider-contract';

export interface BlocketDeliveryStore {
  get(jobId: string): Promise<BlocketDelivery | null>;
  begin(job: AdvertisingWorkerJob, claimToken: string, payloadSha256: string): Promise<{ job: AdvertisingWorkerJob; delivery: BlocketDelivery; replayed: boolean }>;
  record(jobId: string, delivery: BlocketDelivery, claimToken: string | null, outcome: BlocketProviderOutcome): Promise<BlocketDelivery>;
}
export type BlocketServiceRpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_blocket_delivery'); return value as Record<string, unknown>; }
function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) throw Error('invalid_blocket_delivery'); return value; }
function positive(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1) throw Error('invalid_blocket_delivery'); return Number(value); }
export function parseBlocketDelivery(value: unknown): BlocketDelivery {
  const r = object(value), names = ['id','companyId','listingId','listingVersion','sourceId','dealerCode','revision','operation','providerAdId','connectionId','connectionVersion','payloadSha256','providerRequestId','status','version'];
  if (Object.keys(r).length !== names.length || names.some(name => !Object.hasOwn(r, name))
    || (r.operation !== 'create' && r.operation !== 'update') || !['dispatching','submitted','outcome_unknown','published','rejected'].includes(String(r.status))
    || typeof r.dealerCode !== 'string' || !r.dealerCode || r.dealerCode.length > 160 || r.dealerCode.trim() !== r.dealerCode || /[\x00-\x1f\x7f-\x9f]/.test(r.dealerCode)
    || typeof r.payloadSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.payloadSha256)
    || r.providerAdId !== null && (typeof r.providerAdId !== 'string' || !/^[0-9]{1,30}$/.test(r.providerAdId))) throw Error('invalid_blocket_delivery');
  const delivery: BlocketDelivery = { id: uuid(r.id), companyId: uuid(r.companyId), listingId: uuid(r.listingId), listingVersion: positive(r.listingVersion), sourceId: uuid(r.sourceId),
    dealerCode: r.dealerCode, revision: positive(r.revision), operation: r.operation, providerAdId: r.providerAdId as string | null,
    connectionId: uuid(r.connectionId), connectionVersion: positive(r.connectionVersion), payloadSha256: r.payloadSha256,
    providerRequestId: r.providerRequestId === null ? null : uuid(r.providerRequestId), status: r.status as BlocketDelivery['status'], version: positive(r.version) };
  if (delivery.sourceId !== delivery.listingId || delivery.operation === 'update' && delivery.providerAdId === null || delivery.status === 'submitted' && delivery.providerRequestId === null || delivery.status === 'published' && (delivery.providerRequestId === null || delivery.providerAdId === null)) throw Error('invalid_blocket_delivery');
  return delivery;
}

/** The caller supplies an already configured service client; this module never reads credentials. */
export function createBlocketDeliveryStore(client: BlocketServiceRpc): BlocketDeliveryStore {
  async function call(name: string, args: Record<string, unknown>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([Promise.resolve(client.rpc(name, args)), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('blocket_delivery_unavailable')), 15000); })]);
      if (result.error) throw Error('blocket_delivery_unavailable'); return result.data;
    } finally { if (timer) clearTimeout(timer); }
  }
  return {
    async get(jobId) { uuid(jobId); const data = await call('get_blocket_delivery', { p_job_id: jobId }); return data === null ? null : parseBlocketDelivery(data); },
    async begin(job, claimToken, payloadSha256) {
      uuid(job.id); uuid(claimToken); if (!/^[a-f0-9]{64}$/.test(payloadSha256)) throw Error('invalid_blocket_delivery');
      const r = object(await call('begin_blocket_delivery', { p_job_id: job.id, p_expected_job_version: job.version, p_claim_token: claimToken, p_payload_sha256: payloadSha256 }));
      if (Object.keys(r).length !== 3 || !Object.hasOwn(r, 'job') || typeof r.replayed !== 'boolean') throw Error('invalid_blocket_delivery');
      return { job: object(r.job) as unknown as AdvertisingWorkerJob, delivery: parseBlocketDelivery(r.delivery), replayed: r.replayed };
    },
    async record(jobId, delivery, claimToken, outcome) {
      uuid(jobId); const status = outcome.status === 'published' ? 'published' : outcome.status === 'rejected' ? 'rejected' : outcome.status === 'submitted' && outcome.providerRequestId ? 'submitted' : 'outcome_unknown';
      const next = parseBlocketDelivery(await call('record_blocket_delivery', { p_job_id: jobId, p_delivery_id: delivery.id, p_expected_version: delivery.version, p_claim_token: claimToken,
        p_status: status, p_provider_request_id: outcome.providerRequestId ?? delivery.providerRequestId, p_provider_ad_id: outcome.providerAdId ?? delivery.providerAdId,
        p_evidence_sha256: status === 'published' ? outcome.evidenceSha256 ?? null : null }));
      const stable: (keyof BlocketDelivery)[] = ['id','companyId','listingId','listingVersion','sourceId','dealerCode','revision','operation','connectionId','connectionVersion','payloadSha256'];
      if (stable.some(key => next[key] !== delivery[key]) || next.status !== status || next.version < delivery.version || next.version > delivery.version + 1
        || next.providerRequestId !== (outcome.providerRequestId ?? delivery.providerRequestId) || next.providerAdId !== (outcome.providerAdId ?? delivery.providerAdId)) throw Error('invalid_blocket_delivery');
      return next;
    },
  };
}
