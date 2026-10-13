import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getActiveCompanyContext } from '@/lib/data/company-context';
import type { AdvertisingDatabase, AdvertisingRole } from './database.types';

export class AdvertisingError extends Error {
  constructor(readonly code: 'unauthenticated' | 'access_denied' | 'unavailable') { super('Annonsbehörigheten kunde inte verifieras.'); }
}
export type AdvertisingContext = { db: SupabaseClient<AdvertisingDatabase>; companyId: string; userId: string; role: AdvertisingRole };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every action verifies Auth and a current membership; dealer page cache is insufficient. */
export async function requireAdvertisingContext(companyId: string, mode: 'read' | 'write' | 'manage' = 'read'): Promise<AdvertisingContext> {
  try {
    const db = await createServerSupabaseClient() as unknown as SupabaseClient<AdvertisingDatabase>;
    const { data, error } = await db.auth.getUser();
    const user = data?.user;
    if (error || !user || !UUID.test(user.id)) throw new AdvertisingError('unauthenticated');
    if (user.is_anonymous || !user.email || !user.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at))) throw new AdvertisingError('access_denied');
    const selected = await getActiveCompanyContext();
    if (selected.user !== user.id || selected.company.toLowerCase() !== companyId) throw new AdvertisingError('access_denied');
    const current = await db.from('memberships').select('company_id,user_id,role,status,companies!inner(id,status)')
      .eq('company_id', companyId).eq('user_id', user.id).eq('status', 'active').eq('companies.status', 'active').maybeSingle();
    if (current.error) throw new AdvertisingError('unavailable');
    const membership = current.data;
    if (!membership || membership.company_id !== companyId || membership.user_id !== user.id || membership.status !== 'active' || !['owner', 'admin', 'sales', 'finance', 'viewer'].includes(membership.role)) throw new AdvertisingError('access_denied');
    const company = membership.companies as unknown as { id?: unknown; status?: unknown };
    if (!company || company.id !== companyId || company.status !== 'active') throw new AdvertisingError('access_denied');
    if (mode === 'write' && !['owner', 'admin', 'sales'].includes(membership.role) || mode === 'manage' && !['owner', 'admin'].includes(membership.role)) throw new AdvertisingError('access_denied');
    return { db, companyId, userId: user.id, role: membership.role as AdvertisingRole };
  } catch (error) {
    if (error instanceof AdvertisingError) throw error;
    throw new AdvertisingError('access_denied');
  }
}
