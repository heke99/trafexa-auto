'use server';
import {revalidatePath} from 'next/cache';
import {requireTradeInContext} from '@/lib/trade-in/context';
import {CrmError} from '@/lib/crm/context';
import type {TradeIn,TradeInPage,TradeInResult,CreateTradeInInput} from '@/lib/trade-in/types';
type Context=Awaited<ReturnType<typeof requireTradeInContext>>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('invalid');return v as Record<string,unknown>;}
function input(v:unknown,keys:string[]){const r=record(v);if(Object.keys(r).some(k=>!keys.includes(k)))throw Error('invalid');return r;}
function id(v:unknown){if(typeof v!=='string'||!UUID.test(v))throw Error('invalid');return v.toLowerCase();}
function integer(v:unknown,min:number,max:number){if(!Number.isSafeInteger(v)||Number(v)<min||Number(v)>max)throw Error('invalid');return v as number;}
function text(v:unknown,min:number,max:number,multi=false){if(typeof v!=='string')throw Error('invalid');const s=v.trim();if(s.length<min||s.length>max||(multi?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(s))throw Error('invalid');return s;}
function money(v:unknown,min=0n,max=999999999999n){if(typeof v!=='string'||!/^(-?[1-9]\d*|0)$/.test(v)||BigInt(v)<min||BigInt(v)>max)throw Error('invalid');return v;}
function dto(v:unknown,c:Context,dealId:string):TradeIn{const r=record(v);if(id(r.companyId)!==c.companyId||id(r.dealId)!==dealId||typeof r.debtKnown!=='boolean'||typeof r.createdAt!=='string'||!Number.isFinite(Date.parse(r.createdAt)))throw Error('invalid');
 const valueOre=money(r.valueOre,1n),salePriceOre=money(r.salePriceOre,1n),debtOre=r.debtOre===null?null:money(r.debtOre),netTradeInOre=r.netTradeInOre===null?null:money(r.netTradeInOre,-999999999999n),amountToPayOre=r.amountToPayOre===null?null:money(r.amountToPayOre,-999999999999n,1999999999998n);
 if(r.debtKnown?(debtOre===null||netTradeInOre===null||amountToPayOre===null||BigInt(netTradeInOre)!==BigInt(valueOre)-BigInt(debtOre)||BigInt(amountToPayOre)!==BigInt(salePriceOre)-BigInt(netTradeInOre)):(debtOre!==null||netTradeInOre!==null||amountToPayOre!==null))throw Error('invalid math');
 const registration=text(r.registration,2,15);if(registration!==registration.toUpperCase())throw Error('invalid');
 return{id:id(r.id),companyId:c.companyId,dealId,customerId:id(r.customerId),version:integer(r.version,1,2147483647),registration,make:text(r.make,2,160),model:text(r.model,2,160),modelYear:integer(r.modelYear,1900,9999),mileageKm:integer(r.mileageKm,0,2000000),conditionNotes:text(r.conditionNotes,0,2000,true),equipmentNotes:text(r.equipmentNotes,0,2000,true),valueOre,debtKnown:r.debtKnown,debtOre,lenderName:r.lenderName===null?null:text(r.lenderName,1,160),salePriceOre,netTradeInOre,amountToPayOre,createdAt:r.createdAt,actorLabel:id(r.createdBy)===c.userId?'Du':'Kollega'};
}
function failure(e:unknown,validation=false):TradeInResult<never>{const dbCode=e&&typeof e==='object'&&'code'in e?e.code:null;const code=e instanceof CrmError?e.code:validation?'invalid_input':dbCode==='40001'?'conflict':dbCode==='42501'?'access_denied':'unavailable';return{ok:false,code,message:code==='invalid_input'?'Kontrollera inbytesbilens uppgifter och bekräfta granskningen.':code==='conflict'?'Affären eller inbytesunderlaget har ändrats. Uppdatera innan du försöker igen. En accepterad offert kräver separat överenskommelse.':code==='access_denied'||code==='unauthenticated'?'Din inloggning eller företagsbehörighet kunde inte verifieras.':'Resultatet kunde inte bekräftas. Uppdatera listan och försök vid behov igen med samma uppgifter och begäran.'};}
async function fresh(c:Context,write=false){const n=await requireTradeInContext(c.companyId,write?'write':'read');if(n.userId!==c.userId||n.role!==c.role)throw new CrmError('access_denied');}
export async function listDealTradeInsAction(value:{companyId:string;dealId:string;beforeVersion?:number|null}):Promise<TradeInResult<TradeInPage>>{
 let companyId:string,dealId:string,beforeVersion:number|null;
 try{const r=input(value,['companyId','dealId','beforeVersion']);companyId=id(r.companyId);dealId=id(r.dealId);beforeVersion=r.beforeVersion===undefined||r.beforeVersion===null?null:integer(r.beforeVersion,1,2147483647);}catch(e){return failure(e,true);}
 try{const c=await requireTradeInContext(companyId);const response=await c.db.rpc('list_deal_trade_ins',{p_company_id:companyId,p_deal_id:dealId,p_before_version:beforeVersion,p_limit:50});if(response.error)throw response.error;const p=record(response.data);
 if(id(p.companyId)!==companyId||id(p.actorUserId)!==c.userId||p.actorRole!==c.role||id(p.dealId)!==dealId||!Array.isArray(p.versions)||p.versions.length>50||typeof p.canCreate!=='boolean')throw Error('invalid scope');
 const versions=p.versions.map(v=>dto(v,c,dealId)),latestVersion=integer(p.latestVersion,0,2147483647),nextBeforeVersion=p.nextBeforeVersion===null?null:integer(p.nextBeforeVersion,1,2147483647);
 if(versions.some((v,i)=>v.version>latestVersion||beforeVersion!==null&&v.version>=beforeVersion||i>0&&v.version>=versions[i-1].version)||nextBeforeVersion!==null&&(versions.length!==50||nextBeforeVersion!==versions.at(-1)?.version)||beforeVersion===null&&(versions[0]?.version??0)!==latestVersion)throw Error('invalid page');
 const page={companyId,dealId,salePriceOre:money(p.salePriceOre,1n),customerName:text(p.customerName,1,160),versions,nextBeforeVersion,latestVersion,canCreate:p.canCreate};await fresh(c);return{ok:true,...page};
 }catch(e){return failure(e);}
}
export async function createTradeInVersionAction(value:CreateTradeInInput):Promise<TradeInResult<{tradeIn:TradeIn}>>{
 let v:CreateTradeInInput;
 try{const r=input(value,['companyId','dealId','expectedVersion','expectedSalePriceOre','registration','make','model','modelYear','mileageKm','conditionNotes','equipmentNotes','valueOre','debtKnown','debtOre','lenderName','reviewAcknowledged','requestId']);if(r.reviewAcknowledged!==true||typeof r.debtKnown!=='boolean')throw Error('invalid');
 v={companyId:id(r.companyId),dealId:id(r.dealId),expectedVersion:integer(r.expectedVersion,0,2147483646),expectedSalePriceOre:money(r.expectedSalePriceOre,1n),registration:text(text(r.registration,2,15).toUpperCase(),2,15),make:text(r.make,2,160),model:text(r.model,2,160),modelYear:integer(r.modelYear,1900,9999),mileageKm:integer(r.mileageKm,0,2000000),conditionNotes:text(r.conditionNotes,0,2000,true),equipmentNotes:text(r.equipmentNotes,0,2000,true),valueOre:money(r.valueOre,1n),debtKnown:r.debtKnown,debtOre:r.debtOre===null?null:money(r.debtOre),lenderName:r.lenderName===null?null:text(r.lenderName,1,160),reviewAcknowledged:true,requestId:id(r.requestId)};
 if(v.debtKnown?(v.debtOre===null):v.debtOre!==null)throw Error('invalid');
 }catch(e){return failure(e,true);}
 try{const c=await requireTradeInContext(v.companyId,'write');const response=await c.db.rpc('create_trade_in_version',{p_company_id:v.companyId,p_deal_id:v.dealId,p_expected_version:v.expectedVersion,p_expected_sale_price_ore:v.expectedSalePriceOre,p_registration:v.registration,p_make:v.make,p_model:v.model,p_model_year:v.modelYear,p_mileage_km:v.mileageKm,p_condition_notes:v.conditionNotes,p_equipment_notes:v.equipmentNotes,p_value_ore:v.valueOre,p_debt_known:v.debtKnown,p_debt_ore:v.debtOre,p_lender_name:v.lenderName,p_request_id:v.requestId});if(response.error)throw response.error;const p=record(response.data);if(id(p.companyId)!==c.companyId||id(p.actorUserId)!==c.userId||id(p.requestId)!==v.requestId)throw Error('invalid receipt');const t=dto(p.tradeIn,c,v.dealId);
 for(const k of ['registration','make','model','modelYear','mileageKm','conditionNotes','equipmentNotes','valueOre','debtKnown','debtOre','lenderName'] as const)if(t[k]!==v[k])throw Error('invalid receipt');if(t.version!==v.expectedVersion+1||t.salePriceOre!==v.expectedSalePriceOre||t.actorLabel!=='Du')throw Error('invalid receipt');await fresh(c,true);revalidatePath('/deals');return{ok:true,tradeIn:t};
 }catch(e){return failure(e);}
}
