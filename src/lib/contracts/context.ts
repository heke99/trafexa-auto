import 'server-only';
import{requireCrmContext,CrmError}from'@/lib/crm/context';
import type{SupabaseClient}from'@supabase/supabase-js';
import type{ContractDatabase}from'./database.types';
export async function requireContractContext(companyId:string,templateWrite=false){const c=await requireCrmContext(companyId);if(!['owner','admin','finance'].includes(c.role)||templateWrite&&c.role==='finance')throw new CrmError('access_denied');return{...c,db:c.db as unknown as SupabaseClient<ContractDatabase>};}
