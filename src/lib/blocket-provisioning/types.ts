export type BlocketGroup = {
  id: string; version: number; groupReference: string; credentialReference: string;
  scope: 'dealer_group' | 'dealer_code'; status: 'active' | 'disabled'; updatedAt: string;
};
export type BlocketBinding = {
  companyId: string; connectionId: string; connectionVersion: number; groupId: string; groupVersion: number;
  dealerCode: string; evidenceReference: string; validUntil: string; status: 'verified' | 'disabled';
};
export type BlocketProvisioningPage = {
  companyId: string; legalName: string; organisationNumber: string; actorUserId: string;
  groups: BlocketGroup[]; nextPageKey: string | null; connectionVersion: number; binding: BlocketBinding | null;
};
export type ConfigureBlocketGroupInput = {
  groupId: string; expectedVersion: number; groupReference: string; credentialReference: string;
  scope: BlocketGroup['scope']; status: BlocketGroup['status']; reason: string; acknowledged: true; requestId: string;
};
export type BindBlocketCompanyInput = {
  companyId: string; groupId: string; expectedGroupVersion: number; expectedConnectionVersion: number;
  dealerCode: string; evidenceReference: string; validUntil: string; reason: string; acknowledged: true; requestId: string;
};
export type DisableBlocketCompanyInput = {
  companyId: string; expectedConnectionVersion: number; reason: string; acknowledged: true; requestId: string;
};
export type BlocketGroupReceipt = { actorUserId: string; requestId: string; group: BlocketGroup };
export type BlocketBindingReceipt = { actorUserId: string; requestId: string; companyId: string; binding: BlocketBinding };
export type BlocketProvisioningCode = 'access_denied' | 'invalid_input' | 'conflict' | 'unavailable';
export type BlocketProvisioningResult<T> = ({ ok: true } & T) | { ok: false; code: BlocketProvisioningCode; error: string };
