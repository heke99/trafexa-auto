import 'server-only';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {Database,Json} from '@/lib/supabase/database.types';
import {EMAIL_KINDS,validRecipient,type TransactionalEmail} from './templates';
import {emailConfigurationStatus,sendTransactionalEmail} from './transport';
import {requirePlatformAdminContext} from '@/lib/platform-admin/context';
import {accountInvitationConfigured} from './account-invitation-server';
type EmailDatabase=Omit<Database,'public'>&{public:Omit<Database['public'],'Functions'>&{Functions:{claim_transactional_email:{Args:{p_kind?:string;p_reference?:string};Returns:Json};claim_transactional_email_exact:{Args:{p_kind:string;p_reference:string;p_expected_email_id:string};Returns:Json};check_transactional_email_lease:{Args:{p_id:string;p_lease_id:string};Returns:boolean};finish_transactional_email:{Args:{p_id:string;p_lease_id:string;p_status:string;p_provider_id:string|null};Returns:boolean}}}};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function config(kind?:string|null){const customer=kind==='offer_invitation'||kind?.startsWith('contract_');return {enabled:(customer?process.env.CONTRACT_EMAIL_ENABLED==='true':process.env.TRANSACTIONAL_EMAIL_ENABLED==='true')&&process.env.TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED==='true'&&!!process.env.SUPABASE_SECRET_KEY&&process.env.NEXT_PUBLIC_SUPABASE_URL==='https://buqdtssxrotkzndublrt.supabase.co',apiKey:process.env.RESEND_API_KEY};}
export function contractEmailConfigurationStatus(){return {transport:process.env.CONTRACT_EMAIL_ENABLED!=='true'?'paused' as const:emailConfigurationStatus(config('contract_invitation'))==='configured'?'configured' as const:'unconfigured' as const};}
export function transactionalEmailConfigurationStatus(){return {
 transport:emailConfigurationStatus(config()),sender:'kundtjanst@trafexa.com',replyTo:'info@trafexa.com',automaticSchedule:false as const,
 diagnostics:{enabled:process.env.TRANSACTIONAL_EMAIL_ENABLED==='true',domainVerified:process.env.TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED==='true',credentialsPresent:Boolean(process.env.RESEND_API_KEY)&&Boolean(process.env.SUPABASE_SECRET_KEY),projectConfigured:process.env.NEXT_PUBLIC_SUPABASE_URL==='https://buqdtssxrotkzndublrt.supabase.co'},
 invitationTransport:accountInvitationConfigured()?'configured' as const:'unconfigured' as const,
 contractTransport:contractEmailConfigurationStatus().transport,
};}
/** One bounded message per explicit platform-admin action. No public recipient or arbitrary content inputs. */
export async function dispatchNextTransactionalEmail():Promise<{status:string}>{return dispatch(null,null,true);}
/** Call only after a persisted domain mutation. Sources and recipients are independently verified by SQL. */
export async function dispatchTransactionalEvent(kind:TransactionalEmail['kind'],reference:string){
 if(!EMAIL_KINDS.includes(kind)||typeof reference!=='string'||!UUID.test(reference))return {status:'unavailable'};
 return dispatch(kind,reference.toLowerCase(),false);
}
/** A reviewed renewal may lease only its new persisted queue ID, never the oldest matching email. */
export async function dispatchReviewedCustomerDocumentRenewal(kind:TransactionalEmail['kind'],reference:string,expectedEmailId:string):Promise<{status:string}>{
 if(!['offer_invitation','contract_invitation','contract_completed'].includes(kind)||typeof reference!=='string'||!UUID.test(reference)||typeof expectedEmailId!=='string'||!UUID.test(expectedEmailId))return {status:'unavailable'};
 try{return await dispatch(kind,reference.toLowerCase(),false,expectedEmailId.toLowerCase());}catch{return {status:'unavailable'};}
}
async function dispatch(kind:TransactionalEmail['kind']|null,reference:string|null,admin:boolean,expectedEmailId?:string):Promise<{status:string}>{
 const actor=admin?await requirePlatformAdminContext():null;
 if(emailConfigurationStatus(config(kind))!=='configured')return {status:'unconfigured'};
 const key=process.env.SUPABASE_SECRET_KEY,url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 if(!key||url!=='https://buqdtssxrotkzndublrt.supabase.co')return {status:'unconfigured'};
 const db:SupabaseClient<EmailDatabase>=createClient<EmailDatabase>(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10_000)})}});
 const claim=expectedEmailId&&kind&&reference
  ?await db.rpc('claim_transactional_email_exact',{p_kind:kind,p_reference:reference,p_expected_email_id:expectedEmailId})
  :await db.rpc('claim_transactional_email',kind&&reference?{p_kind:kind,p_reference:reference}:{});
 if(claim.error)return {status:'unavailable'};
 if(claim.data===null)return {status:'empty'};
 if(!claim.data||typeof claim.data!=='object'||Array.isArray(claim.data))return {status:'unavailable'};
 const row=claim.data;
 if(typeof row.id!=='string'||!UUID.test(row.id)||typeof row.leaseId!=='string'||!UUID.test(row.leaseId)||typeof row.reference!=='string'||!UUID.test(row.reference)||!validRecipient(row.recipient)||typeof row.createdAt!=='string'||!EMAIL_KINDS.includes(row.kind as TransactionalEmail['kind']))return {status:'unavailable'};
 if(kind&&row.kind!==kind||reference&&row.reference!==reference)return {status:'unavailable'};
 let review:import('./customer-contract-invitation-server').ReviewedCustomerDocumentEmail|undefined;
 const customerRow=['offer_invitation','contract_invitation','contract_completed'].includes(String(row.kind));
 if(customerRow&&row.generation!==undefined&&(typeof row.generation!=='number'||!Number.isSafeInteger(row.generation)||row.generation<0||row.generation>2147483647))return {status:'unavailable'};
 // Generic retry/admin dispatch may also claim a renewed generation. It must
 // carry the same immutable review proof as the initial exact-ID dispatch.
 if(expectedEmailId||customerRow&&typeof row.generation==='number'&&row.generation>0){
  if(expectedEmailId&&row.id!==expectedEmailId||typeof row.generation!=='number')return {status:'unavailable'};
  try{review=(await import('./customer-contract-invitation-server')).parseReviewedCustomerDocumentEmail(row.review,row.recipient,row.generation);}catch{return {status:'unavailable'};}
 }
 const finish=async(savedStatus:string,responseStatus=savedStatus,providerId:string|null=null)=>{
  let status='unknown';
  try{const saved=await db.rpc('finish_transactional_email',{p_id:row.id as string,p_lease_id:row.leaseId as string,p_status:savedStatus,p_provider_id:providerId});if(!saved.error&&saved.data===true)status=responseStatus;}catch{/* A failed acknowledgement never proves a final queue status. */}
  if(admin&&(await requirePlatformAdminContext()).userId!==actor?.userId)throw Error('Administrator changed');
  return {status};
 };
 if(admin){try{if((await requirePlatformAdminContext()).userId!==actor?.userId)throw Error('Administrator changed');}catch(error){try{await finish('cancelled');}catch{}throw error;}}
 let lease;
 try{lease=await db.rpc('check_transactional_email_lease',{p_id:row.id,p_lease_id:row.leaseId});}catch{return finish('pending','unavailable');}
 // No provider attempt occurred: a failed verification is not a source revocation.
 if(lease.error||typeof lease.data!=='boolean')return finish('pending','unavailable');
 if(!lease.data)return finish('cancelled');
 if(emailConfigurationStatus(config(String(row.kind)))!=='configured')return finish('pending','unconfigured');
 // Customer invitations grant access only to the linked document. Persist the
 // encrypted message before any provider call; no customer account is created.
 const result=row.kind==='contract_invitation'||row.kind==='offer_invitation'||row.kind==='contract_completed'
  ? await (await import('./customer-contract-invitation-server')).sendClaimedCustomerContractInvitation(db as unknown as import('./customer-contract-invitation-server').CustomerInvitationClient,
    {id:row.id,leaseId:row.leaseId,reference:row.reference,recipient:row.recipient,kind:row.kind,createdAt:row.createdAt},{apiKey:process.env.RESEND_API_KEY!,secret:key},review)
  : await sendTransactionalEmail({id:row.id,kind:row.kind as TransactionalEmail['kind'],reference:row.reference,recipient:row.recipient,createdAt:row.createdAt},config(String(row.kind)));
 return finish(result.status==='retryable'||result.status==='unconfigured'?'pending':result.status,result.status,result.status==='accepted'?result.providerId:null);
}
