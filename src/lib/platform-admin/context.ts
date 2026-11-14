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

/** Read-only eligibility probe. Never turn a normal login into an admin claim. */
export async function requirePlatformAdminActivationContext(): Promise<PlatformAdminContext> {
  const context=await requirePlatformAuthenticatedContext();
  const result=await context.db.rpc('get_platform_admin_activation_access',{});
  if(result.error)throw new PlatformAdminError(result.error.code==='42501'?'forbidden':'unavailable');
  const value=result.data;
  if(!value||typeof value!=='object'||Array.isArray(value)||value.user_id!==context.userId||typeof value.can_activate!=='boolean')throw new PlatformAdminError('unavailable');
  if(!value.can_activate)throw new PlatformAdminError('forbidden');
  const fresh=await requirePlatformAuthenticatedContext();
  if(fresh.userId!==context.userId)throw new PlatformAdminError('forbidden');
  return context;
}
export async function getPlatformAdminActivationContext(): Promise<PlatformAdminContext|null> {
  try{return await requirePlatformAdminActivationContext();}catch{return null;}
}
