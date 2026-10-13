import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getActiveCompanyContext } from '@/lib/data/company-context';
import type { CompanyTeamDatabase, TeamManagerRole } from './database.types';

export class CompanyTeamError extends Error {
  constructor(readonly code: 'unauthenticated' | 'access_denied' | 'unavailable') { super('Behörigheten kunde inte verifieras.'); }
}
export type InvitationContext = { db: SupabaseClient<CompanyTeamDatabase>; userId: string };
export type CompanyTeamContext = InvitationContext & { companyId: string; role: TeamManagerRole };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Recipient access deliberately requires no existing dealer membership. */
export async function requireInvitationContext(): Promise<InvitationContext> {
  try {
    const db = await createServerSupabaseClient() as unknown as SupabaseClient<CompanyTeamDatabase>;
    const { data, error } = await db.auth.getUser();
    const user = data?.user;
    if (error || !user || !UUID.test(user.id)) throw new CompanyTeamError('unauthenticated');
    if (user.is_anonymous || !user.email || !user.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at))) throw new CompanyTeamError('access_denied');
    return { db, userId: user.id };
  } catch (error) {
    if (error instanceof CompanyTeamError) throw error;
    throw new CompanyTeamError('unavailable');
  }
}

/** The company selector chooses a current membership; it never grants access. */
export async function requireCompanyTeamContext(expectedCompanyId: string): Promise<CompanyTeamContext> {
  const context = await requireInvitationContext();
  try {
    const current = await getActiveCompanyContext();
    if (current.user !== context.userId || current.company.toLowerCase() !== expectedCompanyId.toLowerCase()) throw new CompanyTeamError('access_denied');
    // Re-read with the fresh user's client even if the ordinary page context is request-cached.
    const result = await context.db.from('memberships').select('company_id,user_id,role,status,companies!inner(id,status)')
      .eq('company_id', expectedCompanyId).eq('user_id', context.userId).eq('status', 'active').eq('companies.status', 'active').maybeSingle();
    if (result.error) throw new CompanyTeamError('unavailable');
    const member = result.data;
    if (!member || member.company_id !== expectedCompanyId || member.user_id !== context.userId || member.status !== 'active' || (member.role !== 'owner' && member.role !== 'admin')) throw new CompanyTeamError('access_denied');
    const company = member.companies as unknown as { id?: unknown; status?: unknown };
    if (!company || company.id !== expectedCompanyId || company.status !== 'active') throw new CompanyTeamError('access_denied');
    return { ...context, companyId: expectedCompanyId, role: member.role };
  } catch (error) {
    if (error instanceof CompanyTeamError) throw error;
    // An unavailable or revoked ordinary context cannot fall back to another company.
    throw new CompanyTeamError('access_denied');
  }
}
