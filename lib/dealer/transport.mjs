import { ApiError, MAX_BODY_BYTES, UUID } from './validation.mjs';

export function header(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  return typeof value === 'string' ? value : '';
}

export function respond(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(body);
}

export async function readBody(req) {
  if (!/^application\/json(?:\s*;.*)?$/i.test(header(req, 'content-type'))) throw new ApiError(415, 'Use application/json.');
  const declared = header(req, 'content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new ApiError(413, 'Body too large.');
  try {
    let body = req.body;
    if (body === undefined) {
      const parts = [];
      let size = 0;
      for await (const chunk of req) {
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += part.length;
        if (size > MAX_BODY_BYTES) throw new ApiError(413, 'Body too large.');
        parts.push(part);
      }
      body = Buffer.concat(parts).toString('utf8');
    }
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    if (typeof body === 'string') {
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new ApiError(413, 'Body too large.');
      return JSON.parse(body);
    }
    if (Buffer.byteLength(JSON.stringify(body) || '') > MAX_BODY_BYTES) throw new ApiError(413, 'Body too large.');
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'Invalid JSON body.');
  }
}

function config(env) {
  const source = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let url;
  try { url = new URL(source); } catch { throw new ApiError(503, 'Request service is not configured.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new ApiError(503, 'Request service is not configured.');
  }
  if (typeof key !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) throw new ApiError(503, 'Request service is not configured.');
  return { base: url.origin, key };
}

export async function session(req, { fetchImpl = globalThis.fetch, env = process.env, timeoutMs = 8000 } = {}) {
  const bearer = header(req, 'authorization');
  if (!/^Bearer [A-Za-z0-9._~-]+$/i.test(bearer) || bearer.length > 8192) throw new ApiError(401, 'Sign in to continue.');
  const { base, key } = config(env);
  async function upstream(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}${path}`, {
        ...options, signal: controller.signal, redirect: 'error',
        headers: { apikey: key, Authorization: bearer, 'Content-Type': 'application/json', ...options.headers },
      });
      let data;
      try { data = await response.json(); } catch { throw new ApiError(502, 'Request service returned an invalid response.'); }
      return { status: response.status, ok: response.ok, data };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') throw new ApiError(504, 'Request service timed out.');
      throw new ApiError(502, 'Request service is unavailable.');
    } finally { clearTimeout(timer); }
  }
  const auth = await upstream('/auth/v1/user', { method: 'GET' });
  if (auth.status === 401 || auth.status === 403) throw new ApiError(401, 'Sign in to continue.');
  if (!auth.ok) throw new ApiError(502, 'Sign-in service is unavailable.');
  if (!auth.data || typeof auth.data.id !== 'string' || !UUID.test(auth.data.id) || auth.data.is_anonymous === true) {
    throw new ApiError(401, 'Sign in to continue.');
  }
  return { userId: auth.data.id.toLowerCase(), upstream };
}

export function databaseError(result) {
  if (result.status === 401) throw new ApiError(401, 'Sign in to continue.');
  if (result.status === 403 || result.data?.code === '42501') throw new ApiError(403, 'You do not have permission for this action.');
  throw new ApiError(502, 'Request service could not complete the action.');
}

export function rows(result) {
  if (!result.ok) databaseError(result);
  if (!Array.isArray(result.data) || result.data.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new ApiError(502, 'Request service returned an invalid response.');
  }
  return result.data;
}

export async function membership(session, companyId, roles) {
  const params = new URLSearchParams({ select: 'role', company_id: `eq.${companyId}`, user_id: `eq.${session.userId}`, limit: '1' });
  const membershipRows = rows(await session.upstream(`/rest/v1/trafexa_memberships?${params}`, { method: 'GET' }));
  if (membershipRows.length !== 1 || !roles.includes(membershipRows[0].role)) throw new ApiError(403, 'You do not have permission for this action.');
}
