import 'server-only';
import { getAccountAccessContext } from '@/lib/account-access/context';
import { getActiveCompanyContext } from '@/lib/data/company-context';
import { getContractSigningAction } from '@/lib/data/contract-signing-actions';
import { generateSignedContractPdf, generateSigningEvidence, parseCompletedContract } from './signed-contract-pdf';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const headers={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff',Vary:'Cookie'};
const failure=(status:number)=>new Response(status===409?'Avtalet är inte färdigsignerat.':'Avtalet kunde inte hämtas med din nuvarande behörighet.',{status,headers});
function errorStatus(value:unknown){const code=value&&typeof value==='object'&&'code'in value?value.code:null;return code==='unauthenticated'?401:code==='access_denied'?403:code==='invalid_input'?404:503;}
/** Current verified account and exact party/tenant proof are checked again after rendering. */
export async function downloadSignedContract(request:Request,id:string,format:'pdf'|'evidence'){
 if(!UUID.test(id))return failure(404);
 const query=new URL(request.url).searchParams;
 if([...query.keys()].some(key=>key!=='companyId')||query.getAll('companyId').length>1)return failure(404);
 const requestedCompany=query.get('companyId');if(requestedCompany!==null&&!UUID.test(requestedCompany))return failure(404);
 try{
  const account=await getAccountAccessContext();if(!account)return failure(401);if(!account.emailVerified||account.status!=='approved')return failure(403);
  const companyId=requestedCompany?.toLowerCase();let active;
  if(companyId){active=await getActiveCompanyContext();if(active.company!==companyId||active.user!==account.userId||!['owner','admin','finance'].includes(active.role))return failure(403);}
  const input={signingId:id.toLowerCase(),...(companyId?{companyId}:{})};
  const first=await getContractSigningAction(input);if(!first.ok)return failure(errorStatus(first));
  if(first.signing.id!==input.signingId||companyId&&first.signing.companyId!==companyId)return failure(503);
  if(first.signing.status!=='completed')return failure(409);
  const completed=parseCompletedContract(first.signing);
  const body=format==='pdf'?new Uint8Array(await generateSignedContractPdf(completed)):JSON.stringify(await generateSigningEvidence(completed),null,2);
  const second=await getContractSigningAction(input);if(!second.ok)return failure(errorStatus(second));
  if(JSON.stringify(parseCompletedContract(second.signing))!==JSON.stringify(completed))return failure(503);
  const fresh=await getAccountAccessContext();if(!fresh||!fresh.emailVerified||fresh.status!=='approved'||fresh.userId!==account.userId||fresh.email!==account.email)return failure(403);
  if(active){const current=await getActiveCompanyContext();if(current.user!==active.user||current.company!==active.company||current.role!==active.role)return failure(403);}
  return new Response(body,{headers:{...headers,'Content-Type':format==='pdf'?'application/pdf':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="avtal-${input.signingId}-v${completed.draftVersion}${format==='pdf'?'.pdf':'-signeringsbevis.json'}"`}});
 }catch(error){return failure(errorStatus(error));}
}
