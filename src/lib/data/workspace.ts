import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCompanySession } from './company-context';
export type Organization={id:string;name:string;organisation_number:string};
export type Membership={company_id:string;role:string;companies:Organization};
export type Vehicle={id:string;registration_number:string;make:string;model:string;model_year:number;mileage_km:number;fuel:string;gearbox:string};
export type InventoryItem={id:string;status:string;acquired_on:string;purchase_price_ore:number;asking_price_ore:number;vat_scheme:string;vehicles:Vehicle};
export type VehicleCost={id:string;stock_item_id:string;category:'repair'|'transport'|'inspection'|'finance'|'other';description:string;amount_ore:number;incurred_on:string;created_at:string};
export type Customer={id:string;name:string;email:string|null;phone:string|null;kind:string;address:string|null;notes:string|null;created_at:string};
export type Deal={id:string;status:string;sale_price_ore:number;customer_id:string;stock_item_id:string;created_at:string};
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
};
async function getVehicleCosts(db:Awaited<ReturnType<typeof createServerSupabaseClient>>,company:string):Promise<VehicleCost[]> {
 const costs:VehicleCost[]=[];
 for(let offset=0;;offset+=500) {
  const {data,error}=await db.from('vehicle_costs').select('id,stock_item_id,category,description,amount_ore,incurred_on,created_at').eq('company_id',company).order('id').range(offset,offset+499);
  if(error)throw new Error('Bilarnas kostnader kunde inte hämtas. Försök igen.');
  costs.push(...(data??[]) as VehicleCost[]);
  if(!data||data.length<500)return costs;
 }
}
export async function getWorkspaceSnapshot():Promise<WorkspaceSnapshot|null> {
 const session=await getCompanySession();
 if(!session)return null;
 const {db,user,membership,memberships}=session;
 const snapshot:WorkspaceSnapshot={user,organization:membership?.companies??null,membership,memberships,inventory:[],vehicle_costs:[],customers:[],deals:[],finance_applications:[],documents:[],activities:[],finance_partners:[],dealer_approvals:[],integrations:[]};
 if(!membership)return snapshot;
 const company=membership.company_id;
 const [results,costs]=await Promise.all([Promise.all([
 db.from('stock_items').select('id,status,acquired_on,purchase_price_ore,asking_price_ore,vat_scheme,vehicles(id,registration_number,make,model,model_year,mileage_km,fuel,gearbox)').eq('company_id',company).order('created_at',{ascending:false}).limit(500),
 db.from('customers').select('*').eq('company_id',company).order('created_at',{ascending:false}).limit(500),
 db.from('deals').select('*').eq('company_id',company).order('created_at',{ascending:false}).limit(500),
 db.from('finance_applications').select('*').eq('company_id',company).order('created_at',{ascending:false}).limit(500),
 db.from('documents').select('*').eq('company_id',company).order('created_at',{ascending:false}).limit(100),
 db.from('activities').select('*').eq('company_id',company).order('created_at',{ascending:false}).limit(50),
 db.from('finance_partners').select('id,name,status'),
 db.from('dealer_approvals').select('*').eq('company_id',company)
 ]),getVehicleCosts(db,company)]);
 if(results.some(r=>r.error)) throw new Error('Uppgifterna kunde inte hämtas. Försök igen.');
 snapshot.inventory=results[0].data as unknown as InventoryItem[];
 const stockIds=new Set(snapshot.inventory.map(item=>item.id));
 snapshot.vehicle_costs=costs.filter(cost=>stockIds.has(cost.stock_item_id));
 snapshot.customers=results[1].data as Customer[];snapshot.deals=results[2].data as Deal[];
 snapshot.finance_applications=results[3].data as FinanceApplication[];snapshot.documents=results[4].data as Document[];
 snapshot.activities=results[5].data as Activity[];snapshot.finance_partners=results[6].data as FinancePartner[];snapshot.dealer_approvals=results[7].data as DealerApproval[];
 return snapshot;
}
export const getWorkspace=getWorkspaceSnapshot;
