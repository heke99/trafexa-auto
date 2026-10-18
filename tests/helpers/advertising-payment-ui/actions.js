async function response(queue){const next=queue?.shift();if(next?.hold)return new Promise((resolve,reject)=>window.releasePayment={resolve,reject});if(next?.throw)throw Error('Unknown result');return next;}
async function read(input,platform){window.paymentCalls.push({kind:'read',platform,...input});const next=await response(window.paymentReads);return next??{ok:true,page:structuredClone(window.paymentPage)};}
export const getPlatformAdvertisingPaymentPageAction=input=>read(input,true);
export const listAdvertisingPaymentPageAction=input=>read(input,false);
export async function lookupAdvertisingPaymentAction(input){window.paymentCalls.push({kind:'lookup',...input});const next=await response(window.paymentLookups);return next??{ok:true,...input,actorUserId:window.paymentPage.actorUserId,entry:window.paymentSource??null};}
async function write(input,kind){
 window.paymentCalls.push({kind,...structuredClone(input)});
 const custom=window.paymentWrites.shift();if(custom?.hold)return new Promise((resolve,reject)=>window.releasePayment={resolve,reject});if(custom?.throw)throw Error('Unknown result');if(custom&&!custom.throwAfter)return custom;
 const old=window.paymentSaved[input.requestId];if(old)return old;
 const page=window.paymentPage,source=kind==='reverse'?page.entries.find(row=>row.id===input.entryId):null;
 const entry={id:`40000000-0000-4000-8000-${String(window.paymentCalls.length).padStart(12,'0')}`,sequence:String(BigInt(page.latestSequence)+1n),companyId:input.companyId,invoiceId:input.invoiceId,invoiceNumber:page.invoiceNumber,invoiceSourceHash:input.expectedInvoiceSourceHash,sellerOrganisationNumber:'5568554884',kind:kind==='reverse'?'reversal':'receipt',amountOre:source?.amountOre??input.amountOre,paymentIdentifier:source?.paymentIdentifier??input.paymentIdentifier,bankReference:source?.bankReference??input.bankReference,bookedDate:source?.bookedDate??input.bookedDate,reason:input.reason,createdAt:'2026-10-18T10:00:00Z',createdBy:page.actorUserId,reversesEntryId:source?.id??null,replacesEntryId:input.replacesEntryId??null,sourceHash:'c'.repeat(64),canonicalSnapshot:'fixture',isReversed:false,isReplaced:false};
 const paid=BigInt(page.receivedOre)+(kind==='reverse'?-BigInt(entry.amountOre):BigInt(entry.amountOre)),due=BigInt(page.receivableOre);
 page.entries=[entry,...page.entries.map(row=>row.id===source?.id?{...row,isReversed:true}:row)];page.latestSequence=entry.sequence;page.entryCount=String(BigInt(page.entryCount)+1n);page.receivedOre=String(paid);page.outstandingOre=String(due>paid?due-paid:0n);page.surplusOre=String(paid>due?paid-due:0n);page.status=page.credit?'credited':paid>due?'overpaid':paid===due?'settled':paid>0n?'partial':'unpaid';page.reviewToken='d'.repeat(64);
 const result={ok:true,entry,receipt:{entryId:entry.id,companyId:input.companyId,invoiceId:input.invoiceId,actorUserId:page.actorUserId,requestId:input.requestId,sourceHash:entry.sourceHash,reviewToken:input.expectedReviewToken}};
 window.paymentSaved[input.requestId]=result;if(custom?.throwAfter)throw Error('Unknown after commit');return result;
}
export const registerAdvertisingPaymentAction=input=>write(input,'register');
export const reverseAdvertisingPaymentAction=input=>write(input,'reverse');
