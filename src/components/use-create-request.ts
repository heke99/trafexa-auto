'use client';

import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';

type Receipt={companyId:string;actorId:string;requestId:string;recordId:string;kind:'customer'|'finance_intake';createdAt:string};
type Result={ok:true;receipt:Receipt}|{ok:false;code:string;message:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const normalizeCreateText=(value:string)=>value.trim();
export function normalizeCreateMoney(value:string){
 const text=value.trim().replace(',','.');
 if(!/^\d+(?:\.\d{1,2})?$/.test(text))return text;
 const [whole,decimal='']=text.split('.');return `${whole.replace(/^0+(?=\d)/,'')}${decimal.replace(/0+$/,'')?'.'+decimal.replace(/0+$/,''):''}`;
}
const pendingPrefix='trafexa:create:v1:';
const maxPending=100;
function removePending(key:string){try{sessionStorage.removeItem(key);}catch{/* A retained ID can only cause a safe replay. */}}
async function recoverPending(scope:string,payload:string){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));
 const hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
 const storageKey=pendingPrefix+scope+':'+hash;
 const stored=sessionStorage.getItem(storageKey);
 if(stored!==null){
  const value:unknown=JSON.parse(stored);
  if(!value||typeof value!=='object'||!('requestId'in value)||typeof value.requestId!=='string'||!uuid.test(value.requestId)||!('hash'in value)||value.hash!==hash||!('createdAt'in value)||typeof value.createdAt!=='number'||!Number.isFinite(value.createdAt)||value.createdAt>Date.now()+300000)throw Error('storage');
  // Database receipts have no expiry: an old pending ID must still replay exactly.
  return {requestId:value.requestId,storageKey};
 }
 let count=0;for(let index=0;index<sessionStorage.length;index++)if(sessionStorage.key(index)?.startsWith(pendingPrefix))count++;
 if(count>=maxPending)throw Error('capacity');
 const requestId=crypto.randomUUID();
 // Persist before sending; quota/privacy-mode failures cannot cause an untracked create.
 sessionStorage.setItem(storageKey,JSON.stringify({requestId,hash,createdAt:Date.now()}));
 return {requestId,storageKey};
}
/** Keep an ambiguous attempt's immutable request ID and payload for an exact retry. */
export function useCreateRequest<T extends {companyId:string}>(options:{companyId:string;actorId:string;kind:Receipt['kind'];action:(input:T&{requestId:string})=>Promise<Result>;onSuccess:()=>void;onDenied?:()=>void}){
 const router=useRouter();
 const live=useRef(true),busy=useRef(false);
 type Attempt={key:string;requestId:string;input:T;storageKey:string};
 const attempts=useRef(new Map<string,Attempt>());
 const attempt=useRef<Attempt|null>(null);
 const [state,setState]=useState<{status:'idle'|'pending'|'unknown'|'error'|'success'|'denied'|'conflict';message:string}>({status:'idle',message:''});
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 async function submit(input:T){
  if(busy.current||state.status==='denied')return;
  const key=JSON.stringify(input);
  busy.current=true;setState({status:'pending',message:''});
  let sent=false;
  try{
   if(!attempts.current.has(key)){
    const pending=await recoverPending(`${options.companyId}:${options.actorId}:${options.kind}`,key);
    if(!live.current)return;
    attempts.current.set(key,{key,...pending,input});
   }
   attempt.current=attempts.current.get(key)!;
   const current=attempt.current;
   sent=true;
   const result=await options.action({...current.input,requestId:current.requestId});
   if(!live.current)return;
   if(!result.ok){
    if(result.code==='access_denied'||result.code==='company_changed'){attempts.current.clear();attempt.current=null;options.onDenied?.();setState({status:'denied',message:'Företaget eller behörigheten har ändrats. Läs in sidan igen innan du fortsätter.'});}
    else {if(result.code==='invalid_input'){removePending(current.storageKey);attempts.current.delete(key);attempt.current=null;}setState({status:result.code==='unavailable'?'unknown':result.code==='conflict'?'conflict':'error',message:result.code==='unavailable'?'Resultatet kunde inte bekräftas. Uppgifterna finns kvar. Försök igen med samma uppgifter för att kontrollera samma begäran.':result.message});}
    return;
   }
   const receipt=result.receipt;
   if(!receipt||receipt.companyId!==options.companyId||receipt.actorId!==options.actorId||receipt.requestId!==current.requestId||receipt.kind!==options.kind||!uuid.test(receipt.recordId)||typeof receipt.createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(receipt.createdAt)||!Number.isFinite(Date.parse(receipt.createdAt))){
    setState({status:'unknown',message:'Kvittot kunde inte verifieras. Uppgifterna finns kvar. Försök igen med samma uppgifter.'});return;
   }
   removePending(current.storageKey);attempts.current.delete(key);attempt.current=null;
   setState({status:'success',message:options.kind==='customer'?'Kunden har registrerats.':'Intresseanmälan har registrerats hos Trafexa. Den är inte skickad till en finanspartner.'});
   options.onSuccess();router.refresh();
  }catch{
   if(live.current)setState(sent?{status:'unknown',message:'Svaret kunde inte tas emot. Uppgifterna finns kvar. Försök igen med samma uppgifter för att kontrollera samma begäran.'}:{status:'error',message:'Ingen ny begäran skickades. Säker återförsökning är inte tillgänglig i den här webbläsarsessionen. Kontakta en ansvarig innan du fortsätter. Rensa inte olösta begäranden utan avstämning.'});
  }finally{busy.current=false;}
 }
 function restartConflict(){
  // Only a definite payload conflict can be retired after the caller's review.
  // Ambiguous attempts, including other payloads in this session, keep their IDs.
  if(busy.current||!live.current||state.status!=='conflict'||!attempt.current)return false;
  const current=attempt.current;
  try{sessionStorage.removeItem(current.storageKey);if(sessionStorage.getItem(current.storageKey)!==null)throw Error('storage');}
  catch{setState({status:'conflict',message:'En ny begäran kunde inte förberedas säkert. Läs in sidan igen och kontrollera tidigare intresseanmälningar innan du fortsätter.'});return false;}
  attempts.current.delete(current.key);attempt.current=null;setState({status:'idle',message:''});return true;
 }
 return {submit,edit:()=>setState(current=>current.status==='success'?{status:'idle',message:''}:current),retry:()=>{if(attempt.current)void submit(attempt.current.input);},restartConflict,state,pending:state.status==='pending',denied:state.status==='denied',conflicted:state.status==='conflict'};
}
