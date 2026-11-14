import {parseDealContractProgress}from'@/lib/contracts/deal-progress';
import type {Deal}from'./workspace';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid deal progress scope');return v as Record<string,unknown>;}
/** A missing migration or failed projection does not hide the rest of the workspace. */
export async function workspaceDealProgress(db:unknown,companyId:string,actorId:string,role:string,deals:Deal[]):Promise<{deals:Deal[];error?:string}>{
 const unverified=deals.map(d=>({...d,contractProgress:undefined,archived:undefined}));
 try{
  const ids=deals.map(d=>d.id.toLowerCase());if(ids.length>500||ids.some(id=>!uuid.test(id))||new Set(ids).size!==ids.length)throw Error('Invalid deal ids');
  if(!ids.length)return{deals:[]};
  const result=await(db as {rpc(name:string,args:Record<string,unknown>):Promise<{data:unknown;error:unknown}>}).rpc('get_deal_contract_progress',{p_company_id:companyId,p_deal_ids:ids});
  if(result.error)throw result.error;const data=object(result.data);
  if(data.companyId!==companyId||data.actorId!==actorId||data.role!==role||!Array.isArray(data.rows)||data.rows.length!==ids.length)throw Error('Deal progress scope changed');
  const entries=new Map(data.rows.map(raw=>{const row=object(raw);if(typeof row.dealId!=='string'||!ids.includes(row.dealId)||typeof row.archived!=='boolean')throw Error('Unexpected deal');return[row.dealId,{contractProgress:parseDealContractProgress(row.contractProgress),archived:row.archived}] as const;}));
  if(entries.size!==ids.length)throw Error('Duplicate deal progress');
  return{deals:deals.map(d=>({...d,...entries.get(d.id.toLowerCase())!}))};
 }catch{return{deals:unverified,error:'Avtalsstatus kunde inte verifieras. Uppdatera sidan för aktuell signeringsstatus.'};}
}
