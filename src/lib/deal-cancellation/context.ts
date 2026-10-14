import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireCrmContext } from '@/lib/crm/context';
import type { DealCancellationDatabase } from './database.types';
export async function requireDealCancellationContext(companyId: string) {
  const context = await requireCrmContext(companyId, 'write');
  return { ...context, db: context.db as unknown as SupabaseClient<DealCancellationDatabase> };
}
