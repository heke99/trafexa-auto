import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../supabase/database.types';
import { requireCrmContext, CrmError } from '../crm/context';
import { requireApprovedAccountAccess } from '../account-access/context';
import type { TradeInAcquisitionRole } from './types';

type Functions = {
  get_trade_in_acquisition: { Args: { p_company_id: string; p_deal_id: string }; Returns: Json };
  record_trade_in_acquisition: { Args: {
    p_company_id: string; p_deal_id: string; p_expected_source_sha256: string; p_acquired_on: string;
    p_purchase_agreement_reference: string; p_debt_confirmed_ore: string; p_debt_confirmed_on: string;
    p_debt_evidence_reference: string; p_fuel: string; p_gearbox: string; p_asking_price_ore: string;
    p_purchase_confirmed: boolean; p_received_confirmed: boolean; p_debt_confirmed: boolean; p_acknowledged: boolean;
    p_attestation_version: string; p_request_id: string;
  }; Returns: Json };
};
type AcquisitionDatabase = Omit<Database, 'public'> & { public: Omit<Database['public'], 'Functions'> & { Functions: Omit<Database['public']['Functions'], keyof Functions> & Functions } };
export type TradeInAcquisitionContext = { db: SupabaseClient<AcquisitionDatabase>; companyId: string; userId: string; role: TradeInAcquisitionRole };

/** Auth, membership, company and account approval are read fresh on every call. */
export async function requireTradeInAcquisitionContext(companyId: string, mode: 'read' | 'write' = 'read'): Promise<TradeInAcquisitionContext> {
  const current = await requireCrmContext(companyId, mode);
  const role = current.role;
  if (role !== 'owner' && role !== 'admin' && role !== 'finance' || mode === 'write' && role === 'finance') throw new CrmError('access_denied');
  const approved = await requireApprovedAccountAccess();
  if (approved.userId !== current.userId || current.companyId !== companyId) throw new CrmError('access_denied');
  return { companyId, userId: current.userId, role, db: current.db as unknown as SupabaseClient<AcquisitionDatabase> };
}
