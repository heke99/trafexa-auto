// Unrelated browser harnesses retain the actual lazy payment component. Reads are
// safely unavailable; unexpected writes must fail the test instead of reaching IO.
const unavailable=async()=>({ok:false,code:'unavailable',message:'Betalningsavstämning ingår inte i denna testvy.'});
const unexpected=async()=>{throw Error('Unexpected payment mutation in unrelated UI harness');};
export const getPlatformAdvertisingPaymentPageAction=unavailable;
export const listAdvertisingPaymentPageAction=unavailable;
export const lookupAdvertisingPaymentAction=unexpected;
export const registerAdvertisingPaymentAction=unexpected;
export const reverseAdvertisingPaymentAction=unexpected;
