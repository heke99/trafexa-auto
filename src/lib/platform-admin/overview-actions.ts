'use server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PlatformAdminError, requirePlatformAdminContext } from './context';
import type { PlatformOverview, PlatformOverviewResult } from './overview-types';
import type { PlatformOverviewDatabase } from './overview-database.types';
class OverviewError extends Error { constructor(readonly code:'invalid_input'|'unavailable'|'access_denied'){super('Overview unavailable');} }
function record(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new OverviewError('unavailable');
 return value as Record<string,unknown>;
}
function count(value:unknown):string {if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)||value.length>100)throw new OverviewError('unavailable');return value;}
function group(value:unknown,keys:string[]):Record<string,string>{const row=record(value);return Object.fromEntries(keys.map(key=>[key,count(row[key])]));}
function parse(value:unknown,actor:string):PlatformOverview {
 const row=record(value);
 if(row.actorUserId!==actor||typeof row.generatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(row.generatedAt)||!Number.isFinite(Date.parse(row.generatedAt)))throw new OverviewError('unavailable');
 if(new Date(row.generatedAt.slice(0,10)+'T12:00:00Z').toISOString().slice(0,10)!==row.generatedAt.slice(0,10))throw new OverviewError('unavailable');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.generatedAt));
 if(!Array.isArray(row.daily)||row.daily.length!==7)throw new OverviewError('unavailable');
 const daily=row.daily.map((value,index)=>{const day=record(value);const expected=new Date(Date.parse(today+'T12:00:00Z')-(6-index)*86400000).toISOString().slice(0,10);if(day.date!==expected)throw new OverviewError('unavailable');return {date:expected,applications:count(day.applications),companies:count(day.companies),deals:count(day.deals)};});
 return {actorUserId:actor,generatedAt:row.generatedAt,
 companies:group(row.companies,['total','active','suspended']),users:group(row.users,['total','verified','activeMemberships']),
 applications:group(row.applications,['total','new','inReview','contacted','closed','legacyIncomplete']),inventory:group(row.inventory,['total','available','reserved','sold','archived']),
 deals:group(row.deals,['total','draft','reserved','cancelled','completed']),offers:group(row.offers,['versions','customerReviews','accepted','declined']),
 advertising:group(row.advertising,['draft','ready','connectionsRequested','connectionsVerified']),financing:group(row.financing,['intakeRequests']),
 stockAskingPriceOre:count(row.stockAskingPriceOre),daily} as PlatformOverview;
}
export async function getPlatformOverviewAction(value:unknown={}):Promise<PlatformOverviewResult>{
 try{
  const before=await requirePlatformAdminContext();
  let obj:Record<string,unknown>;try{obj=record(value);}catch{throw new OverviewError('invalid_input');}
  if(Object.keys(obj).length)throw new OverviewError('invalid_input');
  const result=await (before.db as unknown as SupabaseClient<PlatformOverviewDatabase>).rpc('get_platform_overview',{});
  if(result.error)throw new OverviewError(result.error.code==='42501'?'access_denied':'unavailable');
  const overview=parse(result.data,before.userId);
  const after=await requirePlatformAdminContext();
  if(after.userId!==before.userId)throw new OverviewError('access_denied');
  return {ok:true,overview};
 }catch(error){
  const code=error instanceof PlatformAdminError?(error.code==='unavailable'?'unavailable':'access_denied'):error instanceof OverviewError?error.code:'unavailable';
  return {ok:false,code,message:code==='access_denied'?'Du har inte tillgång till plattformsadministrationen.':code==='invalid_input'?'Kontrollera begäran och försök igen.':'Översikten kunde inte verifieras. Försök igen.'};
 }
}
