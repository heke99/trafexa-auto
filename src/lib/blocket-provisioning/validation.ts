import type { BindBlocketCompanyInput, BlocketBinding, BlocketBindingReceipt, BlocketGroup, BlocketGroupReceipt, BlocketProvisioningPage, ConfigureBlocketGroupInput, DisableBlocketCompanyInput } from './types';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/;
export function invalidBlocketValue(): never { throw new Error('Blocketunderlaget kunde inte verifieras.'); }
function record(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalidBlocketValue();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) return invalidBlocketValue();
  return row;
}
export function blocketUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) return invalidBlocketValue();
  return value.toLowerCase();
}
function version(value: unknown, zero = false): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < (zero ? 0 : 1) || value > 2147483647) return invalidBlocketValue();
  return value;
}
function text(value: unknown, max: number, normalize = false): string {
  if (typeof value !== 'string' || value.length > max * 2 || CONTROLS.test(value)) return invalidBlocketValue();
  const clean = normalize ? value.trim() : value;
  if (clean !== clean.trim() || Array.from(clean).length < 1 || Array.from(clean).length > max || /[\ud800-\udfff]/u.test(clean)) return invalidBlocketValue();
  return clean;
}
function credential(value: unknown, normalize = false): string {
  const label = text(value, 100, normalize);
  if (!/^[a-z0-9_-]{1,100}$/.test(label)) return invalidBlocketValue();
  return label;
}
export function blocketInstant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return invalidBlocketValue();
  if (new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) return invalidBlocketValue();
  return value;
}
function scope(value: unknown): BlocketGroup['scope'] { if (value !== 'dealer_group' && value !== 'dealer_code') return invalidBlocketValue(); return value; }
function status(value: unknown): BlocketGroup['status'] { if (value !== 'active' && value !== 'disabled') return invalidBlocketValue(); return value; }
export function parseConfigureBlocketGroupInput(value: unknown): ConfigureBlocketGroupInput {
  const row = record(value, ['groupId', 'expectedVersion', 'groupReference', 'credentialReference', 'scope', 'status', 'reason', 'acknowledged', 'requestId']);
  if (row.acknowledged !== true) return invalidBlocketValue();
  return { groupId: blocketUuid(row.groupId), expectedVersion: version(row.expectedVersion, true), groupReference: text(row.groupReference, 160, true), credentialReference: credential(row.credentialReference, true), scope: scope(row.scope), status: status(row.status), reason: text(row.reason, 500, true), acknowledged: true, requestId: blocketUuid(row.requestId) };
}
export function parseBindBlocketCompanyInput(value: unknown): BindBlocketCompanyInput {
  const row = record(value, ['companyId', 'groupId', 'expectedGroupVersion', 'expectedConnectionVersion', 'dealerCode', 'evidenceReference', 'validUntil', 'reason', 'acknowledged', 'requestId']);
  if (row.acknowledged !== true) return invalidBlocketValue();
  // Mutable date bounds belong to NEW SQL mutations, after historical replay.
  return { companyId: blocketUuid(row.companyId), groupId: blocketUuid(row.groupId), expectedGroupVersion: version(row.expectedGroupVersion), expectedConnectionVersion: version(row.expectedConnectionVersion, true), dealerCode: text(row.dealerCode, 160, true), evidenceReference: text(row.evidenceReference, 500, true), validUntil: blocketInstant(row.validUntil), reason: text(row.reason, 500, true), acknowledged: true, requestId: blocketUuid(row.requestId) };
}
export function parseDisableBlocketCompanyInput(value: unknown): DisableBlocketCompanyInput {
  const row = record(value, ['companyId', 'expectedConnectionVersion', 'reason', 'acknowledged', 'requestId']);
  if (row.acknowledged !== true) return invalidBlocketValue();
  return { companyId: blocketUuid(row.companyId), expectedConnectionVersion: version(row.expectedConnectionVersion), reason: text(row.reason, 500, true), acknowledged: true, requestId: blocketUuid(row.requestId) };
}
export function parseBlocketProvisioningQuery(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalidBlocketValue();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['companyId', 'pageKey', 'limit'].includes(key))) return invalidBlocketValue();
  const limit = row.limit ?? 50;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) return invalidBlocketValue();
  return { companyId: blocketUuid(row.companyId), pageKey: row.pageKey == null ? null : blocketUuid(row.pageKey), limit };
}
export function parseBlocketGroup(value: unknown): BlocketGroup {
  const row = record(value, ['id', 'version', 'groupReference', 'credentialReference', 'scope', 'status', 'updatedAt']);
  return { id: blocketUuid(row.id), version: version(row.version), groupReference: text(row.groupReference, 160), credentialReference: credential(row.credentialReference), scope: scope(row.scope), status: status(row.status), updatedAt: blocketInstant(row.updatedAt) };
}
export function parseBlocketBinding(value: unknown, companyId: string): BlocketBinding {
  const row = record(value, ['companyId', 'connectionId', 'connectionVersion', 'groupId', 'groupVersion', 'dealerCode', 'evidenceReference', 'validUntil', 'status']);
  if (blocketUuid(row.companyId) !== companyId || row.status !== 'verified' && row.status !== 'disabled') return invalidBlocketValue();
  return { companyId, connectionId: blocketUuid(row.connectionId), connectionVersion: version(row.connectionVersion), groupId: blocketUuid(row.groupId), groupVersion: version(row.groupVersion), dealerCode: text(row.dealerCode, 160), evidenceReference: text(row.evidenceReference, 500), validUntil: blocketInstant(row.validUntil), status: row.status };
}
export function parseBlocketProvisioningPage(value: unknown, actor: string, input: ReturnType<typeof parseBlocketProvisioningQuery>): BlocketProvisioningPage {
  const row = record(value, ['companyId', 'legalName', 'organisationNumber', 'actorUserId', 'groups', 'nextPageKey', 'connectionVersion', 'binding']);
  if (blocketUuid(row.companyId) !== input.companyId || blocketUuid(row.actorUserId) !== actor || typeof row.organisationNumber !== 'string' || !/^\d{10}$/.test(row.organisationNumber) || !Array.isArray(row.groups) || row.groups.length > input.limit) return invalidBlocketValue();
  const groups = row.groups.map(parseBlocketGroup), nextPageKey = row.nextPageKey === null ? null : blocketUuid(row.nextPageKey);
  if (groups.some((group, index) => group.id <= (index ? groups[index - 1].id : input.pageKey ?? '')) || nextPageKey !== null && (groups.length !== input.limit || nextPageKey !== groups.at(-1)?.id)) return invalidBlocketValue();
  const connectionVersion = version(row.connectionVersion, true), binding = row.binding === null ? null : parseBlocketBinding(row.binding, input.companyId);
  if (binding && (binding.connectionVersion > connectionVersion || binding.connectionVersion !== connectionVersion && binding.status !== 'disabled')) return invalidBlocketValue();
  return { companyId: input.companyId, actorUserId: actor, legalName: text(row.legalName, 160), organisationNumber: row.organisationNumber, groups, nextPageKey, connectionVersion, binding };
}
export function parseBlocketGroupReceipt(value: unknown, actor: string, input: ConfigureBlocketGroupInput): BlocketGroupReceipt {
  const row = record(value, ['actorUserId', 'requestId', 'group']);
  const group = parseBlocketGroup(row.group);
  if (blocketUuid(row.actorUserId) !== actor || blocketUuid(row.requestId) !== input.requestId || group.id !== input.groupId || group.version !== input.expectedVersion + 1 || group.groupReference !== input.groupReference || group.credentialReference !== input.credentialReference || group.scope !== input.scope || group.status !== input.status) return invalidBlocketValue();
  return { actorUserId: actor, requestId: input.requestId, group };
}
export function parseBlocketBindingReceipt(value: unknown, actor: string, input: BindBlocketCompanyInput | DisableBlocketCompanyInput): BlocketBindingReceipt {
  const row = record(value, ['actorUserId', 'requestId', 'companyId', 'binding']), binding = parseBlocketBinding(row.binding, input.companyId);
  if (blocketUuid(row.actorUserId) !== actor || blocketUuid(row.requestId) !== input.requestId || blocketUuid(row.companyId) !== input.companyId || binding.connectionVersion !== input.expectedConnectionVersion + 1) return invalidBlocketValue();
  if ('groupId' in input ? binding.status !== 'verified' || binding.groupId !== input.groupId || binding.groupVersion !== input.expectedGroupVersion || binding.dealerCode !== input.dealerCode || binding.evidenceReference !== input.evidenceReference || Date.parse(binding.validUntil) !== Date.parse(input.validUntil) : binding.status !== 'disabled') return invalidBlocketValue();
  return { actorUserId: actor, requestId: input.requestId, companyId: input.companyId, binding };
}
