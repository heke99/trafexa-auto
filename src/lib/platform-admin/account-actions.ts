'use server';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PlatformAdminError, requirePlatformAdminContext } from './context';
import type { AdminResult } from './database.types';
import type { AccountDatabase } from '@/lib/account-access/database.types';
import type { AccountPage, AccountReceipt, AccountStatus, PlatformAccount } from '@/lib/account-access/types';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class ActionError extends Error { constructor(readonly code:'invalid_input'|'unavailable'|'access_denied'|'conflict'|'not_found'){super('Account review failed');} }
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new ActionError('invalid_input');return value as Record<string,unknown>;}
function input(value:unknown,keys:string[]){const row=object(value);if(Object.keys(row).some(key=>!keys.includes(key)))throw new ActionError('invalid_input');return row;}
function uuid(value:unknown){if(typeof value!=='string'||!UUID.test(value))throw new ActionError('invalid_input');return value.toLowerCase();}
function status(value:unknown):AccountStatus{if(typeof value!=='string'||!['pending','approved','rejected','suspended'].includes(value))throw new ActionError('invalid_input');return value as AccountStatus;}
function integer(value:unknown){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>2147483647)throw new ActionError('invalid_input');return value;}
function text(value:unknown,max:number){if(typeof value!=='string'||!value.length||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new ActionError('invalid_input');return value;}
function displayName(value:unknown):string|null{return typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f]/.test(value)?value:null;}
function timestamp(value:unknown){const s=text(value,80);if(!Number.isFinite(Date.parse(s)))throw new ActionError('unavailable');return s;}
function rpcError(error:{code?:string}|null){if(error)throw new ActionError(error.code==='42501'?'access_denied':error.code==='40001'?'conflict':error.code==='P0002'?'not_found':error.code==='22023'?'invalid_input':'unavailable');}
function failure(error:unknown):AdminResult<never>{const code=error instanceof PlatformAdminError?(error.code==='unavailable'?'unavailable':'access_denied'):error instanceof ActionError?error.code:'unavailable';const messages={invalid_input:'Kontrollera uppgifterna och ange en motivering.',unavailable:'Kontot kunde inte verifieras. Försök igen med samma uppgifter.',access_denied:'Du har inte behörighet att hantera kontot.',conflict:'Kontot har ändrats. Läs in aktuella uppgifter.',not_found:'Kontot kunde inte hittas.'};return {ok:false,code,message:messages[code]};}
export async function listPlatformAccountsAction(value:unknown={}):Promise<AdminResult<AccountPage>> {
 try{
 const {db,userId}=await requirePlatformAdminContext();const obj=input(value,['filter','pageKey','limit','search']);
 const filter=obj.filter??'pending';if(filter!=='all')status(filter);
 const searching=obj.search!==undefined;
 if(searching&&(typeof obj.search!=='string'||obj.search.length>254||/[\s\u0000-\u001f\u007f-\u009f]/.test(obj.search.trim())))throw new ActionError('invalid_input');
 const query=searching?(obj.search as string).trim().toLowerCase():'';
 function cursor(value:unknown){const c=input(value,['actorId','filter','query','id','createdAt']);if(Object.keys(c).length!==5||c.actorId!==userId||c.filter!==filter||c.query!==query)throw new ActionError('invalid_input');uuid(c.id);timestamp(c.createdAt);return c;}
 let searchCursor:ReturnType<typeof cursor>|null=null;
 if(searching&&obj.pageKey!=null){if(typeof obj.pageKey!=='string'||obj.pageKey.length>2048)throw new ActionError('invalid_input');try{searchCursor=cursor(JSON.parse(obj.pageKey));}catch{throw new ActionError('invalid_input');}}
 const pageKey=searching?null:obj.pageKey==null?null:uuid(obj.pageKey),limit=obj.limit===undefined?50:integer(obj.limit);if(limit<1||limit>50)throw new ActionError('invalid_input');
 const client=db as unknown as SupabaseClient<AccountDatabase>;
 const result=searching?await client.rpc('search_platform_accounts',{p_filter:filter as string,p_query:query,p_cursor:searchCursor as import('@/lib/supabase/database.types').Json|null,p_limit:limit}):await client.rpc('list_platform_accounts',{p_filter:filter as string,p_page_key:pageKey,p_limit:limit});rpcError(result.error);
 const row=object(result.data);if(row.actorUserId!==userId||!Array.isArray(row.accounts)||row.accounts.length>limit)throw new ActionError('unavailable');
 if(searching&&(row.filter!==filter||row.query!==query))throw new ActionError('unavailable');
 const accounts:PlatformAccount[]=row.accounts.map(value=>{const a=object(value);if(typeof a.emailVerified!=='boolean'||typeof a.isPlatformAdmin!=='boolean')throw new ActionError('unavailable');const account:PlatformAccount={userId:uuid(a.userId),name:displayName(a.name),email:text(a.email,254),emailVerified:a.emailVerified,createdAt:timestamp(a.createdAt),status:status(a.status),version:integer(a.version),isPlatformAdmin:a.isPlatformAdmin};if(filter!=='all'&&account.status!==filter||account.version===0&&account.status!=='pending'&&!account.isPlatformAdmin)throw new ActionError('unavailable');return account;});
 if(new Set(accounts.map(a=>a.userId)).size!==accounts.length||accounts.some((a,i)=>i>0&&(Date.parse(a.createdAt)>Date.parse(accounts[i-1].createdAt)||a.createdAt===accounts[i-1].createdAt&&a.userId>=accounts[i-1].userId)))throw new ActionError('unavailable');
 if(searching&&accounts.some(account=>!account.email.toLowerCase().includes(query)))throw new ActionError('unavailable');
 let nextPageKey:string|null;
 if(searching){if(row.nextCursor===null)nextPageKey=null;else{const next=cursor(row.nextCursor);if(next.id!==accounts.at(-1)?.userId||Date.parse(next.createdAt as string)!==Date.parse(accounts.at(-1)!.createdAt))throw new ActionError('unavailable');nextPageKey=JSON.stringify(next);}}
 else {nextPageKey=row.nextPageKey===null?null:uuid(row.nextPageKey);if(nextPageKey&&nextPageKey!==accounts.at(-1)?.userId)throw new ActionError('unavailable');}
 const fresh=await requirePlatformAdminContext();if(fresh.userId!==userId)throw new ActionError('access_denied');
 return {ok:true,accounts,nextPageKey};
 }catch(error){return failure(error);}
}
export async function setPlatformAccountAccessAction(value:unknown):Promise<AdminResult<{receipt:AccountReceipt}>> {
 try{
 const {db,userId:actor}=await requirePlatformAdminContext();const obj=input(value,['userId','expectedVersion','status','reason','requestId']);
 const userId=uuid(obj.userId),requestId=uuid(obj.requestId),expectedVersion=integer(obj.expectedVersion),target=status(obj.status),reason=text(obj.reason,500).trim();if(userId===actor||target==='pending'||reason.length<2||expectedVersion===2147483647)throw new ActionError('invalid_input');
 const result=await (db as unknown as SupabaseClient<AccountDatabase>).rpc('set_platform_account_access',{p_user_id:userId,p_expected_version:expectedVersion,p_status:target,p_reason:reason,p_request_id:requestId});rpcError(result.error);
 const row=object(result.data),previousStatus=status(row.previousStatus),changed=previousStatus!==target;
 if(row.actorUserId!==actor||row.userId!==userId||row.requestId!==requestId||row.status!==target||row.reason!==reason||row.changed!==changed||row.version!==expectedVersion+(changed?1:0))throw new ActionError('unavailable');
 const receipt:AccountReceipt={userId,requestId,status:target,previousStatus,version:integer(row.version),reason,createdAt:timestamp(row.createdAt),changed};
 const fresh=await requirePlatformAdminContext();if(fresh.userId!==actor)throw new ActionError('access_denied');
 try{revalidatePath('/admin');}catch{}
 if(receipt.changed&&receipt.status==='approved'&&process.env.TRANSACTIONAL_EMAIL_ENABLED==='true'){try{const {dispatchTransactionalEvent}=await import('@/lib/email/server');await dispatchTransactionalEvent('account_approved',receipt.userId);}catch{/* Approval persists; delivery remains in the durable queue. */}}
 return {ok:true,receipt};
 }catch(error){return failure(error);}
}
