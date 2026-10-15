'use server';

import { revalidatePath } from 'next/cache';
import { AdvertisingError, requireAdvertisingContext } from './context';
import type { AdvertisingChannel, AdvertisingConnection, AdvertisingJob, AdvertisingJobStatus, AdvertisingListing, AdvertisingListingReceipt, AdvertisingPhoto, AdvertisingResult, AdvertisingScope, AdvertisingSendQuote, AdvertisingSendReceipt, AdvertisingSnapshot, AdvertisingStock, AdvertisingStockPage, AdvertisingWorkspacePage, StockAdvertisingDetails } from './database.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class ActionError extends Error { constructor(readonly code: 'invalid_input' | 'conflict' | 'not_found' | 'connection_required' | 'unavailable' | 'access_denied') { super('Advertising action failed'); } }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new ActionError('invalid_input');
  return value as Record<string, unknown>;
}
function input(value: unknown, keys: string[]): Record<string, unknown> {
  const row = object(value);
  if (Object.keys(row).some(key => !keys.includes(key))) throw new ActionError('invalid_input');
  return row;
}
function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) throw new ActionError('invalid_input'); return value.toLowerCase(); }
function integer(value: unknown, min = 1, max = 2147483647): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new ActionError('invalid_input'); return value; }
function text(value: unknown, max: number, empty = false, multiline = false): string {
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/ : /[\u0000-\u001f\u007f-\u009f]/;
  if (typeof value !== 'string' || value.length > max || controls.test(value) || !empty && !value.trim()) throw new ActionError('invalid_input');
  return value;
}
function bool(value: unknown): boolean { if (typeof value !== 'boolean') throw new ActionError('invalid_input'); return value; }
function timestamp(value: unknown): string { const result = text(value, 80); if (!Number.isFinite(Date.parse(result))) throw new ActionError('unavailable'); return result; }
function money(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > BigInt('9223372036854775807')) throw new ActionError('unavailable');
  return value;
}
function channel(value: unknown): AdvertisingChannel { if (value !== 'blocket' && value !== 'wayke') throw new ActionError('invalid_input'); return value; }
function selectedChannels(value: unknown): AdvertisingChannel[] {
  if (!Array.isArray(value) || !value.length || value.length > 2) throw new ActionError('invalid_input');
  const channels = value.map(channel).sort();
  if (new Set(channels).size !== channels.length) throw new ActionError('invalid_input');
  return channels;
}
function quoteToken(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new ActionError('invalid_input');
  return value;
}
function sendQuote(value: unknown, companyId: string, userId: string, listingId: string, version: number, channels: AdvertisingChannel[]): AdvertisingSendQuote {
  const row = object(value);
  if (uuid(row.companyId) !== companyId || uuid(row.actorUserId) !== userId || uuid(row.listingId) !== listingId || integer(row.listingVersion) !== version || row.currency !== 'SEK' || row.taxBasis !== 'exclusive' || row.billingUnit !== 'unique_publication') throw new ActionError('unavailable');
  if (JSON.stringify(row.channels) !== JSON.stringify(channels) || !Array.isArray(row.items) || row.items.length !== channels.length) throw new ActionError('unavailable');
  const items = row.items.map((value, index) => {
    const item = object(value), requestedChannel = channel(item.channel);
    if (requestedChannel !== channels[index]) throw new ActionError('unavailable');
    const alreadyPublished = bool(item.alreadyPublished), publicationId = item.publicationId === null ? null : uuid(item.publicationId);
    if (!alreadyPublished && publicationId !== null) throw new ActionError('unavailable');
    const rateId = item.rateId === null ? null : uuid(item.rateId);
    const rateVersion = item.rateVersion === null ? null : integer(item.rateVersion);
    const unitPriceOre = item.unitPriceOre === null ? null : money(item.unitPriceOre);
    if ((rateId === null) !== (rateVersion === null) || (rateId === null) !== (unitPriceOre === null)) throw new ActionError('unavailable');
    const chargeOre = item.chargeOre === null ? null : money(item.chargeOre);
    if (chargeOre !== (rateId === null ? null : alreadyPublished ? '0' : unitPriceOre)) throw new ActionError('unavailable');
    return { channel: requestedChannel, rateId, rateVersion, unitPriceOre, chargeOre, alreadyPublished, publicationId };
  });
  const sum = items.some(item => item.chargeOre === null) ? null : items.reduce((total, item) => total + BigInt(item.chargeOre!), BigInt(0)).toString();
  if (row.totalOre !== sum) throw new ActionError('unavailable');
  return { companyId, actorUserId: userId, listingId, listingVersion: version, channels, currency: 'SEK', taxBasis: 'exclusive', billingUnit: 'unique_publication', items, totalOre: sum, reviewToken: quoteToken(row.reviewToken) };
}
function jobStatus(value: unknown): AdvertisingJobStatus {
  if (value !== 'queued' && value !== 'dispatching' && value !== 'outcome_unknown' && value !== 'submitted' && value !== 'published' && value !== 'rejected' && value !== 'retryable') throw new ActionError('unavailable');
  return value;
}
function photoIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new ActionError('invalid_input');
  const ids = value.map(uuid);
  if (new Set(ids).size !== ids.length) throw new ActionError('invalid_input');
  return ids;
}
function photo(value: unknown, companyId: string, stockId: string): AdvertisingPhoto {
  const row = object(value);
  if (uuid(row.companyId) !== companyId || uuid(row.stockId) !== stockId || row.storageBucket !== 'ads-vehicle-photos' || row.storageVisibility !== 'private') throw new ActionError('unavailable');
  if (row.contentType !== 'image/jpeg' && row.contentType !== 'image/png' && row.contentType !== 'image/webp' || row.status !== 'active' && row.status !== 'archived') throw new ActionError('unavailable');
  return { id: uuid(row.id), contentType: row.contentType, sizeBytes: integer(row.sizeBytes, 1, 10485760), version: integer(row.version), status: row.status, createdAt: timestamp(row.createdAt) };
}
function snapshot(value: unknown, companyId: string, stockId: string): AdvertisingSnapshot {
  const row = object(value);
  if (!Array.isArray(row.photos) || row.photos.length > 20) throw new ActionError('unavailable');
  const photos = row.photos.map(value => photo(value, companyId, stockId));
  if (new Set(photos.map(item => item.id)).size !== photos.length) throw new ActionError('unavailable');
  const includeRegistrationNumber = bool(row.includeRegistrationNumber);
  const registrationNumber = includeRegistrationNumber ? text(row.registrationNumber, 40) : null;
  if (!includeRegistrationNumber && row.registrationNumber !== null) throw new ActionError('unavailable');
  return { title: text(row.title, 160), description: text(row.description, 5000, true, true), priceGrossOre: money(row.priceGrossOre), make: text(row.make, 160), model: text(row.model, 160), year: integer(row.year, 1886, 2200), mileageKm: integer(row.mileageKm, 0), fuel: text(row.fuel, 120), transmission: text(row.transmission, 120), photos, includeRegistrationNumber, registrationNumber };
}
function listing(value: unknown, companyId: string): AdvertisingListing {
  const row = object(value);
  if (uuid(row.companyId) !== companyId || row.status !== 'draft' && row.status !== 'ready') throw new ActionError('unavailable');
  const stockId = uuid(row.stockId), content = snapshot(row.snapshot, companyId, stockId);
  if (row.status === 'ready' && (!content.photos.length || content.photos.some(item => item.status !== 'active'))) throw new ActionError('unavailable');
  return { id: uuid(row.id), companyId, stockId, version: integer(row.version), status: row.status, snapshot: content, createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) };
}
function publicProviderUrl(value: unknown, requestedChannel: AdvertisingChannel): string | null {
  if (value === null) return null;
  const raw = text(value, 2048);
  const url = new URL(raw);
  const hosts = requestedChannel === 'blocket' ? ['blocket.se', 'www.blocket.se'] : ['wayke.se', 'www.wayke.se'];
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash) throw new ActionError('unavailable');
  return url.href;
}
function job(value: unknown, companyId: string): AdvertisingJob {
  const row = object(value);
  if (uuid(row.companyId) !== companyId) throw new ActionError('unavailable');
  const stockId = uuid(row.stockId), requestedChannel = channel(row.channel), status = jobStatus(row.status);
  const providerAdId = row.providerAdId === null ? null : text(row.providerAdId, 200);
  const verifiedUrl = publicProviderUrl(row.providerUrl, requestedChannel);
  // A provider may confirm publication by ID without supplying a documented public URL.
  if (status === 'published' && !providerAdId) throw new ActionError('unavailable');
  return { id: uuid(row.id), companyId, stockId, listingId: uuid(row.listingId), listingVersion: integer(row.listingVersion), channel: requestedChannel, status, version: integer(row.version), providerAdId, providerUrl: status === 'published' ? verifiedUrl : null, snapshot: snapshot(row.snapshot, companyId, stockId), createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) };
}
function connection(value: unknown): AdvertisingConnection {
  const row = object(value);
  if (row.status !== 'disconnected' && row.status !== 'requested' && row.status !== 'verified') throw new ActionError('unavailable');
  const dispatcherAvailable = bool(row.dispatcherAvailable);
  if (dispatcherAvailable && row.status !== 'verified') throw new ActionError('unavailable');
  return { channel: channel(row.channel), status: row.status, accountReference: row.accountReference === null ? null : text(row.accountReference, 160), dispatcherAvailable };
}
function connections(value: unknown): AdvertisingConnection[] {
  if (!Array.isArray(value) || value.length > 2) throw new ActionError('unavailable');
  const items = value.map(connection);
  if (new Set(items.map(item => item.channel)).size !== items.length) throw new ActionError('unavailable');
  return items;
}
function pagination(row: Record<string, unknown>) { return { pageKey: row.pageKey == null ? null : uuid(row.pageKey), limit: integer(row.limit ?? 50, 1, 50) }; }
function rows<T extends { id: string }>(value: unknown, count: number, after: string | null, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > count) throw new ActionError('unavailable');
  const items = value.map(parse);
  if (items.some((item, index) => item.id <= (index ? items[index - 1].id : after ?? ''))) throw new ActionError('unavailable');
  return items;
}
function next(value: unknown, items: { id: string }[]): string | null {
  const key = value === null ? null : uuid(value);
  if (key && key !== items.at(-1)?.id) throw new ActionError('unavailable');
  return key;
}
function output<T>(parse: () => T): T { try { return parse(); } catch { throw new ActionError('unavailable'); } }
function rpcError(error: { code?: string } | null) {
  if (error) throw new ActionError(error.code === '42501' ? 'access_denied' : error.code === '40001' || error.code === '23505' ? 'conflict' : error.code === 'P0002' ? 'not_found' : error.code === '22023' ? 'invalid_input' : 'unavailable');
}
function receiptActor(row: Record<string, unknown>, userId: string, requestId: string) { if (row.actorUserId !== userId || uuid(row.requestId) !== requestId) throw new ActionError('unavailable'); }
function failure(error: unknown): AdvertisingResult<never> {
  const code = error instanceof AdvertisingError || error instanceof ActionError ? error.code : 'unavailable';
  const messages = { unauthenticated: 'Logga in igen för att fortsätta.', access_denied: 'Du har inte längre åtkomst eller behörighet för detta företag.', invalid_input: 'Kontrollera annonsuppgifterna och försök igen.', conflict: 'Annonsen, lagret eller begäran har ändrats. Läs in aktuell information innan du försöker igen.', not_found: 'Annonsen eller lagerobjektet kunde inte hittas.', connection_required: 'Valda kanaler behöver en verifierad kontoanslutning och en tillgänglig publiceringsanslutning. Ingen publicering har köats.', unavailable: 'Resultatet kunde inte verifieras. Försök igen med samma uppgifter.' };
  return { ok: false, code, message: messages[code] };
}
function refresh() { try { revalidatePath('/advertising'); } catch { /* A durable receipt remains valid. */ } }
function scope(context: { companyId: string; userId: string; role: AdvertisingScope['actorRole'] }): AdvertisingScope { return { companyId: context.companyId, actorUserId: context.userId, actorRole: context.role }; }

export async function listAdvertisingWorkspaceAction(value: unknown): Promise<AdvertisingResult<AdvertisingWorkspacePage>> {
  try {
    const row = input(value, ['companyId', 'pageKey', 'jobsPageKey', 'limit']);
    const companyId = uuid(row.companyId), { pageKey, limit } = pagination(row), jobsPageKey = row.jobsPageKey == null ? null : uuid(row.jobsPageKey);
    const context = await requireAdvertisingContext(companyId);
    const result = await context.db.rpc('list_company_advertising', { p_company_id: companyId, p_page_key: pageKey, p_jobs_page_key: jobsPageKey, p_limit: limit });
    rpcError(result.error);
    return output(() => {
      const page = object(result.data), listings = rows(page.listings, limit, pageKey, value => listing(value, companyId)), jobs = rows(page.jobs, limit, jobsPageKey, value => job(value, companyId));
      return { ok: true, ...scope(context), listings, jobs, channels: connections(page.channels), nextPageKey: next(page.nextPageKey, listings), nextJobsPageKey: next(page.nextJobsPageKey, jobs) };
    });
  } catch (error) { return failure(error); }
}

export async function listAdvertisingStockAction(value: unknown): Promise<AdvertisingResult<AdvertisingStockPage>> {
  try {
    const row = input(value, ['companyId', 'pageKey', 'limit']);
    const companyId = uuid(row.companyId), { pageKey, limit } = pagination(row), context = await requireAdvertisingContext(companyId);
    const result = await context.db.rpc('list_advertising_stock', { p_company_id: companyId, p_page_key: pageKey, p_limit: limit });
    rpcError(result.error);
    return output(() => {
      const page = object(result.data), stock = rows<AdvertisingStock>(page.stock, limit, pageKey, value => {
        const item = object(value);
        if (item.status !== 'available' && item.status !== 'reserved' && item.status !== 'sold') throw new Error();
        return { id: uuid(item.id), make: text(item.make, 160), model: text(item.model, 160), year: integer(item.year, 1886, 2200), priceGrossOre: money(item.priceGrossOre), status: item.status };
      });
      return { ok: true, ...scope(context), stock, nextPageKey: next(page.nextPageKey, stock) };
    });
  } catch (error) { return failure(error); }
}

export async function getStockAdvertisingAction(value: unknown): Promise<AdvertisingResult<StockAdvertisingDetails>> {
  try {
    const row = input(value, ['companyId', 'stockItemId']), companyId = uuid(row.companyId), stockId = uuid(row.stockItemId), context = await requireAdvertisingContext(companyId);
    const result = await context.db.rpc('get_stock_advertising', { p_company_id: companyId, p_stock_id: stockId });
    rpcError(result.error);
    return output(() => {
      const details = object(result.data), found = details.listing === null ? null : listing(details.listing, companyId), jobs = rows(details.jobs, 50, null, value => job(value, companyId));
      if (found && found.stockId !== stockId || jobs.some(item => item.stockId !== stockId)) throw new Error();
      return { ok: true, ...scope(context), listing: found, jobs, channels: connections(details.channels) };
    });
  } catch (error) { return failure(error); }
}

async function save(value: unknown, creating: boolean): Promise<AdvertisingResult<{ receipt: AdvertisingListingReceipt }>> {
  try {
    const keys = ['companyId', 'stockItemId', 'title', 'description', 'photoIds', 'includeRegistrationNumber', 'requestId'];
    const row = input(value, creating ? keys : [...keys, 'listingId', 'expectedVersion']);
    const companyId = uuid(row.companyId), stockId = uuid(row.stockItemId), requestId = uuid(row.requestId), listingId = creating ? requestId : uuid(row.listingId), expectedVersion = creating ? 0 : integer(row.expectedVersion);
    const title = text(row.title, 160).trim(), description = text(row.description, 5000, true, true), ids = photoIds(row.photoIds), includeRegistrationNumber = row.includeRegistrationNumber === undefined ? false : bool(row.includeRegistrationNumber);
    const context = await requireAdvertisingContext(companyId, 'write');
    const result = await context.db.rpc('save_vehicle_advertisement', { p_company_id: companyId, p_stock_id: stockId, p_listing_id: listingId, p_expected_version: expectedVersion, p_title: title, p_description: description, p_photo_ids: ids, p_include_registration_number: includeRegistrationNumber, p_request_id: requestId });
    rpcError(result.error);
    const receipt = output(() => {
      const row = object(result.data); receiptActor(row, context.userId, requestId);
      const saved = listing(row.listing, companyId);
      if (saved.id !== listingId || saved.stockId !== stockId || saved.version !== expectedVersion + 1 || saved.status !== 'draft' || saved.snapshot.title !== title || saved.snapshot.description !== description || saved.snapshot.includeRegistrationNumber !== includeRegistrationNumber || JSON.stringify(saved.snapshot.photos.map(item => item.id)) !== JSON.stringify(ids)) throw new Error();
      return { listing: saved };
    });
    refresh(); return { ok: true, receipt };
  } catch (error) { return failure(error); }
}
export async function createAdvertisingListingAction(value: unknown): Promise<AdvertisingResult<{ receipt: AdvertisingListingReceipt }>> { return save(value, true); }
export async function saveAdvertisingListingAction(value: unknown): Promise<AdvertisingResult<{ receipt: AdvertisingListingReceipt }>> { return save(value, false); }

export async function markAdvertisingListingReadyAction(value: unknown): Promise<AdvertisingResult<{ receipt: AdvertisingListingReceipt }>> {
  try {
    const row = input(value, ['companyId', 'listingId', 'expectedVersion', 'requestId']), companyId = uuid(row.companyId), listingId = uuid(row.listingId), expectedVersion = integer(row.expectedVersion), requestId = uuid(row.requestId);
    const context = await requireAdvertisingContext(companyId, 'write');
    const result = await context.db.rpc('mark_vehicle_advertisement_ready', { p_company_id: companyId, p_listing_id: listingId, p_expected_version: expectedVersion, p_request_id: requestId });
    rpcError(result.error);
    const receipt = output(() => {
      const row = object(result.data); receiptActor(row, context.userId, requestId);
      const ready = listing(row.listing, companyId);
      if (ready.id !== listingId || ready.version !== expectedVersion + 1 || ready.status !== 'ready') throw new Error();
      return { listing: ready };
    });
    refresh(); return { ok: true, receipt };
  } catch (error) { return failure(error); }
}

export async function requestAdvertisingConnectionAction(value: unknown): Promise<AdvertisingResult<{ connection: AdvertisingConnection }>> {
  try {
    const row = input(value, ['companyId', 'channel', 'accountReference', 'requestId']), companyId = uuid(row.companyId), requestedChannel = channel(row.channel), accountReference = text(row.accountReference, 160).trim(), requestId = uuid(row.requestId);
    const context = await requireAdvertisingContext(companyId, 'manage');
    const result = await context.db.rpc('request_advertising_connection', { p_company_id: companyId, p_channel: requestedChannel, p_account_reference: accountReference, p_request_id: requestId });
    rpcError(result.error);
    const requested = output(() => {
      const row = object(result.data); receiptActor(row, context.userId, requestId);
      const requested = connection(row.connection);
      // Requesting the same already verified account preserves the trusted registry
      // state; this action cannot confer verification or replace that account.
      if (requested.channel !== requestedChannel || requested.accountReference !== accountReference || requested.status === 'disconnected' || requested.status === 'requested' && requested.dispatcherAvailable) throw new Error();
      return requested;
    });
    refresh(); return { ok: true, connection: requested };
  } catch (error) { return failure(error); }
}

export async function sendAdvertisingListingAction(value: unknown): Promise<AdvertisingResult<{ receipt: AdvertisingSendReceipt }>> {
  try {
    const row = input(value, ['companyId', 'listingId', 'expectedVersion', 'channels', 'requestId', 'expectedQuoteToken']), companyId = uuid(row.companyId), listingId = uuid(row.listingId), expectedVersion = integer(row.expectedVersion), requestId = uuid(row.requestId);
    const channels = selectedChannels(row.channels), expectedQuoteToken = quoteToken(row.expectedQuoteToken);
    const context = await requireAdvertisingContext(companyId, 'write');
    // SQL requires current private verified account bindings and a fresh heartbeat
    // written by a trusted, configured worker, before it queues any selected channel.
    const result = await context.db.rpc('send_vehicle_advertisement_priced', { p_company_id: companyId, p_listing_id: listingId, p_expected_version: expectedVersion, p_channels: channels, p_request_id: requestId, p_expected_quote_token: expectedQuoteToken });
    rpcError(result.error);
    const receipt = output(() => {
      const row = object(result.data); receiptActor(row, context.userId, requestId);
      const sent = listing(row.listing, companyId);
      if (sent.id !== listingId || sent.version !== expectedVersion || sent.status !== 'ready' || !Array.isArray(row.jobs)) throw new Error();
      if (row.status === 'connection_required') {
        if (row.jobs.length) throw new Error();
        return null;
      }
      if (row.status !== 'queued' || row.jobs.length !== channels.length) throw new Error();
      const jobs = row.jobs.map(value => job(value, companyId));
      if (new Set(jobs.map(item => item.id)).size !== jobs.length || new Set(jobs.map(item => item.channel)).size !== jobs.length || jobs.some(item => item.stockId !== sent.stockId || item.listingId !== listingId || item.listingVersion !== expectedVersion || item.status !== 'queued' || !channels.includes(item.channel) || JSON.stringify(item.snapshot) !== JSON.stringify(sent.snapshot))) throw new Error();
      const quote = sendQuote(row.quote, companyId, context.userId, listingId, expectedVersion, channels);
      if (quote.reviewToken !== expectedQuoteToken || quote.totalOre === null || quote.items.some(item => item.rateId === null)) throw new Error();
      return { status: 'queued' as const, jobs, listing: sent, quote };
    });
    if (!receipt) throw new ActionError('connection_required');
    refresh(); return { ok: true, receipt };
  } catch (error) { return failure(error); }
}

export async function getAdvertisingSendQuoteAction(value: unknown): Promise<AdvertisingResult<AdvertisingScope & { quote: AdvertisingSendQuote }>> {
  try {
    const row = input(value, ['companyId', 'listingId', 'expectedVersion', 'channels']);
    const companyId = uuid(row.companyId), listingId = uuid(row.listingId), expectedVersion = integer(row.expectedVersion), channels = selectedChannels(row.channels);
    const context = await requireAdvertisingContext(companyId, 'write');
    const result = await context.db.rpc('get_advertising_send_quote', { p_company_id: companyId, p_listing_id: listingId, p_expected_version: expectedVersion, p_channels: channels });
    rpcError(result.error);
    const quote = output(() => sendQuote(result.data, companyId, context.userId, listingId, expectedVersion, channels));
    return { ok: true, ...scope(context), quote };
  } catch (error) { return failure(error); }
}
