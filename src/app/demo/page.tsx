import type { Metadata } from 'next';
import type { WorkspaceSnapshot } from '@/lib/data/workspace';
import { DealerWorkspace, type WorkspaceSection } from '@/components/dealer-workspace';

export const metadata: Metadata = { title: 'Demonstration | Trafexa', robots: { index: false, follow: false } };
const organization={id:'demo-company',name:'Exempel Bilhandel',organisation_number:'Fiktivt företag'};
const membership={company_id:organization.id,role:'owner',companies:organization};
const sampleVehicles=[
  ['demo-v1','EXEMPEL 01','Volvo','V60 B4',2022,48200,'hybrid','automatic',24000000,28900000,'available','standard'],
  ['demo-v2','EXEMPEL 02','BMW','320d Touring',2021,61400,'diesel','automatic',21500000,26900000,'reserved','vmb'],
  ['demo-v3','EXEMPEL 03','Volkswagen','Golf TSI',2023,26500,'petrol','automatic',18700000,22900000,'available','standard'],
  ['demo-v4','EXEMPEL 04','Audi','A4 Avant',2020,79500,'diesel','automatic',18400000,22900000,'available','vmb'],
  ['demo-v5','EXEMPEL 05','Kia','Niro EV',2022,38200,'electric','automatic',21900000,26900000,'available','standard'],
] as const;
const snapshot:WorkspaceSnapshot={
  organization,membership,memberships:[membership],user:{id:'demo-user',email:'demo@exempel.invalid'},
  inventory:sampleVehicles.map(([id,registration_number,make,model,model_year,mileage_km,fuel,gearbox,purchase_price_ore,asking_price_ore,status,vat_scheme])=>({id,status,acquired_on:'2026-10-01',purchase_price_ore,asking_price_ore,vat_scheme,vehicles:{id,registration_number,make,model,model_year,mileage_km,fuel,gearbox}})),
  vehicle_costs:[
    {id:'demo-cost1',stock_item_id:'demo-v1',category:'transport',description:'Fiktiv transportkostnad',amount_ore:250000,incurred_on:'2026-10-02',created_at:'2026-10-02T12:00:00Z'},
    {id:'demo-cost2',stock_item_id:'demo-v1',category:'repair',description:'Fiktiv service och rekond',amount_ore:425050,incurred_on:'2026-10-04',created_at:'2026-10-04T12:00:00Z'},
    {id:'demo-cost3',stock_item_id:'demo-v2',category:'inspection',description:'Fiktiv besiktningskostnad',amount_ore:125000,incurred_on:'2026-10-03',created_at:'2026-10-03T12:00:00Z'},
  ],
  customers:[{id:'demo-c1',name:'Exempelkund Anna',email:'anna@exempel.invalid',phone:null,kind:'person',address:null,notes:null,created_at:'2026-10-07'},{id:'demo-c2',name:'Exempelkund Johan',email:'johan@exempel.invalid',phone:null,kind:'person',address:null,notes:null,created_at:'2026-10-06'},{id:'demo-c3',name:'Exempel Företag AB',email:'foretag@exempel.invalid',phone:null,kind:'business',address:null,notes:null,created_at:'2026-10-03'}],
  deals:[{id:'demo-d1',customer_id:'demo-c1',stock_item_id:'demo-v2',sale_price_ore:26900000,status:'reserved',created_at:'2026-10-07'},{id:'demo-d2',customer_id:'demo-c2',stock_item_id:'demo-v1',sale_price_ore:28900000,status:'draft',created_at:'2026-10-06'},{id:'demo-d3',customer_id:'demo-c3',stock_item_id:'demo-v3',sale_price_ore:22900000,status:'draft',created_at:'2026-10-05'}],
  finance_applications:[{id:'demo-f1',product:'stock',requested_amount_ore:50000000,deposit_ore:0,term_months:null,status:'intake',note:'Fiktiv förfrågan om finansiering av fordonslager.',deal_id:null,created_at:'2026-10-07'}],
  documents:[],activities:[],finance_partners:[],dealer_approvals:[],integrations:[],
};
export default async function DemoPage({searchParams}:{searchParams:Promise<{section?:string}>}) {
  const params=await searchParams;
  const sections:WorkspaceSection[]=['dashboard','inventory','customers','deals','finance','network','documents','settings','advertising'];
  const section=sections.includes(params.section as WorkspaceSection)?params.section as WorkspaceSection:'dashboard';
  return <DealerWorkspace snapshot={snapshot} section={section} demo/>;
}
