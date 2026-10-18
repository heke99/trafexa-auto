'use server';
import { requirePlatformAdminContext, PlatformAdminError } from '@/lib/platform-admin/context';
import { requireContractContext } from '@/lib/contracts/context';
import { CrmError } from '@/lib/crm/context';
import { invoiceUuid, issuanceText } from './issuance-validation';
import { record } from './billing-validation';
import { paymentExact, paymentHash, paymentSequence, paymentAmount, paymentIdentifier, paymentDay, parseAdvertisingPaymentEntry, parseAdvertisingPaymentPage } from './payment-validation';
import type { AdvertisingPaymentScope, AdvertisingPaymentPageResult, AdvertisingPaymentLookupResult, AdvertisingPaymentRegistration, AdvertisingPaymentReversal, AdvertisingPaymentWriteResult, AdvertisingPaymentPage } from './payment-types';

function invalid() { return { ok: false as const, code: 'invalid_input' as const, message: 'Kontrollera betalningsbelopp, datum, transaktions-ID och granskat underlag.' }; }
function failure(e: unknown) {
 const c = e instanceof PlatformAdminError ? (e.code === 'forbidden' ? 'access_denied' : e.code) : e instanceof CrmError ? e.code : typeof e === 'object' && e !== null && 'code' in e ? (e.code === '42501' ? 'access_denied' : e.code === '40001' || e.code === '23505' ? 'conflict' : ['22023','22007','22008'].includes(String(e.code)) ? 'invalid_input' : 'unavailable') : 'unavailable';
 const code = c as 'unauthenticated' | 'access_denied' | 'conflict' | 'invalid_input' | 'unavailable';
 return { ok: false as const, code, message: code === 'conflict' ? 'Avstämningen eller transaktions-ID:t har ändrats. Uppdatera och granska innan en ny registrering. Ett redan skickat försök kan återläsas med samma begäran.' : code === 'access_denied' || code === 'unauthenticated' ? 'Din behörighet till avstämningen kunde inte verifieras.' : code === 'invalid_input' ? invalid().message : 'Betalningsregistreringen kunde inte bekräftas. Behåll samma begäran och försök igen.' };
}
async function context(companyId: string, platform: boolean) {
 if (platform) return { ...await requirePlatformAdminContext(), role: 'platform_admin' as const };
 const c = await requireContractContext(companyId);
 if (!['owner','admin','finance'].includes(c.role)) throw new CrmError('access_denied');
 return { ...c, role: c.role as AdvertisingPaymentPage['actorRole'] };
}
async function rpc(c: Awaited<ReturnType<typeof context>>, name: string, args: Record<string, unknown>) {
 const db = c.db as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
 const r = await db.rpc(name,args); if (r.error) throw r.error; return r.data;
}
async function fresh(c: Awaited<ReturnType<typeof context>>, companyId: string, platform: boolean) {
 const next = await context(companyId,platform);
 if (next.userId !== c.userId || next.role !== c.role) throw new CrmError('access_denied');
}
export async function getPlatformAdvertisingPaymentPageAction(value: AdvertisingPaymentScope & { beforeSequence: string | null }): Promise<AdvertisingPaymentPageResult> { return page(value,true); }
export async function listAdvertisingPaymentPageAction(value: AdvertisingPaymentScope & { beforeSequence: string | null }): Promise<AdvertisingPaymentPageResult> { return page(value,false); }
async function page(value: AdvertisingPaymentScope & { beforeSequence: string | null }, platform: boolean): Promise<AdvertisingPaymentPageResult> {
 let companyId: string, invoiceId: string, beforeSequence: string | null;
 try { const r = paymentExact(value,['companyId','invoiceId','beforeSequence']); companyId = invoiceUuid(r.companyId); invoiceId = invoiceUuid(r.invoiceId); beforeSequence = r.beforeSequence === null ? null : paymentSequence(r.beforeSequence); } catch { return invalid(); }
 try { const c = await context(companyId,platform), parsed = parseAdvertisingPaymentPage(await rpc(c,platform ? 'get_platform_advertising_payment_page' : 'list_advertising_payment_page',{p_company_id:companyId,p_invoice_id:invoiceId,p_before_sequence:beforeSequence}),companyId,invoiceId,c.userId,c.role,beforeSequence); await fresh(c,companyId,platform); return {ok:true,page:parsed}; } catch (e) { return failure(e); }
}
export async function lookupAdvertisingPaymentAction(value: AdvertisingPaymentScope & { paymentIdentifier: string }): Promise<AdvertisingPaymentLookupResult> {
 let companyId: string, invoiceId: string, identifier: string;
 try { const r = paymentExact(value,['companyId','invoiceId','paymentIdentifier']); companyId = invoiceUuid(r.companyId); invoiceId = invoiceUuid(r.invoiceId); identifier = paymentIdentifier(r.paymentIdentifier); } catch { return invalid(); }
 try {
  const c = await context(companyId,true), r = paymentExact(await rpc(c,'lookup_advertising_payment',{p_company_id:companyId,p_invoice_id:invoiceId,p_payment_identifier:identifier}),['companyId','invoiceId','actorUserId','paymentIdentifier','entry']);
  if (r.companyId !== companyId || r.invoiceId !== invoiceId || r.actorUserId !== c.userId || r.paymentIdentifier !== identifier) throw Error('Wrong payment lookup scope');
  const entry = r.entry === null ? null : parseAdvertisingPaymentEntry(r.entry);
  if (entry && (entry.kind !== 'receipt' || entry.paymentIdentifier !== identifier || entry.isReplaced)) throw Error('Wrong payment chain head');
  await fresh(c,companyId,true); return {ok:true,companyId,invoiceId,actorUserId:c.userId,paymentIdentifier:identifier,entry};
 } catch (e) { return failure(e); }
}
const reviewKeys = ['companyId','invoiceId','expectedInvoiceSourceHash','expectedReviewToken','reviewAcknowledged','requestId'];
function review(r: Record<string, unknown>) {
 if (r.reviewAcknowledged !== true) throw Error('Review required');
 return { companyId: invoiceUuid(r.companyId), invoiceId: invoiceUuid(r.invoiceId), expectedInvoiceSourceHash: paymentHash(r.expectedInvoiceSourceHash), expectedReviewToken: paymentHash(r.expectedReviewToken), requestId: invoiceUuid(r.requestId) };
}
export async function registerAdvertisingPaymentAction(value: AdvertisingPaymentRegistration): Promise<AdvertisingPaymentWriteResult> {
 let fields: ReturnType<typeof review> & { amountOre: string; paymentIdentifier: string; bankReference: string; bookedDate: string; reason: string; replacesEntryId: string | null; expectedReplacedEntryHash: string | null };
 try {
  const r = paymentExact(value,[...reviewKeys,'amountOre','paymentIdentifier','bankReference','bookedDate','reason','replacesEntryId','expectedReplacedEntryHash']);
  fields = {...review(r),amountOre:paymentAmount(r.amountOre),paymentIdentifier:paymentIdentifier(r.paymentIdentifier),bankReference:issuanceText(r.bankReference,200),bookedDate:paymentDay(r.bookedDate),reason:issuanceText(r.reason,500),replacesEntryId:r.replacesEntryId === null ? null : invoiceUuid(r.replacesEntryId),expectedReplacedEntryHash:r.expectedReplacedEntryHash === null ? null : paymentHash(r.expectedReplacedEntryHash)};
  if ((fields.replacesEntryId === null) !== (fields.expectedReplacedEntryHash === null)) throw Error('Correction proof missing');
 } catch { return invalid(); }
 try {
  const c = await context(fields.companyId,true), result = await rpc(c,'register_advertising_payment',{p_company_id:fields.companyId,p_invoice_id:fields.invoiceId,p_expected_invoice_source_hash:fields.expectedInvoiceSourceHash,p_expected_review_token:fields.expectedReviewToken,p_amount_ore:fields.amountOre,p_payment_identifier:fields.paymentIdentifier,p_bank_reference:fields.bankReference,p_booked_date:fields.bookedDate,p_reason:fields.reason,p_replaces_entry_id:fields.replacesEntryId,p_expected_replaced_entry_hash:fields.expectedReplacedEntryHash,p_review_acknowledged:true,p_request_id:fields.requestId});
  const parsed = writeResult(result,fields,c.userId);
  if (parsed.entry.kind !== 'receipt' || parsed.entry.createdBy !== c.userId || parsed.entry.amountOre !== fields.amountOre || parsed.entry.paymentIdentifier !== fields.paymentIdentifier || parsed.entry.bankReference !== fields.bankReference || parsed.entry.bookedDate !== fields.bookedDate || parsed.entry.reason !== fields.reason || parsed.entry.replacesEntryId !== fields.replacesEntryId) throw Error('Wrong payment registration receipt');
  await fresh(c,fields.companyId,true); return parsed;
 } catch (e) { return failure(e); }
}
export async function reverseAdvertisingPaymentAction(value: AdvertisingPaymentReversal): Promise<AdvertisingPaymentWriteResult> {
 let fields: ReturnType<typeof review> & { entryId: string; reason: string };
 try { const r = paymentExact(value,[...reviewKeys,'entryId','reason']); fields = {...review(r),entryId:invoiceUuid(r.entryId),reason:issuanceText(r.reason,500)}; } catch { return invalid(); }
 try {
  const c = await context(fields.companyId,true), result = await rpc(c,'reverse_advertising_payment',{p_company_id:fields.companyId,p_invoice_id:fields.invoiceId,p_expected_invoice_source_hash:fields.expectedInvoiceSourceHash,p_expected_review_token:fields.expectedReviewToken,p_entry_id:fields.entryId,p_reason:fields.reason,p_review_acknowledged:true,p_request_id:fields.requestId});
  const parsed = writeResult(result,fields,c.userId);
  if (parsed.entry.kind !== 'reversal' || parsed.entry.createdBy !== c.userId || parsed.entry.reversesEntryId !== fields.entryId || parsed.entry.reason !== fields.reason) throw Error('Wrong payment reversal receipt');
  await fresh(c,fields.companyId,true); return parsed;
 } catch (e) { return failure(e); }
}
function writeResult(value: unknown, fields: ReturnType<typeof review>, actorUserId: string): Extract<AdvertisingPaymentWriteResult,{ok:true}> {
 const r = paymentExact(value,['entry','receipt']), entry = parseAdvertisingPaymentEntry(r.entry), receipt = record(r.receipt);
 const expected = {entryId:entry.id,companyId:fields.companyId,invoiceId:fields.invoiceId,actorUserId,requestId:fields.requestId,sourceHash:entry.sourceHash,reviewToken:fields.expectedReviewToken};
 paymentExact(receipt,Object.keys(expected));
 if (Object.entries(expected).some(([k,v])=>receipt[k]!==v) || entry.companyId !== fields.companyId || entry.invoiceId !== fields.invoiceId || entry.invoiceSourceHash !== fields.expectedInvoiceSourceHash) throw Error('Wrong payment mutation proof');
 return {ok:true,entry,receipt:expected};
}
