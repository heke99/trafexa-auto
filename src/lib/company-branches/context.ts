import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../supabase/database.types';
import { requireCompanyTeamContext, CompanyTeamError } from '../company-team/context';
import { requireApprovedAccountAccess } from '../account-access/context';
import type { BranchFields, BranchRole } from './types';

type Functions = {
  list_company_branches: { Args: { p_company_id: string; p_status: string; p_page_key: string | null; p_limit: number }; Returns: Json };
  save_company_branch: { Args: { p_company_id: string; p_branch_id: string; p_expected_version: number; p_fields: BranchFields; p_acknowledged: boolean; p_request_id: string }; Returns: Json };
  set_company_branch_status: { Args: { p_company_id: string; p_branch_id: string; p_expected_version: number; p_status: string; p_reason: string; p_acknowledged: boolean; p_request_id: string }; Returns: Json };
};
type BranchDatabase = Omit<Database, 'public'> & { public: Omit<Database['public'], 'Functions'> & { Functions: Omit<Database['public']['Functions'], keyof Functions> & Functions } };
export type CompanyBranchesContext = { db: SupabaseClient<BranchDatabase>; companyId: string; userId: string; role: BranchRole };

/** A selected company is insufficient: re-read Auth, live membership and approval. */
export async function requireCompanyBranchesContext(companyId: string): Promise<CompanyBranchesContext> {
  const current = await requireCompanyTeamContext(companyId);
  const account = await requireApprovedAccountAccess();
  if (current.companyId !== companyId || account.userId !== current.userId || current.role !== 'owner' && current.role !== 'admin') throw new CompanyTeamError('access_denied');
  return { ...current, db: current.db as unknown as SupabaseClient<BranchDatabase> };
}
