import { getActiveCompanyContext } from '@/lib/data/company-context';
import { getSaleContractDraftAction } from '@/lib/data/contract-actions';
import { requireContractContext } from '@/lib/contracts/context';
import { generateContractPdf, parseContractDraft } from '@/lib/documents/contract-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function failure(status: number) { return new Response(status === 401 ? 'Logga in igen för att hämta utkastet.' : status === 403 ? 'Du har inte behörighet att hämta utkastet.' : status === 404 ? 'Avtalsutkastet kunde inte hittas.' : 'Avtalsutkastet kunde inte verifieras. Försök igen.', { status, headers }); }
function errorStatus(value: unknown) {
  const code = value && typeof value === 'object' && 'code' in value ? value.code : null;
  return code === 'unauthenticated' ? 401 : code === 'access_denied' ? 403 : code === 'invalid_input' ? 404 : 503;
}
/** One private saved draft. Caller query data cannot select another company or overwrite the source. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const path = await params; if (!UUID.test(path.id)) return failure(404);
  const contractId = path.id.toLowerCase(); let active;
  try { active = await getActiveCompanyContext(); } catch { return failure(401); }
  if (!['owner', 'admin', 'finance'].includes(active.role)) return failure(403);
  try {
    const proof = await requireContractContext(active.company);
    if (proof.userId !== active.user || proof.companyId !== active.company || proof.role !== active.role) return failure(403);
    const input = { companyId: active.company, draftId: contractId }, result = await getSaleContractDraftAction(input);
    if (!result.ok) return failure(errorStatus(result));
    const draft = parseContractDraft(result.draft);
    if (draft.id !== contractId || draft.companyId !== active.company) return failure(503);
    const bytes = await generateContractPdf(draft);
    const reread = await getSaleContractDraftAction(input);
    if (!reread.ok) return failure(errorStatus(reread));
    if (JSON.stringify(parseContractDraft(reread.draft)) !== JSON.stringify(draft)) return failure(503);
    const current = await requireContractContext(active.company);
    if (current.userId !== proof.userId || current.companyId !== proof.companyId || current.role !== proof.role) return failure(403);
    return new Response(new Uint8Array(bytes), { status: 200, headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="avtalsutkast-${contractId}-v${draft.version}.pdf"` } });
  } catch (error) { return failure(errorStatus(error)); }
}
