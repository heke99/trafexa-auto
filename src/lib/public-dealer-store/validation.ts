import { parseCompanyStoreFields } from '../company-store-profile/validation';
import type { PublicDealerStore, PublicStoreCode, PublicStorePage, PublicStoreReceipt, PublicStoreSelection, PublicStoreState, PublishPublicStoreInput, UnpublishPublicStoreInput } from './types';
export class PublicStoreError extends Error { constructor(readonly code: PublicStoreCode) { super('Butiken kunde inte verifieras.'); } }
const RESERVED = new Set(['api','admin','dashboard','login','register','settings','onboarding','privacy','terms','demo','invitations','butik','butiker','stores','trafexa','www','support','help','auth','account','billing']);
export function storeSlug(value: unknown): string { if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(value) || RESERVED.has(value)) throw new PublicStoreError('invalid_input'); return value; }
export function storeUuid(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new PublicStoreError('invalid_input'); return value.toLowerCase(); }
function invalid(): never { throw new PublicStoreError('invalid_input'); }
export function storeObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(k => !Object.hasOwn(row, k))) return invalid(); return row;
}
function int(value: unknown, min = 1, max = 2147483647): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return invalid(); return value; }
function string(value: unknown, min: number, max: number, multiline = false): string {
  if (typeof value !== 'string' || [...value].length < min || [...value].length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/ : /[\u0000-\u001f\u007f-\u009f]/).test(value)) return invalid(); return value;
}
function date(value: unknown): string { const v = string(value, 20, 50); if (!/^\d{4}-\d\d-\d\dT/.test(v) || !Number.isFinite(Date.parse(v))) return invalid(); return v; }
function selections(value: unknown): PublicStoreSelection[] {
  if (!Array.isArray(value) || value.length > 50) return invalid();
  const result = value.map(v => { const r = storeObject(v, ['listingId', 'version']); return { listingId: storeUuid(r.listingId), version: int(r.version) }; }).sort((a,b) => a.listingId.localeCompare(b.listingId));
  if (new Set(result.map(r => r.listingId)).size !== result.length) invalid(); return result;
}
export function parsePublicStoreReadInput(value: unknown) { return { companyId: storeUuid(storeObject(value, ['companyId']).companyId) }; }
export function parsePublishPublicStoreInput(value: unknown): PublishPublicStoreInput {
  const r = storeObject(value, ['companyId','slug','expectedVersion','profileVersion','listings','acknowledged','requestId']);
  if (r.acknowledged !== true) invalid();
  return { companyId: storeUuid(r.companyId), slug: storeSlug(r.slug), expectedVersion: int(r.expectedVersion, 0, 2147483646), profileVersion: int(r.profileVersion), listings: selections(r.listings), acknowledged: true, requestId: storeUuid(r.requestId) };
}
export function parseUnpublishPublicStoreInput(value: unknown): UnpublishPublicStoreInput {
  const r = storeObject(value, ['companyId','expectedVersion','acknowledged','requestId']); if (r.acknowledged !== true) invalid();
  return { companyId: storeUuid(r.companyId), expectedVersion: int(r.expectedVersion,1,2147483646), acknowledged: true, requestId: storeUuid(r.requestId) };
}
function state(value: unknown): PublicStoreState {
  const r = storeObject(value, ['slug','version','status','profileVersion','publishedAt','updatedAt','selectedListings']);
  if (r.status !== 'published' && r.status !== 'unpublished') invalid();
  return { slug: storeSlug(r.slug), version: int(r.version), status: r.status, profileVersion: int(r.profileVersion), publishedAt: date(r.publishedAt), updatedAt: date(r.updatedAt), selectedListings: selections(r.selectedListings) };
}
function output<T>(work: () => T): T { try { return work(); } catch { throw new PublicStoreError('unavailable'); } }
type Context = { companyId: string; userId: string; role: 'owner'|'admin' };
export function parsePublicStorePage(value: unknown, ctx: Context): PublicStorePage {
  return output(() => { const r = storeObject(value, ['companyId','actorUserId','actorRole','store']);
    if (storeUuid(r.companyId) !== ctx.companyId || storeUuid(r.actorUserId) !== ctx.userId || r.actorRole !== ctx.role) invalid();
    return { companyId: ctx.companyId, actorUserId: ctx.userId, actorRole: ctx.role, store: r.store === null ? null : state(r.store) };
  });
}
export function parsePublicStoreReceipt(value: unknown, ctx: Context, input: PublishPublicStoreInput|UnpublishPublicStoreInput, action: 'publish'|'unpublish'): PublicStoreReceipt {
  return output(() => { const r = storeObject(value, ['companyId','actorUserId','requestId','action','store']), s = state(r.store);
    if (storeUuid(r.companyId) !== ctx.companyId || storeUuid(r.actorUserId) !== ctx.userId || storeUuid(r.requestId) !== input.requestId || r.action !== action || s.version !== input.expectedVersion+1 || s.status !== (action === 'publish' ? 'published' : 'unpublished')) invalid();
    if (action === 'publish' && (!('slug' in input) || s.slug !== input.slug || s.profileVersion !== input.profileVersion || JSON.stringify(s.selectedListings) !== JSON.stringify(input.listings))) invalid();
    return { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: input.requestId, action, store: s };
  });
}
export function parsePublicDealerStore(value: unknown, expectedSlug: string): PublicDealerStore | null {
  if (value === null) return null;
  return output(() => { const r = storeObject(value, ['slug','version','publishedAt','shop','listings']); if (storeSlug(r.slug) !== expectedSlug || !Array.isArray(r.listings) || r.listings.length > 50) invalid();
    const shopRaw = storeObject(r.shop, ['legalName','organisationNumber','displayName','addressLine1','addressLine2','postalCode','city','countryCode','publicEmail','publicPhone','websiteUrl','logoUrl','description','openingHoursText']);
    const { legalName, organisationNumber, ...fields } = shopRaw;
    if (typeof organisationNumber !== 'string' || !/^[0-9]{10}$/.test(organisationNumber)) invalid();
    const shop = { legalName: string(legalName, 1, 500), organisationNumber, ...parseCompanyStoreFields(fields) };
    const listings = r.listings.map(v => { const l = storeObject(v, ['id','version','title','description','priceOre','currency','make','model','year','mileageKm','fuel','transmission','photos']);
      if (l.currency !== 'SEK' || typeof l.priceOre !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(l.priceOre) || BigInt(l.priceOre) > 9223372036854775807n || !Array.isArray(l.photos) || l.photos.length > 20) invalid();
      const photos = l.photos.map(v => ({ id: storeUuid(storeObject(v, ['id']).id) })); if (new Set(photos.map(p => p.id)).size !== photos.length) invalid();
      return { id: storeUuid(l.id), version: int(l.version), title: string(l.title,1,160), description: string(l.description,0,5000,true), priceOre: l.priceOre, currency: 'SEK' as const, make: string(l.make,1,160), model: string(l.model,1,160), year: int(l.year,1886,2200), mileageKm: int(l.mileageKm,0), fuel: string(l.fuel,1,120), transmission: string(l.transmission,1,120), photos };
    }); if (new Set(listings.map(l => l.id)).size !== listings.length) invalid();
    return { slug: expectedSlug, version: int(r.version), publishedAt: date(r.publishedAt), shop, listings };
  });
}
