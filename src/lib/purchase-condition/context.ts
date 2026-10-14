import 'server-only';
import{requireCrmContext,CrmError}from'@/lib/crm/context';
import type{SupabaseClient}from'@supabase/supabase-js';
import type{PurchaseConditionDatabase}from'./database.types';
/** Finance can manage this private financial underlag; sales/viewer cannot read it. */
export async function requirePurchaseConditionContext(companyId:string){const c=await requireCrmContext(companyId);if(!['owner','admin','finance'].includes(c.role))throw new CrmError('access_denied');return{...c,db:c.db as unknown as SupabaseClient<PurchaseConditionDatabase>};}
