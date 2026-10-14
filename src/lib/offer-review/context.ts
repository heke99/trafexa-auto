import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireCrmContext, CrmError } from '@/lib/crm/context';
import type { ReviewDatabase } from './database.types';
export type CustomerReviewContext = { db: SupabaseClient<ReviewDatabase>; userId: string; email: string };
export async function requireCustomerReviewContext(): Promise<CustomerReviewContext> {
 try {
  const db = await createServerSupabaseClient() as unknown as SupabaseClient<ReviewDatabase>;
  const {data,error} = await db.auth.getUser(); const user = data?.user;
  if(error || !user || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) throw new CrmError('unauthenticated');
  if(user.is_anonymous || !user.email || !user.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at))) throw new CrmError('access_denied');
  const email = user.email.trim().toLowerCase();
  if(email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CrmError('access_denied');
  return {db,userId:user.id.toLowerCase(),email};
 } catch(error) { if(error instanceof CrmError) throw error; throw new CrmError('access_denied'); }
}
export async function requireDealerReviewContext(companyId: string, mode: 'read' | 'write' = 'read') {
 const ctx = await requireCrmContext(companyId,mode);
 return {...ctx, db:ctx.db as unknown as SupabaseClient<ReviewDatabase>};
}
