import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/database.types';
import { requireContractContext } from './context';
import { requireCustomerReviewContext } from '@/lib/offer-review/context';
import { requireApprovedAccountAccess } from '@/lib/account-access/context';
import { CrmError } from '@/lib/crm/context';
type Functions = {
  list_deal_contract_signings: { Args: { p_company_id: string; p_deal_id: string }; Returns: Json };
  list_my_contract_signings: { Args: { p_before_id: string | null }; Returns: Json };
  get_contract_signing: { Args: { p_signing_id: string; p_company_id: string | null }; Returns: Json };
  get_contract_signing_delivery: { Args: { p_company_id: string; p_deal_id: string; p_signing_id: string }; Returns: Json };
  request_contract_signing: { Args: { p_company_id: string; p_deal_id: string; p_draft_id: string; p_acknowledged: boolean; p_request_id: string }; Returns: Json };
  sign_contract: { Args: { p_signing_id: string; p_company_id: string | null; p_expected_revision: number; p_document_hash: string; p_full_name: string; p_strokes: Json; p_acknowledged: boolean; p_consent_version: string; p_request_id: string }; Returns: Json };
};
type SigningDatabase = Omit<Database, 'public'> & { public: Omit<Database['public'], 'Functions'> & { Functions: Database['public']['Functions'] & Functions } };
export async function requireDealerSigningContext(companyId: string, write = false) {
  const c = await requireContractContext(companyId, write);
  try { const approved = await requireApprovedAccountAccess(); if (approved.userId !== c.userId) throw Error('Actor changed'); } catch { throw new CrmError('access_denied'); }
  return { ...c, db: c.db as unknown as SupabaseClient<SigningDatabase> };
}
export async function requireCustomerSigningContext() {
  const c = await requireCustomerReviewContext();
  try { const approved = await requireApprovedAccountAccess(); if (approved.userId !== c.userId || approved.email.trim().toLowerCase() !== c.email) throw Error('Actor changed'); } catch { throw new CrmError('access_denied'); }
  return { ...c, db: c.db as unknown as SupabaseClient<SigningDatabase> };
}
