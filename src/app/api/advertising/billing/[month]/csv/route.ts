import { getActiveCompanyContext } from '@/lib/data/company-context';
import { requireContractContext } from '@/lib/contracts/context';
import { requirePlatformAdminContext } from '@/lib/platform-admin/context';
import { listAdvertisingBillingAction, getPlatformAdvertisingBillingAction } from '@/lib/advertising/billing-actions';
import { generateAdvertisingBillingCsv } from '@/lib/advertising/billing-csv';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0',Vary:'Cookie','X-Content-Type-Options':'nosniff'};
const fail=(status:number)=>new Response(status===409?'Månadsunderlaget är inte låst.':'Det låsta annonsunderlaget kunde inte hämtas med din nuvarande behörighet.',{status,headers});
function status(v:unknown){const code=v&&typeof v==='object'&&'code'in v?v.code:null;return code==='unauthenticated'?401:code==='access_denied'||code==='forbidden'?403:code==='invalid_input'?404:503;}
export async function GET(request:Request,{params}:{params:Promise<{month:string}>}){
 const{month}=await params;if(!/^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$/.test(month))return fail(404);
 const query=new URL(request.url).searchParams;
 if([...query.keys()].some(k=>k!=='companyId')||query.getAll('companyId').length>1)return fail(404);
 const target=query.get('companyId');if(target!==null&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(target))return fail(404);
 try{
  let companyId:string,userId:string,role:string;
  if(target){const context=await requirePlatformAdminContext();companyId=target.toLowerCase();userId=context.userId;role='platform_admin';}
  else{const active=await getActiveCompanyContext(),c=await requireContractContext(active.company);if(c.userId!==active.user||c.role!==active.role)return fail(403);companyId=active.company;userId=c.userId;role=c.role;}
  const input={companyId,month},read=target?getPlatformAdvertisingBillingAction:listAdvertisingBillingAction;
  const first=await read(input);if(!first.ok)return fail(status(first));const page=first.page;
  if(page.companyId!==companyId||page.actorUserId!==userId||page.actorRole!==role||page.month!==month)return fail(503);
  if(!page.locked)return fail(409);
  const original=JSON.stringify(page.locked),body=generateAdvertisingBillingCsv(page);
  const second=await read(input);if(!second.ok)return fail(status(second));
  if(second.page.companyId!==companyId||second.page.actorUserId!==userId||second.page.actorRole!==role||second.page.month!==month||JSON.stringify(second.page.locked)!==original)return fail(503);
  if(target){if((await requirePlatformAdminContext()).userId!==userId)return fail(403);}
  else{const current=await requireContractContext(companyId),active=await getActiveCompanyContext();if(current.userId!==userId||current.role!==role||active.company!==companyId||active.user!==userId||active.role!==role)return fail(403);}
  return new Response(body,{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="last-annonsunderlag-${companyId}-${month}.csv"`}});
 }catch(error){return fail(status(error));}
}
