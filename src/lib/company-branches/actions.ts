'use server';

import { revalidatePath } from 'next/cache';
import { requireCompanyBranchesContext } from './context';
import type { CompanyBranchesContext } from './context';
import { parseBranchPage, parseBranchReceipt, parseListBranchesInput, parseSaveBranchInput, parseSetBranchStatusInput } from './validation';
import type { BranchCode, BranchPage, BranchReceipt, BranchResult, ListBranchesInput, SaveBranchInput, SetBranchStatusInput } from './types';

function failure(error: unknown, invalidInput = false): BranchResult<never> {
  const raw = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const code: BranchCode = invalidInput ? 'invalid_input' : raw === 'unauthenticated' ? 'unauthenticated' : raw === 'access_denied' || raw === '42501' ? 'access_denied' : raw === 'conflict' || raw === '40001' || raw === '23505' ? 'conflict' : raw === 'invalid_input' || raw === '22023' ? 'invalid_input' : 'unavailable';
  const messages: Record<BranchCode, string> = {
    unauthenticated: 'Logga in igen för att fortsätta.',
    access_denied: 'Din aktuella behörighet till företagets filialer kunde inte verifieras.',
    invalid_input: 'Kontrollera filialuppgifterna och bekräfta granskningen.',
    conflict: 'Filialen eller begäran har ändrats. Läs in aktuell information och granska igen.',
    unavailable: 'Resultatet kunde inte bekräftas. Försök vid behov igen med samma uppgifter och begäran.',
  };
  return { ok: false, code, message: messages[code] };
}
async function bounded<T>(work: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(() => work(controller.signal)), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Filialuppgifterna kunde inte bekräftas.')); }, 15000); })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function fresh(first: CompanyBranchesContext) {
  const current = await requireCompanyBranchesContext(first.companyId);
  if (current.companyId !== first.companyId || current.userId !== first.userId || current.role !== first.role) throw { code: 'access_denied' };
}
function refresh() { try { revalidatePath('/settings'); } catch { /* A verified durable receipt remains valid when revalidation is unavailable. */ } }

export async function listCompanyBranchesAction(value: unknown): Promise<BranchResult<BranchPage>> {
  let input: Required<ListBranchesInput>; try { input = parseListBranchesInput(value); } catch (error) { return failure(error, true); }
  try {
    const current = await bounded(() => requireCompanyBranchesContext(input.companyId));
    const result = await bounded(signal => current.db.rpc('list_company_branches', { p_company_id: input.companyId, p_status: input.status, p_page_key: input.pageKey ?? null, p_limit: input.limit ?? 50 }).abortSignal(signal));
    if (result.error) throw result.error;
    const page = parseBranchPage(result.data, current, input);
    await bounded(() => fresh(current)); return { ok: true, ...page };
  } catch (error) { return failure(error); }
}

/** Never preflight a mutable branch: SQL must return authorized historical receipts first. */
export async function saveCompanyBranchAction(value: unknown): Promise<BranchResult<{ receipt: BranchReceipt }>> {
  let input: SaveBranchInput; try { input = parseSaveBranchInput(value); } catch (error) { return failure(error, true); }
  try {
    const current = await bounded(() => requireCompanyBranchesContext(input.companyId));
    const result = await bounded(signal => current.db.rpc('save_company_branch', { p_company_id: input.companyId, p_branch_id: input.branchId, p_expected_version: input.expectedVersion, p_fields: input.fields, p_acknowledged: true, p_request_id: input.requestId }).abortSignal(signal));
    if (result.error) throw result.error;
    const receipt = parseBranchReceipt(result.data, current, input, 'save');
    await bounded(() => fresh(current)); refresh(); return { ok: true, receipt };
  } catch (error) { return failure(error); }
}

export async function setCompanyBranchStatusAction(value: unknown): Promise<BranchResult<{ receipt: BranchReceipt }>> {
  let input: SetBranchStatusInput; try { input = parseSetBranchStatusInput(value); } catch (error) { return failure(error, true); }
  try {
    const current = await bounded(() => requireCompanyBranchesContext(input.companyId));
    const result = await bounded(signal => current.db.rpc('set_company_branch_status', { p_company_id: input.companyId, p_branch_id: input.branchId, p_expected_version: input.expectedVersion, p_status: input.status, p_reason: input.reason, p_acknowledged: true, p_request_id: input.requestId }).abortSignal(signal));
    if (result.error) throw result.error;
    const receipt = parseBranchReceipt(result.data, current, input, 'status');
    await bounded(() => fresh(current)); refresh(); return { ok: true, receipt };
  } catch (error) { return failure(error); }
}
