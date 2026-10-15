import 'server-only';
import { requireCrmContext, CrmError } from '@/lib/crm/context';
import { requireApprovedAccountAccess } from '@/lib/account-access/context';
import { canReadInternalFinance, canWriteInternalFinance } from './dealer-capabilities';

/** Read actual Auth, approval and membership without trusting a page's cached
 * role. Finance reads; existing financial writes remain owner/admin only. */
export async function requireInternalFinanceContext(companyId: string, write = false) {
  const current = await requireCrmContext(companyId);
  if (!canReadInternalFinance(current.role) || write && !canWriteInternalFinance(current.role)) throw new CrmError('access_denied');
  const access = await requireApprovedAccountAccess();
  if (access.userId !== current.userId) throw new CrmError('access_denied');
  return current;
}
