import 'server-only';
import {
  createCompanyWithProfileAction,
  getCompanyStoreExportAction,
  getCompanyStoreProfileAction,
  prepareCompanyStoreExportAction,
  saveCompanyStoreProfileAction,
} from '@/lib/data/company-store-profile-actions';

export const COMPANY_STORE_BODY_LIMIT = 65536;
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type Failure = { ok: false; code: string; error: string };

function failure(status: number, code = 'invalid_input', error = 'Begäran kunde inte godkännas.') {
  return Response.json({ ok: false, code, error }, { status, headers: PRIVATE_HEADERS });
}
function result<T extends { ok: true } | Failure>(value: T, success = 200): Response {
  if (value.ok) return Response.json(value, { status: success, headers: PRIVATE_HEADERS });
  const status = value.code === 'unauthenticated' ? 401 : value.code === 'access_denied' ? 403 : value.code === 'conflict' ? 409 : value.code === 'invalid_input' ? 400 : 503;
  return Response.json(value, { status, headers: PRIVATE_HEADERS });
}
function unavailable() {
  return failure(503, 'unavailable', 'Resultatet kunde inte verifieras. Försök vid behov igen med samma uppgifter och begäran.');
}
function configuredOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url.origin;
  } catch { return null; }
}
function acceptsOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const allowed = new Set<string>(['https://app.trafexa.com', 'https://www.trafexa.com', 'https://trafexa.com']);
  for (const value of [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_SITE_URL, process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined, process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : undefined]) {
    const configured = configuredOrigin(value); if (configured) allowed.add(configured);
  }
  if (process.env.NODE_ENV !== 'production') { allowed.add('http://localhost:3000'); allowed.add('http://127.0.0.1:3000'); }
  return allowed.has(origin);
}
function companyQuery(request: Request): string | null {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => key !== 'companyId') || params.getAll('companyId').length !== 1) return null;
  const value = params.get('companyId'); return value && UUID.test(value) ? value.toLowerCase() : null;
}
async function mutationBody(request: Request): Promise<{ value: unknown } | { response: Response }> {
  if (!acceptsOrigin(request)) return { response: failure(403, 'access_denied') };
  if ([...new URL(request.url).searchParams].length) return { response: failure(400) };
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return { response: failure(415, 'invalid_input', 'Begäran måste skickas som JSON.') };
  const length = request.headers.get('content-length');
  if (length !== null) {
    if (!/^\d+$/.test(length)) return { response: failure(400) };
    if (Number(length) > COMPANY_STORE_BODY_LIMIT) return { response: failure(413, 'invalid_input', 'Begäran är för stor.') };
  }
  const reader = request.body?.getReader();
  if (!reader) return { response: failure(400) };
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true }); let size = 0, source = '';
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > COMPANY_STORE_BODY_LIMIT) { await reader.cancel().catch(() => {}); return { response: failure(413, 'invalid_input', 'Begäran är för stor.') }; }
      source += decoder.decode(chunk.value, { stream: true });
    }
    source += decoder.decode(); const value: unknown = JSON.parse(source);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { response: failure(400) };
    return { value };
  } catch { return { response: failure(400) }; }
  finally { reader.releaseLock(); }
}

/** Session-authenticated Trafexa API. These handlers do not contact an advertiser. */
export async function createDealerCompany(request: Request): Promise<Response> {
  try {
    const body = await mutationBody(request); if ('response' in body) return body.response;
    return result(await createCompanyWithProfileAction(body.value), 201);
  } catch { return unavailable(); }
}
export async function readCompanyStoreProfile(request: Request): Promise<Response> {
  try {
    const companyId = companyQuery(request); if (!companyId) return failure(400);
    return result(await getCompanyStoreProfileAction({ companyId }));
  } catch { return unavailable(); }
}
export async function writeCompanyStoreProfile(request: Request): Promise<Response> {
  try {
    const body = await mutationBody(request); if ('response' in body) return body.response;
    return result(await saveCompanyStoreProfileAction(body.value));
  } catch { return unavailable(); }
}
export async function prepareCompanyStoreExport(request: Request): Promise<Response> {
  try {
    const body = await mutationBody(request); if ('response' in body) return body.response;
    return result(await prepareCompanyStoreExportAction(body.value), 201);
  } catch { return unavailable(); }
}
export async function downloadCompanyStoreExport(request: Request, exportId: string): Promise<Response> {
  try {
    const companyId = companyQuery(request); if (!companyId || !UUID.test(exportId)) return failure(400);
    const value = await getCompanyStoreExportAction({ companyId, exportId: exportId.toLowerCase() });
    if (!value.ok) return result(value);
    // The action verifies the hash against these exact persisted UTF-8 bytes.
    return new Response(value.export.canonicalContent, { status: 200, headers: {
      ...PRIVATE_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="trafexa-butiksprofil-${exportId.toLowerCase()}.json"`,
      'X-Trafexa-Content-SHA256': value.export.exportSha256,
      ETag: `"${value.export.exportSha256}"`,
    } });
  } catch { return unavailable(); }
}
