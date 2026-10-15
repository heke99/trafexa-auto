'use server';
import { requireInternalFinanceContext } from '@/lib/access/internal-finance-context';
import { hubInputSchema, parseHubPage, type HubInput, type HubResult } from './types';
export async function loadDealerDocumentHub(input: HubInput): Promise<HubResult> {
 const validated=hubInputSchema.safeParse(input);
 if(!validated.success)return {ok:false,code:'invalid_input',message:'Kontrollera dokumentfiltret och börja om från första sidan.'};
 const {companyId,query,kind,cursor}=validated.data;
 try {
  const before=await requireInternalFinanceContext(companyId);
  const db=before.db as unknown as {rpc(name:string,input:Record<string,unknown>):Promise<{data:unknown;error:{code?:string}|null}>};
  const result=await db.rpc('dealer_document_hub_page',{p_company_id:companyId,p_query:query,p_kind:kind,p_cursor:cursor});
  if(result.error)throw result.error;
  const page=parseHubPage(result.data,{companyId,actorId:before.userId,role:before.role,query,kind});
  const after=await requireInternalFinanceContext(companyId);
  if(after.userId!==before.userId||after.role!==before.role)throw {code:'42501'};
  return {ok:true,page};
 }catch(error){
  const raw=error&&typeof error==='object'&&'code'in error?error.code:null;
  const code=raw==='42501'||raw==='access_denied'||raw==='unauthenticated'?'access_denied':raw==='22023'?'invalid_input':'unavailable';
  return {ok:false,code,message:code==='access_denied'?'Din behörighet till dokumenten kunde inte verifieras. Välj rätt företag eller logga in igen.':code==='invalid_input'?'Dokumentfiltret har ändrats. Börja om från första sidan.':'Dokumentöversikten kunde inte hämtas. Försök igen.'};
 }
}
