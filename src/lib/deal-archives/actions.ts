'use server';
import {z} from 'zod';
import {revalidatePath} from 'next/cache';
import {requireCrmContext} from '@/lib/crm/context';
import {requireApprovedAccountAccess} from '@/lib/account-access/context';
import type {DealArchiveInput,DealArchiveResult} from './types';
const uuid=z.string().uuid().transform(v=>v.toLowerCase());
const scope=z.object({companyId:uuid,dealId:uuid}).strict();
const input=scope.extend({operation:z.enum(['archive','restore']),expectedVersion:z.number().int().min(0).max(2147483646),reviewHash:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().min(2).max(300).regex(/^[^\u0000-\u001f\u007f]*$/),acknowledged:z.literal(true),requestId:uuid}).strict();
const page=z.object({companyId:uuid,dealId:uuid,actorId:uuid,role:z.enum(['owner','admin','sales','finance','viewer']),version:z.number().int().min(0),archived:z.boolean(),dealStatus:z.enum(['draft','reserved','cancelled','completed']),canArchive:z.boolean(),blockedReason:z.enum(['active_reservation','live_contract','unsettled_payment','deal_unavailable']).nullable(),reviewHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
async function run(value:unknown,write:boolean):Promise<DealArchiveResult>{try{
 const v=write?input.parse(value):scope.parse(value),c=await requireCrmContext(v.companyId),access=await requireApprovedAccountAccess();
 if(access.userId!==c.userId||write&&!['owner','admin'].includes(c.role))throw{code:'42501'};
 const db=c.db as unknown as {rpc(name:string,args:Record<string,unknown>):Promise<{data:unknown;error:unknown}>};
 const response=await db.rpc(write?'mutate_deal_archive':'get_deal_archive',{p_company_id:v.companyId,p_deal_id:v.dealId,...(write?{p_input:v}:{})});if(response.error)throw response.error;
 const p=page.parse(response.data),fresh=await requireCrmContext(v.companyId),approved=await requireApprovedAccountAccess();
 if(p.companyId!==c.companyId||p.dealId!==v.dealId||p.actorId!==c.userId||p.role!==c.role||fresh.userId!==c.userId||fresh.role!==c.role||approved.userId!==c.userId)throw{code:'42501'};
 if(write)for(const path of['/deals','/dashboard'])revalidatePath(path);
 return{ok:true,page:p};
 }catch(e){const raw=e&&typeof e==='object'&&'code'in e?String(e.code):'',code=e instanceof z.ZodError||raw==='22023'?'invalid_input':['42501','access_denied','unauthenticated'].includes(raw)?'access_denied':['40001','23505','55000'].includes(raw)?'conflict':'unavailable';return{ok:false,code,message:code==='access_denied'?'Din behörighet kunde inte verifieras. Läs in sidan igen.':code==='conflict'?'Affären har ändrats eller har ett aktivt avtal, en reservation eller en oavslutad betalning. Läs in aktuell status.':code==='invalid_input'?'Kontrollera granskningen och ange en anledning.':'Resultatet kunde inte bekräftas. Försök igen med samma begäran.'};}}
export async function getDealArchiveAction(value:{companyId:string;dealId:string}):Promise<DealArchiveResult>{return run(value,false);}
export async function mutateDealArchiveAction(value:DealArchiveInput):Promise<DealArchiveResult>{return run(value,true);}
