import 'server-only';
import { getAccountAccessContext } from '@/lib/account-access/context';
import { getActiveCompanyContext } from '@/lib/data/company-context';
import { getContractSigningAction } from '@/lib/data/contract-signing-actions';
import { getContractArchiveAction } from '@/lib/data/contract-archive-actions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { assertContractArchiveSource, nativeArchiveOperation, verifyContractArchiveFiles, CONTRACT_ARCHIVE_BUCKET, MAX_CONTRACT_PDF_BYTES, MAX_CONTRACT_EVIDENCE_BYTES } from './native-contract-archive';
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
  const bounded=nativeArchiveOperation();
  const account=await bounded(()=>getAccountAccessContext());if(!account)return failure(401);if(!account.emailVerified||account.status!=='approved')return failure(403);
  const companyId=requestedCompany?.toLowerCase();let active;
  if(companyId){active=await bounded(()=>getActiveCompanyContext());if(active.company!==companyId||active.user!==account.userId||!['owner','admin','finance'].includes(active.role))return failure(403);}
  const input={signingId:id.toLowerCase(),...(companyId?{companyId}:{})};
  const first=await bounded(()=>getContractSigningAction(input));if(!first.ok)return failure(errorStatus(first));
  if(first.signing.id!==input.signingId||companyId&&first.signing.companyId!==companyId)return failure(503);
  if(first.signing.status!=='completed')return failure(409);
  const completed=parseCompletedContract(first.signing);
  const archiveState=await bounded(()=>getContractArchiveAction(input));
  if(!archiveState.ok)return failure(errorStatus(archiveState));
  if(archiveState.actorId!==account.userId||archiveState.companyId!==completed.companyId||archiveState.signingId!==completed.id||archiveState.role!==(active?active.role:'customer'))return failure(503);
  let body:Uint8Array<ArrayBuffer>|string;
  if(archiveState.archive!==null){
   const archived=archiveState.archive;
   assertContractArchiveSource(archived,completed);
   const db=await bounded(()=>createServerSupabaseClient());
   async function stored(path:string,max:number){
    return bounded(async({signal})=>{const result=await db.storage.from(CONTRACT_ARCHIVE_BUCKET).download(path,{},{signal,cache:'no-store'});if(result.error||!result.data||result.data.size<2||result.data.size>max)throw Error('Stored archive unavailable');return new Uint8Array(await result.data.arrayBuffer());});
   }
   const [pdf,evidence]=await Promise.all([stored(archived.pdf.objectPath,MAX_CONTRACT_PDF_BYTES),stored(archived.evidence.objectPath,MAX_CONTRACT_EVIDENCE_BYTES)]);
   const files=verifyContractArchiveFiles(archived,{pdf,evidence},completed);
   const current=await bounded(()=>getContractArchiveAction(input));
   if(!current.ok)return failure(errorStatus(current));
   if(current.actorId!==archiveState.actorId||current.companyId!==archiveState.companyId||current.role!==archiveState.role||JSON.stringify(current.archive)!==JSON.stringify(archived))return failure(503);
   body=new Uint8Array(format==='pdf'?files.pdf:files.evidence);
  }else{
   // A verified absence preserves the existing dynamic-download behavior.
   // Every archive read error above stops; it must never become this fallback.
   body=format==='pdf'?new Uint8Array(await bounded(()=>generateSignedContractPdf(completed))):JSON.stringify(await bounded(()=>generateSigningEvidence(completed)),null,2);
   const current=await bounded(()=>getContractArchiveAction(input));
   if(!current.ok)return failure(errorStatus(current));
   if(current.archive!==null||current.actorId!==archiveState.actorId||current.companyId!==archiveState.companyId||current.role!==archiveState.role)return failure(503);
  }
  const second=await bounded(()=>getContractSigningAction(input));if(!second.ok)return failure(errorStatus(second));
  if(JSON.stringify(parseCompletedContract(second.signing))!==JSON.stringify(completed))return failure(503);
  const fresh=await bounded(()=>getAccountAccessContext());if(!fresh||!fresh.emailVerified||fresh.status!=='approved'||fresh.userId!==account.userId||fresh.email!==account.email)return failure(403);
  if(active){const current=await bounded(()=>getActiveCompanyContext());if(current.user!==active.user||current.company!==active.company||current.role!==active.role)return failure(403);}
  const artifact=archiveState.archive===null?'genererad-kopia':'original';
  return new Response(body,{headers:{...headers,'Content-Type':format==='pdf'?'application/pdf':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="avtal-${input.signingId}-v${completed.draftVersion}-${artifact}${format==='pdf'?'.pdf':'-signeringsbevis.json'}"`}});
 }catch(error){return failure(errorStatus(error));}
}
