import 'server-only';
import type { AdvertisingProvider, AdvertisingProviderOutcome, AdvertisingPublicPayload } from './provider-contract';

/** Verified official contract: https://api.blocket.se/pro-import-api/docs/client-documentation */
const BASE = 'https://api.blocket.se/pro-import-api/v4';
type Options = {
  enabled?: boolean; token: string; dispatcherId: string;
  verifiedBinding: AdvertisingProvider['verifiedBinding']; fetch?: typeof fetch;
};
async function boundedJson(response: Response): Promise<Record<string, unknown>> {
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
  const value: unknown = JSON.parse(new TextDecoder().decode(body));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_response');
  return value as Record<string, unknown>;
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
