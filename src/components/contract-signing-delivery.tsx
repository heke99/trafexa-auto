'use client';

import { CustomerEmailDelivery } from './customer-email-delivery';

export function ContractSigningDelivery({ signingId, ...props }: { companyId: string; dealId: string; signingId: string; userId: string; role: string }) {
  return <CustomerEmailDelivery {...props} referenceId={signingId} kind="contract_invitation"/>;
}
