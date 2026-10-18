'use server';
import {requirePlatformAdminContext,PlatformAdminError} from '@/lib/platform-admin/context';
import {paymentExact} from './payment-validation';
import {receivablesFilter,receivablesCursor,parseAdvertisingReceivablesPage} from './receivables-validation';
import type {AdvertisingReceivablesCursor,AdvertisingReceivablesFilter,AdvertisingReceivablesInput,AdvertisingReceivablesResult} from './receivables-types';
export async function getPlatformAdvertisingReceivablesAction(value:AdvertisingReceivablesInput):Promise<AdvertisingReceivablesResult>{
 let filter:AdvertisingReceivablesFilter,cursor:AdvertisingReceivablesCursor|null;
 try{const r=paymentExact(value,['filter','cursor']);filter=receivablesFilter(r.filter);cursor=receivablesCursor(r.cursor,filter);}catch{return{ok:false,code:'invalid_input',message:'Kontrollera fakturafilter och sida. Uppdatera vyn om filtret har ändrats.'};}
 try{const c=await requirePlatformAdminContext();if(cursor&&cursor.actorUserId!==c.userId)return{ok:false,code:'invalid_input',message:'Sidmarkören hör till en annan administratör. Börja från första sidan.'};
 const db=c.db as unknown as{rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{code?:string}|null}>};
 const r=await db.rpc('get_platform_advertising_receivables',{p_filter:filter,p_cursor:cursor});if(r.error)throw r.error;
 const page=parseAdvertisingReceivablesPage(r.data,c.userId,filter,cursor),fresh=await requirePlatformAdminContext();if(fresh.userId!==c.userId)throw new PlatformAdminError('forbidden');return{ok:true,page};
 }catch(e){const raw=e instanceof PlatformAdminError?(e.code==='forbidden'?'access_denied':e.code):typeof e==='object'&&e!==null&&'code'in e?(e.code==='42501'?'access_denied':e.code==='22023'?'invalid_input':'unavailable'):'unavailable';const code=raw as 'access_denied'|'unauthenticated'|'invalid_input'|'unavailable';return{ok:false,code,message:code==='access_denied'||code==='unauthenticated'?'Din superadminbehörighet till annonsfakturorna kunde inte verifieras.':'Annonsfakturorna kunde inte hämtas och verifieras. Uppdatera vyn och försök igen.'};}
}
