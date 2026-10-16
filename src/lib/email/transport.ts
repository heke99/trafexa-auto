import type { TransactionalEmail } from './templates.ts';
import { renderTransactionalEmail } from './templates.ts';
export type EmailSendResult={status:'accepted';providerId:string}|{status:'unconfigured'|'retryable'|'rejected'|'unknown'};
export type EmailConfiguration={enabled:boolean;apiKey?:string};
export function emailConfigurationStatus(config:EmailConfiguration){return config.enabled&&typeof config.apiKey==='string'&&config.apiKey.length>0?'configured':'unconfigured';}
/** Provider keys are supplied by the server wrapper. Never log requests or provider bodies. */
export async function sendTransactionalEmail(email:TransactionalEmail,config:EmailConfiguration,fetcher:typeof fetch=fetch):Promise<EmailSendResult>{
 if(emailConfigurationStatus(config)!=='configured')return {status:'unconfigured'};
 let rendered:ReturnType<typeof renderTransactionalEmail>;
 try{rendered=renderTransactionalEmail(email);}catch{return {status:'rejected'};}
 // Resend retains idempotency keys 24 hours. Old unknown outcomes require manual reconciliation.
 const age=Date.now()-Date.parse(email.createdAt);
 if(!Number.isFinite(age)||age < -60_000||age>=23*60*60*1000)return {status:'unknown'};
 try{
 const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json','Idempotency-Key':`trafexa/${email.id}`},body:JSON.stringify({from:'Trafexa <kundtjanst@trafexa.com>',to:[email.recipient],reply_to:'info@trafexa.com',subject:rendered.subject,text:rendered.text,html:rendered.html}),signal:AbortSignal.timeout(10000),redirect:'error'});
 if(response.status===429)return {status:'retryable'};
 if(response.status>=500)return {status:'unknown'};
 if(!response.ok)return {status:'rejected'};
 const body:unknown=await response.json();
 if(!body||typeof body!=='object'||!('id' in body)||typeof body.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(body.id))return {status:'unknown'};
 return {status:'accepted',providerId:body.id};
 }catch{return {status:'unknown'};}
}
