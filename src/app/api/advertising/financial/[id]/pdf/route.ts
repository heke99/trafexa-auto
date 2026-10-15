import { getActiveCompanyContext } from '@/lib/data/company-context';
import { requireContractContext } from '@/lib/contracts/context';
import { requirePlatformAdminContext } from '@/lib/platform-admin/context';
import { getAdvertisingFinancialAssessmentAction, getPlatformAdvertisingFinancialAssessmentAction } from '@/lib/advertising/financial-actions';
import { generateAdvertisingFinancialPdf } from '@/lib/documents/advertising-financial-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = (status: number) => new Response('Det granskade fakturaunderlaget kunde inte hämtas med din nuvarande behörighet.', { status, headers });
function status(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return code === 'unauthenticated' ? 401 : code === 'access_denied' || code === 'forbidden' ? 403 : code === 'invalid_input' || code === 'not_found' ? 404 : 503;
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: value } = await params;
  if (!uuid.test(value)) return fail(404);
  const id = value.toLowerCase(), query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => key !== 'companyId') || query.getAll('companyId').length > 1) return fail(404);
  const target = query.get('companyId'); if (target !== null && !uuid.test(target)) return fail(404);
  try {
    let companyId: string, userId: string, role: string;
    if (target) { const context = await requirePlatformAdminContext(); companyId = target.toLowerCase(); userId = context.userId; role = 'platform_admin'; }
    else {
      const active = await getActiveCompanyContext(), context = await requireContractContext(active.company);
      if (context.userId !== active.user || context.role !== active.role || !['owner', 'admin', 'finance'].includes(context.role)) return fail(403);
      companyId = active.company; userId = context.userId; role = context.role;
    }
    const read = target ? getPlatformAdvertisingFinancialAssessmentAction : getAdvertisingFinancialAssessmentAction;
    const first = await read({ companyId, id }); if (!first.ok) return fail(status(first));
    if (first.assessment.companyId !== companyId || first.assessment.id !== id) return fail(503);
    const original = JSON.stringify(first.assessment), body = await generateAdvertisingFinancialPdf(first.assessment);
    const second = await read({ companyId, id }); if (!second.ok) return fail(status(second));
    if (second.assessment.companyId !== companyId || second.assessment.id !== id || JSON.stringify(second.assessment) !== original) return fail(503);
    if (target) { if ((await requirePlatformAdminContext()).userId !== userId) return fail(403); }
    else {
      const current = await requireContractContext(companyId), active = await getActiveCompanyContext();
      if (current.userId !== userId || current.role !== role || active.company !== companyId || active.user !== userId || active.role !== role) return fail(403);
    }
    return new Response(new Uint8Array(body), { headers: { ...headers, 'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="granskat-fakturaunderlag-${id}-v${first.assessment.version}.pdf"` } });
  } catch (error) { return fail(status(error)); }
}
