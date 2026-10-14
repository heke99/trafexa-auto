import type { Database, Json } from '@/lib/supabase/database.types';
import type { WebApplicationSeeking, WebApplicationStatus } from '@/lib/web-applications/database.types';

type PlatformFunctions = {
  get_platform_admin_session: { Args: Record<string, never>; Returns: Json };
  claim_platform_admin_access: { Args: Record<string, never>; Returns: Json };
  list_platform_companies: { Args: { p_search: string; p_page_key: string | null; p_limit: number }; Returns: Json };
  list_platform_contact_requests: { Args: { p_page_key: string | null; p_limit: number }; Returns: Json };
  set_platform_company_status: { Args: { p_company_id: string; p_expected_status: string; p_status: string; p_reason: string; p_request_id: string }; Returns: Json };
};
export type PlatformAdminDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & { Functions: Database['public']['Functions'] & PlatformFunctions };
};
export type CompanyStatus = 'active' | 'suspended';
export type PlatformCompany = { id: string; name: string; organisationNumber: string; status: CompanyStatus; createdAt: string; membershipCount: number; stockCount: number };
export type PlatformContact = { id: string; name: string; email: string; company: string; phone: string | null; message: string | null; createdAt: string; organisationNumber: string | null; seeking: WebApplicationSeeking[]; privacyVersion: string | null; privacyAcknowledgedAt: string | null; legacy: boolean; status: WebApplicationStatus; version: number };
export type WebApplicationAudit = { status: WebApplicationStatus; reason: string; createdAt: string };
export type WebApplicationStatusReceipt = { applicationId: string; requestId: string; status: WebApplicationStatus; previousStatus: WebApplicationStatus; version: number; reason: string; createdAt: string };
export type CompanyPage = { companies: PlatformCompany[]; nextPageKey: string | null };
export type ContactPage = { requests: PlatformContact[]; nextPageKey: string | null };
export type StatusReceipt = { companyId: string; status: CompanyStatus; previousStatus: CompanyStatus; changed: boolean; requestId: string; reason: string; createdAt: string };
export type AdminResult<T> = ({ ok: true } & T) | { ok: false; code: 'access_denied' | 'invalid_input' | 'conflict' | 'not_found' | 'unavailable'; message: string };
