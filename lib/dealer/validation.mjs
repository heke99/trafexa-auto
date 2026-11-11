export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const STATUSES = ['submitted', 'sourcing', 'offered', 'confirmed', 'closed'];
export const BUYER_TYPES = ['Dealer / reseller', 'Fleet / company buyer', 'Broker / trader', 'Professional private buyer', 'Other'];
export const CONDITIONS = ['New / unregistered', 'Nearly new', 'Either'];
export const MAX_BODY_BYTES = 16384;

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function uuid(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ApiError(400, `Invalid ${field}.`);
  return value.toLowerCase();
}

function text(body, field, max, required = false) {
  const value = body[field] ?? '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new ApiError(400, `Invalid ${field}.`);
  }
  const trimmed = value.trim();
  if (required && !trimmed) throw new ApiError(400, `Missing ${field}.`);
  return trimmed;
}

function integer(value, field, min, max) {
  // HTML form number fields arrive as strings; do not coerce booleans or objects.
  if (typeof value === 'string' && /^\d{1,10}$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new ApiError(400, `Invalid ${field}.`);
  return value;
}

function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.getPrototypeOf(body) !== Object.prototype) {
    throw new ApiError(400, 'Invalid JSON body.');
  }
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new ApiError(400, 'Unknown body field.');
}

export function createPayload(body, userId) {
  fields(body, ['companyId', 'name', 'email', 'phone', 'country', 'buyerType', 'brand', 'model', 'year', 'quantity', 'condition', 'budget', 'destination', 'notes', 'consent', 'idempotencyKey']);
  if (body.consent !== true) throw new ApiError(400, 'Consent is required.');
  const email = text(body, 'email', 254, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Invalid email.');
  const buyerType = text(body, 'buyerType', 64, true);
  if (!BUYER_TYPES.includes(buyerType)) throw new ApiError(400, 'Invalid buyerType.');
  const condition = text(body, 'condition', 64) || 'Either';
  if (!CONDITIONS.includes(condition)) throw new ApiError(400, 'Invalid condition.');
  return {
    company_id: uuid(body.companyId, 'companyId'), created_by: userId,
    idempotency_key: uuid(body.idempotencyKey, 'idempotencyKey'),
    name: text(body, 'name', 200, true), email, phone: text(body, 'phone', 80),
    country: text(body, 'country', 100, true), buyer_type: buyerType,
    brand: text(body, 'brand', 120, true), model: text(body, 'model', 120, true),
    year: text(body, 'year', 40),
    quantity: body.quantity === '' || body.quantity === undefined ? 1 : integer(body.quantity, 'quantity', 1, 1000),
    condition, budget: text(body, 'budget', 100), destination: text(body, 'destination', 100, true),
    notes: text(body, 'notes', 5000), consent: true,
  };
}

export function patchPayload(body) {
  fields(body, ['id', 'version', 'status']);
  if (!STATUSES.includes(body.status)) throw new ApiError(400, 'Invalid status.');
  // Version is part of the concurrency contract and must be an actual integer.
  if (!Number.isSafeInteger(body.version) || body.version < 1 || body.version > 2147483647) throw new ApiError(400, 'Invalid version.');
  return { id: uuid(body.id, 'id'), version: body.version, status: body.status };
}

export function query(req, allowed) {
  const params = new URL(req.url || '/', 'http://localhost').searchParams;
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) {
    throw new ApiError(400, 'Invalid query.');
  }
  return params;
}
