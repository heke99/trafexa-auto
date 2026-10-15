async function read(input,platform) {
 window.invoiceCalls ??=[];window.invoiceCalls.push({kind:'read',...input,platform});
 const next=window.invoiceResponses?.shift();if(next?.hold)return new Promise(resolve=>{window.releaseInvoices=resolve;});if(next)return next;
 if(!window.invoicePage)return {ok:false,code:'unavailable',message:'Fakturafixture saknas'};
 return {ok:true,page:{...window.invoicePage,month:input.month}};
}
export const getPlatformAdvertisingInvoicePageAction=input=>read(input,true);
export const listAdvertisingInvoicePageAction=input=>read(input,false);
async function save(kind,input,platform=false){
 window.invoiceCalls.push({kind,...input,platform});const next=window.invoiceMutationResponses?.shift();if(next?.throw)throw Error('Unknown outcome');if(next)return next;
 const companyId=kind==='seller'?null:input.companyId;
 return {ok:true,profile:kind==='seller'?window.invoicePage.sellerProfile:window.invoicePage.buyerProfile,receipt:{profileId:'10000000-0000-4000-8000-000000000060',kind,companyId,actorUserId:window.invoicePage.actorUserId,requestId:input.requestId}};
}
export const saveAdvertisingBuyerProfileAction=input=>save('buyer',input,false);
export const savePlatformAdvertisingBuyerProfileAction=input=>save('buyer',input,true);
export const saveAdvertisingSellerProfileAction=input=>save('seller',input,true);
export async function createAdvertisingInvoiceDraftAction(input){
 window.invoiceCalls.push({kind:'create',...input});const next=window.invoiceMutationResponses?.shift();if(next?.throw)throw Error('Unknown outcome');if(next)return next;
 return {ok:true,draft:window.invoiceDraft,isOutdated:false,receipt:{draftId:window.invoiceDraft.id,companyId:input.companyId,actorUserId:window.invoicePage.actorUserId,requestId:input.requestId,sourceHash:window.invoiceDraft.sourceHash}};
}
async function detail(input,platform){
 window.invoiceCalls.push({kind:'detail',...input,platform});const next=window.invoiceDetailResponses?.shift();if(next?.hold)return new Promise(resolve=>{window.releaseInvoiceDetail=resolve;});if(next)return next;return {ok:true,draft:window.invoiceDraft,isOutdated:window.invoiceOutdated??false};
}
export const getAdvertisingInvoiceDraftAction=input=>detail(input,false);
export const getPlatformAdvertisingInvoiceDraftAction=input=>detail(input,true);
