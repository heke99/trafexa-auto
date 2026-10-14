'use server';

import { revalidatePath } from 'next/cache';
import { getActiveCompanyContext } from './company-context';
import { uuidField } from './validation';
import { parseOfferSnapshot, type OfferTradeInSnapshot } from '../documents/offer-pdf';
import {requireCrmContext,CrmError} from '@/lib/crm/context';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {OfferDatabase} from '@/lib/offer/database.types';

export type OfferSummary = { id: string; version: number; createdAt: string; validUntil: string; salePriceOre: string; vatScheme: 'standard' | 'vmb' | 'unknown'; tradeIn: OfferTradeInSnapshot | null };
export type OfferListResult = { ok: boolean; message: string; code?:'unauthenticated'|'access_denied'|'conflict'|'invalid_input'|'unavailable'; companyId?: string; offers?: OfferSummary[]; nextBeforeVersion?: number };
export type OfferCreateResult = { ok: boolean; message: string; code?:'unauthenticated'|'access_denied'|'conflict'|'invalid_input'|'unavailable'; offerId?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listDealOffersAction(dealId: string, expectedCompany?: string, beforeVersion?: number): Promise<OfferListResult> {
  if (typeof dealId !== 'string' || !uuid.test(dealId) || (expectedCompany !== undefined && (typeof expectedCompany !== 'string' || !uuid.test(expectedCompany))) || (beforeVersion !== undefined && (!Number.isSafeInteger(beforeVersion) || beforeVersion < 1))) return { ok: false, message: 'Affären är ogiltig. Öppna affärslistan igen.' };
  try {
    const selected=await getActiveCompanyContext();
    const company=selected.company.toLowerCase(),ctx=await requireCrmContext(company),db=ctx.db;
    if (expectedCompany && company.toLowerCase() !== expectedCompany.toLowerCase()) return { ok: false, message: 'Det aktiva företaget har ändrats. Öppna affärslistan igen.' };
    const { data: deal, error: dealError } = await db.from('deals').select('id').eq('company_id', company).eq('id', dealId).maybeSingle();
    if (dealError || !deal) return { ok: false,code:'access_denied', message: 'Affären kunde inte hämtas i det aktiva företaget.' };
    let query = db.from('offers').select('id,version,created_at,snapshot').eq('company_id', company).eq('deal_id', dealId).order('version', { ascending: false }).limit(51);
    if (beforeVersion !== undefined) query = query.lt('version', beforeVersion);
    const { data, error } = await query;
    if (error) return { ok: false, message: 'Offertversionerna kunde inte hämtas. Försök igen.' };
    const rows = (data ?? []).slice(0, 50);
    const offers = rows.map((row) => {
      const snapshot = parseOfferSnapshot(row.snapshot);
      if(!uuid.test(row.id)||snapshot.company.id.toLowerCase()!==company||snapshot.deal_id.toLowerCase()!==dealId.toLowerCase()||snapshot.version!==row.version||!Number.isSafeInteger(row.version)||row.version<1||typeof row.created_at!=='string'||!Number.isFinite(Date.parse(row.created_at)))throw Error('Invalid scoped offer');
      return { id: row.id, version: row.version, createdAt: row.created_at, validUntil: snapshot.valid_until, salePriceOre: snapshot.sale_price_ore, vatScheme: snapshot.stock.vat_scheme,tradeIn:snapshot.trade_in??null };
    });
    const fresh=await requireCrmContext(company);if(fresh.userId!==ctx.userId||fresh.role!==ctx.role)throw new CrmError('access_denied');
    return { ok: true, message: '', companyId: company, offers, nextBeforeVersion: (data?.length ?? 0) > 50 ? rows.at(-1)?.version : undefined };
  } catch { return { ok: false,code:'access_denied', message: 'Offertversionerna kunde inte hämtas. Kontrollera att du är inloggad i rätt företag och försök igen.' }; }
}

/** Actor and tenant come from verified auth/membership. The RPC snapshots all business data. */
export async function createOfferVersionAction(form: FormData): Promise<OfferCreateResult> {
  let deal: string, submission: string, expectedCompany: string, terms: string, validUntil: string,tradeInId:string|null=null,expectedTradeInVersion:number|null=null,expectedOfferVersion:number|null=null,expectedSalePriceOre:string|null=null;
  try {
    const keys=['deal_id','submission_id','company_id','gross_confirmed','terms','valid_until','trade_in_id','expected_trade_in_version','expected_offer_version','expected_sale_price_ore','trade_in_confirmed'];
    if(Array.from(form.keys()).some(k=>!keys.includes(k)||form.getAll(k).length!==1))throw Error('Offertens fält är ogiltiga.');
    const selectedTradeIn=form.get('trade_in_id');
    if(selectedTradeIn!==null&&selectedTradeIn!==''){if(typeof selectedTradeIn!=='string'||!uuid.test(selectedTradeIn)||form.get('trade_in_confirmed')!=='true')throw Error('Bekräfta det granskade kundsynliga inbytesunderlaget.');tradeInId=selectedTradeIn.toLowerCase();}
    function version(key:string,optional:boolean,min:number){const raw=form.get(key);if(raw===null&&optional)return null;if(typeof raw!=='string'||!/^(0|[1-9]\d*)$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<min||Number(raw)>2147483646)throw Error('Uppdatera offertunderlaget innan du försöker igen.');return Number(raw);}
    expectedTradeInVersion=version('expected_trade_in_version',!tradeInId,1);
    if(!tradeInId&&expectedTradeInVersion!==null)throw Error('Välj ett giltigt inbytesunderlag.');
    expectedOfferVersion=version('expected_offer_version',!tradeInId,0);
    const price=form.get('expected_sale_price_ore');if(price!==null){if(typeof price!=='string'||! /^[1-9]\d{0,11}$/.test(price)||BigInt(price)>999999999999n)throw Error('Affärspriset är ogiltigt.');expectedSalePriceOre=price;}
    if(tradeInId&&(expectedOfferVersion===null||expectedSalePriceOre===null)||((expectedOfferVersion===null)!==(expectedSalePriceOre===null)))throw Error('Uppdatera offertens pris och version innan du försöker igen.');
    deal = uuidField(form, 'deal_id');
    submission = uuidField(form, 'submission_id');
    expectedCompany = uuidField(form, 'company_id');
    if (form.get('gross_confirmed') !== 'true') throw new Error('Bekräfta att affärspriset är totalpris inklusive eventuell moms innan du skapar offerten.');
    const rawTerms = form.get('terms'), rawDate = form.get('valid_until');
    if (typeof rawTerms !== 'string' || Array.from(rawTerms).length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(rawTerms)) throw new Error('Villkoren får innehålla högst 2000 tecken och inga kontrolltecken.');
    if (typeof rawDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || rawDate.startsWith('0000')) throw new Error('Ange ett giltigt sista giltighetsdatum.');
    const parsed = new Date(`${rawDate}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== rawDate) throw new Error('Ange ett giltigt sista giltighetsdatum.');
    terms = rawTerms; validUntil = rawDate;
  } catch (error) { return { ok: false,code:'invalid_input', message: error instanceof Error ? error.message : 'Kontrollera offertens villkor och giltighetsdatum.' }; }
  try {
    const ctx=await requireCrmContext(expectedCompany.toLowerCase(),'write'),company=ctx.companyId;
    const db=ctx.db as unknown as SupabaseClient<OfferDatabase>;
    const {data,error}=expectedOfferVersion===null?await db.rpc('create_offer_version',{company,deal,submission,terms,valid_until:validUntil,gross_confirmed:true}):await db.rpc('create_offer_version_with_trade_in',{company,deal,submission,terms,valid_until:validUntil,gross_confirmed:true,trade_in_id:tradeInId,expected_trade_in_version:expectedTradeInVersion,expected_offer_version:expectedOfferVersion,expected_sale_price_ore:expectedSalePriceOre!});
    if (error) {
      const message = error.code === '40001' ? 'Offerten, affärspriset eller inbytesunderlaget har ändrats. Uppdatera underlaget; en accepterad offert kräver separat överenskommelse.' : error.code === '42501' ? 'Du har inte behörighet att skapa offertversionen.' : error.code === '22023' ? 'Kontrollera att datumet är inom 90 dagar och uppgifterna är giltiga. Ett inbyte måste ha granskad, känd skuld innan det kan ingå i kundofferten. Använd samma underlag vid återförsök.' : error.code === 'P0002' ? 'Affären är inte tillgänglig i det aktiva företaget.' : 'Offertversionen kunde inte bekräftas. Försök igen med samma underlag.';
      return { ok: false,code:error.code==='40001'?'conflict':error.code==='42501'?'access_denied':error.code==='22023'?'invalid_input':'unavailable', message };
    }
    if (typeof data !== 'string' || !uuid.test(data)) return { ok: false, message: 'Offertversionen kunde inte bekräftas. Försök igen med samma underlag.' };
    const fresh=await requireCrmContext(company,'write');if(fresh.userId!==ctx.userId||fresh.role!==ctx.role)throw new CrmError('access_denied');
    revalidatePath('/deals');
    return { ok: true, message: 'Offertversionen har sparats. Den skickas inte till kunden eller till en finanspartner.', offerId: data };
  } catch { return { ok: false,code:'access_denied', message: 'Offertversionen kunde inte bekräftas. Kontrollera din inloggning och försök igen med samma underlag.' }; }
}
