'use server';
import { createHash } from 'node:crypto';
import { requirePlatformAdminContext, PlatformAdminError } from '@/lib/platform-admin/context';
import { requireContractContext } from '@/lib/contracts/context';
import { CrmError } from '@/lib/crm/context';
import { getPlatformAdvertisingPaymentPageAction, listAdvertisingPaymentPageAction } from '@/lib/advertising/payment-actions';
import { invoiceUuid } from './issuance-validation';
import { paymentExact, paymentHash, parseAdvertisingPaymentPage } from './payment-validation';
import { generateAdvertisingPaymentCsv, AdvertisingPaymentExportLimitError, PAYMENT_EXPORT_MAX_ENTRIES, PAYMENT_EXPORT_MAX_RESPONSE_BYTES } from './payment-export';
import type { AdvertisingPaymentExportInput, AdvertisingPaymentExportResult } from './payment-export-types';
import type { AdvertisingPaymentPage, AdvertisingPaymentEntry } from './payment-types';

class ExportError extends Error {
  constructor(readonly code: 'conflict' | 'access_denied' | 'unauthenticated' | 'unavailable') { super(code); }
}
async function context(companyId: string, platform: boolean) {
  if (platform) return {...await requirePlatformAdminContext(),role:'platform_admin' as const};
  const c = await requireContractContext(companyId);
  if (!['owner','admin','finance'].includes(c.role)) throw new CrmError('access_denied');
  return {...c,role:c.role as AdvertisingPaymentPage['actorRole']};
}
function revision(page: AdvertisingPaymentPage) {
  const {entries: _entries,nextBeforeSequence: _cursor,...state} = page;
  return JSON.stringify(state);
}
function failure(error: unknown): Extract<AdvertisingPaymentExportResult,{ok:false}> {
  if (error instanceof AdvertisingPaymentExportLimitError) return {ok:false,code:'unavailable',message:'Hela avstämningen är för stor för säker CSV-hämtning. Gränsen är 10 000 journalposter, 2 MiB CSV och 3 MiB svar. Ingen ofullständig fil har skapats.'};
  const c = error instanceof ExportError ? error.code : error instanceof PlatformAdminError ? (error.code === 'forbidden' ? 'access_denied' : error.code) : error instanceof CrmError ? error.code : 'unavailable';
  const code = ['access_denied','unauthenticated','conflict'].includes(c) ? c as 'access_denied'|'unauthenticated'|'conflict' : 'unavailable';
  return {ok:false,code,message:code === 'conflict' ? 'Avstämningen har ändrats sedan granskningen. Uppdatera fakturan och hämta sedan hela CSV-filen igen. Ingen ofullständig fil har skapats.' : code === 'access_denied' || code === 'unauthenticated' ? 'Din behörighet till avstämningen kunde inte verifieras. Ingen fil har skapats.' : 'Hela avstämningen kunde inte verifieras. Försök igen. Ingen ofullständig fil har skapats.'};
}
export async function getPlatformAdvertisingPaymentExportAction(input: AdvertisingPaymentExportInput): Promise<AdvertisingPaymentExportResult> { return exportCsv(input,true); }
export async function getAdvertisingPaymentExportAction(input: AdvertisingPaymentExportInput): Promise<AdvertisingPaymentExportResult> { return exportCsv(input,false); }
async function exportCsv(input: AdvertisingPaymentExportInput, platform: boolean): Promise<AdvertisingPaymentExportResult> {
  let companyId: string, invoiceId: string, expectedInvoiceSourceHash: string, expectedReviewToken: string;
  try {
    const value = paymentExact(input,['companyId','invoiceId','expectedInvoiceSourceHash','expectedReviewToken']);
    companyId = invoiceUuid(value.companyId); invoiceId = invoiceUuid(value.invoiceId);
    expectedInvoiceSourceHash = paymentHash(value.expectedInvoiceSourceHash); expectedReviewToken = paymentHash(value.expectedReviewToken);
  } catch { return {ok:false,code:'invalid_input',message:'Välj en verifierad faktura och uppdatera avstämningen innan du hämtar CSV.'}; }
  try {
    const c = await context(companyId,platform), fetchPage = platform ? getPlatformAdvertisingPaymentPageAction : listAdvertisingPaymentPageAction;
    async function load(beforeSequence: string | null) {
      const result = await fetchPage({companyId,invoiceId,beforeSequence});
      if (!result.ok) throw new ExportError(result.code === 'access_denied' || result.code === 'unauthenticated' || result.code === 'conflict' ? result.code : 'unavailable');
      const page = parseAdvertisingPaymentPage(result.page,companyId,invoiceId,c.userId,c.role,beforeSequence);
      if (page.invoiceSourceHash !== expectedInvoiceSourceHash || page.reviewToken !== expectedReviewToken) throw new ExportError('conflict');
      return page;
    }
    const first = await load(null), expectedRevision = revision(first);
    if (BigInt(first.entryCount) > BigInt(PAYMENT_EXPORT_MAX_ENTRIES)) throw new AdvertisingPaymentExportLimitError('Entry limit');
    const entries: AdvertisingPaymentEntry[] = [], ids = new Set<string>(), cursors = new Set<string>();
    let current = first, pages = 0, previousSequence = BigInt(first.latestSequence) + 1n;
    while (true) {
      if (++pages > PAYMENT_EXPORT_MAX_ENTRIES / 50 || revision(current) !== expectedRevision) throw new ExportError('conflict');
      for (const entry of current.entries) {
        if (ids.has(entry.id) || BigInt(entry.sequence) >= previousSequence) throw new ExportError('unavailable');
        ids.add(entry.id); previousSequence = BigInt(entry.sequence); entries.push(entry);
        if (entries.length > PAYMENT_EXPORT_MAX_ENTRIES) throw new AdvertisingPaymentExportLimitError('Entry limit');
      }
      if (current.nextBeforeSequence === null) break;
      if (BigInt(entries.length) >= BigInt(first.entryCount) || current.nextBeforeSequence !== entries.at(-1)?.sequence || cursors.has(current.nextBeforeSequence)) throw new ExportError('unavailable');
      cursors.add(current.nextBeforeSequence); current = await load(current.nextBeforeSequence);
    }
    if (BigInt(entries.length) !== BigInt(first.entryCount)) throw new ExportError('unavailable');
    const csv = generateAdvertisingPaymentCsv({page:first,entries}), sha256 = createHash('sha256').update(csv,'utf8').digest('hex');
    // Recheck the observed revision after all paging/formatting. This is not a bank or atomic DB snapshot.
    const final = await load(null);
    if (revision(final) !== expectedRevision || final.entries.length !== first.entries.length || final.entries.some((entry,index) => entry.id !== first.entries[index].id || entry.sourceHash !== first.entries[index].sourceHash)) throw new ExportError('conflict');
    const fresh = await context(companyId,platform);
    if (fresh.userId !== c.userId || fresh.role !== c.role) throw new ExportError('access_denied');
    const result: Extract<AdvertisingPaymentExportResult,{ok:true}> = {ok:true,export:{companyId,invoiceId,actorUserId:c.userId,actorRole:c.role,invoiceSourceHash:first.invoiceSourceHash,reviewToken:first.reviewToken,entryCount:first.entryCount,fileName:`trafexa-annonsavstamning-${invoiceId}.csv`,contentType:'text/csv;charset=utf-8',csv,sha256}};
    if (Buffer.byteLength(JSON.stringify(result),'utf8') > PAYMENT_EXPORT_MAX_RESPONSE_BYTES) throw new AdvertisingPaymentExportLimitError('Serialized response limit');
    return result;
  } catch (error) { return failure(error); }
}
