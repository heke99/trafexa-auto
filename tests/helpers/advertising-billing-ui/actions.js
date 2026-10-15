async function read(input, platform) {
 window.billingCalls ??= [];
 window.billingCalls.push({ kind: 'read', ...input, platform });
 const next = window.billingResponses?.shift();
 if (next?.hold) return new Promise(resolve => { window.releaseBilling = resolve; });
 if (next) return next;
 if (!window.billing) return {ok:false,code:'unavailable',message:'Prisunderlag saknas i testet'};
 return {ok:true,page:{...window.billing,month:input.month}};
}
export const getPlatformAdvertisingBillingAction = input => read(input,true);
export const listAdvertisingBillingAction = input => read(input,false);
async function mutate(kind,input) { window.billingCalls.push({kind,...input}); const next = window.billingMutationResponses?.shift(); if(next)return next; if(kind==='rate')return {ok:true,rate:{}}; return {ok:true,page:window.billing}; }
export const saveAdvertisingChannelRateAction = input => mutate('rate',input);
export const reconcileAdvertisingBillingAction = input => mutate('reconcile',input);
export const lockAdvertisingBillingPeriodAction = input => mutate('lock',input);
