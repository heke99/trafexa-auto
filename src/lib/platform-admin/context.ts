import 'server-only';
import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { PlatformAdminDatabase } from './database.types';

export type PlatformAdminContext = { db: SupabaseClient<PlatformAdminDatabase>; userId: string };
export class PlatformAdminError extends Error {
  readonly code: 'unauthenticated' | 'forbidden' | 'unavailable';
  constructor(code: PlatformAdminError['code']) { super('Administratörsåtkomst kunde inte verifieras.'); this.code = code; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fresh verification for every action. Dealer roles and profile metadata confer no access. */
export async function requirePlatformAuthenticatedContext(): Promise<PlatformAdminContext> {
  try {
    const db = await createServerSupabaseClient() as unknown as SupabaseClient<PlatformAdminDatabase>;
    const { data, error } = await db.auth.getUser();
    const user = data?.user;
    if (error || !user || !UUID.test(user.id)) throw new PlatformAdminError('unauthenticated');
    if (user.is_anonymous || !user.email || !user.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at))) throw new PlatformAdminError('forbidden');
    return { db, userId: user.id };
  } catch (error) {
    if (error instanceof PlatformAdminError) throw error;
    throw new PlatformAdminError('unavailable');
  }
}
export async function requirePlatformAdminContext(): Promise<PlatformAdminContext> {
  try {
    const { db, userId } = await requirePlatformAuthenticatedContext();
    const session = await db.rpc('get_platform_admin_session', {});
    if (session.error) throw new PlatformAdminError(session.error.code === '42501' ? 'forbidden' : 'unavailable');
    const value = session.data;
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.is_platform_admin !== true || value.user_id !== userId) throw new PlatformAdminError('forbidden');
    return { db, userId };
  } catch (error) {
    if (error instanceof PlatformAdminError) throw error;
    throw new PlatformAdminError('unavailable');
  }
}

/** Optional navigation probe: unavailable migrations also omit the admin link. */
export async function getPlatformAdminContext(): Promise<PlatformAdminContext | null> {
  try { return await requirePlatformAdminContext(); } catch { return null; }
}
export const requirePlatformAdminPageContext = cache(requirePlatformAdminContext);
