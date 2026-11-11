import { ApiError, UUID, STATUSES, BUYER_TYPES, CONDITIONS, createPayload, patchPayload, query, uuid } from './validation.mjs';
import { databaseError, membership, readBody, respond, rows, session } from './transport.mjs';

const REQUEST_COLUMNS = 'id,company_id,created_by,idempotency_key,name,email,phone,country,buyer_type,brand,model,year,quantity,condition,budget,destination,notes,consent,status,version,created_at,updated_at';

function requestRow(row) {
  if (!row || !UUID.test(row.id || '') || !UUID.test(row.company_id || '') || !UUID.test(row.created_by || '') || !UUID.test(row.idempotency_key || '') || !STATUSES.includes(row.status) || !Number.isSafeInteger(row.version) || row.version < 1) {
    throw new ApiError(502, 'Request service returned an invalid response.');
  }
  const textFields = { name: 200, email: 254, phone: 80, country: 100, brand: 120, model: 120, year: 40, budget: 100, destination: 100, notes: 5000 };
  const required = ['name', 'email', 'country', 'brand'];
  for (const [field, max] of Object.entries(textFields)) {
    if ((!required.includes(field) && row[field] === null)) continue;
    if (typeof row[field] !== 'string' || row[field].length > max || (required.includes(field) && !row[field].trim())) {
      throw new ApiError(502, 'Request service returned an invalid response.');
    }
  }
  if (!BUYER_TYPES.includes(row.buyer_type) || !CONDITIONS.includes(row.condition) || row.consent !== true || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 1000 || !validTimestamp(row.created_at) || !validTimestamp(row.updated_at)) {
    throw new ApiError(502, 'Request service returned an invalid response.');
  }
  return Object.fromEntries(REQUEST_COLUMNS.split(',').map(field => [field, row[field]]));
}

function validTimestamp(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }

async function getRequest(session, id) {
  const params = new URLSearchParams({ select: REQUEST_COLUMNS, id: `eq.${id}`, limit: '1' });
  const found = rows(await session.upstream(`/rest/v1/trafexa_requests?${params}`, { method: 'GET' }));
  if (!found.length) return null;
  const row = requestRow(found[0]);
  if (found.length !== 1 || row.id !== id) throw new ApiError(502, 'Request service returned an invalid response.');
  return row;
}

async function existingRequest(session, payload) {
  const params = new URLSearchParams({
    select: REQUEST_COLUMNS, company_id: `eq.${payload.company_id}`, created_by: `eq.${session.userId}`,
    idempotency_key: `eq.${payload.idempotency_key}`, limit: '1',
  });
  const found = rows(await session.upstream(`/rest/v1/trafexa_requests?${params}`, { method: 'GET' }));
  if (found.length !== 1) throw new ApiError(409, 'The request could not be saved. Try with a new request key.');
  const row = requestRow(found[0]);
  if (Object.entries(payload).some(([key, value]) => row[key] !== value)) {
    throw new ApiError(409, 'This request key was already used for different details.');
  }
  return row;
}

async function collection(req, res, options) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    throw new ApiError(405, 'Method not allowed.');
  }
  const verified = await session(req, options);
  if (req.method === 'GET') {
    const params = query(req, ['companyId', 'limit']);
    const companyId = uuid(params.get('companyId'), 'companyId');
    const limit = params.get('limit') ?? '50';
    if (!/^[1-9]\d?$/.test(limit) || Number(limit) > 50) throw new ApiError(400, 'Invalid limit.');
    const filter = new URLSearchParams({ select: REQUEST_COLUMNS, company_id: `eq.${companyId}`, order: 'created_at.desc,id.desc', limit });
    const found = rows(await verified.upstream(`/rest/v1/trafexa_requests?${filter}`, { method: 'GET' }));
    if (found.length > Number(limit)) throw new ApiError(502, 'Request service returned an invalid response.');
    const requests = found.map(value => {
      const row = requestRow(value);
      if (row.company_id !== companyId) throw new ApiError(502, 'Request service returned an invalid response.');
      return row;
    });
    return respond(res, 200, { ok: true, requests });
  }
  query(req, []);
  const payload = createPayload(await readBody(req), verified.userId);
  await membership(verified, payload.company_id, ['member', 'manager']);
  const params = new URLSearchParams({ select: REQUEST_COLUMNS });
  const inserted = await verified.upstream(`/rest/v1/trafexa_requests?${params}`, {
    method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload),
  });
  if (!inserted.ok && inserted.data?.code === '23505') {
    return respond(res, 200, { ok: true, request: await existingRequest(verified, payload) });
  }
  const saved = rows(inserted);
  if (saved.length !== 1) throw new ApiError(502, 'Request service did not confirm saving the request.');
  const row = requestRow(saved[0]);
  if (Object.entries(payload).some(([key, value]) => row[key] !== value) || row.status !== 'submitted' || row.version !== 1) {
    throw new ApiError(502, 'Request service returned an invalid response.');
  }
  return respond(res, 201, { ok: true, request: row });
}

async function detail(req, res, options) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
    throw new ApiError(405, 'Method not allowed.');
  }
  const verified = await session(req, options);
  if (req.method === 'GET') {
    const params = query(req, ['id']);
    const id = uuid(params.get('id'), 'id');
    const request = await getRequest(verified, id);
    if (!request) throw new ApiError(404, 'Request not found.');
    const filter = new URLSearchParams({ select: 'request_id,company_id,actor_id,from_status,to_status,version,created_at', request_id: `eq.${id}`, order: 'version.asc' });
    const eventRows = rows(await verified.upstream(`/rest/v1/trafexa_request_events?${filter}`, { method: 'GET' }));
    const events = [];
    let version = 0;
    for (const event of eventRows) {
      if (event.request_id !== id || event.company_id !== request.company_id || !UUID.test(event.actor_id || '') || !STATUSES.includes(event.to_status) || (event.from_status !== null && !STATUSES.includes(event.from_status)) || !validTimestamp(event.created_at) || !Number.isSafeInteger(event.version) || event.version <= version) {
        throw new ApiError(502, 'Request service returned an invalid response.');
      }
      version = event.version;
      events.push(Object.fromEntries(['request_id', 'company_id', 'actor_id', 'from_status', 'to_status', 'version', 'created_at'].map(field => [field, event[field]])));
    }
    return respond(res, 200, { ok: true, request, events });
  }
  query(req, []);
  const payload = patchPayload(await readBody(req));
  const visible = await getRequest(verified, payload.id);
  if (!visible) throw new ApiError(404, 'Request not found.');
  await membership(verified, visible.company_id, ['manager']);
  if (visible.version !== payload.version) throw new ApiError(409, 'This request changed. Refresh before updating.');
  const params = new URLSearchParams({ select: REQUEST_COLUMNS, id: `eq.${payload.id}`, version: `eq.${payload.version}` });
  const updated = await verified.upstream(`/rest/v1/trafexa_requests?${params}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: payload.status }),
  });
  if (!updated.ok && updated.data?.code === '23514') throw new ApiError(409, 'This status change is not allowed. Refresh before updating.');
  if (!updated.ok) databaseError(updated);
  const saved = rows(updated);
  if (!saved.length) {
    const current = await getRequest(verified, payload.id);
    if (!current) throw new ApiError(404, 'Request not found.');
    if (current.version !== payload.version) throw new ApiError(409, 'This request changed. Refresh before updating.');
    throw new ApiError(403, 'You do not have permission for this action.');
  }
  if (saved.length !== 1) throw new ApiError(502, 'Request service returned an invalid response.');
  const row = requestRow(saved[0]);
  const expectedVersion = visible.status === payload.status ? payload.version : payload.version + 1;
  if (row.id !== payload.id || row.company_id !== visible.company_id || row.created_by !== visible.created_by || row.idempotency_key !== visible.idempotency_key || row.status !== payload.status || row.version !== expectedVersion) {
    throw new ApiError(502, 'Request service did not confirm updating the request.');
  }
  return respond(res, 200, { ok: true, request: row });
}

async function guarded(handler, req, res, options) {
  try { return await handler(req, res, options); }
  catch (error) {
    if (error instanceof ApiError) return respond(res, error.status, { ok: false, error: error.message });
    // Never include provider errors, tokens or request contents in responses or logs.
    console.error('dealer_request_unexpected_error');
    return respond(res, 500, { ok: false, error: 'Request could not be completed.' });
  }
}

export function handleRequests(req, res, options) { return guarded(collection, req, res, options); }
export function handleRequest(req, res, options) { return guarded(detail, req, res, options); }
