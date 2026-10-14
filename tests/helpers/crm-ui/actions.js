const f = () => window.fixture;
const page = () => ({ ok: true, companyId: f().companyId, businessDate: '2026-10-14', contacts: f().contacts, nextPageKey: f().cursor || null });
async function response(queue, fallback) { const next = queue.shift(); if (next?.throw) throw Error('unknown'); if (next?.delay) { await new Promise(resolve => setTimeout(resolve, next.delay)); } return next?.result || next || fallback(); }
export async function listCustomerContactsAction(input) { f().reads.push(input); return response(f().readResponses, page); }
export async function listCustomerFollowUpsAction(input) { f().reads.push(input); return response(f().readResponses, page); }
export async function createCustomerContactAction(input) { f().writes.push(input); return response(f().writeResponses, () => ({ ok: true, contact: f().contacts[0] })); }
export async function updateCustomerFollowUpAction(input) { f().updates.push(input); return response(f().updateResponses, () => ({ ok: true, contact: f().contacts[0] })); }
