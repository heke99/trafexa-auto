import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getActiveCompanyContext } from '@/lib/data/company-context';
import type { CrmDatabase } from './database.types';
import type { CrmRole } from './types';

export class CrmError extends Error {
  constructor(readonly code: 'unauthenticated' | 'access_denied' | 'unavailable') { super('Kundbehörigheten kunde inte verifieras.'); }
}
export type CrmContext = { db: SupabaseClient<CrmDatabase>; companyId: string; userId: string; role: CrmRole };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every action verifies Auth and a current membership; dealer page cache is insufficient. */
export async function requireCrmContext(companyId: string, mode: 'read' | 'write' = 'read'): Promise<CrmContext> {
  try {
    const db = await createServerSupabaseClient() as unknown as SupabaseClient<CrmDatabase>;
    const { data, error } = await db.auth.getUser();
    const user = data?.user;
    if (error || !user || !UUID.test(user.id)) throw new CrmError('unauthenticated');
    if (user.is_anonymous || !user.email || !user.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at))) throw new CrmError('access_denied');
    const selected = await getActiveCompanyContext();
    if (selected.user !== user.id || selected.company.toLowerCase() !== companyId) throw new CrmError('access_denied');
    const current = await db.from('memberships').select('company_id,user_id,role,status,companies!inner(id,status)')
      .eq('company_id', companyId).eq('user_id', user.id).eq('status', 'active').eq('companies.status', 'active').maybeSingle();
    if (current.error) throw new CrmError('unavailable');
    const membership = current.data;
    if (!membership || membership.company_id !== companyId || membership.user_id !== user.id || membership.status !== 'active' || !['owner', 'admin', 'sales', 'finance', 'viewer'].includes(membership.role)) throw new CrmError('access_denied');
    const company = membership.companies as unknown as { id?: unknown; status?: unknown };
    if (!company || company.id !== companyId || company.status !== 'active') throw new CrmError('access_denied');
    if (mode === 'write' && !['owner', 'admin', 'sales'].includes(membership.role)) throw new CrmError('access_denied');
    return { db, companyId, userId: user.id, role: membership.role as CrmRole };
  } catch (error) {
    if (error instanceof CrmError) throw error;
    throw new CrmError('access_denied');
  }
}
