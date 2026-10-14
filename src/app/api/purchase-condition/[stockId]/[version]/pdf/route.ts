import { getActiveCompanyContext } from '@/lib/data/company-context';
import { getPurchaseConditionVersionAction } from '@/lib/data/purchase-condition-actions';
import { requirePurchaseConditionContext } from '@/lib/purchase-condition/context';
import { generatePurchaseConditionPdf, parsePurchaseConditionSnapshot } from '@/lib/documents/purchase-condition-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure = (status: number) => new Response(status === 401 ? 'Logga in igen för att hämta underlaget.' : status === 403 ? 'Du har inte behörighet att hämta underlaget.' : status === 404 ? 'Underlaget kunde inte hittas.' : 'Underlaget kunde inte verifieras. Försök igen.', { status, headers });
function errorStatus(value: unknown): number {
  const code = value && typeof value === 'object' && 'code' in value ? value.code : null;
  return code === 'unauthenticated' ? 401 : code === 'access_denied' ? 403 : code === 'invalid_input' ? 404 : 503;
}

/** Cookie-selected current company and private immutable version; query parameters never grant scope. */
export async function GET(_request: Request, { params }: { params: Promise<{ stockId: string; version: string }> }) {
  const path = await params;
  if (!UUID.test(path.stockId) || !/^[1-9]\d{0,9}$/.test(path.version) || BigInt(path.version) > BigInt(2147483647)) return failure(404);
  const stockId = path.stockId.toLowerCase(), version = Number(path.version);
  let active;
  try { active = await getActiveCompanyContext(); } catch { return failure(401); }
  if (!['owner', 'admin', 'finance'].includes(active.role)) return failure(403);
  try {
    const proof = await requirePurchaseConditionContext(active.company);
    if (proof.userId !== active.user || proof.companyId !== active.company || proof.role !== active.role) return failure(403);
    const input = { companyId: active.company, stockId, version };
    const read = await getPurchaseConditionVersionAction(input);
    if (!read.ok) return failure(errorStatus(read));
    const saved = parsePurchaseConditionSnapshot(read.purchaseCondition);
    if (saved.companyId !== input.companyId || saved.stockId !== stockId || saved.version !== version) return failure(503);
    const bytes = await generatePurchaseConditionPdf(saved);
    // Rendering can take time. Re-read the exact version and then verify the
    // same current actor, approval and role before releasing any private bytes.
    const recheck = await getPurchaseConditionVersionAction(input);
    if (!recheck.ok) return failure(errorStatus(recheck));
    if (JSON.stringify(parsePurchaseConditionSnapshot(recheck.purchaseCondition)) !== JSON.stringify(saved)) return failure(503);
    const current = await requirePurchaseConditionContext(active.company);
    if (current.userId !== proof.userId || current.companyId !== proof.companyId || current.role !== proof.role) return failure(403);
    return new Response(new Uint8Array(bytes), { status: 200, headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="inkops-skickunderlag-${stockId}-v${version}.pdf"` } });
  } catch (error) { return failure(errorStatus(error)); }
}
