import { z } from 'zod';
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const counts = { queued:count,dispatching:count,outcomeUnknown:count,submitted:count,published:count,rejected:count,retryable:count,newPublications:count };
const schema = z.object({companyId:z.string().uuid(),month:z.string().regex(/^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$/),timeZone:z.literal('Europe/Stockholm'),periodStart:z.string().datetime({offset:true}),periodEnd:z.string().datetime({offset:true}),trackingStartedAt:z.string().datetime({offset:true}),legacyPublishedJobs:count,
 totals:z.object({...counts,drafts:count,ready:count}),channels:z.array(z.object({...counts,channel:z.enum(['blocket','wayke'])})).length(2),billing:z.object({status:z.literal('quantity_only'),unitPriceOre:z.null(),totalOre:z.null(),unpricedPublications:count})});
function boundary(value:string,month:string,end:boolean){
 const date=new Date(value),parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const get=(key:string)=>parts.find(p=>p.type===key)?.value,[year,m]=month.split('-').map(Number),want=end?new Date(Date.UTC(year,m,1)):new Date(Date.UTC(year,m-1,1));
 if(date.getUTCMilliseconds()!==0||get('year')!==String(want.getUTCFullYear())||get('month')!==String(want.getUTCMonth()+1).padStart(2,'0')||get('day')!=='01'||get('hour')!=='00'||get('minute')!=='00'||get('second')!=='00')throw Error('Invalid period boundary');
}
const cell=(v:string|number)=>`"${String(v).replace(/"/g,'""')}"`;
/** Quantity basis only. Monetary amounts belong to the separate reviewed billing report. */
export function generateAdvertisingUsageCsv(value:unknown){
 const page=schema.parse(value);
 boundary(page.periodStart,page.month,false);boundary(page.periodEnd,page.month,true);
 if(page.channels[0].channel!=='blocket'||page.channels[1].channel!=='wayke'||Object.keys(counts).some(k=>page.channels.reduce((sum,row)=>sum+row[k as keyof typeof counts],0)!==page.totals[k as keyof typeof counts])||page.billing.unpricedPublications>page.totals.newPublications)throw Error('Invalid usage totals');
 const rows:(string|number)[][]=[['Annonsunderlag','Antal per unik publicerad annons och kanal'],['Företags-ID',page.companyId],['Månad',page.month],['Tidszon',page.timeZone],['Period från (inklusive)',page.periodStart],['Period till (exklusive)',page.periodEnd],['Registrering startade',page.trackingStartedAt],['Äldre publicerade jobb utan periodbevis',page.legacyPublishedJobs],['Prisstatus','Priser ingår inte i antalunderlaget'],[],['Kanal','Nya unika publiceringar under månaden','Styckpris i öre','Belopp i öre']];
 for(const row of page.channels)rows.push([row.channel==='blocket'?'Blocket':'Wayke',row.newPublications,'','']);
 rows.push(['Totalt',page.totals.newPublications,'',''],[],['Aktuell leveransstatus — hela historiken','Köad','Pågår','Okänt utfall','Inskickad','Publicerad','Avvisad','Nytt försök']);
 for(const row of page.channels)rows.push([row.channel==='blocket'?'Blocket':'Wayke',row.queued,row.dispatching,row.outcomeUnknown,row.submitted,row.published,row.rejected,row.retryable]);
 rows.push([],['Underlaget är ingen utfärdad faktura.','Uppdateringar och återförsök ger inga nya debiteringsenheter.']);
 return '\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n')+'\r\n';
}
