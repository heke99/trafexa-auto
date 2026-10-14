import 'server-only';
import {requireCrmContext} from '@/lib/crm/context';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {TradeInDatabase} from './database.types';
export async function requireTradeInContext(companyId:string,mode:'read'|'write'='read') {
 const context=await requireCrmContext(companyId,mode);
 return {...context,db:context.db as unknown as SupabaseClient<TradeInDatabase>};
}
