import { parseBillingPage, BILLING_UUID, BILLING_MONTH } from './billing-validation.ts';
import type { AdvertisingBillingPage } from './billing-types';
const cell=(v:string|number)=>`"${String(v).replace(/"/g,'""')}"`;
/** Exports the immutable locked original, never current channel prices or an issued invoice. */
export function generateAdvertisingBillingCsv(value:unknown){
 if(!value||typeof value!=='object')throw Error('Invalid report');
 const raw=value as AdvertisingBillingPage;
 if(!BILLING_UUID.test(raw.companyId)||!BILLING_UUID.test(raw.actorUserId)||!BILLING_MONTH.test(raw.month)||!['platform_admin','owner','admin','finance'].includes(raw.actorRole))throw Error('Invalid report scope');
 const page=parseBillingPage(value,raw.companyId,raw.month,raw.actorUserId,raw.actorRole),lock=page.locked;
 if(!lock)throw Error('Billing period is not locked');
 const rows:(string|number)[][]=[['Låst annonsunderlag','Underlag inför fakturering — ingen utfärdad faktura'],['Företags-ID',lock.companyId],['Månad',lock.month],['Tidszon','Europe/Stockholm'],['Period från (inklusive)',lock.periodStart],['Period till (exklusive)',lock.periodEnd],['Underlags-ID',lock.id],['Låst',lock.lockedAt],['Registrering startade',lock.trackingStartedAt],['Täckning',lock.coverage==='full'?'Hela perioden':'Del av perioden — uttryckligen granskad'],['Äldre publicerade jobb utan nytt perioddatum',lock.legacyPublishedJobs],['Originalets SHA-256',lock.reviewToken],['Valuta','SEK'],['Belopp','Exklusive moms; moms och fakturautställning ingår inte'],[],['Publicerings-ID','Annons-ID','Kanal','Registrerad publicering','Antal','Styckpris exklusive moms i öre','Radbelopp exklusive moms i öre','Prisgrund','Prisversion']];
 for(const item of lock.items){if(item.unitPriceOre===null)throw Error('Unpriced locked item');rows.push([item.publicationId,item.listingId,item.channel==='blocket'?'Blocket':'Wayke',item.publishedAt,1,item.unitPriceOre,item.unitPriceOre,item.priceSource==='rate'?'Aktivt kanalpris':'Granskat historiskt pris',item.rateVersion??'']);}
 rows.push([],['Kanal','Unika publiceringar','Summa exklusive moms i öre']);
 for(const channel of ['blocket','wayke']as const){const items=lock.items.filter(item=>item.channel===channel);rows.push([channel==='blocket'?'Blocket':'Wayke',items.length,items.reduce((sum,item)=>sum+BigInt(item.unitPriceOre!),0n).toString()]);}
 rows.push(['Totalt',lock.count,lock.totalOre],[],['Återförsök och nya annonsversioner ger inga extra debiteringsenheter.']);
 return '\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n')+'\r\n';
}
