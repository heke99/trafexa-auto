import { getActiveCompanyContext } from '@/lib/data/company-context';
import { ArchivedOfferDownloadError, createArchivedOfferDownloader } from '@/lib/documents/archived-offer-download';
import type { OfferArchiveDatabase } from '@/lib/documents/offer-archive-database';
import type { SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  if (!uuid.test(documentId)) return new Response('Dokumentet kunde inte hittas.', { status: 404, headers });
  let context: Awaited<ReturnType<typeof getActiveCompanyContext>>;
  try { context = await getActiveCompanyContext(); }
  catch { return new Response('Logga in i rätt företag för att hämta dokumentet.', { status: 401, headers }); }
  if (!['owner', 'admin', 'finance'].includes(context.role)) return new Response('Du saknar behörighet till dokumentarkivet.', { status: 403, headers });
  // The isolated overlay describes unapplied additive RPCs; the client remains the user's client.
  const db = context.db as unknown as SupabaseClient<OfferArchiveDatabase>;
  const downloader = createArchivedOfferDownloader({
    async readRecord(companyId, id) {
      const { data, error } = await db.rpc('get_offer_archive_by_document', { p_company_id: companyId, p_document_id: id });
      if (error) throw new ArchivedOfferDownloadError(error.code === '42501' ? 'not_found' : 'unavailable');
      return data;
    },
    async download(path) {
      const { data, error } = await db.storage.from('dealer-documents').download(path);
      if (error || !data) throw new ArchivedOfferDownloadError('unavailable');
      return data;
    },
  });
  try {
    const result = await downloader.read(context.company.toLowerCase(), documentId.toLowerCase());
    return new Response(result.bytes, { status: 200, headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${result.filename}"` } });
  } catch (error) {
    const status = error instanceof ArchivedOfferDownloadError && error.code === 'not_found' ? 404 : 503;
    return new Response('Den arkiverade offerten kunde inte hämtas. Kontrollera företagsvalet och försök igen.', { status, headers });
  }
}
