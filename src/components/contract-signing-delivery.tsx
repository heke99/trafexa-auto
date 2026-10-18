'use client';

import { CustomerEmailDelivery } from './customer-email-delivery';

export function ContractSigningDelivery({ signingId, completed = false, ...props }: { companyId: string; dealId: string; signingId: string; userId: string; role: string; completed?: boolean }) {
  return <><CustomerEmailDelivery {...props} referenceId={signingId} kind="contract_invitation"/>{completed && <CustomerEmailDelivery {...props} referenceId={signingId} kind="contract_completed"/>}</>;
}
