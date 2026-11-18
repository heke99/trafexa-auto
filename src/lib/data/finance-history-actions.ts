'use server';
import {requireCrmContext,CrmError} from '@/lib/crm/context';
import {requireApprovedAccountAccess} from '@/lib/account-access/context';
export type FinanceHistoryItem={id:string;product:'purchase'|'stock';requested_amount_ore:string;deposit_ore:string;term_months:number|null;status:string;note:string|null;created_at:string};
export type FinanceHistoryPage={companyId:string;actorUserId:string;actorRole:string;applications:FinanceHistoryItem[];nextCursor:string|null;totalCount:string};
export type FinanceHistoryResult={ok:true;page:FinanceHistoryPage}|{ok:false;code:'invalid_input'|'access_denied'|'unavailable';message:string};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function record(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw Error();return v as Record<string,unknown>;}
function id(v:unknown):string{if(typeof v!=='string'||!UUID.test(v))throw Error();return v;}
function integer(v:unknown):string{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,99})$/.test(v))throw Error();return v;}
function instant(v:unknown):string{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v.slice(0,10)+'T12:00:00Z').toISOString().slice(0,10)!==v.slice(0,10))throw Error();return v;}
function micros(v:string){return BigInt(Date.parse(v))*1000n+BigInt((v.match(/\.(\d+)/)?.[1]??'').padEnd(6,'0').slice(3));}
export async function listFinanceHistoryAction(value:unknown):Promise<FinanceHistoryResult>{
 let company:string,before:string|null;
 try{const r=record(value);if(Object.keys(r).some(k=>!['companyId','before'].includes(k)))throw Error();company=id(r.companyId);before=r.before==null?null:id(r.before);}catch{return{ok:false,code:'invalid_input',message:'Kontrollera vald historiksida.'};}
 try{
  const ctx=await requireCrmContext(company),approval=await requireApprovedAccountAccess();if(approval.userId!==ctx.userId)throw new CrmError('access_denied');
  const db=ctx.db as unknown as{rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{code?:string}|null}>};
  const result=await db.rpc('list_finance_history',{p_company_id:company,p_before:before,p_limit:50});if(result.error){if(result.error.code==='42501')throw new CrmError('access_denied');throw Error();}
  const row=record(result.data);if(row.companyId!==company||row.actorUserId!==ctx.userId||row.actorRole!==ctx.role||!Array.isArray(row.applications)||row.applications.length>50)throw Error();
  const applications:FinanceHistoryItem[]=row.applications.map(v=>{const r=record(v);if(r.company_id!==company||!['purchase','stock'].includes(String(r.product))||!['intake','awaiting_partner','submitted','withdrawn'].includes(String(r.status))||r.note!==null&&(typeof r.note!=='string'||r.note.length>2000)||r.term_months!==null&&(typeof r.term_months!=='number'||!Number.isInteger(r.term_months)||r.term_months<1||r.term_months>120))throw Error();const amount=integer(r.requested_amount_ore),deposit=integer(r.deposit_ore);if(BigInt(amount)<1n)throw Error();return{id:id(r.id),product:r.product as 'purchase'|'stock',requested_amount_ore:amount,deposit_ore:deposit,term_months:r.term_months as number|null,status:r.status as string,note:r.note as string|null,created_at:instant(r.created_at)};});
  if(new Set(applications.map(r=>r.id)).size!==applications.length||applications.some((r,i)=>i>0&&(micros(r.created_at)>micros(applications[i-1].created_at)||micros(r.created_at)===micros(applications[i-1].created_at)&&r.id>=applications[i-1].id)))throw Error();
  const nextCursor=row.nextCursor===null?null:id(row.nextCursor),totalCount=integer(row.totalCount);if(nextCursor&&(nextCursor!==applications.at(-1)?.id||applications.length!==50)||BigInt(totalCount)<BigInt(applications.length))throw Error();
  const fresh=await requireCrmContext(company),freshApproval=await requireApprovedAccountAccess();if(fresh.userId!==ctx.userId||fresh.role!==ctx.role||freshApproval.userId!==ctx.userId)throw new CrmError('access_denied');
  return{ok:true,page:{companyId:company,actorUserId:ctx.userId,actorRole:ctx.role,applications,nextCursor,totalCount}};
 }catch(e){const denied=e instanceof CrmError&&e.code!=='unavailable';return{ok:false,code:denied?'access_denied':'unavailable',message:denied?'Din åtkomst till finanshistoriken kunde inte verifieras.':'Finanshistoriken kunde inte hämtas. Försök igen.'};}
}
