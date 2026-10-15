async function read(input, platform) {
 window.correctionCalls ??= [];
 window.correctionCalls.push({kind:'read',...input,platform});
 const next=window.correctionResponses?.shift();
 if(next?.hold)return new Promise(resolve=>{window.releaseCorrection=resolve;});
 if(next)return next;
 if(!window.corrections)return {ok:false,code:'unavailable',message:'Rättelseunderlag saknas i testet'};
 return {ok:true,page:{...window.corrections,month:input.month}};
}
export const getPlatformAdvertisingCorrectionsAction=input=>read(input,true);
export const listAdvertisingCorrectionsAction=input=>read(input,false);
export async function createAdvertisingReductionAction(input) {
 window.correctionCalls.push({kind:'create',...input});
 const next=window.correctionMutationResponses?.shift();
 if(next?.hold)return new Promise(resolve=>{window.releaseCorrectionMutation=resolve;});
 if(next?.throw)throw new Error('Simulated unknown outcome');
 if(next)return next;
 return {ok:true,page:window.corrections,receipt:{id:'10000000-0000-4000-8000-000000000060',companyId:input.companyId,actorUserId:window.corrections.actorUserId,requestId:input.requestId}};
}
