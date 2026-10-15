import 'server-only';
import { createHash } from 'node:crypto';
import type { AdvertisingProvider, AdvertisingProviderOutcome, AdvertisingPublicPayload, BlocketDelivery, BlocketProviderOutcome } from './provider-contract';

/** Verified official contract: https://api.blocket.se/pro-import-api/docs/client-documentation */
const BASE = 'https://api.blocket.se/pro-import-api/v4';
type Options = {
  enabled?: boolean; token: string; dispatcherId: string;
  verifiedBinding: AdvertisingProvider['verifiedBinding']; fetch?: typeof fetch;
};
async function boundedValue(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('invalid_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 262144) throw new Error('response_too_large');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  return value;
}
async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const value = await boundedValue(response);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_response');
  return value as Record<string, unknown>;
}

/** V5 transport requires the durable SQL revision supplied by the worker; construction never activates it. */
export function createBlocketV5Provider(options: Options): AdvertisingProvider {
  if (options.enabled !== true || !options.token || /[\x00-\x1f\x7f-\x9f]/.test(options.token)
    || !options.dispatcherId || !options.verifiedBinding.accountReference) throw Error('blocket_provider_unavailable');
  const fetcher = options.fetch ?? fetch;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const remoteId = (value: unknown): value is string => typeof value === 'string' && /^[0-9]{1,30}$/.test(value);
  async function request(path: string, method: 'GET' | 'POST' | 'PUT', body?: object) {
    return fetcher(`https://api.blocket.se/pro-import-api/v5${path}`, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: { 'X-Auth-Token': options.token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  function bound(payload: Pick<AdvertisingPublicPayload, 'sourceId' | 'listingVersion' | 'accountReference'>, delivery: BlocketDelivery | undefined): delivery is BlocketDelivery {
    const binding = options.verifiedBinding;
    return !!delivery && uuid.test(delivery.id) && delivery.companyId === binding.companyId && delivery.connectionId === binding.connectionId
      && delivery.connectionVersion === binding.connectionVersion && delivery.dealerCode === binding.accountReference && payload.accountReference === binding.accountReference
      && delivery.sourceId === payload.sourceId && delivery.listingId === payload.sourceId && uuid.test(delivery.sourceId) && delivery.listingVersion === payload.listingVersion
      && Number.isSafeInteger(delivery.revision) && delivery.revision > 0 && (delivery.operation === 'create' || delivery.operation === 'update')
      && (delivery.operation !== 'update' || remoteId(delivery.providerAdId));
  }
  function identity(data: Record<string, unknown>, delivery: BlocketDelivery) {
    return data.source_id === delivery.sourceId && data.dealer_code === delivery.dealerCode && (data.category_id === 1020 || data.category_id === '1020')
      && data.api_version === 'v5' && data.state === 'created' && (delivery.providerAdId === null || data.blocket_ad_id === delivery.providerAdId);
  }
  function logs(data: Record<string, unknown>) {
    if (!Array.isArray(data.log) || data.log.length > 1000) throw Error('blocket_invalid_evidence');
    return data.log.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('blocket_invalid_evidence');
      const row = value as Record<string, unknown>;
      if (typeof row.request_id !== 'string' || !uuid.test(row.request_id) || typeof row.action !== 'string' || !['processing','done','error'].includes(String(row.state)) || typeof row.created !== 'string' || !Number.isFinite(Date.parse(row.created))) throw Error('blocket_invalid_evidence');
      return { request_id: row.request_id, action: row.action, state: String(row.state), created: row.created };
    });
  }
  async function read(delivery: BlocketDelivery) {
    const response = await request(`/car/${encodeURIComponent(delivery.sourceId)}?include=log`, 'GET');
    if (!response.ok) throw Error('blocket_verification_unavailable');
    const data = await boundedJson(response);
    if (!identity(data, delivery)) throw Error('blocket_evidence_mismatch');
    return { data, log: logs(data) };
  }
  async function taxonomy(path: string, value: string) {
    const response = await request(path, 'GET');
    if (!response.ok) throw Error('blocket_taxonomy_unavailable');
    const data = await boundedValue(response);
    if (!Array.isArray(data) || !data.length || data.length > 5000) throw Error('blocket_taxonomy_unavailable');
    const ids = new Set<string>();
    const rows = data.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('blocket_taxonomy_unavailable');
      const row = item as Record<string, unknown>;
      if (typeof row.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(row.id) || ids.has(row.id)
        || typeof row.name !== 'string' || !row.name || row.name.length > 200 || /[\x00-\x1f\x7f-\x9f]/.test(row.name)) throw Error('blocket_taxonomy_unavailable');
      ids.add(row.id); return { id: row.id, name: row.name };
    });
    const exactIds = rows.filter(row => row.id === value);
    if (exactIds.length === 1) return exactIds[0].id;
    const exactNames = rows.filter(row => row.name.toLocaleLowerCase('sv-SE') === value.toLocaleLowerCase('sv-SE'));
    if (exactNames.length !== 1) throw Error('blocket_taxonomy_selection_required');
    return exactNames[0].id;
  }
  return {
    channel: 'blocket', deliveryProtocol: 'blocket-v5', dispatcherId: options.dispatcherId, verifiedBinding: { ...options.verifiedBinding },
    async submit(payload, delivery): Promise<BlocketProviderOutcome> {
      if (!bound(payload, delivery) || delivery.status !== 'dispatching' || delivery.providerRequestId !== null) return { status: 'outcome_unknown', errorCode: 'blocket_delivery_required' };
      if (!payload.registrationNumber || !/^[A-Z0-9]{6}$/.test(payload.registrationNumber)) return { status: 'rejected', errorCode: 'blocket_registration_required' };
      if (!Number.isInteger(payload.year) || payload.year < 1900 || payload.year > 2100 || !Number.isSafeInteger(payload.mileageKm) || payload.mileageKm < 0
        || typeof payload.description !== 'string' || payload.description.length > 10000 || !Array.isArray(payload.photos) || payload.photos.length < 1 || payload.photos.length > 20
        || payload.photos.some(photo => !['image/jpeg','image/png'].includes(photo.contentType))) return { status: 'rejected', errorCode: 'blocket_payload_invalid' };
      // Decimal SEK support remains unverified; never round the dealer's advertised price.
      if (!/^[1-9]\d{0,14}$/.test(payload.priceGrossOre) || !payload.priceGrossOre.endsWith('00')) return { status: 'rejected', errorCode: 'blocket_decimal_price_unverified' };
      const amount = Number(BigInt(payload.priceGrossOre) / BigInt(100));
      if (!Number.isSafeInteger(amount)) return { status: 'rejected', errorCode: 'blocket_price_invalid' };
      try {
        // Group credentials can reach several dealers: verify the existing owner before PUT.
        const baseline = delivery.operation === 'update' ? await read(delivery) : null;
        const oldRequests = new Set(baseline?.log.map(row => row.request_id) ?? []);
        if (typeof payload.make !== 'string' || !payload.make || typeof payload.model !== 'string' || !payload.model || typeof payload.fuel !== 'string'
          || !['manual','automatic','sequential'].includes(payload.transmission) || ['hybrid','other'].includes(payload.fuel)) return { status: 'rejected', errorCode: 'blocket_taxonomy_selection_required' };
        const brand = await taxonomy('/vehicles/car/brand', payload.make);
        const [model, fuel] = await Promise.all([
          taxonomy(`/vehicles/car/models?brand=${encodeURIComponent(brand)}`, payload.model),
          taxonomy('/vehicles/car/fuel', ({ petrol: 'petrol', diesel: 'diesel', electric: 'electricity' } as Record<string,string>)[payload.fuel] ?? payload.fuel),
        ]);
        const body = { ...(delivery.operation === 'create' ? { source_id: delivery.sourceId, dealer_code: delivery.dealerCode } : {}),
          body: payload.description, visible: true, dont_publish_on_failed_images: true,
          price: [{ type: 'list', amount, currency: 'SEK' }], image_urls: payload.photos.map(photo => photo.url),
          // Resolve exact IDs or unique exact labels against V5; never guess taxonomy slugs.
          category_fields: { brand, model, model_year: payload.year, ...(delivery.operation === 'create' ? { registration_number: payload.registrationNumber } : {}),
            powertrain: { fuel, transmission: payload.transmission }, condition: { mileage: { unit: 'km', value: payload.mileageKm } } } };
        if (delivery.operation === 'create') {
          const validation = await request('/car/validate', 'POST', body);
          if (!validation.ok) return { status: validation.status === 400 || validation.status === 401 || validation.status === 403 ? 'rejected' : 'outcome_unknown', errorCode: 'blocket_validation_unavailable' };
        }
        const response = await request(delivery.operation === 'create' ? '/car' : `/car/${encodeURIComponent(delivery.sourceId)}`, delivery.operation === 'create' ? 'POST' : 'PUT', body);
        if ([400,401,403].includes(response.status)) return { status: 'rejected', errorCode: `blocket_http_${response.status}` };
        if (response.status !== (delivery.operation === 'create' ? 201 : 200)) return { status: 'outcome_unknown', errorCode: 'blocket_submission_unknown' };
        const data = await boundedJson(response);
        if (!identity(data, delivery)) return { status: 'outcome_unknown', errorCode: 'blocket_evidence_mismatch' };
        const candidates = new Set(logs(data).filter(row => row.action === delivery.operation && !oldRequests.has(row.request_id)).map(row => row.request_id));
        // No guessed response header or client-chosen idempotency key: only the documented body log.
        if (candidates.size !== 1) return { status: 'outcome_unknown', errorCode: 'blocket_request_correlation_missing' };
        return { status: 'submitted', providerRequestId: [...candidates][0], ...(remoteId(data.blocket_ad_id) ? { providerAdId: data.blocket_ad_id } : {}) };
      } catch (error) { return error instanceof Error && error.message === 'blocket_taxonomy_selection_required'
        ? { status: 'rejected', errorCode: 'blocket_taxonomy_selection_required' } : { status: 'outcome_unknown', errorCode: 'blocket_submission_unknown' }; }
    },
    async reconcile(payload, delivery): Promise<BlocketProviderOutcome> {
      if (!bound(payload, delivery)) return { status: 'outcome_unknown', errorCode: 'blocket_delivery_required' };
      try {
        const { data, log } = await read(delivery);
        if (!delivery.providerRequestId) return { status: 'outcome_unknown', errorCode: 'blocket_request_correlation_missing' };
        const current = log.filter(row => row.request_id === delivery.providerRequestId);
        const operationDone = current.some(row => row.action === delivery.operation && row.state === 'done');
        const published = current.some(row => row.action === 'publish' && row.state === 'done');
        if (current.some(row => row.state === 'error' || row.action === 'delete' || row.action === 'unpublish')) return { status: 'outcome_unknown', errorCode: 'blocket_remote_action_error' };
        // A later removal/error defeats stale publication evidence even if another request performed it.
        const publishTimes = current.filter(row => row.action === 'publish' && row.state === 'done').map(row => Date.parse(row.created));
        const latestPublish = Math.max(...publishTimes);
        if (log.some(row => Date.parse(row.created) >= latestPublish && (row.action === 'delete' || row.action === 'unpublish' || row.state === 'error'))) return { status: 'outcome_unknown', errorCode: 'blocket_remote_action_error' };
        if (operationDone && published && data.visible === true && remoteId(data.blocket_ad_id)) {
          const evidenceSha256 = createHash('sha256').update(JSON.stringify({ sourceId: delivery.sourceId, dealerCode: delivery.dealerCode, providerAdId: data.blocket_ad_id,
            providerRequestId: delivery.providerRequestId, operation: delivery.operation, log: current }), 'utf8').digest('hex');
          return { status: 'published', providerAdId: data.blocket_ad_id, providerUrl: null, providerRequestId: delivery.providerRequestId, evidenceSha256 };
        }
        return { status: 'submitted', providerRequestId: delivery.providerRequestId, ...(remoteId(data.blocket_ad_id) ? { providerAdId: data.blocket_ad_id } : {}) };
      } catch { return { status: 'outcome_unknown', errorCode: 'blocket_verification_unavailable' }; }
    },
  };
}

export function createBlocketProvider(options: Options): AdvertisingProvider {
  if (options.enabled !== true || !options.token || /[\r\n]/.test(options.token)
    || !options.dispatcherId || !options.verifiedBinding.accountReference) throw new Error('blocket_provider_unavailable');
  const fetcher = options.fetch ?? fetch;
  async function request(path: string, method: 'GET' | 'POST', body?: object) {
    return fetcher(`${BASE}${path}`, { method, redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(15000), headers: { 'X-Auth-Token': options.token, 'Accept': 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  function bound(payload: Pick<AdvertisingPublicPayload, 'sourceId' | 'listingVersion' | 'accountReference'>) {
    return /^[0-9a-f-]{36}$/i.test(payload.sourceId) && payload.accountReference === options.verifiedBinding.accountReference;
  }
  return {
    channel: 'blocket', dispatcherId: options.dispatcherId, verifiedBinding: { ...options.verifiedBinding },
    async submit(payload): Promise<AdvertisingProviderOutcome> {
      if (!bound(payload)) return { status: 'rejected', errorCode: 'provider_account_mismatch' };
      // Contract prototype only: real SQL ready listings are already >= 2, so this is not activation-ready.
      // Stable listing identity requires persistent delivery revision, CREATE/PUT decision and correlated evidence.
      // Until that ledger contract is implemented, never POST another listing version or reuse old publish logs.
      if (payload.listingVersion !== 1) return { status: 'rejected', errorCode: 'blocket_update_contract_required' };
      if (!payload.registrationNumber || !/^[A-Z0-9]{6}$/.test(payload.registrationNumber)) {
        return { status: 'rejected', errorCode: 'blocket_registration_required' };
      }
      if (payload.photos.some((photo) => !['image/jpeg', 'image/png'].includes(photo.contentType))) {
        return { status: 'rejected', errorCode: 'blocket_photo_format_unsupported' };
      }
      // Trafexa stores integer öre; the official list price amount is denominated in SEK.
      if (!/^[1-9]\d{0,14}$/.test(payload.priceGrossOre)) return { status: 'rejected', errorCode: 'blocket_price_invalid' };
      // Public examples confirm whole SEK. Decimal-price support is not yet verified against OpenAPI.
      // Reject öre explicitly instead of silently rounding the dealer's advertised amount.
      if (!payload.priceGrossOre.endsWith('00')) return { status: 'rejected', errorCode: 'blocket_decimal_price_unverified' };
      const amount = Number(payload.priceGrossOre) / 100;
      if (!Number.isSafeInteger(amount) || amount * 100 !== Number(payload.priceGrossOre)) {
        return { status: 'rejected', errorCode: 'blocket_price_invalid' };
      }
      try {
        const response = await request('/car', 'POST', {
          source_id: payload.sourceId, dealer_code: payload.accountReference, category_id: 1020,
          body: payload.description, visible: true, dont_publish_on_failed_images: true,
          price: [{ type: 'list', amount, currency: 'SEK' }], image_urls: payload.photos.map((photo) => photo.url),
          // V4 car forbids title/contact; brands/models are provider enum slugs, not arbitrary Trafexa labels.
          category_fields: { model_year: payload.year, registration_number: payload.registrationNumber,
            condition: { mileage: { unit: 'km', value: payload.mileageKm } } },
        });
        if ([400, 401, 403].includes(response.status)) return { status: 'rejected', errorCode: `blocket_http_${response.status}` };
        if (response.status !== 201) return { status: 'outcome_unknown', errorCode: 'blocket_submission_unknown' };
        // A positive POST only means queued in Blocket. It is never evidence of publication.
        return { status: 'submitted' };
      } catch { return { status: 'outcome_unknown', errorCode: 'blocket_submission_unknown' }; }
    },
    async reconcile(payload): Promise<AdvertisingProviderOutcome> {
      if (!bound(payload)) return { status: 'outcome_unknown', errorCode: 'provider_account_mismatch' };
      if (payload.listingVersion !== 1) return { status: 'outcome_unknown', errorCode: 'blocket_update_contract_required' };
      try {
        const response = await request(`/ad/${encodeURIComponent(payload.sourceId)}?include=log`, 'GET');
        if (!response.ok) return { status: 'outcome_unknown', errorCode: 'blocket_verification_unavailable' };
        const data = await boundedJson(response);
        if (data.source_id !== payload.sourceId || data.dealer_code !== payload.accountReference
          || data.category_id !== 1020 || data.state !== 'created' || data.visible !== true || !Array.isArray(data.log)) {
          return { status: 'outcome_unknown', errorCode: 'blocket_evidence_mismatch' };
        }
        const logs = data.log.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object' && !Array.isArray(row)));
        const published = logs.some((row) => row.action === 'publish' && row.state === 'done');
        // This adapter only creates each immutable source_id once. Error/removal evidence defeats old success logs.
        const problem = logs.some((row) => row.state === 'error' || row.action === 'delete' || row.action === 'unpublish');
        if (published && !problem && typeof data.blocket_ad_id === 'string' && /^\d{1,30}$/.test(data.blocket_ad_id)) {
          return { status: 'published', providerAdId: data.blocket_ad_id, providerUrl: null };
        }
        if (problem) return { status: 'outcome_unknown', errorCode: 'blocket_remote_action_error' };
        return { status: 'submitted' };
      } catch { return { status: 'outcome_unknown', errorCode: 'blocket_verification_unavailable' }; }
    },
  };
}
