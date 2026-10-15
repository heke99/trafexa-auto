export const COMPANY_STORE_ATTESTATION_VERSION = '2026-10-15' as const;
export type CompanyStoreRole = 'owner' | 'admin';
export type CompanyStoreChannel = 'blocket' | 'wayke';
export type CompanyStorePurpose = 'new_store' | 'existing_store';
export type CompanyStoreFields = {
  displayName: string; addressLine1: string; addressLine2: string | null; postalCode: string; city: string; countryCode: 'SE';
  publicEmail: string; publicPhone: string; websiteUrl: string | null; logoUrl: string | null;
  description: string | null; openingHoursText: string | null;
};
export type CompanyStoreProfile = { id: string; companyId: string; version: number; fields: CompanyStoreFields; createdAt: string; actorLabel: 'Du' | 'Kollega' };
export type CompanyStoreSourceSnapshot = {
  schemaVersion: 1; companyId: string; profileId: string; profileVersion: number;
  legalName: string; organisationNumber: string; shop: CompanyStoreFields;
};
export type CompanyStoreExportSummary = {
  id: string; companyId: string; channel: CompanyStoreChannel; purpose: CompanyStorePurpose; profileId: string; profileVersion: number;
  sourceSha256: string; exportSha256: string; createdAt: string; actorLabel: 'Du' | 'Kollega'; status: 'prepared';
  attestationVersion: typeof COMPANY_STORE_ATTESTATION_VERSION;
};
export type CompanyStoreExport = CompanyStoreExportSummary & { snapshot: CompanyStoreSourceSnapshot; canonicalContent: string };
export type CompanyStoreScope = { actorId: string; role: CompanyStoreRole; companyId: string };
export type CompanyStoreProfilePage = CompanyStoreScope & {
  legalName: string; organisationNumber: string; identityValid: boolean; profile: CompanyStoreProfile | null;
  source: CompanyStoreSourceSnapshot | null; sourceSha256: string | null; canExport: boolean;
  reason: 'profile_missing' | 'invalid_organisation_number' | null; exports: CompanyStoreExportSummary[];
};
export type GetCompanyStoreProfileInput = { companyId: string };
export type CreateCompanyWithProfileInput = { legalName: string; organisationNumber: string; fields: CompanyStoreFields; representationAcknowledged: boolean; requestId: string };
export type SaveCompanyStoreProfileInput = { companyId: string; expectedVersion: number; fields: CompanyStoreFields; reviewAcknowledged: boolean; requestId: string };
export type PrepareCompanyStoreExportInput = {
  companyId: string; expectedVersion: number; expectedSourceSha256: string; channel: CompanyStoreChannel; purpose: CompanyStorePurpose;
  reviewAcknowledged: boolean; attestationVersion: typeof COMPANY_STORE_ATTESTATION_VERSION; requestId: string;
};
export type GetCompanyStoreExportInput = { companyId: string; exportId: string };
export type CompanyStoreProfileReceipt = CompanyStoreScope & { requestId: string; profile: CompanyStoreProfile; source: CompanyStoreSourceSnapshot; sourceSha256: string };
export type CompanyStoreExportReceipt = CompanyStoreScope & { requestId: string; export: CompanyStoreExport };
export type CompanyStoreExportPage = CompanyStoreScope & { export: CompanyStoreExport };
export type CompanyStoreCode = 'unauthenticated' | 'access_denied' | 'invalid_input' | 'conflict' | 'unavailable';
export type CompanyStoreResult<T> = ({ ok: true } & T) | { ok: false; code: CompanyStoreCode; error: string };
