import { getActiveCompanyContext } from '@/lib/data/company-context';
import { generateOfferPdf, parseOfferSnapshot } from '@/lib/documents/offer-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  if (!uuid.test(offerId)) return new Response('Offerten kunde inte hittas.', { status: 404, headers });
  let context: Awaited<ReturnType<typeof getActiveCompanyContext>>;
  try { context = await getActiveCompanyContext(); }
  catch { return new Response('Logga in i rätt företag för att hämta offerten.', { status: 401, headers }); }
  const { data, error } = await context.db.from('offers').select('id,company_id,deal_id,version,snapshot').eq('company_id', context.company).eq('id', offerId).maybeSingle();
  if (error) return new Response('Offerten kunde inte hämtas. Försök igen.', { status: 503, headers });
  if (!data) return new Response('Offerten kunde inte hittas.', { status: 404, headers });
  try {
    const snapshot = parseOfferSnapshot(data.snapshot);
    if (snapshot.company.id !== data.company_id || snapshot.deal_id !== data.deal_id || snapshot.version !== data.version) throw new Error('Invalid offer identity');
    const pdf = await generateOfferPdf(snapshot, data.id);
    return new Response(new Uint8Array(pdf), { status: 200, headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="offert-${data.id.toLowerCase()}-v${data.version}.pdf"` } });
  } catch { return new Response('PDF-underlaget kunde inte skapas. Kontrollera offertens uppgifter och försök igen.', { status: 500, headers }); }
}
