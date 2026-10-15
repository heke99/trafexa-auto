import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../supabase/database.types';
import { requireCompanyTeamContext, CompanyTeamError } from '../company-team/context';
import { requireApprovedAccountAccess } from '../account-access/context';
import type { OwnershipRole } from './types';

type DecisionArgs = { p_company_id: string; p_transfer_id: string; p_expected_version: number; p_expected_team_version: number; p_acknowledged: boolean; p_attestation_version: string; p_request_id: string };
type Functions = {
  get_company_ownership_transfer: { Args: { p_company_id: string; p_page_key: string | null; p_limit: number }; Returns: Json };
  request_company_ownership_transfer: { Args: { p_company_id: string; p_target_membership_id: string; p_expected_owner_version: number; p_expected_target_version: number; p_expected_team_version: number; p_reason: string; p_acknowledged: boolean; p_attestation_version: string; p_request_id: string }; Returns: Json };
  accept_company_ownership_transfer: { Args: DecisionArgs; Returns: Json };
  cancel_company_ownership_transfer: { Args: DecisionArgs & { p_reason: string }; Returns: Json };
};
type OwnershipDatabase = Omit<Database, 'public'> & { public: Omit<Database['public'], 'Functions'> & { Functions: Omit<Database['public']['Functions'], keyof Functions> & Functions } };
export type OwnershipContext = { db: SupabaseClient<OwnershipDatabase>; companyId: string; userId: string; role: OwnershipRole };

/** The selector chooses a tenant; current Auth, approval and membership authorize it. */
export async function requireOwnershipContext(companyId: string): Promise<OwnershipContext> {
  const current = await requireCompanyTeamContext(companyId);
  const account = await requireApprovedAccountAccess();
  if (account.userId !== current.userId || current.companyId !== companyId) throw new CompanyTeamError('access_denied');
  return { ...current, db: current.db as unknown as SupabaseClient<OwnershipDatabase> };
}
