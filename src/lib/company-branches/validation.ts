import type { BranchCode, BranchFields, BranchPage, BranchReceipt, BranchRole, BranchStatus, CompanyBranch, ListBranchesInput, SaveBranchInput, SetBranchStatusInput } from './types';

export class BranchError extends Error { constructor(readonly code: BranchCode) { super('Filialuppgifterna kunde inte verifieras.'); } }
type Scope = { companyId: string; userId: string; role: BranchRole };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid(): never { throw new BranchError('invalid_input'); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(); return value as Record<string, unknown>; }
function keys(row: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some(k => !Object.hasOwn(row, k)) || Object.keys(row).some(k => !required.includes(k) && !optional.includes(k))) invalid();
}
function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) return invalid(); return value.toLowerCase(); }
function integer(value: unknown, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) return invalid(); return value; }
function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string' || value !== value.trim() || [...value].length < min || [...value].length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return invalid();
  return value;
}
function status(value: unknown): BranchStatus { if (value !== 'active' && value !== 'archived') return invalid(); return value; }
function fields(value: unknown): BranchFields {
  const row = object(value); keys(row, ['code', 'name', 'addressLine1', 'postalCode', 'city', 'publicEmail', 'publicPhone']);
  const code = text(row.code, 1, 24), name = text(row.name, 2, 120), addressLine1 = text(row.addressLine1, 2, 160), postalCode = text(row.postalCode, 5, 5), city = text(row.city, 2, 100);
  const publicEmail = row.publicEmail === null ? null : text(row.publicEmail, 3, 254), publicPhone = row.publicPhone === null ? null : text(row.publicPhone, 7, 40);
  if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(code) || !/^[0-9]{5}$/.test(postalCode) || publicEmail !== null && (publicEmail !== publicEmail.toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(publicEmail)) || publicPhone !== null && (!/^\+?[0-9 ()-]+$/.test(publicPhone) || publicPhone.replace(/[^0-9]/g, '').length < 7 || publicPhone.replace(/[^0-9]/g, '').length > 15)) invalid();
  return { code, name, addressLine1, postalCode, city, publicEmail, publicPhone };
}
function date(value: unknown): string { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(value) || !Number.isFinite(Date.parse(value))) return invalid(); return value; }
function branch(value: unknown, companyId: string): CompanyBranch {
  const row = object(value); keys(row, ['id', 'companyId', 'version', 'status', 'fields', 'createdAt', 'updatedAt']);
  const result = { id: uuid(row.id), companyId: uuid(row.companyId), version: integer(row.version), status: status(row.status), fields: fields(row.fields), createdAt: date(row.createdAt), updatedAt: date(row.updatedAt) };
  if (result.companyId !== companyId || Date.parse(result.updatedAt) < Date.parse(result.createdAt)) invalid();
  return result;
}
function output<T>(work: () => T): T { try { return work(); } catch { throw new BranchError('unavailable'); } }
export function parseListBranchesInput(value: unknown): Required<ListBranchesInput> {
  const row = object(value); keys(row, ['companyId', 'status'], ['pageKey', 'limit']);
  return { companyId: uuid(row.companyId), status: status(row.status), pageKey: row.pageKey == null ? null : uuid(row.pageKey), limit: integer(row.limit ?? 50, 1, 50) };
}
export function parseSaveBranchInput(value: unknown): SaveBranchInput {
  const row = object(value); keys(row, ['companyId', 'branchId', 'expectedVersion', 'fields', 'acknowledged', 'requestId']);
  if (row.acknowledged !== true) invalid();
  return { companyId: uuid(row.companyId), branchId: uuid(row.branchId), expectedVersion: integer(row.expectedVersion, 0, Number.MAX_SAFE_INTEGER - 1), fields: fields(row.fields), acknowledged: true, requestId: uuid(row.requestId) };
}
export function parseSetBranchStatusInput(value: unknown): SetBranchStatusInput {
  const row = object(value); keys(row, ['companyId', 'branchId', 'expectedVersion', 'status', 'reason', 'acknowledged', 'requestId']);
  if (row.acknowledged !== true) invalid();
  return { companyId: uuid(row.companyId), branchId: uuid(row.branchId), expectedVersion: integer(row.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1), status: status(row.status), reason: text(row.reason, 1, 500), acknowledged: true, requestId: uuid(row.requestId) };
}
export function parseBranchPage(value: unknown, context: Scope, input: Required<ListBranchesInput>): BranchPage {
  return output(() => {
    const row = object(value); keys(row, ['companyId', 'actorUserId', 'actorRole', 'branches', 'nextPageKey', 'status', 'legalName', 'organisationNumber']);
    const companyId = uuid(row.companyId), actorUserId = uuid(row.actorUserId), currentStatus = status(row.status);
    if (companyId !== context.companyId || companyId !== input.companyId || actorUserId !== context.userId || row.actorRole !== context.role || currentStatus !== input.status || !Array.isArray(row.branches) || row.branches.length > input.limit) invalid();
    const branches = row.branches.map(v => branch(v, companyId));
    let previous = input.pageKey;
    for (const item of branches) { if (item.status !== currentStatus || previous !== null && item.id <= previous) invalid(); previous = item.id; }
    const nextPageKey = row.nextPageKey === null ? null : uuid(row.nextPageKey);
    if (nextPageKey !== null && (branches.length !== input.limit || nextPageKey !== branches.at(-1)?.id)) invalid();
    return { companyId, actorUserId, actorRole: context.role, status: currentStatus, branches, nextPageKey, legalName: text(row.legalName, 1, 500), organisationNumber: text(row.organisationNumber, 1, 100) };
  });
}
export function parseBranchReceipt(value: unknown, context: Scope, input: SaveBranchInput | SetBranchStatusInput, action: 'save' | 'status'): BranchReceipt {
  return output(() => {
    const row = object(value); keys(row, ['companyId', 'actorUserId', 'requestId', 'action', 'branch']);
    const companyId = uuid(row.companyId), actorUserId = uuid(row.actorUserId), requestId = uuid(row.requestId), current = branch(row.branch, companyId);
    if (companyId !== context.companyId || companyId !== input.companyId || actorUserId !== context.userId || requestId !== input.requestId || row.action !== action || current.id !== input.branchId || current.version !== input.expectedVersion + 1) invalid();
    if (action === 'save') {
      if (!('fields' in input) || current.status !== 'active' || (Object.keys(input.fields) as (keyof BranchFields)[]).some(k => current.fields[k] !== input.fields[k])) invalid();
    } else if (!('status' in input) || current.status !== input.status) invalid();
    return { companyId, actorUserId, requestId, action, branch: current };
  });
}
