import 'server-only';
import { requireCrmContext, CrmError } from '@/lib/crm/context';
import { requireApprovedAccountAccess } from '@/lib/account-access/context';
export async function requireFulfilmentContext(companyId: string, write = false) {
  const ctx = await requireCrmContext(companyId);
  if (!['owner', 'admin', 'finance'].includes(ctx.role) || write && ctx.role === 'finance') throw new CrmError('access_denied');
  const approved = await requireApprovedAccountAccess();
  if (approved.userId !== ctx.userId) throw new CrmError('access_denied');
  return ctx;
}
