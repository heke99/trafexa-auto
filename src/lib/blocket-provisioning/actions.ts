'use server';

import { revalidatePath } from 'next/cache';
import { requireBlocketProvisioningContext } from './context';
import { parseBindBlocketCompanyInput, parseBlocketBindingReceipt, parseBlocketGroupReceipt, parseBlocketProvisioningPage, parseBlocketProvisioningQuery, parseConfigureBlocketGroupInput, parseDisableBlocketCompanyInput } from './validation';
import type { BlocketBindingReceipt, BlocketGroupReceipt, BlocketProvisioningCode, BlocketProvisioningPage, BlocketProvisioningResult } from './types';

function failure(error: unknown, invalid = false): BlocketProvisioningResult<never> {
  const raw = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const code: BlocketProvisioningCode = invalid || raw === '22023' ? 'invalid_input' : raw === '42501' || raw === 'forbidden' || raw === 'unauthenticated' || raw === 'access_denied' ? 'access_denied' : raw === '40001' || raw === '23505' ? 'conflict' : 'unavailable';
  const messages = { access_denied: 'Du har inte längre tillgång till plattformsadministrationen.', invalid_input: 'Kontrollera underlaget och bekräfta granskningen. Klistra aldrig in en nyckel eller token.', conflict: 'Kopplingen eller gruppen har ändrats. Läs in aktuella uppgifter och granska på nytt.', unavailable: 'Resultatet kunde inte bekräftas. Försök igen med samma uppgifter och begäran.' };
  return { ok: false, code, error: messages[code] };
}
function bounded() {
  return async <T>(operation: (signal: AbortSignal) => PromiseLike<T>): Promise<T> => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('Unconfirmed Blocket operation')); }, 15000); })]); }
    finally { if (timer) clearTimeout(timer); }
  };
}
async function fresh(actor: string) {
  const current = await requireBlocketProvisioningContext();
  if (current.userId !== actor) throw { code: 'access_denied' };
}
function refresh() { try { revalidatePath('/admin'); revalidatePath('/advertising'); } catch { /* Durable verified receipt remains valid. */ } }

export async function getPlatformBlocketProvisioningAction(value: unknown): Promise<BlocketProvisioningResult<BlocketProvisioningPage>> {
  let input: ReturnType<typeof parseBlocketProvisioningQuery>; try { input = parseBlocketProvisioningQuery(value); } catch (error) { return failure(error, true); }
  try {
    const run = bounded(), current = await run(() => requireBlocketProvisioningContext());
    const response = await run(signal => current.db.rpc('get_platform_blocket_provisioning', { p_company_id: input.companyId, p_page_key: input.pageKey, p_limit: input.limit }).abortSignal(signal)); if (response.error) throw response.error;
    const page = parseBlocketProvisioningPage(response.data, current.userId, input); await run(() => fresh(current.userId));
    return { ok: true, ...page };
  } catch (error) { return failure(error); }
}
export async function configureBlocketGroupAction(value: unknown): Promise<BlocketProvisioningResult<BlocketGroupReceipt>> {
  let input: ReturnType<typeof parseConfigureBlocketGroupInput>; try { input = parseConfigureBlocketGroupInput(value); } catch (error) { return failure(error, true); }
  try {
    const run = bounded(), current = await run(() => requireBlocketProvisioningContext());
    const response = await run(signal => current.db.rpc('configure_blocket_group', { p_group_id: input.groupId, p_expected_version: input.expectedVersion, p_group_reference: input.groupReference, p_credential_reference: input.credentialReference, p_scope: input.scope, p_status: input.status, p_reason: input.reason, p_acknowledged: true, p_request_id: input.requestId }).abortSignal(signal)); if (response.error) throw response.error;
    const receipt = parseBlocketGroupReceipt(response.data, current.userId, input); await run(() => fresh(current.userId)); refresh(); return { ok: true, ...receipt };
  } catch (error) { return failure(error); }
}
export async function bindBlocketCompanyAction(value: unknown): Promise<BlocketProvisioningResult<BlocketBindingReceipt>> {
  let input: ReturnType<typeof parseBindBlocketCompanyInput>; try { input = parseBindBlocketCompanyInput(value); } catch (error) { return failure(error, true); }
  try {
    const run = bounded(), current = await run(() => requireBlocketProvisioningContext());
    const response = await run(signal => current.db.rpc('bind_blocket_company', { p_company_id: input.companyId, p_group_id: input.groupId, p_expected_group_version: input.expectedGroupVersion, p_expected_connection_version: input.expectedConnectionVersion, p_dealer_code: input.dealerCode, p_evidence_reference: input.evidenceReference, p_valid_until: input.validUntil, p_reason: input.reason, p_acknowledged: true, p_request_id: input.requestId }).abortSignal(signal)); if (response.error) throw response.error;
    const receipt = parseBlocketBindingReceipt(response.data, current.userId, input); await run(() => fresh(current.userId)); refresh(); return { ok: true, ...receipt };
  } catch (error) { return failure(error); }
}
export async function disableBlocketCompanyAction(value: unknown): Promise<BlocketProvisioningResult<BlocketBindingReceipt>> {
  let input: ReturnType<typeof parseDisableBlocketCompanyInput>; try { input = parseDisableBlocketCompanyInput(value); } catch (error) { return failure(error, true); }
  try {
    const run = bounded(), current = await run(() => requireBlocketProvisioningContext());
    const response = await run(signal => current.db.rpc('disable_blocket_company', { p_company_id: input.companyId, p_expected_connection_version: input.expectedConnectionVersion, p_reason: input.reason, p_acknowledged: true, p_request_id: input.requestId }).abortSignal(signal)); if (response.error) throw response.error;
    const receipt = parseBlocketBindingReceipt(response.data, current.userId, input); await run(() => fresh(current.userId)); refresh(); return { ok: true, ...receipt };
  } catch (error) { return failure(error); }
}
