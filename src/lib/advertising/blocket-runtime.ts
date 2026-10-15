import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createAdvertisingWorker, type AdvertisingWorkerStore } from './advertising-worker';
import { createBlocketV5Provider } from './blocket-provider';
import { createBlocketDeliveryStore } from './blocket-delivery-store';
import { createAdvertisingExportMediaResolver } from '../vehicle-photos/export-media';
import type { AdvertisingProvider, AdvertisingWorkerJob } from './provider-contract';

type Environment = Record<string, string | undefined>;
type Options = { environment?: () => Environment; createServiceClient?: typeof createClient; fetch?: typeof fetch; now?: () => Date };
type Group = { id: string; version: number; groupReference: string; credentialReference: string; scope: 'dealer_group' | 'dealer_code'; status: 'active'; updatedAt: string; dispatcherId: string };
type Binding = AdvertisingProvider['verifiedBinding'] & { group: Group };
class RuntimeError extends Error { constructor(readonly code: 'disabled' | 'unauthorized' | 'invalid_input' | 'configuration_missing' | 'unavailable' | 'not_found') { super('Annonskörningen kunde inte verifieras.'); } }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" };
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RuntimeError('unavailable'); return value as Record<string, unknown>; }
function uuid(value: unknown): string { if (typeof value !== 'string' || !uuidPattern.test(value)) throw new RuntimeError('invalid_input'); return value; }
function integer(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new RuntimeError('unavailable'); return value; }
function text(value: unknown, max: number): string { if (typeof value !== 'string' || !value.length || value.length > max || value !== value.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new RuntimeError('unavailable'); return value; }
function date(value: unknown): string { const v = text(value, 50); if (!Number.isFinite(Date.parse(v))) throw new RuntimeError('unavailable'); return v; }
function group(value: unknown, expectedId?: string): Group {
  const r = object(value), id = uuid(r.id), dispatcherId = `blocket_${id.replaceAll('-', '')}`;
  if (expectedId && id !== expectedId || r.status !== 'active' || !['dealer_group', 'dealer_code'].includes(String(r.scope)) || r.dispatcherId !== dispatcherId || typeof r.credentialReference !== 'string' || !/^[a-z0-9_-]{1,100}$/.test(r.credentialReference)) throw new RuntimeError('unavailable');
  return { id, version: integer(r.version), groupReference: text(r.groupReference, 160), credentialReference: r.credentialReference, scope: r.scope as Group['scope'], status: 'active', updatedAt: date(r.updatedAt), dispatcherId };
}
function binding(value: unknown, now: Date): Binding {
  const r = object(value), validUntil = date(r.validUntil);
  if (Date.parse(validUntil) <= now.getTime()) throw new RuntimeError('unavailable');
  return { companyId: uuid(r.companyId), connectionId: uuid(r.connectionId), connectionVersion: integer(r.connectionVersion), accountReference: text(r.accountReference, 160), validUntil, group: group(r.group) };
}
function tokenFor(env: Environment, ref: string): string {
  let tokens: unknown;
  const raw = env.BLOCKET_GROUP_TOKENS_JSON;
  if (!raw || raw.length > 65536) throw new RuntimeError('configuration_missing');
  try { tokens = JSON.parse(raw); } catch { throw new RuntimeError('configuration_missing'); }
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens) || Object.keys(tokens).length > 100 || !Object.hasOwn(tokens, ref)) throw new RuntimeError('configuration_missing');
  for (const [label, secret] of Object.entries(tokens)) if (!/^[a-z0-9_-]{1,100}$/.test(label) || typeof secret !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(secret)) throw new RuntimeError('configuration_missing');
  return (tokens as Record<string, string>)[ref];
}
function authorize(request: Request, env: Environment) {
  if (request.method !== 'POST') throw new RuntimeError('invalid_input');
  if (env.BLOCKET_DISPATCH_ENABLED !== 'true') throw new RuntimeError('disabled');
  const secret = env.INTERNAL_ADVERTISING_SECRET;
  if (!secret || !/^[\x21-\x7e]{32,512}$/.test(secret)) throw new RuntimeError('configuration_missing');
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ') || authorization.length > 1024) throw new RuntimeError('unauthorized');
  const supplied = createHash('sha256').update(authorization.slice(7)).digest(), expected = createHash('sha256').update(secret).digest();
  if (!timingSafeEqual(supplied, expected)) throw new RuntimeError('unauthorized');
}
async function body(request: Request, keys: readonly string[]) {
  if (new URL(request.url).search || request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new RuntimeError('invalid_input');
  const length = request.headers.get('content-length'); if (length !== null && (!/^\d+$/.test(length) || Number(length) > 4096)) throw new RuntimeError('invalid_input');
  const reader = request.body?.getReader(); if (!reader) throw new RuntimeError('invalid_input');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 4096) throw new RuntimeError('invalid_input'); chunks.push(next.value); } }
  finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const r = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); if (Object.keys(r).length !== keys.length || keys.some(key => !Object.hasOwn(r, key))) throw Error(); return r; }
  catch { throw new RuntimeError('invalid_input'); }
}
function responseError(error: unknown) {
  const code = error instanceof RuntimeError ? error.code : 'unavailable';
  return Response.json({ ok: false, code }, { status: code === 'unauthorized' ? 401 : code === 'invalid_input' ? 400 : code === 'not_found' ? 404 : 503, headers });
}
/** No environment access, client creation or provider request occurs until an authorized explicit POST. */
export function createBlocketRuntime(options: Options = {}) {
  const now = options.now ?? (() => new Date());
  function service(env: Environment) {
    const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new RuntimeError('configuration_missing');
    let project: URL; try { project = new URL(url); } catch { throw new RuntimeError('configuration_missing'); }
    if (project.protocol !== 'https:' || project.username || project.password || project.port || project.pathname !== '/' || project.search || project.hash) throw new RuntimeError('configuration_missing');
    const sdk = (options.createServiceClient ?? createClient)(project.origin, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => (options.fetch ?? fetch)(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(15000) }) } });
    async function rpc(name: string, args: Record<string, unknown>) { const result = await sdk.rpc(name, args).abortSignal(AbortSignal.timeout(15000)); if (result.error) throw new RuntimeError('unavailable'); return result.data as unknown; }
    return { sdk, rpc, origin: project.origin };
  }
  return {
    async readiness(request: Request): Promise<Response> {
      try {
        const env = (options.environment ?? (() => process.env))(); authorize(request, env); const input = await body(request, ['groupId']), groupId = uuid(input.groupId), client = service(env);
        const current = group(await client.rpc('get_blocket_worker_group', { p_group_id: groupId }), groupId); tokenFor(env, current.credentialReference);
        const availableUntil = new Date(now().getTime() + 240000).toISOString();
        const lease = object(await client.rpc('refresh_advertising_dispatcher', { p_dispatcher_id: current.dispatcherId, p_channel: 'blocket', p_available_until: availableUntil }));
        if (lease.dispatcherId !== current.dispatcherId || lease.channel !== 'blocket' || Date.parse(date(lease.availableUntil)) !== Date.parse(availableUntil)) throw new RuntimeError('unavailable');
        return Response.json({ ok: true, status: 'ready', availableUntil }, { headers });
      } catch (error) { return responseError(error); }
    },
    async job(request: Request, inputId: string): Promise<Response> {
      try {
        const env = (options.environment ?? (() => process.env))(); authorize(request, env); await body(request, []); const jobId = uuid(inputId), client = service(env);
        const resolved = await client.rpc('get_blocket_worker_binding', { p_job_id: jobId }); if (resolved === null) throw new RuntimeError('not_found');
        const verified = binding(resolved, now()), token = tokenFor(env, verified.group.credentialReference);
        function job(value: unknown): AdvertisingWorkerJob {
          const r = object(value);
          if (r.id !== jobId || r.companyId !== verified.companyId || r.connectionId !== verified.connectionId || r.connectionVersion !== verified.connectionVersion || r.accountReference !== verified.accountReference || r.dispatcherId !== verified.group.dispatcherId || r.channel !== 'blocket' || !['queued','dispatching','submitted','outcome_unknown','published','rejected','retryable'].includes(String(r.status))) throw new RuntimeError('unavailable');
          uuid(r.stockId); uuid(r.listingId); uuid(r.createdBy); integer(r.version); integer(r.listingVersion); date(r.createdAt); date(r.updatedAt); object(r.snapshot);
          if (r.claimToken !== null) uuid(r.claimToken); if (r.claimExpiresAt !== null) date(r.claimExpiresAt);
          if (r.providerAdId !== null) text(r.providerAdId, 200); if (r.providerUrl !== null) text(r.providerUrl, 2048); if (r.errorCode !== null) text(r.errorCode, 100);
          return r as unknown as AdvertisingWorkerJob;
        }
        const store: AdvertisingWorkerStore = {
          getJob: async id => { const value = await client.rpc('get_advertising_job', { p_job_id: id }); return value === null ? null : job(value); },
          claimJob: async (id, expectedVersion, claimToken) => job(await client.rpc('claim_advertising_job', { p_job_id: id, p_expected_version: expectedVersion, p_claim_token: claimToken })),
          expireDispatch: async (id, expectedVersion) => job(await client.rpc('expire_advertising_dispatch', { p_job_id: id, p_expected_version: expectedVersion })),
          saveJob: async (id, expectedVersion, claimToken, outcome) => job(await client.rpc('save_advertising_job', { p_job_id: id, p_expected_version: expectedVersion, p_claim_token: claimToken, p_status: outcome.status, p_provider_ad_id: 'providerAdId' in outcome ? outcome.providerAdId ?? null : null, p_provider_url: 'providerUrl' in outcome ? outcome.providerUrl : null, p_error_code: 'errorCode' in outcome ? outcome.errorCode ?? null : null })),
        };
        const provider = createBlocketV5Provider({ enabled: true, token, dispatcherId: verified.group.dispatcherId, verifiedBinding: verified, fetch: options.fetch });
        const media = createAdvertisingExportMediaResolver({ enabled: true, client: client.sdk, projectOrigin: client.origin, now });
        const worker = createAdvertisingWorker({ enabled: true, store, providers: [provider], media, blocketDelivery: createBlocketDeliveryStore(client.sdk), now });
        const result = await worker.run(jobId); return result ? Response.json({ ok: true, status: result.status }, { headers }) : Response.json({ ok: false, code: 'not_found' }, { status: 404, headers });
      } catch (error) { return responseError(error); }
    },
  };
}
