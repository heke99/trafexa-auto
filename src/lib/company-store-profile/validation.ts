import { createHash } from 'node:crypto';
import { normalizeApplicationOrganisationNumber } from '../web-applications/validation';
import { COMPANY_STORE_ATTESTATION_VERSION } from './types';
import type { CompanyStoreChannel, CompanyStoreExport, CompanyStoreExportPage, CompanyStoreExportReceipt, CompanyStoreExportSummary, CompanyStoreFields, CompanyStoreProfile, CompanyStoreProfilePage, CompanyStoreProfileReceipt, CompanyStorePurpose, CompanyStoreRole, CompanyStoreSourceSnapshot, CreateCompanyWithProfileInput, GetCompanyStoreExportInput, GetCompanyStoreProfileInput, PrepareCompanyStoreExportInput, SaveCompanyStoreProfileInput } from './types';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/;
const MULTILINE_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const FIELD_KEYS = ['displayName', 'addressLine1', 'addressLine2', 'postalCode', 'city', 'countryCode', 'publicEmail', 'publicPhone', 'websiteUrl', 'logoUrl', 'description', 'openingHoursText'];
const SOURCE_KEYS = ['schemaVersion', 'companyId', 'profileId', 'profileVersion', 'legalName', 'organisationNumber', 'shop'];
const SUMMARY_KEYS = ['id', 'companyId', 'channel', 'purpose', 'profileId', 'profileVersion', 'sourceSha256', 'exportSha256', 'createdAt', 'actorLabel', 'status', 'attestationVersion'];
export type CompanyStoreExpectedScope = { companyId: string; userId: string; role: CompanyStoreRole };
function invalid(): never { throw new Error('Butiksuppgifterna kunde inte verifieras.'); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || Object.keys(result).some(key => !keys.includes(key))) return invalid();
  return result;
}
export function companyStoreUuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) return invalid(); return value.toLowerCase(); }
function hash(value: unknown): string { if (typeof value !== 'string' || !HASH.test(value)) return invalid(); return value; }
function version(value: unknown, allowZero = false): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 2147483647) return invalid(); return value; }
function text(value: unknown, min: number, max: number, normalize = false, multiline = false): string {
  if (typeof value !== 'string' || value.length > max * 2 + 256 || (multiline ? MULTILINE_CONTROLS : CONTROLS).test(value)) return invalid();
  const result = normalize ? value.trim() : value, chars = Array.from(result);
  if (result !== result.trim() || chars.length < min || chars.length > max || chars.some(char => { const n = char.codePointAt(0)!; return n >= 0xd800 && n <= 0xdfff; })) return invalid();
  return result;
}
function nullable(value: unknown, max: number, normalize: boolean, multiline = false): string | null {
  if (value === null || normalize && typeof value === 'string' && value.trim() === '') return null;
  return text(value, 1, max, normalize, multiline);
}
/** A syntactic public DNS URL. It is never fetched and proves no domain ownership. */
export function normalizeCompanyStoreUrl(value: unknown): string {
  const clean = text(value, 1, 2048, true);
  if (!/^https:\/\//i.test(clean) || /[\s\\?#]/u.test(clean)) return invalid();
  const authority = /^https:\/\/([^/]+)/i.exec(clean)?.[1];
  if (!authority || /[:@%]/.test(authority)) return invalid();
  let url: URL; try { url = new URL(clean); } catch { return invalid(); }
  const host = url.hostname, labels = host.split('.');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || host.length > 253 || labels.length < 2
    || labels.some(label => label.startsWith('xn--') || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || /^\d+$/.test(labels.at(-1)!)
    || /(?:^|\.)(?:localhost|local|internal|test|example|invalid|onion)$/.test(host) || /(?:^|\.)home\.arpa$/.test(host)
    || /(?:^|\.)example\.(?:com|net|org)$/.test(host)
    || /[^\x21-\x7e]|["<>`{}]|%(?![a-f0-9]{2})|%(?:0[a-f0-9]|1[a-f0-9]|7f|5c)/i.test(url.pathname)) return invalid();
  if (url.href.length > 2048) return invalid();
  return url.href;
}
export function parseCompanyStoreFields(value: unknown, normalize = false): CompanyStoreFields {
  const row = record(value, FIELD_KEYS);
  const email = text(row.publicEmail, 3, 254, normalize), publicEmail = text(normalize ? email.toLowerCase() : email, 3, 254);
  const publicPhone = text(row.publicPhone, 7, 40, normalize), postalCode = text(row.postalCode, 5, 5, normalize);
  if (publicEmail !== publicEmail.toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(publicEmail) || !/^\+?[0-9 ()-]+$/.test(publicPhone) || !/^[0-9]{5}$/.test(postalCode) || publicPhone.replace(/\D/g, '').length < 7 || publicPhone.replace(/\D/g, '').length > 15 || row.countryCode !== 'SE') return invalid();
  const url = (value: unknown) => { const candidate = nullable(value, 2048, normalize); if (candidate === null) return null; const canonical = normalizeCompanyStoreUrl(candidate); if (!normalize && canonical !== candidate) return invalid(); return canonical; };
  return { displayName: text(row.displayName, 2, 160, normalize), addressLine1: text(row.addressLine1, 2, 160, normalize), addressLine2: nullable(row.addressLine2, 160, normalize), postalCode, city: text(row.city, 2, 100, normalize), countryCode: 'SE', publicEmail, publicPhone, websiteUrl: url(row.websiteUrl), logoUrl: url(row.logoUrl), description: nullable(row.description, 5000, normalize, true), openingHoursText: nullable(row.openingHoursText, 2000, normalize, true) };
}
function channel(value: unknown): CompanyStoreChannel { if (value !== 'blocket' && value !== 'wayke') return invalid(); return value; }
function purpose(value: unknown): CompanyStorePurpose { if (value !== 'new_store' && value !== 'existing_store') return invalid(); return value; }
function attestation(value: unknown): typeof COMPANY_STORE_ATTESTATION_VERSION { if (value !== COMPANY_STORE_ATTESTATION_VERSION) return invalid(); return value; }
function instant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return invalid();
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`); if (day.toISOString().slice(0, 10) !== value.slice(0, 10)) return invalid(); return value;
}
function actorLabel(value: unknown): 'Du' | 'Kollega' { if (value !== 'Du' && value !== 'Kollega') return invalid(); return value; }
function organisationNumber(value: unknown): string { if (typeof value !== 'string' || !/^\d{10}$/.test(value)) return invalid(); return value; }
export function companyStoreIdentityValid(value: string): boolean { try { return normalizeApplicationOrganisationNumber(value) === value; } catch { return false; } }
export function sameCompanyStoreValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => sameCompanyStoreValue(value, b[i]));
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>, keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameCompanyStoreValue(left[key], right[key]));
}
export function parseGetCompanyStoreProfileInput(value: unknown): GetCompanyStoreProfileInput { const row = record(value, ['companyId']); return { companyId: companyStoreUuid(row.companyId) }; }
export function parseGetCompanyStoreExportInput(value: unknown): GetCompanyStoreExportInput { const row = record(value, ['companyId', 'exportId']); return { companyId: companyStoreUuid(row.companyId), exportId: companyStoreUuid(row.exportId) }; }
export function parseCreateCompanyWithProfileInput(value: unknown): CreateCompanyWithProfileInput {
  const row = record(value, ['legalName', 'organisationNumber', 'fields', 'representationAcknowledged', 'requestId']); if (row.representationAcknowledged !== true) return invalid();
  return { legalName: text(row.legalName, 2, 160, true), organisationNumber: normalizeApplicationOrganisationNumber(text(row.organisationNumber, 10, 30, true)), fields: parseCompanyStoreFields(row.fields, true), representationAcknowledged: true, requestId: companyStoreUuid(row.requestId) };
}
export function parseSaveCompanyStoreProfileInput(value: unknown): SaveCompanyStoreProfileInput {
  const row = record(value, ['companyId', 'expectedVersion', 'fields', 'reviewAcknowledged', 'requestId']); if (row.reviewAcknowledged !== true) return invalid();
  return { companyId: companyStoreUuid(row.companyId), expectedVersion: version(row.expectedVersion, true), fields: parseCompanyStoreFields(row.fields, true), reviewAcknowledged: true, requestId: companyStoreUuid(row.requestId) };
}
export function parsePrepareCompanyStoreExportInput(value: unknown): PrepareCompanyStoreExportInput {
  const row = record(value, ['companyId', 'expectedVersion', 'expectedSourceSha256', 'channel', 'purpose', 'reviewAcknowledged', 'attestationVersion', 'requestId']); if (row.reviewAcknowledged !== true) return invalid();
  return { companyId: companyStoreUuid(row.companyId), expectedVersion: version(row.expectedVersion), expectedSourceSha256: hash(row.expectedSourceSha256), channel: channel(row.channel), purpose: purpose(row.purpose), reviewAcknowledged: true, attestationVersion: attestation(row.attestationVersion), requestId: companyStoreUuid(row.requestId) };
}
function scope(row: Record<string, unknown>, expected: CompanyStoreExpectedScope) { if (companyStoreUuid(row.actorId) !== expected.userId || companyStoreUuid(row.companyId) !== expected.companyId || row.role !== expected.role || row.role !== 'owner' && row.role !== 'admin') return invalid(); }
export function parseCompanyStoreProfile(value: unknown, companyId: string): CompanyStoreProfile {
  const row = record(value, ['id', 'companyId', 'version', 'fields', 'createdAt', 'actorLabel']); if (companyStoreUuid(row.companyId) !== companyId) return invalid();
  return { id: companyStoreUuid(row.id), companyId, version: version(row.version), fields: parseCompanyStoreFields(row.fields), createdAt: instant(row.createdAt), actorLabel: actorLabel(row.actorLabel) };
}
export function parseCompanyStoreSource(value: unknown, companyId: string): CompanyStoreSourceSnapshot {
  const row = record(value, SOURCE_KEYS); if (row.schemaVersion !== 1 || companyStoreUuid(row.companyId) !== companyId) return invalid();
  return { schemaVersion: 1, companyId, profileId: companyStoreUuid(row.profileId), profileVersion: version(row.profileVersion), legalName: text(row.legalName, 2, 160), organisationNumber: organisationNumber(row.organisationNumber), shop: parseCompanyStoreFields(row.shop) };
}
function matchesProfile(source: CompanyStoreSourceSnapshot, profile: CompanyStoreProfile) { if (source.profileId !== profile.id || source.profileVersion !== profile.version || !sameCompanyStoreValue(source.shop, profile.fields)) return invalid(); }
export function parseCompanyStoreExportSummary(value: unknown, companyId: string): CompanyStoreExportSummary {
  const row = record(value, SUMMARY_KEYS); if (companyStoreUuid(row.companyId) !== companyId || row.status !== 'prepared') return invalid();
  return { id: companyStoreUuid(row.id), companyId, channel: channel(row.channel), purpose: purpose(row.purpose), profileId: companyStoreUuid(row.profileId), profileVersion: version(row.profileVersion), sourceSha256: hash(row.sourceSha256), exportSha256: hash(row.exportSha256), createdAt: instant(row.createdAt), actorLabel: actorLabel(row.actorLabel), status: 'prepared', attestationVersion: attestation(row.attestationVersion) };
}
export function parseCompanyStoreExport(value: unknown, companyId: string): CompanyStoreExport {
  const row = record(value, [...SUMMARY_KEYS, 'snapshot', 'canonicalContent']);
  const summary = parseCompanyStoreExportSummary(Object.fromEntries(SUMMARY_KEYS.map(key => [key, row[key]])), companyId), snapshot = parseCompanyStoreSource(row.snapshot, companyId);
  if (!companyStoreIdentityValid(snapshot.organisationNumber) || snapshot.profileId !== summary.profileId || snapshot.profileVersion !== summary.profileVersion || typeof row.canonicalContent !== 'string' || Buffer.byteLength(row.canonicalContent, 'utf8') > 65536 || createHash('sha256').update(row.canonicalContent, 'utf8').digest('hex') !== summary.exportSha256) return invalid();
  let parsed: unknown; try { parsed = JSON.parse(row.canonicalContent); } catch { return invalid(); }
  const body = record(parsed, ['schemaVersion', 'kind', 'channel', 'purpose', 'profile']);
  if (body.schemaVersion !== 1 || body.kind !== 'trafexa_store_profile' || body.channel !== summary.channel || body.purpose !== summary.purpose || !sameCompanyStoreValue(body.profile, snapshot)) return invalid();
  return { ...summary, snapshot, canonicalContent: row.canonicalContent };
}
export function parseCompanyStoreProfilePage(value: unknown, expected: CompanyStoreExpectedScope): CompanyStoreProfilePage {
  const row = record(value, ['actorId', 'role', 'companyId', 'legalName', 'organisationNumber', 'identityValid', 'profile', 'source', 'sourceSha256', 'canExport', 'reason', 'exports']); scope(row, expected);
  const legalName = text(row.legalName, 2, 160), org = organisationNumber(row.organisationNumber), identityValid = companyStoreIdentityValid(org);
  const profile = row.profile === null ? null : parseCompanyStoreProfile(row.profile, expected.companyId), source = row.source === null ? null : parseCompanyStoreSource(row.source, expected.companyId), sourceSha256 = row.sourceSha256 === null ? null : hash(row.sourceSha256);
  const reason = !profile ? 'profile_missing' : !identityValid ? 'invalid_organisation_number' : null;
  if (row.identityValid !== identityValid || row.reason !== reason || row.canExport !== (profile !== null && identityValid) || Boolean(profile) !== Boolean(source) || Boolean(profile) !== Boolean(sourceSha256)) return invalid();
  if (source && profile) { matchesProfile(source, profile); if (source.legalName !== legalName || source.organisationNumber !== org) return invalid(); }
  if (!Array.isArray(row.exports) || row.exports.length > 20) return invalid();
  const exports = row.exports.map(item => parseCompanyStoreExportSummary(item, expected.companyId));
  if (new Set(exports.map(item => item.id)).size !== exports.length || exports.some((item, i) => i > 0 && Date.parse(item.createdAt) > Date.parse(exports[i - 1].createdAt))) return invalid();
  return { actorId: expected.userId, role: expected.role, companyId: expected.companyId, legalName, organisationNumber: org, identityValid, profile, source, sourceSha256, canExport: profile !== null && identityValid, reason, exports };
}
export function parseCompanyStoreProfileReceipt(value: unknown, expected: CompanyStoreExpectedScope, input: CreateCompanyWithProfileInput | SaveCompanyStoreProfileInput): CompanyStoreProfileReceipt {
  const row = record(value, ['actorId', 'role', 'companyId', 'requestId', 'profile', 'source', 'sourceSha256']); scope(row, expected);
  const profile = parseCompanyStoreProfile(row.profile, expected.companyId), source = parseCompanyStoreSource(row.source, expected.companyId); matchesProfile(source, profile);
  if (companyStoreUuid(row.requestId) !== input.requestId || profile.actorLabel !== 'Du' || !sameCompanyStoreValue(profile.fields, input.fields) || profile.version !== ('expectedVersion' in input ? input.expectedVersion + 1 : 1)) return invalid();
  if ('legalName' in input && (source.legalName !== input.legalName || source.organisationNumber !== input.organisationNumber)) return invalid();
  return { actorId: expected.userId, role: expected.role, companyId: expected.companyId, requestId: input.requestId, profile, source, sourceSha256: hash(row.sourceSha256) };
}
export function parseCompanyStoreExportPage(value: unknown, expected: CompanyStoreExpectedScope, exportId: string): CompanyStoreExportPage {
  const row = record(value, ['actorId', 'role', 'companyId', 'export']); scope(row, expected); const result = parseCompanyStoreExport(row.export, expected.companyId); if (result.id !== exportId) return invalid(); return { actorId: expected.userId, role: expected.role, companyId: expected.companyId, export: result };
}
export function parseCompanyStoreExportReceipt(value: unknown, expected: CompanyStoreExpectedScope, input: PrepareCompanyStoreExportInput): CompanyStoreExportReceipt {
  const row = record(value, ['actorId', 'role', 'companyId', 'requestId', 'export']); scope(row, expected); const result = parseCompanyStoreExport(row.export, expected.companyId);
  if (companyStoreUuid(row.requestId) !== input.requestId || result.profileVersion !== input.expectedVersion || result.sourceSha256 !== input.expectedSourceSha256 || result.channel !== input.channel || result.purpose !== input.purpose || result.actorLabel !== 'Du' || result.attestationVersion !== input.attestationVersion) return invalid();
  return { actorId: expected.userId, role: expected.role, companyId: expected.companyId, requestId: input.requestId, export: result };
}
