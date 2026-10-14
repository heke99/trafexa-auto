import 'server-only';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {Database,Json} from '@/lib/supabase/database.types';
import {EMAIL_KINDS,type TransactionalEmail} from './templates';
import {emailConfigurationStatus,sendTransactionalEmail} from './transport';
import {requirePlatformAdminContext} from '@/lib/platform-admin/context';
type EmailDatabase=Omit<Database,'public'>&{public:Omit<Database['public'],'Functions'>&{Functions:{claim_transactional_email:{Args:{p_kind?:string;p_reference?:string};Returns:Json};check_transactional_email_lease:{Args:{p_id:string;p_lease_id:string};Returns:boolean};finish_transactional_email:{Args:{p_id:string;p_lease_id:string;p_status:string;p_provider_id:string|null};Returns:boolean}}}};
function config(){return {enabled:process.env.TRANSACTIONAL_EMAIL_ENABLED==='true'&&process.env.TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED==='true'&&!!process.env.SUPABASE_SECRET_KEY&&process.env.NEXT_PUBLIC_SUPABASE_URL==='https://buqdtssxrotkzndublrt.supabase.co',apiKey:process.env.RESEND_API_KEY};}
export function transactionalEmailConfigurationStatus(){return {transport:emailConfigurationStatus(config()),sender:'kundtjanst@trafexa.com',replyTo:'info@trafexa.com',automaticSchedule:false as const};}
/** One bounded message per explicit platform-admin action. No public recipient or arbitrary content inputs. */
export async function dispatchNextTransactionalEmail():Promise<{status:string}>{return dispatch(null,null,true);}
/** Call only after a persisted domain mutation. Sources and recipients are independently verified by SQL. */
export async function dispatchTransactionalEvent(kind:TransactionalEmail['kind'],reference:string){return dispatch(kind,reference,false);}
async function dispatch(kind:TransactionalEmail['kind']|null,reference:string|null,admin:boolean):Promise<{status:string}>{
 const actor=admin?await requirePlatformAdminContext():null;
 if(emailConfigurationStatus(config())!=='configured')return {status:'unconfigured'};
 const key=process.env.SUPABASE_SECRET_KEY,url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 if(!key||url!=='https://buqdtssxrotkzndublrt.supabase.co')return {status:'unconfigured'};
 const db:SupabaseClient<EmailDatabase>=createClient<EmailDatabase>(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const claim=await db.rpc('claim_transactional_email',kind&&reference?{p_kind:kind,p_reference:reference}:{});
 if(claim.error)return {status:'unavailable'};
 if(claim.data===null)return {status:'empty'};
 if(!claim.data||typeof claim.data!=='object'||Array.isArray(claim.data))return {status:'unavailable'};
 const row=claim.data;
 if(typeof row.id!=='string'||typeof row.leaseId!=='string'||typeof row.reference!=='string'||typeof row.recipient!=='string'||typeof row.createdAt!=='string'||!EMAIL_KINDS.includes(row.kind as TransactionalEmail['kind']))return {status:'unavailable'};
 if(kind&&row.kind!==kind||reference&&row.reference!==reference)return {status:'unavailable'};
 const finish=async(status:string,providerId:string|null=null)=>db.rpc('finish_transactional_email',{p_id:row.id as string,p_lease_id:row.leaseId as string,p_status:status,p_provider_id:providerId});
 const fresh=admin?await requirePlatformAdminContext():null;
 if(admin&&fresh?.userId!==actor?.userId){await finish('cancelled');return {status:'access_denied'};}
 const lease=await db.rpc('check_transactional_email_lease',{p_id:row.id,p_lease_id:row.leaseId});
 if(lease.error||lease.data!==true){await finish('cancelled');return {status:'cancelled'};}
 const result=await sendTransactionalEmail({id:row.id,kind:row.kind as TransactionalEmail['kind'],reference:row.reference,recipient:row.recipient,createdAt:row.createdAt},config());
 const saved=await finish(result.status==='retryable'||result.status==='unconfigured'?'pending':result.status,result.status==='accepted'?result.providerId:null);
 return {status:saved.error||saved.data!==true?'unknown':result.status};
}
