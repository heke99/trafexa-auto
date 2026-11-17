import 'server-only';
import type {DealContractProgress}from'@/lib/contracts/deal-progress';
import {loadDashboardDeals} from './register-actions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCompanySession } from './company-context';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CalculationDatabase } from '@/lib/calculations/database.types';
import type { InventoryDashboardTotals } from '@/lib/calculations/vehicle-calculation';
import { parseInventoryDashboardTotals } from '@/lib/calculations/source';
import { parseWorkspaceInventory } from './workspace-inventory';
import { requireCrmContext } from '@/lib/crm/context';
import { requireApprovedAccountAccess } from '@/lib/account-access/context';
export type Organization={id:string;name:string;organisation_number:string};
export type Membership={company_id:string;role:string;companies:Organization};
export type Vehicle={dataIssue?:string;id:string;registration_number:string;make:string;model:string;model_year:number;mileage_km:number;fuel:string;gearbox:string};
export type InventoryItem={id:string;status:string;acquired_on:string;purchase_price_ore:number|null;asking_price_ore:number;vat_scheme:string;vehicles:Vehicle};
export type VehicleCost={id:string;stock_item_id:string;category:'repair'|'transport'|'inspection'|'finance'|'other';description:string;amount_ore:number;incurred_on:string;created_at:string};
export type Customer={id:string;name:string;email:string|null;phone:string|null;kind:string;address:string|null;notes:string|null;created_at:string};
export type Deal={id:string;status:string;sale_price_ore:number;customer_id:string;stock_item_id:string;created_at:string;archived?:boolean;contractProgress?:DealContractProgress;reservationId?:string|null};
export type FinanceApplication={id:string;product:string;requested_amount_ore:number;deposit_ore:number;term_months:number|null;status:string;note:string|null;deal_id:string|null;created_at:string};
export type Document={id:string;name:string;kind:string;object_path:string;deal_id:string|null;created_at:string};
export type Activity={id:string;description:string;created_at:string;customer_id:string|null;deal_id:string|null};
export type FinancePartner={id:string;name:string;status:string};
export type DealerApproval={id:string;partner_id:string;product:string;status:string};
export type WorkspaceSnapshot={
 user:{id:string;email:string};organization:Organization|null;membership:Membership|null;memberships:Membership[];
 inventory:InventoryItem[];vehicle_costs:VehicleCost[];customers:Customer[];deals:Deal[];finance_applications:FinanceApplication[];
 documents:Document[];activities:Activity[];finance_partners:FinancePartner[];dealer_approvals:DealerApproval[];
 integrations:{name:string;status:string}[];
 hasSuspendedCompany?:boolean;dashboardTotals?:InventoryDashboardTotals;dashboardTotalsError?:string;contractProgressError?:string;
};
async function dashboardTotals(db:Awaited<ReturnType<typeof createServerSupabaseClient>>,company:string,role:string) {
 try {
  const {data,error}=await (db as unknown as SupabaseClient<CalculationDatabase>).rpc('inventory_dashboard_totals',{p_company_id:company});
  if(error)throw new Error();
  return {totals:parseInventoryDashboardTotals(data,company.toLowerCase(),role)};
 } catch {return {error:'Företagets totalsiffror kunde inte verifieras. Läs in sidan igen.'};}
}
export async function getWorkspaceSnapshot(section = 'dashboard'):Promise<WorkspaceSnapshot|null> {
 const session=await getCompanySession();
 if(!session)return null;
 const {db,user,membership,memberships}=session;
 const snapshot:WorkspaceSnapshot={hasSuspendedCompany:session.hasSuspendedCompany??false,user,organization:membership?.companies??null,membership,memberships,inventory:[],vehicle_costs:[],customers:[],deals:[],finance_applications:[],documents:[],activities:[],finance_partners:[],dealer_approvals:[],integrations:[]};
 if(!membership)return snapshot;
 const company=membership.company_id;
 if(section==='dashboard'){
  const [inventory,deals,totals]=await Promise.all([
   (db as unknown as SupabaseClient<CalculationDatabase>).rpc('get_workspace_inventory',{p_company_id:company}),
   loadDashboardDeals(company),
   dashboardTotals(db,company,membership.role)
  ]);
  if(inventory.error)throw new Error('Översiktens lageruppgifter kunde inte hämtas. Försök igen.');
  snapshot.inventory=parseWorkspaceInventory(inventory.data,company,user.id,membership.role);
  if(deals?.companyId===company&&deals.actorId===user.id&&deals.role===membership.role)snapshot.deals=deals.rows;
  else snapshot.contractProgressError='Pågående affärer kunde inte hämtas. Försök igen.';
  const counts=deals?.companyId===company&&deals.actorId===user.id&&deals.role===membership.role
   ?{activeDealCount:deals.activeDealCount,reservedDealCount:deals.reservedDealCount}:{};
  snapshot.dashboardTotals=totals.totals?{...totals.totals,...counts}:undefined;
  snapshot.dashboardTotalsError=totals.error;
 }else if(section==='inventory'){
  const inventory=await (db as unknown as SupabaseClient<CalculationDatabase>).rpc('get_workspace_inventory',{p_company_id:company});
  if(inventory.error)throw new Error('Lagrets uppgifter kunde inte hämtas. Försök igen.');
  snapshot.inventory=parseWorkspaceInventory(inventory.data,company,user.id,membership.role);
 }else if(section==='settings'||section==='finance'){
  const approvals=await db.from('dealer_approvals').select('id,partner_id,product,status').eq('company_id',company);
  if(approvals.error)throw new Error('Finansgodkännanden kunde inte hämtas. Försök igen.');
  snapshot.dealer_approvals=approvals.data as DealerApproval[];
 }else{
  // Each interactive tab reads through its own scoped server action.
  return snapshot;
 }
 const current=await requireCrmContext(company.toLowerCase());
 const access=await requireApprovedAccountAccess();
 if(current.userId!==user.id||access.userId!==user.id||current.companyId!==company||current.role!==membership.role)throw new Error('Företagsbehörigheten har ändrats. Läs in sidan igen.');
 return snapshot;
}
export const getWorkspace=getWorkspaceSnapshot;
