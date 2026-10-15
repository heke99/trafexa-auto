import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../supabase/database.types';
import { requireCompanyTeamContext, CompanyTeamError } from '../company-team/context';
import { requireApprovedAccountAccess } from '../account-access/context';
type Functions = {
  get_company_public_store: { Args: { p_company_id: string }; Returns: Json };
  publish_company_public_store: { Args: { p_company_id: string; p_slug: string; p_expected_version: number; p_profile_version: number; p_listings: Json; p_acknowledged: boolean; p_request_id: string }; Returns: Json };
  unpublish_company_public_store: { Args: { p_company_id: string; p_expected_version: number; p_acknowledged: boolean; p_request_id: string }; Returns: Json };
  get_public_dealer_store: { Args: { p_slug: string }; Returns: Json };
  get_public_store_photo: { Args: { p_slug: string; p_photo_id: string }; Returns: Json };
};
export type PublicStoreDatabase = Omit<Database,'public'> & { public: Omit<Database['public'],'Functions'> & { Functions: Omit<Database['public']['Functions'],keyof Functions> & Functions } };
export async function requirePublicStoreContext(companyId: string) {
  const current = await requireCompanyTeamContext(companyId), account = await requireApprovedAccountAccess();
  if (account.userId !== current.userId || current.companyId !== companyId) throw new CompanyTeamError('access_denied');
  return { ...current, db: current.db as unknown as SupabaseClient<PublicStoreDatabase> };
}
