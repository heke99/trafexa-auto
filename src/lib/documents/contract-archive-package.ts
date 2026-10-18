import { z } from 'zod';
import { parseCompletedContract, sha256 } from './signed-contract-pdf.ts';
import { parseContractArchive, assertContractArchiveSource, verifyContractArchiveFiles, MAX_CONTRACT_PDF_BYTES, MAX_CONTRACT_EVIDENCE_BYTES } from './native-contract-archive.ts';
import type { ContractArchive } from '../contracts/archive-types.ts';

export const MAX_CONTRACT_ARCHIVE_PACKAGE_BYTES = 54 * 1024 * 1024;
export const MAX_CONTRACT_ARCHIVE_MANIFEST_BYTES = 2 * 1024 * 1024;
export class ContractArchivePackageError extends Error {
  constructor() { super('Avtalets säkerhetskopia kunde inte verifieras.'); this.name = 'ContractArchivePackageError'; }
}
type Source = ReturnType<typeof parseCompletedContract>;
export type ContractArchivePackageManifest = {
  format: 'trafexa-contract-archive'; schemaVersion: 1; archive: ContractArchive; source: Source;
};
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const names = ['manifest.json', 'original.pdf', 'evidence.json'] as const;
const limits = [MAX_CONTRACT_ARCHIVE_MANIFEST_BYTES, MAX_CONTRACT_PDF_BYTES, MAX_CONTRACT_EVIDENCE_BYTES];
const block = 512;
const padded = (size: number) => Math.ceil(size / block) * block;
const fail = (): never => { throw new ContractArchivePackageError(); };
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a), right = Object.keys(b);
  return left.length === right.length && left.every(key => Object.hasOwn(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
function bytesEqual(a: Uint8Array, b: Uint8Array) { return a.length === b.length && a.every((value, i) => value === b[i]); }
function octal(value: number, width: number) {
  const text = value.toString(8);
  if (!Number.isSafeInteger(value) || value < 0 || text.length >= width) return fail();
  return text.padStart(width - 1, '0') + '\0';
}
/** Deterministic POSIX USTAR: regular files, no owner names, links, extensions or paths. */
function header(name: string, size: number) {
  const result = new Uint8Array(block);
  const put = (offset: number, value: string) => result.set(encoder.encode(value), offset);
  put(0, name); put(100, octal(0o600, 8)); put(108, octal(0, 8)); put(116, octal(0, 8));
  put(124, octal(size, 12)); put(136, octal(0, 12)); result.fill(32, 148, 156);
  put(156, '0'); put(257, 'ustar\0'); put(263, '00'); put(329, octal(0, 8)); put(337, octal(0, 8));
  const sum = result.reduce((total, value) => total + value, 0);
  put(148, sum.toString(8).padStart(6, '0') + '\0 ');
  return result;
}
function manifest(value: unknown, canonical: boolean): ContractArchivePackageManifest {
  const raw = z.object({ format: z.literal('trafexa-contract-archive'), schemaVersion: z.literal(1), archive: z.unknown(), source: z.unknown() }).strict().parse(value);
  const archive = parseContractArchive(raw.archive), source = parseCompletedContract(raw.source);
  assertContractArchiveSource(archive, source);
  if (source.revision !== 3 || canonical && (!equal(raw.archive, archive) || !equal(raw.source, source))) return fail();
  return { format: raw.format, schemaVersion: raw.schemaVersion, archive, source };
}
/** Bound UTF-8 serialization incrementally, including large valid signature arrays. */
function boundedJson(value: unknown) {
  const chunks: string[] = [];
  let length = 0;
  function append(text: string) {
    if (text.length > MAX_CONTRACT_ARCHIVE_MANIFEST_BYTES - length) return fail();
    length += encoder.encode(text).length;
    if (length > MAX_CONTRACT_ARCHIVE_MANIFEST_BYTES) return fail();
    chunks.push(text);
  }
  function visit(item: unknown) {
    if (Array.isArray(item)) {
      append('['); item.forEach((entry, index) => { if (index) append(','); visit(entry === undefined ? null : entry); }); append(']');
    } else if (item && typeof item === 'object') {
      append('{'); const entries = Object.entries(item).filter(([, entry]) => entry !== undefined);
      entries.forEach(([key, entry], index) => { if (index) append(','); append(JSON.stringify(key)); append(':'); visit(entry); }); append('}');
    } else { const text = JSON.stringify(item); if (text === undefined) return fail(); append(text); }
  }
  visit(value);
  return encoder.encode(chunks.join(''));
}
/** A portable byte-exact backup. Its hash must be retained outside the package. */
export function createContractArchivePackage(input: { archive: unknown; source: unknown; pdf: Uint8Array; evidence: Uint8Array }) {
  try {
    // Preflight untrusted metadata before schema parsers allocate nested source copies.
    boundedJson({ archive: input.archive, source: input.source });
    const m = manifest({ format: 'trafexa-contract-archive', schemaVersion: 1, archive: input.archive, source: input.source }, false);
    // Validate bounded original byte views before allocating the package or copies.
    if (!(input.pdf instanceof Uint8Array) || !(input.evidence instanceof Uint8Array)
      || input.pdf.length > MAX_CONTRACT_PDF_BYTES || input.evidence.length > MAX_CONTRACT_EVIDENCE_BYTES) return fail();
    const json = boundedJson(m);
    if (json.length > MAX_CONTRACT_ARCHIVE_MANIFEST_BYTES) return fail();
    const total = 5 * block + padded(json.length) + padded(input.pdf.length) + padded(input.evidence.length);
    if (total > MAX_CONTRACT_ARCHIVE_PACKAGE_BYTES) return fail();
    const files = verifyContractArchiveFiles(m.archive, input, m.source);
    const result = new Uint8Array(total);
    let position = 0;
    for (const [index, data] of [json, files.pdf, files.evidence].entries()) {
      result.set(header(names[index], data.length), position); position += block;
      result.set(data, position); position += padded(data.length);
    }
    return { bytes: result, sha256: sha256(result), manifestSha256: sha256(json) };
  } catch { return fail(); }
}
/** expectedSha256 is mandatory externally trusted evidence, never read from this TAR. */
export function verifyContractArchivePackage(value: Uint8Array, options: { expectedSha256: string }) {
  try {
    if (!(value instanceof Uint8Array) || value.length < 5 * block || value.length > MAX_CONTRACT_ARCHIVE_PACKAGE_BYTES
      || value.length % block !== 0 || !options || typeof options.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(options.expectedSha256)) return fail();
    const digest = sha256(value);
    if (digest !== options.expectedSha256) return fail();
    const entries: Uint8Array[] = [];
    let position = 0;
    for (let index = 0; index < names.length; index++) {
      if (position + block > value.length) return fail();
      const h = value.subarray(position, position + block);
      const sizeText = decoder.decode(h.subarray(124, 136));
      if (!/^[0-7]{11}\0$/.test(sizeText)) return fail();
      const size = Number.parseInt(sizeText.slice(0, -1), 8);
      if (!Number.isSafeInteger(size) || size < 2 || size > limits[index] || !bytesEqual(h, header(names[index], size))) return fail();
      position += block;
      const end = position + size, next = position + padded(size);
      if (next > value.length || value.subarray(end, next).some(byte => byte !== 0)) return fail();
      entries.push(value.subarray(position, end)); position = next;
    }
    if (position + 2 * block !== value.length || value.subarray(position).some(byte => byte !== 0)) return fail();
    const parsed = manifest(JSON.parse(decoder.decode(entries[0])), true);
    // V1 has a single canonical JSON representation; reject duplicate keys and ambiguities.
    if (!bytesEqual(entries[0], boundedJson(parsed))) return fail();
    const files = verifyContractArchiveFiles(parsed.archive, { pdf: entries[1], evidence: entries[2] }, parsed.source);
    return { archive: parsed.archive, source: parsed.source, ...files, manifest: parsed, manifestBytes: new Uint8Array(entries[0]), sha256: digest };
  } catch { return fail(); }
}
