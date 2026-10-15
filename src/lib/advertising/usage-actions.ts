'use server';
import { requireContractContext } from '@/lib/contracts/context';
import { requirePlatformAdminContext, PlatformAdminError } from '@/lib/platform-admin/context';
import { CrmError } from '@/lib/crm/context';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/database.types';
import type { AdvertisingUsageCounts, AdvertisingUsagePage, AdvertisingUsageResult } from './usage-types';
type UsageDatabase=Omit<Database,'public'> & {public:Omit<Database['public'],'Functions'> & {Functions:Database['public']['Functions'] & {list_advertising_quantities:{Args:{p_company_id:string;p_month:string};Returns:Json};get_platform_advertising_quantities:{Args:{p_company_id:string;p_month:string};Returns:Json}}}};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH=/^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$/;
const keys=['queued','dispatching','outcomeUnknown','submitted','published','rejected','retryable','newPublications'] as const;
function record(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid record');return v as Record<string,unknown>;}
function count(v:unknown):number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw Error('Invalid count');return v;}
function counts(v:unknown):AdvertisingUsageCounts{const r=record(v);return Object.fromEntries(keys.map(k=>[k,count(r[k])])) as AdvertisingUsageCounts;}
function instant(v:unknown):string{if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT/.test(v)||!Number.isFinite(Date.parse(v)))throw Error('Invalid instant');return v;}
function boundary(value:string,month:string,end:boolean){const date=new Date(value);if(date.getUTCMilliseconds()!==0)throw Error('Invalid boundary precision');const part=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);const get=(type:string)=>part.find(p=>p.type===type)?.value;const [year,m]=month.split('-').map(Number);const wanted=end?new Date(Date.UTC(year,m,1)):new Date(Date.UTC(year,m-1,1));if(get('year')!==String(wanted.getUTCFullYear())||get('month')!==String(wanted.getUTCMonth()+1).padStart(2,'0')||get('day')!=='01'||get('hour')!=='00'||get('minute')!=='00'||get('second')!=='00')throw Error('Invalid calendar boundary');}
export async function listAdvertisingUsageAction(value:{companyId:string;month:string}):Promise<AdvertisingUsageResult>{return usage(value,false);}
export async function getPlatformAdvertisingUsageAction(value:{companyId:string;month:string}):Promise<AdvertisingUsageResult>{return usage(value,true);}
async function usage(value:{companyId:string;month:string},platform:boolean):Promise<AdvertisingUsageResult>{
 let companyId:string,month:string;
 try{const r=record(value);if(Object.keys(r).some(k=>!['companyId','month'].includes(k))||typeof r.companyId!=='string'||!UUID.test(r.companyId)||typeof r.month!=='string'||!MONTH.test(r.month))throw Error();companyId=r.companyId.toLowerCase();month=r.month;}catch{return{ok:false,code:'invalid_input',message:'Välj en giltig månad.'};}
 try{const c=platform?{...await requirePlatformAdminContext(),role:'platform_admin' as const}:await requireContractContext(companyId);const db=c.db as unknown as SupabaseClient<UsageDatabase>;const response=await db.rpc(platform?'get_platform_advertising_quantities':'list_advertising_quantities',{p_company_id:companyId,p_month:month});if(response.error)throw response.error;const r=record(response.data);if(r.companyId!==companyId||r.actorUserId!==c.userId||r.actorRole!==c.role||r.month!==month||r.timeZone!=='Europe/Stockholm')throw Error('Invalid scope');
 const totals={...counts(r.totals),drafts:count(record(r.totals).drafts),ready:count(record(r.totals).ready)};
 if(!Array.isArray(r.channels)||r.channels.length!==2)throw Error('Invalid channels');const channels=r.channels.map(v=>{const ch=record(v);if(ch.channel!=='blocket'&&ch.channel!=='wayke')throw Error('Invalid channel');return{channel:ch.channel as 'blocket'|'wayke',...counts(ch)};});if(channels[0].channel!=='blocket'||channels[1].channel!=='wayke'||keys.some(k=>channels.reduce((n,ch)=>n+ch[k],0)!==totals[k]))throw Error('Invalid totals');
 const billing=record(r.billing);if(billing.status!=='quantity_only'||billing.unitPriceOre!==null||billing.totalOre!==null||count(billing.unpricedPublications)>totals.newPublications)throw Error('Invalid billing');
 const periodStart=instant(r.periodStart),periodEnd=instant(r.periodEnd);boundary(periodStart,month,false);boundary(periodEnd,month,true);
 const page:AdvertisingUsagePage={companyId,actorUserId:c.userId,actorRole:c.role,month,timeZone:'Europe/Stockholm',periodStart,periodEnd,totals,channels,billing:{status:'quantity_only',unitPriceOre:null,totalOre:null,unpricedPublications:count(billing.unpricedPublications)},trackingStartedAt:instant(r.trackingStartedAt),legacyPublishedJobs:count(r.legacyPublishedJobs)};
 const fresh=platform?{...await requirePlatformAdminContext(),role:'platform_admin' as const}:await requireContractContext(companyId);if(fresh.userId!==c.userId||fresh.role!==c.role)throw new CrmError('access_denied');return{ok:true,...page};
 }catch(e){const code=e instanceof PlatformAdminError?(e.code==='forbidden'?'access_denied':e.code):e instanceof CrmError?e.code:e&&typeof e==='object'&&'code'in e&&e.code==='42501'?'access_denied':'unavailable';return{ok:false,code,message:code==='unauthenticated'||code==='access_denied'?'Din behörighet till annonsstatistiken kunde inte verifieras.':'Annonsstatistiken kunde inte bekräftas. Uppdatera och försök igen.'};}
}
