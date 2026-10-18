import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readVerifiedContractArchive, contractArchiveIntegrityFailure } from '@/lib/documents/verified-contract-archive';
import { createContractArchivePackage, MAX_CONTRACT_ARCHIVE_PACKAGE_BYTES } from '@/lib/documents/contract-archive-package';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = z.string().uuid();
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
function failure(code: string, error: string, status: number) {
  return Response.json({ ok: false, code, error }, { status, headers });
}
/** No bytes leave this route until both originals and the final current authorization are verified. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = new URL(request.url).searchParams, company = query.get('companyId');
  if (!uuid.safeParse(id).success || [...query.keys()].some(key => key !== 'companyId') || query.getAll('companyId').length > 1
    || company !== null && !uuid.safeParse(company).success) return failure('invalid_input', 'Avtalsreferensen är ogiltig.', 400);
  try {
    if (request.signal.aborted) return failure('unavailable', 'Hämtningen avbröts.', 503);
    const original = await readVerifiedContractArchive({ signingId: id, ...(company !== null ? { companyId: company } : {}) });
    if (!original.archive) return failure('not_archived', 'Avtalets original har ännu inte arkiverats.', 409);
    const { archive, source, pdf, evidence } = original;
    const packaged = createContractArchivePackage({ archive, source, pdf, evidence });
    if (packaged.bytes.length < 1 || packaged.bytes.length > MAX_CONTRACT_ARCHIVE_PACKAGE_BYTES) throw Error('Package size');
    await original.revalidate();
    if (request.signal.aborted) return failure('unavailable', 'Hämtningen avbröts.', 503);
    // Stream the already verified bytes to avoid the platform's buffered response limit.
    let offset = 0, cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (cancelled || request.signal.aborted) { controller.close(); return; }
        const end = Math.min(offset + 64 * 1024, packaged.bytes.length);
        controller.enqueue(packaged.bytes.slice(offset, end)); offset = end;
        if (offset === packaged.bytes.length) controller.close();
      },
      cancel() { cancelled = true; },
    });
    const metadata = [archive.id, archive.companyId, archive.signingId, archive.dealId, archive.draftId, archive.draftVersion,
      archive.documentContentSha256, archive.signingRevision, archive.rendererVersion, archive.evidenceSchemaVersion, archive.archivedAt,
      archive.pdf.objectPath, archive.pdf.sha256, archive.pdf.bytes, archive.pdf.mimeType,
      archive.evidence.objectPath, archive.evidence.sha256, archive.evidence.bytes, archive.evidence.mimeType];
    return new Response(body, { headers: { ...headers,
      'Content-Type': 'application/x-tar',
      'Content-Disposition': `attachment; filename="trafexa-avtalsarkiv-${original.signingId}-${archive.id}.tar"`,
      'X-Archive-Id': archive.id, 'X-Archive-Signing-Id': original.signingId, 'X-Archive-Company-Id': original.companyId,
      'X-Archive-Actor-Id': original.actorId, 'X-Archive-Actor-Role': original.role,
      'X-Archive-Document-SHA256': archive.documentContentSha256,
      'X-Archive-Metadata-SHA256': createHash('sha256').update(JSON.stringify(metadata)).digest('hex'),
      'X-Archive-Package-SHA256': packaged.sha256, 'X-Archive-Manifest-SHA256': packaged.manifestSha256,
      'X-Archive-Package-Bytes': String(packaged.bytes.length),
    } });
  } catch (error) {
    const result = contractArchiveIntegrityFailure(error);
    const status = result.code === 'invalid_input' ? 400 : result.code === 'unauthenticated' ? 401
      : result.code === 'access_denied' ? 403 : ['conflict', 'source_invalid', 'storage_unverified'].includes(result.code) ? 409 : 503;
    return failure(result.code, result.error, status);
  }
}
