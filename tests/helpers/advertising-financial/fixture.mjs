import {createHash} from 'node:crypto';
import {invoiceFixture,resignInvoice,id} from '../advertising-invoices/fixture.mjs';
export {id};
const digest=value=>createHash('sha256').update(value).digest('hex');
export const financialFields=()=>({vatTreatment:'se_standard_25',sellerVatRegistered:true,sellerVatNumber:'SE556855488401',paymentDays:30,paymentMethod:'bankgiro',paymentAccount:'9912346',reason:'Granskad svensk annonsering och betalningsuppgifter'});
export function financialInvoice(prices=['2','2']){
 const draft=invoiceFixture(),basis=draft.snapshot.basis,original=basis.original;
 for(let index=0;index<original.items.length;index++)original.items[index].unitPriceOre=prices[index];
 original.totalOre=prices.reduce((sum,value)=>sum+BigInt(value),0n).toString();
 const old=JSON.parse(original.canonicalSnapshot);old.items=original.items;old.totalOre=original.totalOre;
 original.canonicalSnapshot=JSON.stringify(old);original.reviewToken=digest(original.canonicalSnapshot);
 basis.adjustments=[];basis.reductionTotalOre='0';basis.netTotalOre=original.totalOre;
 const canonical=JSON.parse(basis.canonicalSnapshot);canonical.originalReviewToken=original.reviewToken;canonical.adjustments=[];canonical.reductionTotalOre='0';canonical.netTotalOre=original.totalOre;
 basis.canonicalSnapshot=JSON.stringify(canonical);basis.reviewToken=digest(basis.canonicalSnapshot);
 return resignInvoice(draft);
}

export function financialAssessment(prices=['2','2']){
 const draft=financialInvoice(prices),fields=financialFields(),settingsCanonical=JSON.stringify({companyId:draft.companyId,version:1,fields});
 const settings={companyId:draft.companyId,version:1,fields,reviewToken:digest(settingsCanonical),canonicalSnapshot:settingsCanonical,updatedAt:'2026-10-15T09:01:00Z'};
 const sourceCanonicalSnapshot=JSON.stringify({companyId:draft.companyId,month:draft.month,draftId:draft.id,draftSourceHash:draft.sourceHash,settingsVersion:settings.version,settingsReviewToken:settings.reviewToken,calculationVersion:1});
 const lines=draft.snapshot.basis.original.items.map(item=>{const net=BigInt(item.unitPriceOre),vat=(net*25n+50n)/100n;return{publicationId:item.publicationId,listingId:item.listingId,channel:item.channel,originalOre:String(net),reductionOre:'0',netOre:String(net),vatOre:String(vat),grossOre:String(net+vat)};});
 const sum=key=>lines.reduce((s,line)=>s+BigInt(line[key]),0n).toString();
 const snapshot={status:'reviewed_draft',currency:'SEK',calculationVersion:1,companyId:draft.companyId,month:draft.month,sourceReviewToken:digest(sourceCanonicalSnapshot),sourceCanonicalSnapshot,draft,settings,lines,netTotalOre:sum('netOre'),vatTotalOre:sum('vatOre'),grossTotalOre:sum('grossOre')};
 return resignFinancial({id:id(70),companyId:draft.companyId,month:draft.month,version:1,createdAt:'2026-10-15T09:02:00Z',snapshot});
}
export function resignFinancial(value){value.canonicalSnapshot=JSON.stringify(value.snapshot);value.sourceHash=digest(value.canonicalSnapshot);return value;}
