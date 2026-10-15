import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requirePlatformAdminContext } from '../platform-admin/context';
import type { Database, Json } from '../supabase/database.types';

type Functions = {
  get_platform_blocket_provisioning: { Args: { p_company_id: string; p_page_key: string | null; p_limit: number }; Returns: Json };
  configure_blocket_group: { Args: { p_group_id: string; p_expected_version: number; p_group_reference: string; p_credential_reference: string; p_scope: string; p_status: string; p_reason: string; p_acknowledged: boolean; p_request_id: string }; Returns: Json };
  bind_blocket_company: { Args: { p_company_id: string; p_group_id: string; p_expected_group_version: number; p_expected_connection_version: number; p_dealer_code: string; p_evidence_reference: string; p_valid_until: string; p_reason: string; p_acknowledged: boolean; p_request_id: string }; Returns: Json };
  disable_blocket_company: { Args: { p_company_id: string; p_expected_connection_version: number; p_reason: string; p_acknowledged: boolean; p_request_id: string }; Returns: Json };
};
type BlocketDatabase = Omit<Database, 'public'> & { public: Omit<Database['public'], 'Functions'> & { Functions: Omit<Database['public']['Functions'], keyof Functions> & Functions } };
export async function requireBlocketProvisioningContext() {
  const current = await requirePlatformAdminContext();
  return { userId: current.userId, db: current.db as unknown as SupabaseClient<BlocketDatabase> };
}
