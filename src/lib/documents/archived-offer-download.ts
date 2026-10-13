import { createHash } from 'node:crypto';

export class ArchivedOfferDownloadError extends Error {
  readonly code: 'invalid_input' | 'not_found' | 'invalid_archive' | 'unavailable';
  constructor(code: ArchivedOfferDownloadError['code']) {
    super('Den arkiverade offerten kunde inte hämtas.');
    this.name = 'ArchivedOfferDownloadError'; this.code = code;
  }
}
if (typeof window !== 'undefined') throw new ArchivedOfferDownloadError('unavailable');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const MAX_BYTES = 50 * 1024 * 1024;
type ArchiveRecord = { company_id: string; document_id: string; offer_id: string; offer_version: number; pdf_sha256: string; object_path: string };
type ArchiveReader = {
  readRecord(companyId: string, documentId: string): Promise<unknown>;
  download(objectPath: string): Promise<Blob>;
  timeoutMs?: number;
};
function fail(code: ArchivedOfferDownloadError['code']): never { throw new ArchivedOfferDownloadError(code); }
function parseRecord(value: unknown, companyId: string, documentId: string): ArchiveRecord {
  if (value === null) return fail('not_found');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('invalid_archive');
  const row = value as Record<string, unknown>;
  if (row.company_id !== companyId || row.document_id !== documentId || typeof row.offer_id !== 'string' || !UUID.test(row.offer_id) || !Number.isSafeInteger(row.offer_version) || (row.offer_version as number) < 1 || (row.offer_version as number) > 2147483647 || typeof row.pdf_sha256 !== 'string' || !HASH.test(row.pdf_sha256) || row.document_kind !== 'other' || row.storage_bucket !== 'dealer-documents' || row.storage_visibility !== 'private') return fail('invalid_archive');
  const expected = `${companyId}/offers/${row.offer_id}/v${row.offer_version}/${row.pdf_sha256}.pdf`;
  if (row.object_path !== expected) return fail('invalid_archive');
  return Object.freeze({ company_id: companyId, document_id: documentId, offer_id: row.offer_id, offer_version: row.offer_version as number, pdf_sha256: row.pdf_sha256, object_path: expected });
}
/** Readers must use the authenticated user's RLS; privacy receipts come from the catalog-checking RPC. */
export function createArchivedOfferDownloader(reader: ArchiveReader) {
  const timeoutMs = reader.timeoutMs ?? 15000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) return fail('invalid_input');
  async function bounded<T>(operation: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ArchivedOfferDownloadError('unavailable')), timeoutMs); })]);
    } catch (error) { if (error instanceof ArchivedOfferDownloadError) throw error; return fail('unavailable'); }
    finally { if (timer) clearTimeout(timer); }
  }
  return {
    async read(companyId: string, documentId: string) {
      if (!UUID.test(companyId) || !UUID.test(documentId)) return fail('invalid_input');
      const record = parseRecord(await bounded(() => reader.readRecord(companyId, documentId)), companyId, documentId);
      const blob = await bounded(() => reader.download(record.object_path));
      if (!(blob instanceof Blob) || blob.size < 5 || blob.size > MAX_BYTES) return fail('invalid_archive');
      const bytes = new Uint8Array(await bounded(() => blob.arrayBuffer()));
      if (Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-' || createHash('sha256').update(bytes).digest('hex') !== record.pdf_sha256) return fail('invalid_archive');
      // Recheck the actual bucket's private status and immutable binding after IO.
      const final = parseRecord(await bounded(() => reader.readRecord(companyId, documentId)), companyId, documentId);
      if (JSON.stringify(final) !== JSON.stringify(record)) return fail('invalid_archive');
      return { bytes, filename: `offert-${record.offer_id}-v${record.offer_version}.pdf` };
    },
  };
}
