'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { companyStoreUuid, parseCompanyStoreExportPage, parseCompanyStoreExportReceipt, parseCompanyStoreProfilePage, parseCompanyStoreProfileReceipt, parseCreateCompanyWithProfileInput, parseGetCompanyStoreExportInput, parseGetCompanyStoreProfileInput, parsePrepareCompanyStoreExportInput, parseSaveCompanyStoreProfileInput } from '../company-store-profile/validation';
import { requireCompanyStoreContext, requireCompanyStoreCreationContext, requireCreatedCompanyStoreContext } from '../company-store-profile/context';
import type { CompanyStoreContext } from '../company-store-profile/context';
import type { CompanyStoreCode, CompanyStoreExportPage, CompanyStoreExportReceipt, CompanyStoreProfilePage, CompanyStoreProfileReceipt, CompanyStoreResult, CreateCompanyWithProfileInput, GetCompanyStoreExportInput, GetCompanyStoreProfileInput, PrepareCompanyStoreExportInput, SaveCompanyStoreProfileInput } from '../company-store-profile/types';

function failure(error: unknown, validation = false): CompanyStoreResult<never> {
  const raw = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const code: CompanyStoreCode = validation ? 'invalid_input' : raw === 'unauthenticated' ? 'unauthenticated' : raw === 'access_denied' || raw === '42501' ? 'access_denied' : raw === 'conflict' || raw === '40001' || raw === '23505' ? 'conflict' : raw === '22023' ? 'invalid_input' : 'unavailable';
  const messages: Record<CompanyStoreCode, string> = {
    unauthenticated: 'Logga in igen för att fortsätta.',
    access_denied: 'Din aktuella behörighet till företagets butiksuppgifter kunde inte verifieras.',
    invalid_input: 'Kontrollera företags- och butiksuppgifterna och bekräfta granskningen.',
    conflict: 'Butiksuppgifterna eller begäran har ändrats. Läs in aktuell information innan du gör en ny granskning.',
    unavailable: 'Resultatet kunde inte bekräftas. Försök vid behov igen med samma uppgifter och begäran.',
  };
  return { ok: false, code, error: messages[code] };
}
function operation() {
  return async function bounded<T>(work: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([Promise.resolve().then(() => work(controller.signal)), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Butiksuppgifterna kunde inte bekräftas.')); }, 15000); })]); }
    finally { if (timer) clearTimeout(timer); }
  };
}
async function fresh(first: CompanyStoreContext) {
  const current = await requireCompanyStoreContext(first.companyId);
  if (current.companyId !== first.companyId || current.userId !== first.userId || current.role !== first.role) throw { code: 'access_denied' };
}
function refresh() { try { revalidatePath('/settings'); revalidatePath('/advertising'); revalidatePath('/dashboard'); } catch { /* The verified durable receipt remains valid. */ } }

export async function getCompanyStoreProfileAction(value: unknown): Promise<CompanyStoreResult<CompanyStoreProfilePage>> {
  let input: GetCompanyStoreProfileInput; try { input = parseGetCompanyStoreProfileInput(value); } catch (error) { return failure(error, true); }
  try {
    const bounded = operation(), current = await bounded(() => requireCompanyStoreContext(input.companyId));
    const result = await bounded(signal => current.db.rpc('get_company_store_profile', { p_company_id: input.companyId }).abortSignal(signal)); if (result.error) throw result.error;
    const page = parseCompanyStoreProfilePage(result.data, current); await bounded(() => fresh(current)); return { ok: true, ...page };
  } catch (error) { return failure(error); }
}

/** No selected-company or mutable profile preflight may block historical replay. */
export async function createCompanyWithProfileAction(value: unknown): Promise<CompanyStoreResult<CompanyStoreProfileReceipt>> {
  let input: CreateCompanyWithProfileInput; try { input = parseCreateCompanyWithProfileInput(value); } catch (error) { return failure(error, true); }
  try {
    const bounded = operation(), current = await bounded(() => requireCompanyStoreCreationContext());
    const result = await bounded(signal => current.db.rpc('create_company_with_profile', { p_legal_name: input.legalName, p_organisation_number: input.organisationNumber, p_fields: input.fields, p_representation_acknowledged: true, p_request_id: input.requestId }).abortSignal(signal)); if (result.error) throw result.error;
    if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw Error('Invalid company receipt');
    const companyId = companyStoreUuid(result.data.companyId);
    const checked = await bounded(() => requireCreatedCompanyStoreContext(companyId, current.userId));
    if (checked.companyId !== companyId || checked.userId !== current.userId || checked.role !== 'owner' && checked.role !== 'admin' || result.data.role !== checked.role) throw { code: 'access_denied' };
    const receipt = parseCompanyStoreProfileReceipt(result.data, checked, input);
    (await cookies()).set('trafexa-company', companyId, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
    refresh(); return { ok: true, ...receipt };
  } catch (error) { return failure(error); }
}

export async function saveCompanyStoreProfileAction(value: unknown): Promise<CompanyStoreResult<CompanyStoreProfileReceipt>> {
  let input: SaveCompanyStoreProfileInput; try { input = parseSaveCompanyStoreProfileInput(value); } catch (error) { return failure(error, true); }
  try {
    const bounded = operation(), current = await bounded(() => requireCompanyStoreContext(input.companyId));
    const result = await bounded(signal => current.db.rpc('save_company_store_profile', { p_company_id: input.companyId, p_expected_version: input.expectedVersion, p_fields: input.fields, p_acknowledged: true, p_request_id: input.requestId }).abortSignal(signal)); if (result.error) throw result.error;
    const receipt = parseCompanyStoreProfileReceipt(result.data, current, input); await bounded(() => fresh(current)); refresh(); return { ok: true, ...receipt };
  } catch (error) { return failure(error); }
}

export async function prepareCompanyStoreExportAction(value: unknown): Promise<CompanyStoreResult<CompanyStoreExportReceipt>> {
  let input: PrepareCompanyStoreExportInput; try { input = parsePrepareCompanyStoreExportInput(value); } catch (error) { return failure(error, true); }
  try {
    const bounded = operation(), current = await bounded(() => requireCompanyStoreContext(input.companyId));
    const result = await bounded(signal => current.db.rpc('prepare_company_store_export', { p_company_id: input.companyId, p_expected_version: input.expectedVersion, p_expected_source_sha256: input.expectedSourceSha256, p_channel: input.channel, p_purpose: input.purpose, p_acknowledged: true, p_attestation_version: input.attestationVersion, p_request_id: input.requestId }).abortSignal(signal)); if (result.error) throw result.error;
    const receipt = parseCompanyStoreExportReceipt(result.data, current, input); await bounded(() => fresh(current)); refresh(); return { ok: true, ...receipt };
  } catch (error) { return failure(error); }
}

export async function getCompanyStoreExportAction(value: unknown): Promise<CompanyStoreResult<CompanyStoreExportPage>> {
  let input: GetCompanyStoreExportInput; try { input = parseGetCompanyStoreExportInput(value); } catch (error) { return failure(error, true); }
  try {
    const bounded = operation(), current = await bounded(() => requireCompanyStoreContext(input.companyId));
    const result = await bounded(signal => current.db.rpc('get_company_store_export', { p_company_id: input.companyId, p_export_id: input.exportId }).abortSignal(signal)); if (result.error) throw result.error;
    const page = parseCompanyStoreExportPage(result.data, current, input.exportId); await bounded(() => fresh(current)); return { ok: true, ...page };
  } catch (error) { return failure(error); }
}
