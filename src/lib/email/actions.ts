'use server';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database,Json} from '@/lib/supabase/database.types';
import {requirePlatformAdminContext} from '@/lib/platform-admin/context';
import {dispatchNextTransactionalEmail,transactionalEmailConfigurationStatus} from './server';
type StatusDatabase=Omit<Database,'public'>&{public:Omit<Database['public'],'Functions'>&{Functions:{get_transactional_email_status:{Args:Record<string,never>;Returns:Json}}}};
type QueueStatus={sendableCount:number;oldestSendableAt:string|null;oldestSendableAgeSeconds:number|null;byKind:{kind:string;pending:number;sendable:number;oldestSendableAt:string|null}[]};
function count(v:unknown):number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw Error();return v;}
function date(v:unknown):string|null{if(v===null)return null;if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))throw Error();return v;}
function queueStatus(value:unknown):QueueStatus|null{
 if(value===undefined)return null;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error();const q=value as Record<string,unknown>;
 if(!Array.isArray(q.byKind)||q.byKind.length>30)throw Error();
 const byKind=q.byKind.map(v=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error();const row=v as Record<string,unknown>;if(typeof row.kind!=='string'||!/^[a-z_]{1,60}$/.test(row.kind))throw Error();return{kind:row.kind,pending:count(row.pending),sendable:count(row.sendable),oldestSendableAt:date(row.oldestSendableAt)};});
 if(new Set(byKind.map(v=>v.kind)).size!==byKind.length)throw Error();
 return{sendableCount:count(q.sendableCount),oldestSendableAt:date(q.oldestSendableAt),oldestSendableAgeSeconds:q.oldestSendableAgeSeconds===null?null:count(q.oldestSendableAgeSeconds),byKind};
}
export async function getTransactionalEmailStatusAction(){try{
 const {db,userId}=await requirePlatformAdminContext();const result=await(db as unknown as SupabaseClient<StatusDatabase>).rpc('get_transactional_email_status',{});
 if(result.error)throw result.error;if(!result.data||typeof result.data!=='object'||Array.isArray(result.data))throw Error();
 const counts:Record<string,number>={};for(const key of ['pending','processing','accepted','rejected','unknown','cancelled'])counts[key]=count(result.data[key]);
 const queue=queueStatus(result.data.queue);
 if((await requirePlatformAdminContext()).userId!==userId)throw{code:'42501'};
 return{ok:true as const,...transactionalEmailConfigurationStatus(),counts,queue};
 }catch(error){const c=error&&typeof error==='object'&&'code'in error?String(error.code):'';const denied=['unauthenticated','forbidden','access_denied','42501'].includes(c);return{ok:false as const,code:denied?'access_denied':'unavailable',message:denied?'Du har inte tillgång till mejlhanteringen.':'Mejlstatus kunde inte hämtas just nu. Uppdatera status för att försöka igen.'};}}

export async function dispatchTransactionalEmailAction(value:unknown){try{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!('acknowledged' in value)||value.acknowledged!==true)return {ok:false as const,message:'Bekräfta utskicket.'};return {ok:true as const,...await dispatchNextTransactionalEmail()};}catch{return {ok:false as const,message:'Utskicket kunde inte verifieras.'};}}
