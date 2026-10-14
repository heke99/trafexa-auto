import { getActiveCompanyContext } from '@/lib/data/company-context';
import { requireContractContext } from '@/lib/contracts/context';
import { requirePlatformAdminContext } from '@/lib/platform-admin/context';
import { listAdvertisingUsageAction, getPlatformAdvertisingUsageAction } from '@/lib/advertising/usage-actions';
import { generateAdvertisingUsageCsv } from '@/lib/advertising/usage-csv';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0',Vary:'Cookie','X-Content-Type-Options':'nosniff'};
const failure=(status:number)=>new Response('Annonsunderlaget kunde inte hämtas med din nuvarande behörighet.',{status,headers});
function errorStatus(v:unknown){const code=v&&typeof v==='object'&&'code'in v?v.code:null;return code==='unauthenticated'?401:code==='access_denied'||code==='forbidden'?403:code==='invalid_input'?404:503;}
/** Cookie-selected dealer company, or actual UUID superadmin for one explicitly selected company. */
export async function GET(request:Request,{params}:{params:Promise<{month:string}>}){
 const {month}=await params;if(!/^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$/.test(month))return failure(404);
 const query=new URL(request.url).searchParams;
 if([...query.keys()].some(k=>k!=='companyId')||query.getAll('companyId').length>1)return failure(404);
 const target=query.get('companyId');if(target!==null&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(target))return failure(404);
 try{
  let companyId:string,userId:string,role:string;
  if(target){const context=await requirePlatformAdminContext();companyId=target.toLowerCase();userId=context.userId;role='platform_admin';}
  else{const active=await getActiveCompanyContext(),context=await requireContractContext(active.company);if(context.userId!==active.user||context.role!==active.role)return failure(403);companyId=active.company;userId=context.userId;role=context.role;}
  const input={companyId,month},read=target?getPlatformAdvertisingUsageAction:listAdvertisingUsageAction;
  const result=await read(input);if(!result.ok)return failure(errorStatus(result));
  if(result.companyId!==companyId||result.actorUserId!==userId||result.actorRole!==role||result.month!==month)return failure(503);
  const body=generateAdvertisingUsageCsv(result);
  const again=await read(input);if(!again.ok)return failure(errorStatus(again));
  if(JSON.stringify(again)!==JSON.stringify(result))return failure(503);
  if(target){if((await requirePlatformAdminContext()).userId!==userId)return failure(403);}
  else{const current=await requireContractContext(companyId);if(current.userId!==userId||current.role!==role)return failure(403);const active=await getActiveCompanyContext();if(active.company!==companyId||active.user!==userId||active.role!==role)return failure(403);}
  return new Response(body,{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="annonsunderlag-${companyId}-${month}.csv"`}});
 }catch(error){return failure(errorStatus(error));}
}
