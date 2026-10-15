import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../supabase/database.types';
import { createServerSupabaseClient } from '../supabase/server';
import { requireCrmContext, CrmError } from '../crm/context';
import { readAccountAccess, requireApprovedAccountAccess } from '../account-access/context';
import type { CompanyStoreFields, CompanyStoreRole } from './types';

type Functions = {
  get_company_store_profile: { Args: { p_company_id: string }; Returns: Json };
  create_company_with_profile: { Args: { p_legal_name: string; p_organisation_number: string; p_fields: CompanyStoreFields; p_representation_acknowledged: boolean; p_request_id: string }; Returns: Json };
  save_company_store_profile: { Args: { p_company_id: string; p_expected_version: number; p_fields: CompanyStoreFields; p_acknowledged: boolean; p_request_id: string }; Returns: Json };
  prepare_company_store_export: { Args: { p_company_id: string; p_expected_version: number; p_expected_source_sha256: string; p_channel: string; p_purpose: string; p_acknowledged: boolean; p_attestation_version: string; p_request_id: string }; Returns: Json };
  get_company_store_export: { Args: { p_company_id: string; p_export_id: string }; Returns: Json };
};
type StoreDatabase = Omit<Database, 'public'> & { public: Omit<Database['public'], 'Functions'> & { Functions: Omit<Database['public']['Functions'], keyof Functions> & Functions } };
export type CompanyStoreCreationContext = { db: SupabaseClient<StoreDatabase>; userId: string };
export type CompanyStoreContext = CompanyStoreCreationContext & { companyId: string; role: CompanyStoreRole };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Creating an additional company must not depend on an existing selected tenant. */
export async function requireCompanyStoreCreationContext(): Promise<CompanyStoreCreationContext> {
  const db = await createServerSupabaseClient(), { data, error } = await db.auth.getUser(), user = data?.user;
  if (error || !user || !UUID.test(user.id)) throw new CrmError('unauthenticated');
  if (user.is_anonymous || !user.email || !user.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at))) throw new CrmError('access_denied');
  const approval = await readAccountAccess(db, user);
  if (approval.userId !== user.id || !approval.emailVerified || approval.status !== 'approved') throw new CrmError('access_denied');
  return { db: db as unknown as SupabaseClient<StoreDatabase>, userId: user.id };
}
/** Fresh post-create/replay membership read bypasses the old company cookie. */
export async function requireCreatedCompanyStoreContext(companyId: string, userId: string): Promise<CompanyStoreContext> {
  const current = await requireCompanyStoreCreationContext(); if (current.userId !== userId) throw new CrmError('access_denied');
  const result = await current.db.from('memberships').select('company_id,user_id,role,status,companies!inner(id,status)')
    .eq('company_id', companyId).eq('user_id', userId).eq('status', 'active').eq('companies.status', 'active').maybeSingle();
  if (result.error) throw new CrmError('unavailable');
  const member = result.data;
  if (!member || member.company_id !== companyId || member.user_id !== userId || member.role !== 'owner' && member.role !== 'admin' || member.status !== 'active' || !member.companies || member.companies.id !== companyId || member.companies.status !== 'active') throw new CrmError('access_denied');
  return { ...current, companyId, role: member.role };
}
export async function requireCompanyStoreContext(companyId: string): Promise<CompanyStoreContext> {
  const current = await requireCrmContext(companyId), approved = await requireApprovedAccountAccess();
  if (approved.userId !== current.userId || current.companyId !== companyId || current.role !== 'owner' && current.role !== 'admin') throw new CrmError('access_denied');
  return { companyId, userId: current.userId, role: current.role, db: current.db as unknown as SupabaseClient<StoreDatabase> };
}
